import {
  EmbeddingProvider,
  EmbeddingProviderInfo,
} from '../../services/embedding-provider';
import { Logger } from '@foam/core';

export interface CustConfig {
  url: string;
  model: string;
  timeout: number;
}

export const DEFAULT_CUST_CONFIG: CustConfig = {
  url: 'http://localhost:1235',
  model: 'bge-m3',
  timeout: 30000,
};

export class CustEmbeddingProvider implements EmbeddingProvider {
  private config: CustConfig;

  constructor(config: Partial<CustConfig> = {}) {
    this.config = { ...DEFAULT_CUST_CONFIG, ...config };
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const inputs = texts.map(t => t.substring(0, 16000).normalize());

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout
      );

      const response = await fetch(`${this.config.url}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: inputs,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cust AI service error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (data.data == null || data.data.length === 0) {
        throw new Error(
          `Invalid response from Cust AI service: ${JSON.stringify(data)}`
        );
      }

      // Sort by index to ensure correct order (API may return in any order)
      const sorted = [...data.data].sort((a: any, b: any) => a.index - b.index);
      return sorted.map((item: any) => {
        if (item.embedding == null) {
          throw new Error(
            `Invalid embedding in response from Cust AI service: ${JSON.stringify(item)}`
          );
        }
        return item.embedding;
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Cust AI service took too long to respond.');
        }
        if (
          error.message.includes('fetch') ||
          error.message.includes('ECONNREFUSED')
        ) {
          throw new Error(
            `Cannot connect to Cust API at ${this.config.url}. Make sure the server is running.`
          );
        }
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.url}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  getProviderInfo(): EmbeddingProviderInfo {
    return {
      name: 'Cust',
      type: 'local',
      model: {
        name: this.config.model,
        dimensions: 1024,
      },
      description: 'Local embedding provider using Cust MLX server',
      endpoint: this.config.url,
      metadata: {
        timeout: this.config.timeout,
      },
    };
  }

  getConfig(): CustConfig {
    return { ...this.config };
  }
}
