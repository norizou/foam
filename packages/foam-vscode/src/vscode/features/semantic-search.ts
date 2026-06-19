import { window, commands, ExtensionContext, workspace as vscodeWorkspace } from 'vscode';
import { FoamFeature } from '../../types';
import { Logger } from '@foam/core';
import { URI } from '@foam/core';
import { toVsCodeUri } from '../utils/vsc-utils';
import { BUILD_EMBEDDINGS_COMMAND } from './ai/build-embeddings';

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

  context.subscriptions.push(
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
            // 0. Ensure embeddings are built
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
            const similar = await foam.embeddings.search(query, 30);
            Logger.info(`Semantic search: vector search returned ${similar.length} candidates`);

            if (similar.length === 0) {
              window.showInformationMessage('No matches found.');
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
            const aiConfig = vscodeWorkspace.getConfiguration('foam.experimental.ai');
            const rerankUrl = aiConfig.get<string>('rerank.url') ?? 'http://localhost:1235/v1/rerank';

            const response = await fetch(rerankUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: query,
                documents: docs.map(d => d.content.substring(0, 2000)),
                top_k: 20,
              }),
            });

            if (!response.ok) {
              const err = await response.text();
              throw new Error(`Reranker failed (${response.status}): ${err}`);
            }

            const data = (await response.json()) as RerankResponse;
            Logger.info(`Semantic search: reranker returned ${data.results?.length ?? 0} results`);

            if (!data.results || data.results.length === 0) {
              window.showInformationMessage('No matches found after reranking.');
              return;
            }

            // 4. Display Results
            const quickPickItems = data.results
              .filter(res => res.index >= 0 && res.index < docs.length)
              .map(res => {
                const doc = docs[res.index];
                const title = doc.uri.getBasename();
                const snippet = doc.content.substring(0, 100).replace(/\n/g, ' ');
                return {
                  label: `$(file) ${title}`,
                  description: `Rerank: ${res.relevance_score.toFixed(3)} | Vector: ${doc.similarity.toFixed(3)}`,
                  detail: snippet,
                  uri: doc.uri,
                };
              });

            if (quickPickItems.length === 0) {
              window.showInformationMessage('No matches found after reranking.');
              return;
            }

            const selected = await window.showQuickPick(quickPickItems, {
              placeHolder: `Found ${quickPickItems.length} results — select to open`,
              matchOnDescription: true,
              matchOnDetail: true,
            });

            if (selected) {
              const selectedUri = (selected as { uri: URI }).uri;
              const doc = await vscodeWorkspace.openTextDocument(toVsCodeUri(selectedUri));
              await window.showTextDocument(doc);
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
