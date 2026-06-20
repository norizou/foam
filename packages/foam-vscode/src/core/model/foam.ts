import {
  Foam as CoreFoam,
  bootstrap as coreBootstrap,
  IMatcher,
  IWatcher,
  IDataStore,
  ResourceParser,
  ResourceProvider,
  URI,
  Logger,
} from '@foam/core';
import { FoamEmbeddings } from '../../ai/model/embeddings';
import { FileEmbeddingCache } from '../../ai/model/file-embedding-cache';
import { EmbeddingProvider } from '../../ai/services/embedding-provider';
import { NoOpEmbeddingProvider } from '../../ai/services/noop-embedding-provider';

export type { Services } from '@foam/core';

export interface Foam extends CoreFoam {
  embeddings: FoamEmbeddings;
}

export const bootstrap = async (
  roots: URI[],
  matcher: IMatcher,
  watcher: IWatcher | undefined,
  dataStore: IDataStore,
  parser: ResourceParser,
  initialProviders: ResourceProvider[],
  defaultExtension: string = '.md',
  embeddingProvider?: EmbeddingProvider,
  embeddingBatchSize?: number
): Promise<Foam> => {
  const core = await coreBootstrap(
    roots,
    matcher,
    watcher,
    dataStore,
    parser,
    initialProviders,
    defaultExtension
  );

  embeddingProvider = embeddingProvider ?? new NoOpEmbeddingProvider();
  
  const cacheUri = roots.length > 0 ? roots[0].joinPath('.foam', 'embeddings.json') : undefined;
  const cache = cacheUri ? new FileEmbeddingCache(dataStore, cacheUri) : undefined;
  if (cache) {
    await cache.load();
  }

  const embeddings = FoamEmbeddings.fromWorkspace(
    core.workspace,
    embeddingProvider,
    true,
    cache,
    embeddingBatchSize
  );

  if (await embeddingProvider.isAvailable()) {
    Logger.info('Embeddings service initialized');
  } else {
    Logger.debug('Embedding provider not available. Semantic features will be disabled.');
  }

  return {
    ...core,
    embeddings,
    dispose: () => {
      core.dispose();
      embeddings.dispose();
    },
  };
};
