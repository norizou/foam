import * as vscode from 'vscode';
import { URI } from '@foam/core';
import { FoamWorkspace } from '@foam/core';
import { BaseTreeProvider } from '../utils/tree-views/base-tree-provider';
import { ResourceTreeItem } from '../utils/tree-views/tree-view-utils';

export interface SearchResultEntry {
  uri: URI;
  relevanceScore: number;
  vectorScore: number;
  snippet: string;
}

export class SemanticSearchProvider extends BaseTreeProvider<vscode.TreeItem> {
  public nValues = 0;
  private results: SearchResultEntry[] = [];
  private _query: string = '';

  constructor(private workspace: FoamWorkspace) {
    super();
  }

  get currentQuery(): string {
    return this._query;
  }

  setResults(query: string, results: SearchResultEntry[]): void {
    this._query = query;
    this.results = results;
    this.nValues = results.length;
    this.refresh();
  }

  clearResults(): void {
    this._query = '';
    this.results = [];
    this.nValues = 0;
    this.refresh();
  }

  getState(): 'no-search' | 'no-results' | 'has-results' {
    if (!this._query) {
      return 'no-search';
    }
    if (this.results.length === 0) {
      return 'no-results';
    }
    return 'has-results';
  }

  async getChildren(item?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (item) {
      return [];
    }

    return this.results
      .map(result => {
        const resource = this.workspace.find(result.uri);
        if (!resource) {
          return null;
        }

        const treeItem = new ResourceTreeItem(resource, this.workspace);
        treeItem.description = `R:${result.relevanceScore.toFixed(3)} V:${result.vectorScore.toFixed(3)}`;
        return treeItem;
      })
      .filter((item): item is vscode.TreeItem => item !== null);
  }
}
