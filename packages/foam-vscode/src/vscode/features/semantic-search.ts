import { window, commands, ExtensionContext, Uri, workspace as vscodeWorkspace } from 'vscode';
import { FoamFeature } from '../../types';
import { Logger } from '@foam/core';

interface RerankResponse {
  id: string;
  results: {
    index: number;
    relevance_score: number;
    document: string;
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
            progress.report({ message: 'Embedding query and searching...' });

            if (!foam.embeddings) {
              window.showErrorMessage('Semantic Search is not available. Embeddings are disabled.');
              return;
            }

            // 1. Initial Vector Search
            const similar = await foam.embeddings.search(query, 30);
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
                documents: docs.map(d => d.content.substring(0, 2000)), // Limit document length for reranker
                top_k: 20,
              }),
            });

            if (!response.ok) {
              const err = await response.text();
              throw new Error(`Reranker failed: ${err}`);
            }

            const data = (await response.json()) as RerankResponse;

            // 4. Display Results
            const quickPickItems = data.results.map(res => {
              const doc = docs[res.index];
              const title = doc.uri.getBasename();
              const snippet = res.document.substring(0, 100).replace(/\n/g, ' ');
              return {
                label: `$(file) ${title}`,
                description: `$(star) Rerank: ${res.relevance_score.toFixed(3)} | Vector: ${doc.similarity.toFixed(3)}`,
                detail: snippet,
                uri: doc.uri,
              };
            });

            const selected = await window.showQuickPick(quickPickItems, {
              placeHolder: 'Select a document to open',
              matchOnDescription: true,
              matchOnDetail: true,
            });

            if (selected) {
              const doc = await vscodeWorkspace.openTextDocument(Uri.parse(selected.uri.toString()));
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
