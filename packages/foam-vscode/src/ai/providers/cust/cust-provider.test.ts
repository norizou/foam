import { Logger } from '@foam/core';
import { CustEmbeddingProvider, DEFAULT_CUST_CONFIG } from './cust-provider';

Logger.setLevel('error');

describe('CustEmbeddingProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as typeof global.fetch;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      const provider = new CustEmbeddingProvider();
      const config = provider.getConfig();

      expect(config.url).toBe(DEFAULT_CUST_CONFIG.url);
      expect(config.model).toBe(DEFAULT_CUST_CONFIG.model);
      expect(config.timeout).toBe(DEFAULT_CUST_CONFIG.timeout);
    });

    it('should merge custom config with defaults', () => {
      const provider = new CustEmbeddingProvider({
        url: 'http://custom:8080',
        model: 'custom-model',
      });
      const config = provider.getConfig();

      expect(config.url).toBe('http://custom:8080');
      expect(config.model).toBe('custom-model');
      expect(config.timeout).toBe(DEFAULT_CUST_CONFIG.timeout);
    });
  });

  describe('getProviderInfo', () => {
    it('should return provider information', () => {
      const provider = new CustEmbeddingProvider();
      const info = provider.getProviderInfo();

      expect(info.name).toBe('Cust');
      expect(info.type).toBe('local');
      expect(info.model.name).toBe(DEFAULT_CUST_CONFIG.model);
      expect(info.model.dimensions).toBe(1024);
      expect(info.endpoint).toBe(DEFAULT_CUST_CONFIG.url);
      expect(info.description).toBe('Local embedding provider using Cust MLX server');
      expect(info.metadata).toEqual({ timeout: DEFAULT_CUST_CONFIG.timeout });
    });

    it('should return custom model name when configured', () => {
      const provider = new CustEmbeddingProvider({ model: 'custom-model' });
      const info = provider.getProviderInfo();

      expect(info.model.name).toBe('custom-model');
    });

    it('should return custom endpoint when configured', () => {
      const provider = new CustEmbeddingProvider({ url: 'http://custom:8080' });
      const info = provider.getProviderInfo();

      expect(info.endpoint).toBe('http://custom:8080');
    });
  });

  describe('embed', () => {
    it('should successfully generate embeddings', async () => {
      const mockEmbedding = Array.from({ length: 1024 }).fill(0.1) as number[];
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: mockEmbedding }] }),
      });

      const provider = new CustEmbeddingProvider();
      const result = await provider.embed('test text');

      expect(result).toEqual(mockEmbedding);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:1235/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: DEFAULT_CUST_CONFIG.model,
            input: ['test text'],
          }),
        })
      );
    });

    it('should truncate and normalize long input', async () => {
      const mockEmbedding = Array.from({ length: 1024 }).fill(0.1) as number[];
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: mockEmbedding }] }),
      });

      const provider = new CustEmbeddingProvider();
      const longText = 'a'.repeat(10000);
      await provider.embed(longText);

      const callArgs = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.input[0].length).toBe(8000);
    });

    it('should throw error on non-ok response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      const provider = new CustEmbeddingProvider();

      await expect(provider.embed('test')).rejects.toThrow(
        'Cust AI service error (500)'
      );
    });

    it('should throw error on invalid response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const provider = new CustEmbeddingProvider();

      await expect(provider.embed('test')).rejects.toThrow(
        'Invalid response from Cust AI service'
      );
    });

    it('should throw error on connection refused', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('fetch failed'));

      const provider = new CustEmbeddingProvider();

      await expect(provider.embed('test')).rejects.toThrow(
        'Cannot connect to Cust API'
      );
    });

    it('should timeout after configured duration', async () => {
      (global.fetch as any).mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );

      const provider = new CustEmbeddingProvider({ timeout: 1000 });
      const embedPromise = provider.embed('test');

      vi.advanceTimersByTime(1001);

      await expect(embedPromise).rejects.toThrow(
        'Cust AI service took too long to respond'
      );
    });
  });

  describe('isAvailable', () => {
    it('should return true when Cust API is available', async () => {
      (global.fetch as any).mockResolvedValueOnce({ ok: true });

      const provider = new CustEmbeddingProvider();
      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:1235/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return false when Cust API is not available', async () => {
      (global.fetch as any).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      const provider = new CustEmbeddingProvider();
      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when Cust API returns non-ok status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const provider = new CustEmbeddingProvider();
      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should timeout quickly (5s) when checking availability', async () => {
      (global.fetch as any).mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );

      const provider = new CustEmbeddingProvider();
      const availabilityPromise = provider.isAvailable();

      vi.advanceTimersByTime(5001);

      const result = await availabilityPromise;
      expect(result).toBe(false);
    });
  });
});
