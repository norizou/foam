import { window, commands, ExtensionContext, workspace as vscodeWorkspace } from 'vscode';
import { FoamFeature } from '../../types';
import { Logger } from '@foam/core';
import { URI } from '@foam/core';
import { toVsCodeUri } from '../utils/vsc-utils';
import { BUILD_EMBEDDINGS_COMMAND } from './ai/build-embeddings';
import { SemanticSearchProvider, SearchResultEntry } from './semantic-search-results';

interface RerankResponse {
  model?: string;
  results: {
    index: number;
    relevance_score: number;
    document?: string;
  }[];
}

export const feature: FoamFeature = async (context: ExtensionContext, foamPromise) => {
  const foam = await foamPromise;

  const provider = new SemanticSearchProvider(foam.workspace);
  const treeView = window.createTreeView('foam-vscode.semantic-search-results', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  provider.onDidChangeTreeData(() => {
    treeView.title = provider.currentQuery
      ? `Semantic Search: "${provider.currentQuery}" (${provider.nValues})`
      : 'Semantic Search';
    commands.executeCommand('setContext', 'foam.semanticSearch.state', provider.getState());
  });

  // Set initial context for viewsWelcome messages
  commands.executeCommand('setContext', 'foam.semanticSearch.state', provider.getState());

  context.subscriptions.push(
    treeView,
    provider,
    commands.registerCommand('foam-vscode.semantic-search.clear-results', () => {
      provider.clearResults();
    }),
    commands.registerCommand('foam-vscode.semantic-search', async () => {
      const query = await window.showInputBox({
        prompt: 'Enter search query for Semantic Search',
        placeHolder: 'e.g. How to install dependencies?',
      });

      if (!query) {
        return;
      }

      await window.withProgress(
        {
          location: 15, // ProgressLocation.Notification
          title: 'Semantic Search',
          cancellable: false,
        },
        async progress => {
          try {
            // 0. Check AI provider availability
            const aiConfig = vscodeWorkspace.getConfiguration('foam.experimental.ai');
            const aiEnabled = aiConfig.get<boolean>('enabled') ?? false;
            if (!aiEnabled) {
              window.showErrorMessage(
                'Semantic Search requires AI to be enabled. Set "foam.experimental.ai.enabled": true in your settings.'
              );
              return;
            }

            // Ensure embeddings are built
            if (!foam.embeddings.hasEmbeddings()) {
              progress.report({ message: 'Building embeddings...' });
              const status: 'complete' | 'cancelled' | 'error' =
                await commands.executeCommand(BUILD_EMBEDDINGS_COMMAND.command);
              if (status !== 'complete') {
                return;
              }
            }

            if (!foam.embeddings.hasEmbeddings()) {
              window.showErrorMessage(
                'Semantic Search is not available. No embeddings found. Make sure the AI service is running.'
              );
              return;
            }

            // 1. Initial Vector Search
            progress.report({ message: 'Embedding query and searching...' });
            const embedTopK = aiConfig.get<number>('embedding.Top-K') ?? 30;
            const similar = await foam.embeddings.search(query, embedTopK);
            Logger.info(`Semantic search: vector search returned ${similar.length} candidates`);

            if (similar.length === 0) {
              window.showInformationMessage('No matches found.');
              provider.setResults(query, []);
              return;
            }

            // 2. Prepare documents for Reranking
            progress.report({ message: 'Reranking results...' });
            const docs = await Promise.all(
              similar.map(async sim => {
                const content = await foam.workspace.readAsMarkdown(sim.uri);
                return {
                  uri: sim.uri,
                  content: content ?? '',
                  similarity: sim.similarity,
                };
              })
            );

            // 3. Call Reranker API
            const rerankConfig = vscodeWorkspace.getConfiguration('foam.experimental.ai');
            const rerankUrl = rerankConfig.get<string>('rerank.url') ?? 'http://localhost:1235/v1/rerank';
            const rerankTopK = rerankConfig.get<number>('rerank.Top-K') ?? 20;

            const rerankController = new AbortController();
            const rerankTimeout = setTimeout(() => rerankController.abort(), 30000);

            let response: Response;
            try {
              response = await fetch(rerankUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  query: query,
                  documents: docs.map(d => d.content.substring(0, 2000)),
                  top_k: rerankTopK,
                }),
                signal: rerankController.signal,
              });
            } finally {
              clearTimeout(rerankTimeout);
            }

            if (!response.ok) {
              const err = await response.text();
              throw new Error(`Reranker failed (${response.status}): ${err}`);
            }

            const data = (await response.json()) as RerankResponse;
            Logger.info(`Semantic search: reranker returned ${data.results?.length ?? 0} results`);

            if (!data.results || data.results.length === 0) {
              window.showInformationMessage('No matches found after reranking.');
              provider.setResults(query, []);
              return;
            }

            // 4. Display Results in TreeView
            const searchResults: SearchResultEntry[] = data.results
              .filter(res => res.index >= 0 && res.index < docs.length)
              .map(res => {
                const doc = docs[res.index];
                const snippet = doc.content.substring(0, 100).replace(/\n/g, ' ');
                return {
                  uri: doc.uri,
                  relevanceScore: res.relevance_score,
                  vectorScore: doc.similarity,
                  snippet,
                };
              });

            if (searchResults.length === 0) {
              window.showInformationMessage('No matches found after reranking.');
              provider.setResults(query, []);
              return;
            }

            provider.setResults(query, searchResults);

            // Focus the tree view (ignore if command not found in test environment)
            try {
              await commands.executeCommand('foam-vscode.semantic-search-results.focus');
            } catch (e) {
              // Command may not be available in test environment
              if (!(e instanceof Error) || !e.message.includes('not found')) {
                throw e;
              }
            }
          } catch (e) {
            Logger.error('Semantic search failed', e);
            window.showErrorMessage(`Semantic search failed: ${e instanceof Error ? e.message : e}`);
          }
        }
      );
    })
  );
};
