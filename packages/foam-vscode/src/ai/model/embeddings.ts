import { Emitter } from '@foam/core';
import { IDisposable } from '@foam/core';
import { Logger } from '@foam/core';
import { hash } from '@foam/core';
import { EmbeddingProvider, Embedding } from '../services/embedding-provider';
import { EmbeddingCache } from './embedding-cache';
import {
  ProgressCallback,
  CancellationToken,
  CancellationError,
} from '@foam/core';
import { FoamWorkspace } from '@foam/core';
import { URI } from '@foam/core';

/**
 * Represents a similar resource with its similarity score
 */
export interface SimilarResource {
  uri: URI;
  similarity: number;
}

/**
 * Context information for embedding progress
 */
export interface EmbeddingProgressContext {
  /** URI of the current resource */
  uri: URI;
  /** Title of the current resource */
  title: string;
}

/**
 * Manages embeddings for all resources in the workspace
 */
export class FoamEmbeddings implements IDisposable {
  /**
   * Maps resource URIs to their embeddings
   */
  private embeddings: Map<string, Embedding> = new Map();

  private onDidUpdateEmitter = new Emitter<void>();
  onDidUpdate = this.onDidUpdateEmitter.event;

  /**
   * List of disposables to destroy with the embeddings
   */
  private disposables: IDisposable[] = [];

  constructor(
    private readonly workspace: FoamWorkspace,
    private readonly provider: EmbeddingProvider,
    private readonly cache?: EmbeddingCache,
    private readonly batchSize: number = FoamEmbeddings.DEFAULT_BATCH_SIZE
  ) {}

  /**
   * Get the embedding for a resource
   * @param uri The URI of the resource
   * @returns The embedding vector, or null if not found
   */
  public getEmbedding(uri: URI): number[] | null {
    const embedding = this.embeddings.get(uri.path);
    return embedding ? embedding.vector : null;
  }

  /**
   * Get the embedding for an arbitrary query string using the provider
   * @param query The query text
   * @returns The embedding vector
   */
  public async getQueryEmbedding(query: string): Promise<number[]> {
    return this.provider.embed(query);
  }

  /**
   * Check if embeddings are available
   * @returns true if at least one embedding exists
   */
  public hasEmbeddings(): boolean {
    return this.embeddings.size > 0;
  }

  /**
   * Get the number of embeddings
   * @returns The count of embeddings
   */
  public size(): number {
    return this.embeddings.size;
  }

  /**
   * Find similar resources to a given resource
   * @param uri The URI of the target resource
   * @param topK The number of similar resources to return
   * @returns Array of similar resources sorted by similarity (highest first)
   */
  public getSimilar(uri: URI, topK: number = 10): SimilarResource[] {
    const targetEmbedding = this.getEmbedding(uri);
    if (!targetEmbedding) {
      return [];
    }

    const similarities: SimilarResource[] = [];

    for (const [path, embedding] of this.embeddings.entries()) {
      // Skip self
      if (path === uri.path) {
        continue;
      }

      const similarity = this.cosineSimilarity(
        targetEmbedding,
        embedding.vector
      );
      similarities.push({
        uri: URI.file(path),
        similarity,
      });
    }

    // Sort by similarity (highest first) and take top K
    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, topK);
  }

  /**
   * Search for resources using an arbitrary query string
   * @param query The search query
   * @param topK The number of results to return
   * @returns Array of similar resources sorted by similarity
   */
  public async search(query: string, topK: number = 50): Promise<SimilarResource[]> {
    const targetEmbedding = await this.getQueryEmbedding(query);
    if (targetEmbedding.length === 0) {
      Logger.debug('Query embedding is empty (AI provider may be disabled or unavailable)');
      return [];
    }
    const similarities: SimilarResource[] = [];

    for (const [path, embedding] of this.embeddings.entries()) {
      if (embedding.vector.length !== targetEmbedding.length) {
        Logger.debug(`Skipping ${path}: dimension mismatch (${embedding.vector.length} vs ${targetEmbedding.length})`);
        continue;
      }
      const similarity = this.cosineSimilarity(
        targetEmbedding,
        embedding.vector
      );
      similarities.push({
        uri: URI.file(path),
        similarity,
      });
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, topK);
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param a First vector
   * @param b Second vector
   * @returns Similarity score between -1 and 1 (higher is more similar)
   */
  public cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Update embeddings for a single resource
   * @param uri The URI of the resource to update
   * @returns The embedding vector, or null if not found/not processed
   */
  public async updateResource(uri: URI): Promise<Embedding | null> {
    const resource = this.workspace.find(uri);
    if (!resource) {
      // Resource deleted, remove embedding
      this.embeddings.delete(uri.path);
      if (this.cache) {
        this.cache.del(uri);
      }
      this.onDidUpdateEmitter.fire();
      return null;
    }

    // Skip non-note resources (attachments)
    if (resource.type !== 'note') {
      return null;
    }

    try {
      const content = await this.workspace.readAsMarkdown(resource.uri);
      const text = this.prepareTextForEmbedding(resource.title, content);
      const textChecksum = hash(text);

      // Check cache if available
      if (this.cache && this.cache.has(uri)) {
        const cached = this.cache.get(uri);
        if (cached.checksum === textChecksum) {
          Logger.debug(
            `Skipping embedding for ${uri.toFsPath()} - content unchanged`
          );
          // Use cached embedding
          const embedding: Embedding = {
            vector: cached.embedding,
            createdAt: Date.now(),
          };
          this.embeddings.set(uri.path, embedding);
          return embedding;
        }
      }

      // Generate new embedding
      const vector = await this.provider.embed(text);

      const embedding: Embedding = {
        vector,
        createdAt: Date.now(),
      };
      this.embeddings.set(uri.path, embedding);

      // Update cache
      if (this.cache) {
        this.cache.set(uri, {
          checksum: textChecksum,
          embedding: vector,
        });
      }

      this.onDidUpdateEmitter.fire();
      return embedding;
    } catch (error) {
      Logger.error(`Failed to update embedding for ${uri.toFsPath()}`, error);
      return null;
    }
  }

  /** Default batch size for embedding API calls */
  static readonly DEFAULT_BATCH_SIZE = 128;

  /**
   * Update embeddings for all notes, processing only missing or stale ones.
   * Uses batch API calls when the provider supports embedBatch().
   * @param onProgress Optional callback to report progress
   * @param cancellationToken Optional token to cancel the operation
   * @returns Promise that resolves when all embeddings are updated
   * @throws CancellationError if the operation is cancelled
   */
  public async update(
    onProgress?: ProgressCallback<EmbeddingProgressContext>,
    cancellationToken?: CancellationToken
  ): Promise<void> {
    const start = Date.now();

    // Filter to only process notes (not attachments)
    const allResources = Array.from(this.workspace.resources());
    const resources = allResources.filter(r => r.type === 'note');

    Logger.info(
      `Building embeddings for ${resources.length} notes (${allResources.length} total resources)...`
    );

    let skipped = 0;
    let generated = 0;
    let reused = 0;

    // Phase 1: Read all content, check cache, and collect items needing new embeddings
    const pending: { text: string; checksum: string; uri: URI; title: string }[] = [];

    for (let i = 0; i < resources.length; i++) {
      if (cancellationToken?.isCancellationRequested) {
        Logger.info(
          `Embedding build cancelled. Processed ${i}/${resources.length} notes.`
        );
        throw new CancellationError('Embedding build cancelled');
      }

      const resource = resources[i];

      try {
        const content = await this.workspace.readAsMarkdown(resource.uri);
        const text = this.prepareTextForEmbedding(resource.title, content);
        const textChecksum = hash(text);

        // Check cache if available
        if (this.cache && this.cache.has(resource.uri)) {
          const cached = this.cache.get(resource.uri);
          if (cached.checksum === textChecksum) {
            const existing = this.embeddings.get(resource.uri.path);
            if (existing) {
              reused++;
              continue;
            }

            // Restore from cache
            this.embeddings.set(resource.uri.path, {
              vector: cached.embedding,
              createdAt: Date.now(),
            });
            skipped++;
            continue;
          }
        }

        pending.push({ text, checksum: textChecksum, uri: resource.uri, title: resource.title });
      } catch (error) {
        Logger.error(
          `Failed to read content for ${resource.uri.toFsPath()}`,
          error
        );
      }
    }

    // Phase 2: Generate embeddings in batches
    const supportsEmbedBatch = typeof this.provider.embedBatch === 'function';
    const alreadyProcessed = skipped + reused;

    for (let batchStart = 0; batchStart < pending.length; batchStart += this.batchSize) {
      if (cancellationToken?.isCancellationRequested) {
        Logger.info(
          `Embedding build cancelled during batch processing. Generated ${generated}/${pending.length} embeddings.`
        );
        throw new CancellationError('Embedding build cancelled');
      }

      const batch = pending.slice(batchStart, batchStart + this.batchSize);

      // Report progress
      onProgress?.({
        current: alreadyProcessed + batchStart + batch.length,
        total: resources.length,
        context: {
          uri: batch[0].uri,
          title: `Generating ${batchStart + 1}-${batchStart + batch.length}/${pending.length}`,
        },
      });

      try {
        let vectors: number[][];

        if (supportsEmbedBatch) {
          vectors = await this.provider.embedBatch!(batch.map(item => item.text));
        } else {
          vectors = [];
          for (const item of batch) {
            vectors.push(await this.provider.embed(item.text));
          }
        }

        for (let j = 0; j < batch.length; j++) {
          const item = batch[j];
          const vector = vectors[j];

          this.embeddings.set(item.uri.path, {
            vector,
            createdAt: Date.now(),
          });

          if (this.cache) {
            this.cache.set(item.uri, {
              checksum: item.checksum,
              embedding: vector,
            });
          }

          generated++;
        }
      } catch (error) {
        Logger.error(
          `Failed to generate embeddings for batch starting at index ${batchStart}`,
          error
        );
      }
    }

    // Flush cache to disk once after all batches complete
    if (this.cache?.flush && generated > 0) {
      await this.cache.flush();
    }

    const end = Date.now();
    Logger.info(
      `Embeddings update complete: ${generated} generated, ${skipped} from cache, ${reused} already current (${
        this.embeddings.size
      }/${resources.length} total) in ${end - start}ms`
    );
    this.onDidUpdateEmitter.fire();
  }

  /**
   * Prepare text for embedding by combining title and content
   * @param title The title of the note
   * @param content The markdown content of the note
   * @returns The combined text to embed
   */
  private prepareTextForEmbedding(title: string, content: string): string {
    const parts: string[] = [];

    if (title) {
      parts.push(title);
    }

    if (content) {
      parts.push(content);
    }

    return parts.join('\n\n');
  }

  /**
   * Create FoamEmbeddings from a workspace
   * @param workspace The workspace to generate embeddings for
   * @param provider The embedding provider to use
   * @param keepMonitoring Whether to automatically update embeddings when workspace changes
   * @param cache Optional cache for storing embeddings
   * @returns The FoamEmbeddings instance
   */
  public static fromWorkspace(
    workspace: FoamWorkspace,
    provider: EmbeddingProvider,
    keepMonitoring: boolean = false,
    cache?: EmbeddingCache,
    batchSize?: number
  ): FoamEmbeddings {
    const embeddings = new FoamEmbeddings(workspace, provider, cache, batchSize);

    if (keepMonitoring) {
      // Update embeddings when resources change
      embeddings.disposables.push(
        workspace.onDidAdd(resource => {
          embeddings.updateResource(resource.uri);
        }),
        workspace.onDidUpdate(({ new: resource }) => {
          embeddings.updateResource(resource.uri);
        }),
        workspace.onDidDelete(resource => {
          embeddings.embeddings.delete(resource.uri.path);
          embeddings.onDidUpdateEmitter.fire();
        })
      );
    }

    return embeddings;
  }

  public dispose(): void {
    this.onDidUpdateEmitter.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.embeddings.clear();
  }
}
