import { URI } from '@foam/core';
import { IDataStore } from '@foam/core';
import { Logger } from '@foam/core';
import { EmbeddingCache, EmbeddingCacheEntry } from './embedding-cache';

/**
 * File-based implementation of embedding cache that persists to disk
 */
export class FileEmbeddingCache implements EmbeddingCache {
  private cache: Map<string, EmbeddingCacheEntry> = new Map();
  private saveTimeout: NodeJS.Timeout | null = null;
  private isSaving = false;
  private needsSave = false;

  constructor(
    private readonly dataStore: IDataStore,
    private readonly uri: URI
  ) {}

  async load(): Promise<void> {
    try {
      const exists = await this.dataStore.exists(this.uri);
      if (!exists) {
        return;
      }
      const content = await this.dataStore.read(this.uri);
      if (content) {
        const data = JSON.parse(content);
        this.cache.clear();
        for (const [key, value] of Object.entries(data)) {
          this.cache.set(key, value as EmbeddingCacheEntry);
        }
        Logger.info(`Loaded ${this.cache.size} embeddings from cache file`);
      }
    } catch (e) {
      Logger.error(`Failed to load embeddings cache from ${this.uri.path}`, e);
    }
  }

  private scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.save();
    }, 2000); // debounce 2 seconds
  }

  private async save(): Promise<void> {
    if (this.isSaving) {
      this.needsSave = true;
      return;
    }
    this.isSaving = true;
    this.needsSave = false;
    try {
      const data = Object.fromEntries(this.cache.entries());
      await this.dataStore.write(this.uri, JSON.stringify(data, null, 2));
      Logger.debug(`Saved embeddings cache to ${this.uri.path}`);
    } catch (e) {
      Logger.error(`Failed to save embeddings cache to ${this.uri.path}`, e);
    } finally {
      this.isSaving = false;
      if (this.needsSave) {
        this.scheduleSave();
      }
    }
  }

  get(uri: URI): EmbeddingCacheEntry {
    return this.cache.get(uri.toString()) as EmbeddingCacheEntry;
  }

  has(uri: URI): boolean {
    return this.cache.has(uri.toString());
  }

  set(uri: URI, entry: EmbeddingCacheEntry): void {
    this.cache.set(uri.toString(), entry);
    this.scheduleSave();
  }

  del(uri: URI): void {
    this.cache.delete(uri.toString());
    this.scheduleSave();
  }

  clear(): void {
    this.cache.clear();
    this.scheduleSave();
  }
}
