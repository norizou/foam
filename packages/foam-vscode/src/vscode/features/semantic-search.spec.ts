/* @unit-ready */
import * as vscode from 'vscode';
import { URI } from '@foam/core';
import { feature } from './semantic-search';

const mockFoam = () => {
  const notes: Record<string, string> = {
    '/note1.md': '# Note 1\n\nThis is the first note about installation.',
    '/note2.md': '# Note 2\n\nThis is the second note about dependencies.',
    '/note3.md': '# Note 3\n\nThis is the third note about configuration.',
  };

  return {
    workspace: {
      readAsMarkdown: (uri: URI) => {
        return Promise.resolve(notes[uri.path] ?? '');
      },
    },
    embeddings: {
      search: vi.fn(),
      hasEmbeddings: vi.fn().mockReturnValue(true),
    },
  } as any;
};

const mockContext = () => {
  return {
    subscriptions: {
      push: vi.fn(),
    },
  } as any;
};

describe('semantic-search', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as typeof global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should show reranked results in quick pick', async () => {
    const foam = mockFoam();
    foam.embeddings.search.mockResolvedValue([
      { uri: URI.parse('/note1.md', 'file'), similarity: 0.8 },
      { uri: URI.parse('/note2.md', 'file'), similarity: 0.7 },
      { uri: URI.parse('/note3.md', 'file'), similarity: 0.6 },
    ]);

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'qwen3-0.6b',
        results: [
          { index: 2, relevance_score: 0.95 },
          { index: 1, relevance_score: 0.85 },
          { index: 0, relevance_score: 0.75 },
        ],
      }),
    });

    const showInputBoxSpy = vi
      .spyOn(vscode.window, 'showInputBox')
      .mockResolvedValue('how to configure');
    const showQuickPickSpy = vi
      .spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValue(undefined);
    const showInformationMessageSpy = vi.spyOn(
      vscode.window,
      'showInformationMessage'
    );
    const showErrorMessageSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    const context = mockContext();
    await feature(context, Promise.resolve(foam));
    await vscode.commands.executeCommand('foam-vscode.semantic-search');

    expect(showInputBoxSpy).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:1235/v1/rerank',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"top_k":20'),
      })
    );
    expect(showQuickPickSpy).toHaveBeenCalled();
    expect(showInformationMessageSpy).not.toHaveBeenCalled();
    expect(showErrorMessageSpy).not.toHaveBeenCalled();

    showInputBoxSpy.mockRestore();
    showQuickPickSpy.mockRestore();
    showInformationMessageSpy.mockRestore();
    showErrorMessageSpy.mockRestore();
  });

  it('should trigger build-embeddings when no embeddings exist', async () => {
    const foam = mockFoam();
    foam.embeddings.hasEmbeddings.mockReturnValue(false);
    foam.embeddings.search.mockResolvedValue([
      { uri: URI.parse('/note1.md', 'file'), similarity: 0.8 },
    ]);

    // After build-embeddings, hasEmbeddings returns true
    let buildCalled = false;
    const executeCommandOriginal = vscode.commands.executeCommand;
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(
      async (command: string, ...args: any[]) => {
        if (command === 'foam-vscode.build-embeddings') {
          buildCalled = true;
          foam.embeddings.hasEmbeddings.mockReturnValue(true);
          return 'complete';
        }
        return executeCommandOriginal(command, ...args);
      }
    );

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ index: 0, relevance_score: 0.9 }],
      }),
    });

    const showInputBoxSpy = vi
      .spyOn(vscode.window, 'showInputBox')
      .mockResolvedValue('test query');
    const showQuickPickSpy = vi
      .spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValue(undefined);

    const context = mockContext();
    await feature(context, Promise.resolve(foam));
    await vscode.commands.executeCommand('foam-vscode.semantic-search');

    expect(buildCalled).toBe(true);
    expect(showQuickPickSpy).toHaveBeenCalled();

    showInputBoxSpy.mockRestore();
    showQuickPickSpy.mockRestore();
  });

  it('should show information message when no vector matches are found', async () => {
    const foam = mockFoam();
    foam.embeddings.search.mockResolvedValue([]);

    const showInputBoxSpy = vi
      .spyOn(vscode.window, 'showInputBox')
      .mockResolvedValue('query with no matches');
    const showQuickPickSpy = vi.spyOn(vscode.window, 'showQuickPick');
    const showInformationMessageSpy = vi
      .spyOn(vscode.window, 'showInformationMessage')
      .mockResolvedValue(undefined);
    const showErrorMessageSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    const context = mockContext();
    await feature(context, Promise.resolve(foam));
    await vscode.commands.executeCommand('foam-vscode.semantic-search');

    expect(showQuickPickSpy).not.toHaveBeenCalled();
    expect(showInformationMessageSpy).toHaveBeenCalledWith('No matches found.');
    expect(showErrorMessageSpy).not.toHaveBeenCalled();

    showInputBoxSpy.mockRestore();
    showQuickPickSpy.mockRestore();
    showInformationMessageSpy.mockRestore();
    showErrorMessageSpy.mockRestore();
  });

  it('should show information message when reranker returns empty results', async () => {
    const foam = mockFoam();
    foam.embeddings.search.mockResolvedValue([
      { uri: URI.parse('/note1.md', 'file'), similarity: 0.8 },
      { uri: URI.parse('/note2.md', 'file'), similarity: 0.7 },
    ]);

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'qwen3-0.6b',
        results: [],
      }),
    });

    const showInputBoxSpy = vi
      .spyOn(vscode.window, 'showInputBox')
      .mockResolvedValue('query with empty rerank');
    const showQuickPickSpy = vi
      .spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValue(undefined);
    const showInformationMessageSpy = vi
      .spyOn(vscode.window, 'showInformationMessage')
      .mockResolvedValue(undefined);
    const showErrorMessageSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    const context = mockContext();
    await feature(context, Promise.resolve(foam));
    await vscode.commands.executeCommand('foam-vscode.semantic-search');

    expect(showQuickPickSpy).not.toHaveBeenCalled();
    expect(showInformationMessageSpy).toHaveBeenCalledWith(
      'No matches found after reranking.'
    );
    expect(showErrorMessageSpy).not.toHaveBeenCalled();

    showInputBoxSpy.mockRestore();
    showQuickPickSpy.mockRestore();
    showInformationMessageSpy.mockRestore();
    showErrorMessageSpy.mockRestore();
  });

  it('should show error message when reranker API fails', async () => {
    const foam = mockFoam();
    foam.embeddings.search.mockResolvedValue([
      { uri: URI.parse('/note1.md', 'file'), similarity: 0.8 },
    ]);

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    });

    const showInputBoxSpy = vi
      .spyOn(vscode.window, 'showInputBox')
      .mockResolvedValue('query causing error');
    const showQuickPickSpy = vi.spyOn(vscode.window, 'showQuickPick');
    const showInformationMessageSpy = vi.spyOn(
      vscode.window,
      'showInformationMessage'
    );
    const showErrorMessageSpy = vi
      .spyOn(vscode.window, 'showErrorMessage')
      .mockResolvedValue(undefined);

    const context = mockContext();
    await feature(context, Promise.resolve(foam));
    await vscode.commands.executeCommand('foam-vscode.semantic-search');

    expect(showQuickPickSpy).not.toHaveBeenCalled();
    expect(showInformationMessageSpy).not.toHaveBeenCalled();
    expect(showErrorMessageSpy).toHaveBeenCalled();

    showInputBoxSpy.mockRestore();
    showQuickPickSpy.mockRestore();
    showInformationMessageSpy.mockRestore();
    showErrorMessageSpy.mockRestore();
  });

  it('should use custom rerank URL from configuration', async () => {
    const foam = mockFoam();
    foam.embeddings.search.mockResolvedValue([
      { uri: URI.parse('/note1.md', 'file'), similarity: 0.8 },
    ]);

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'qwen3-0.6b',
        results: [{ index: 0, relevance_score: 0.9 }],
      }),
    });

    const customUrl = 'http://custom:9999/v1/rerank';
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (section: string) => {
        if (section === 'rerank.url') {
          return customUrl;
        }
        return undefined;
      },
    } as any);

    const showInputBoxSpy = vi
      .spyOn(vscode.window, 'showInputBox')
      .mockResolvedValue('custom url query');
    const showQuickPickSpy = vi
      .spyOn(vscode.window, 'showQuickPick')
      .mockResolvedValue(undefined);
    const showErrorMessageSpy = vi.spyOn(vscode.window, 'showErrorMessage');

    const context = mockContext();
    await feature(context, Promise.resolve(foam));
    await vscode.commands.executeCommand('foam-vscode.semantic-search');

    expect(global.fetch).toHaveBeenCalledWith(
      customUrl,
      expect.objectContaining({
        method: 'POST',
      })
    );

    showInputBoxSpy.mockRestore();
    showQuickPickSpy.mockRestore();
    showErrorMessageSpy.mockRestore();
  });
});
