import { FoamEmbeddings } from './embeddings';
import {
  EmbeddingProvider,
  EmbeddingProviderInfo,
} from '../services/embedding-provider';
import {
  createTestWorkspace,
  InMemoryDataStore,
  waitForExpect,
} from '../../test/test-utils';
import { URI } from '@foam/core';
import { InMemoryEmbeddingCache } from './in-memory-embedding-cache';

// Helper to create a simple mock provider
class MockProvider implements EmbeddingProvider {
  embedCallCount = 0;

  async embed(text: string): Promise<number[]> {
    this.embedCallCount++;
    const vector = Array.from({ length: 384 }).fill(0) as number[];
    vector[0] = text.length / 100; // Deterministic based on text length
    return vector;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  getProviderInfo(): EmbeddingProviderInfo {
    return {
      name: 'Test Provider',
      type: 'local',
      model: { name: 'test-model', dimensions: 384 },
    };
  }
}

// Mock provider with embedBatch support
class BatchMockProvider extends MockProvider {
  embedBatchCallCount = 0;

  async embedBatch(texts: string[]): Promise<number[][]> {
    this.embedBatchCallCount++;
    return texts.map(text => {
      const vector = Array.from({ length: 384 }).fill(0) as number[];
      vector[0] = text.length / 100;
      return vector;
    });
  }
}

const ROOT = [URI.parse('/', 'file')];

describe('FoamEmbeddings', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());
      const vector = [1, 2, 3, 4, 5];
      const similarity = embeddings.cosineSimilarity(vector, vector);
      expect(similarity).toBeCloseTo(1.0, 5);
      workspace.dispose();
    });

    it('should return 0 for orthogonal vectors', () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const similarity = embeddings.cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(0.0, 5);
      workspace.dispose();
    });

    it('should return -1 for opposite vectors', () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());
      const vec1 = [1, 0, 0];
      const vec2 = [-1, 0, 0];
      const similarity = embeddings.cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(-1.0, 5);
      workspace.dispose();
    });

    it('should return 0 for zero vectors', () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      const similarity = embeddings.cosineSimilarity(vec1, vec2);
      expect(similarity).toBe(0);
      workspace.dispose();
    });

    it('should throw error for vectors of different lengths', () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2];
      expect(() => embeddings.cosineSimilarity(vec1, vec2)).toThrow();
      workspace.dispose();
    });
  });

  describe('updateResource', () => {
    it('should create embedding for a resource', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      const noteUri = URI.parse('/path/to/note.md', 'file');
      datastore.set(noteUri, '# Test Note\n\nThis is test content');
      await workspace.fetchAndSet(noteUri);

      await embeddings.updateResource(noteUri);

      const embedding = embeddings.getEmbedding(noteUri);
      expect(embedding).not.toBeNull();
      expect(embedding?.length).toBe(384);

      workspace.dispose();
    });

    it('should remove embedding when resource is deleted', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      const noteUri = URI.parse('/path/to/note.md', 'file');
      datastore.set(noteUri, '# Test Note\n\nContent');
      await workspace.fetchAndSet(noteUri);

      await embeddings.updateResource(noteUri);
      expect(embeddings.getEmbedding(noteUri)).not.toBeNull();

      workspace.delete(noteUri);
      await embeddings.updateResource(noteUri);

      expect(embeddings.getEmbedding(noteUri)).toBeNull();

      workspace.dispose();
    });

    it('should create different embeddings for different content', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      const note1Uri = URI.parse('/note1.md', 'file');
      const note2Uri = URI.parse('/note2.md', 'file');

      // Same title, different content
      datastore.set(note1Uri, '# Same Title\n\nShort content');
      datastore.set(
        note2Uri,
        '# Same Title\n\nThis is much longer content that should produce a different embedding vector'
      );

      await workspace.fetchAndSet(note1Uri);
      await workspace.fetchAndSet(note2Uri);

      await embeddings.updateResource(note1Uri);
      await embeddings.updateResource(note2Uri);

      const embedding1 = embeddings.getEmbedding(note1Uri);
      const embedding2 = embeddings.getEmbedding(note2Uri);

      expect(embedding1).not.toBeNull();
      expect(embedding2).not.toBeNull();

      // Embeddings should be different because content is different
      // Our mock provider uses text.length for the first vector component
      expect(embedding1![0]).not.toBe(embedding2![0]);

      workspace.dispose();
    });
  });

  describe('hasEmbeddings', () => {
    it('should return false when no embeddings exist', () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());
      expect(embeddings.hasEmbeddings()).toBe(false);
      workspace.dispose();
    });

    it('should return true when embeddings exist', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      const noteUri = URI.parse('/path/to/note.md', 'file');
      datastore.set(noteUri, '# Note\n\nContent');
      await workspace.fetchAndSet(noteUri);

      await embeddings.updateResource(noteUri);

      expect(embeddings.hasEmbeddings()).toBe(true);

      workspace.dispose();
    });
  });

  describe('getSimilar', () => {
    it('should return empty array when no embedding exists for target', () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());
      const uri = URI.parse('/path/to/note.md', 'file');

      const similar = embeddings.getSimilar(uri, 5);

      expect(similar).toEqual([]);
      workspace.dispose();
    });

    it('should return similar notes sorted by similarity', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      // Create notes with different content lengths
      const note1Uri = URI.parse('/note1.md', 'file');
      const note2Uri = URI.parse('/note2.md', 'file');
      const note3Uri = URI.parse('/note3.md', 'file');

      datastore.set(note1Uri, '# Note 1\n\nShort');
      datastore.set(note2Uri, '# Note 2\n\nMedium length text');
      datastore.set(note3Uri, '# Note 3\n\nVery long text content here');

      await workspace.fetchAndSet(note1Uri);
      await workspace.fetchAndSet(note2Uri);
      await workspace.fetchAndSet(note3Uri);

      await embeddings.updateResource(note1Uri);
      await embeddings.updateResource(note2Uri);
      await embeddings.updateResource(note3Uri);

      // Get similar to note2
      const similar = embeddings.getSimilar(note2Uri, 10);

      expect(similar.length).toBe(2); // Excludes self
      expect(similar[0].uri.path).toBeTruthy();
      expect(similar[0].similarity).toBeGreaterThanOrEqual(
        similar[1].similarity
      );

      workspace.dispose();
    });

    it('should respect topK parameter', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      // Create multiple notes
      for (let i = 0; i < 10; i++) {
        const noteUri = URI.parse(`/note${i}.md`, 'file');
        datastore.set(noteUri, `# Note ${i}\n\nContent ${i}`);
        await workspace.fetchAndSet(noteUri);
        await embeddings.updateResource(noteUri);
      }

      const target = URI.parse('/note0.md', 'file');
      const similar = embeddings.getSimilar(target, 3);

      expect(similar.length).toBe(3);

      workspace.dispose();
    });

    it('should not include self in similar results', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      const noteUri = URI.parse('/note.md', 'file');
      datastore.set(noteUri, '# Note\n\nContent');
      await workspace.fetchAndSet(noteUri);
      await embeddings.updateResource(noteUri);

      const similar = embeddings.getSimilar(noteUri, 10);

      expect(similar.find(s => s.uri.path === noteUri.path)).toBeUndefined();

      workspace.dispose();
    });
  });

  describe('search', () => {
    it('should return empty array when no embeddings exist', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      const results = await embeddings.search('query', 5);

      expect(results).toEqual([]);
      workspace.dispose();
    });

    it('should return results sorted by similarity to query', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      const note1Uri = URI.parse('/note1.md', 'file');
      const note2Uri = URI.parse('/note2.md', 'file');
      const note3Uri = URI.parse('/note3.md', 'file');

      // Content lengths: 10, 20, 30 characters
      datastore.set(note1Uri, '# Note 1\n\nShort text');
      datastore.set(note2Uri, '# Note 2\n\nMedium length text');
      datastore.set(note3Uri, '# Note 3\n\nVery long text content here');

      await workspace.fetchAndSet(note1Uri);
      await workspace.fetchAndSet(note2Uri);
      await workspace.fetchAndSet(note3Uri);

      await embeddings.updateResource(note1Uri);
      await embeddings.updateResource(note2Uri);
      await embeddings.updateResource(note3Uri);

      // Query text length of 20 should match note2 most closely
      const results = await embeddings.search('Medium length text', 10);

      expect(results.length).toBe(3);
      expect(results[0].similarity).toBeGreaterThanOrEqual(
        results[1].similarity
      );
      expect(results[1].similarity).toBeGreaterThanOrEqual(
        results[2].similarity
      );

      workspace.dispose();
    });

    it('should respect topK parameter', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = new FoamEmbeddings(workspace, new MockProvider());

      for (let i = 0; i < 10; i++) {
        const noteUri = URI.parse(`/note${i}.md`, 'file');
        datastore.set(noteUri, `# Note ${i}\n\n${'x'.repeat(i + 1)}`);
        await workspace.fetchAndSet(noteUri);
        await embeddings.updateResource(noteUri);
      }

      const results = await embeddings.search('query', 3);

      expect(results.length).toBe(3);

      workspace.dispose();
    });
  });

  describe('update (batch processing)', () => {
    it('should use embedBatch when provider supports it', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const provider = new BatchMockProvider();
      const embeddings = new FoamEmbeddings(workspace, provider);

      for (let i = 0; i < 5; i++) {
        const noteUri = URI.parse(`/note${i}.md`, 'file');
        datastore.set(noteUri, `# Note ${i}\n\nContent ${i}`);
        await workspace.fetchAndSet(noteUri);
      }

      await embeddings.update();

      expect(embeddings.size()).toBe(5);
      // Should have used embedBatch, not individual embed calls
      expect(provider.embedBatchCallCount).toBeGreaterThan(0);
      expect(provider.embedCallCount).toBe(0);

      workspace.dispose();
    });

    it('should fall back to sequential embed when provider lacks embedBatch', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const provider = new MockProvider();
      const embeddings = new FoamEmbeddings(workspace, provider);

      for (let i = 0; i < 3; i++) {
        const noteUri = URI.parse(`/note${i}.md`, 'file');
        datastore.set(noteUri, `# Note ${i}\n\nContent ${i}`);
        await workspace.fetchAndSet(noteUri);
      }

      await embeddings.update();

      expect(embeddings.size()).toBe(3);
      expect(provider.embedCallCount).toBe(3);

      workspace.dispose();
    });

    it('should batch items up to configured batchSize', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const provider = new BatchMockProvider();
      const customBatchSize = 10;
      const embeddings = new FoamEmbeddings(workspace, provider, undefined, customBatchSize);

      // Create more notes than batchSize to verify batching
      const noteCount = customBatchSize + 5;
      for (let i = 0; i < noteCount; i++) {
        const noteUri = URI.parse(`/note${i}.md`, 'file');
        datastore.set(noteUri, `# Note ${i}\n\nContent ${i}`);
        await workspace.fetchAndSet(noteUri);
      }

      await embeddings.update();

      expect(embeddings.size()).toBe(noteCount);
      // Should have needed 2 batch calls (10 + 5 remaining)
      expect(provider.embedBatchCallCount).toBe(2);

      workspace.dispose();
    });

    it('should skip cached embeddings and only batch uncached ones', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const provider = new BatchMockProvider();
      const cache = new InMemoryEmbeddingCache();
      const embeddings = new FoamEmbeddings(workspace, provider, cache);

      // Create 3 notes
      for (let i = 0; i < 3; i++) {
        const noteUri = URI.parse(`/note${i}.md`, 'file');
        datastore.set(noteUri, `# Note ${i}\n\nContent ${i}`);
        await workspace.fetchAndSet(noteUri);
      }

      // First update: all should be generated
      await embeddings.update();
      expect(provider.embedBatchCallCount).toBe(1);
      expect(embeddings.size()).toBe(3);

      // Second update: all should be reused from in-memory
      provider.embedBatchCallCount = 0;
      await embeddings.update();
      expect(provider.embedBatchCallCount).toBe(0);

      workspace.dispose();
    });
  });

  describe('fromWorkspace with monitoring', () => {
    it('should automatically update when resource is added', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const embeddings = FoamEmbeddings.fromWorkspace(
        workspace,
        new MockProvider(),
        true
      );

      const noteUri = URI.parse('/new-note.md', 'file');
      datastore.set(noteUri, '# New Note\n\nContent');
      await workspace.fetchAndSet(noteUri);

      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 100));

      const embedding = embeddings.getEmbedding(noteUri);
      expect(embedding).not.toBeNull();

      embeddings.dispose();
      workspace.dispose();
    });

    it('should automatically update when resource is modified', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const noteUri = URI.parse('/note.md', 'file');

      datastore.set(noteUri, '# Note\n\nOriginal content');
      await workspace.fetchAndSet(noteUri);

      const embeddings = FoamEmbeddings.fromWorkspace(
        workspace,
        new MockProvider(),
        true
      );

      await embeddings.updateResource(noteUri);
      const originalEmbedding = embeddings.getEmbedding(noteUri);

      // Update the content of the note to simulate a change
      datastore.set(noteUri, '# Note\n\nDifferent content that is much longer');

      // Trigger workspace update event
      await workspace.fetchAndSet(noteUri);

      // Wait for automatic update
      await waitForExpect(
        () => {
          const newEmbedding = embeddings.getEmbedding(noteUri);
          expect(newEmbedding).not.toEqual(originalEmbedding);
        },
        1000,
        50
      );

      embeddings.dispose();
      workspace.dispose();
    });

    it('should automatically remove embedding when resource is deleted', async () => {
      const datastore = new InMemoryDataStore();
      const workspace = createTestWorkspace(ROOT, datastore);
      const noteUri = URI.parse('/note.md', 'file');

      datastore.set(noteUri, '# Note\n\nContent');
      await workspace.fetchAndSet(noteUri);

      const embeddings = FoamEmbeddings.fromWorkspace(
        workspace,
        new MockProvider(),
        true
      );

      await embeddings.updateResource(noteUri);
      expect(embeddings.getEmbedding(noteUri)).not.toBeNull();

      workspace.delete(noteUri);

      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(embeddings.getEmbedding(noteUri)).toBeNull();

      embeddings.dispose();
      workspace.dispose();
    });
  });
});
