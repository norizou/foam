/* @unit-ready */
import { URI } from '@foam/core';
import { createTestNote, createTestWorkspace } from '../../test/test-utils';
import { SemanticSearchProvider, SearchResultEntry } from './semantic-search-results';

describe('SemanticSearchProvider', () => {
  const rootUri = URI.file('/test-root');
  const ws = createTestWorkspace();

  const noteA = createTestNote({
    root: rootUri,
    uri: './note-a.md',
  });
  const noteB = createTestNote({
    root: rootUri,
    uri: './note-b.md',
  });
  const noteC = createTestNote({
    root: rootUri,
    uri: './note-c.md',
  });

  ws.set(noteA).set(noteB).set(noteC);

  const provider = new SemanticSearchProvider(ws);

  afterAll(() => {
    ws.dispose();
    provider.dispose();
  });

  describe('initial state', () => {
    it('returns empty children when no search has been performed', async () => {
      const children = await provider.getChildren();
      expect(children).toEqual([]);
    });

    it('has nValues of 0 initially', () => {
      expect(provider.nValues).toBe(0);
    });

    it('returns no-search state before any search', () => {
      expect(provider.getState()).toBe('no-search');
    });

    it('has empty currentQuery initially', () => {
      expect(provider.currentQuery).toBe('');
    });
  });

  describe('setResults', () => {
    it('shows results after setResults is called', async () => {
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
        {
          uri: noteB.uri,
          relevanceScore: 0.85,
          vectorScore: 0.75,
          snippet: 'another snippet',
        },
      ];

      provider.setResults('test query', results);

      const children = await provider.getChildren();
      expect(children.length).toBe(2);
      expect(provider.nValues).toBe(2);
    });

    it('displays relevance and vector scores in description', async () => {
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
      ];

      provider.setResults('test query', results);

      const children = await provider.getChildren();
      expect(children[0].description).toBe('R:0.950 V:0.830');
    });

    it('creates items with vscode.open command', async () => {
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
      ];

      provider.setResults('test query', results);

      const children = await provider.getChildren();
      expect(children[0].command).toMatchObject({
        command: 'vscode.open',
      });
    });

    it('preserves result order from setResults', async () => {
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
        {
          uri: noteB.uri,
          relevanceScore: 0.85,
          vectorScore: 0.75,
          snippet: 'another snippet',
        },
        {
          uri: noteC.uri,
          relevanceScore: 0.75,
          vectorScore: 0.65,
          snippet: 'third snippet',
        },
      ];

      provider.setResults('test query', results);

      const children = await provider.getChildren();
      expect(children.length).toBe(3);
      // Order should be preserved - check by resource URI
      expect((children[0] as any).resource.uri.path).toBe(noteA.uri.path);
      expect((children[1] as any).resource.uri.path).toBe(noteB.uri.path);
      expect((children[2] as any).resource.uri.path).toBe(noteC.uri.path);
    });

    it('skips results whose URI is not in workspace', async () => {
      const unknownUri = URI.file('/unknown/note.md');
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
        {
          uri: unknownUri,
          relevanceScore: 0.85,
          vectorScore: 0.75,
          snippet: 'unknown snippet',
        },
        {
          uri: noteB.uri,
          relevanceScore: 0.75,
          vectorScore: 0.65,
          snippet: 'another snippet',
        },
      ];

      provider.setResults('test query', results);

      const children = await provider.getChildren();
      expect(children.length).toBe(2);
      expect((children[0] as any).resource.uri.path).toBe(noteA.uri.path);
      expect((children[1] as any).resource.uri.path).toBe(noteB.uri.path);
    });

    it('updates state to has-results when results exist', () => {
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
      ];

      provider.setResults('test query', results);
      expect(provider.getState()).toBe('has-results');
    });

    it('updates state to no-results when empty results', () => {
      provider.setResults('test query', []);
      expect(provider.getState()).toBe('no-results');
    });

    it('updates currentQuery', () => {
      provider.setResults('my query', []);
      expect(provider.currentQuery).toBe('my query');
    });
  });

  describe('clearResults', () => {
    it('clears results and resets state', async () => {
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
      ];

      provider.setResults('test query', results);
      expect(provider.nValues).toBe(1);
      expect(provider.currentQuery).toBe('test query');
      expect(provider.getState()).toBe('has-results');

      provider.clearResults();

      const children = await provider.getChildren();
      expect(children).toEqual([]);
      expect(provider.nValues).toBe(0);
      expect(provider.currentQuery).toBe('');
      expect(provider.getState()).toBe('no-search');
    });
  });

  describe('search overwrite', () => {
    it('replaces previous results when new search is performed', async () => {
      const firstResults: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'first snippet',
        },
      ];

      const secondResults: SearchResultEntry[] = [
        {
          uri: noteB.uri,
          relevanceScore: 0.85,
          vectorScore: 0.75,
          snippet: 'second snippet',
        },
      ];

      provider.setResults('first query', firstResults);
      expect(provider.currentQuery).toBe('first query');
      let children = await provider.getChildren();
      expect(children.length).toBe(1);
      expect((children[0] as any).resource.uri.path).toBe(noteA.uri.path);

      provider.setResults('second query', secondResults);
      expect(provider.currentQuery).toBe('second query');
      children = await provider.getChildren();
      expect(children.length).toBe(1);
      expect((children[0] as any).resource.uri.path).toBe(noteB.uri.path);
    });
  });

  describe('events', () => {
    it('fires onDidChangeTreeData when results are set', done => {
      const listener = provider.onDidChangeTreeData(() => {
        listener.dispose();
        done();
      });

      provider.setResults('test query', [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
      ]);
    });

    it('fires onDidChangeTreeData when results are cleared', done => {
      provider.setResults('test query', [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
      ]);

      const listener = provider.onDidChangeTreeData(() => {
        listener.dispose();
        done();
      });

      provider.clearResults();
    });
  });

  describe('getChildren with item', () => {
    it('returns empty array when item is provided', async () => {
      const results: SearchResultEntry[] = [
        {
          uri: noteA.uri,
          relevanceScore: 0.95,
          vectorScore: 0.83,
          snippet: 'test snippet',
        },
      ];

      provider.setResults('test query', results);

      const children = await provider.getChildren({} as any);
      expect(children).toEqual([]);
    });
  });
});
