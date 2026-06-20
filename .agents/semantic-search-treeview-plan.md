# セマンティック検索結果 TreeView パネル実装計画

## 背景
セマンティックサーチ実行後、QuickPickで結果を表示しているが、選択するとQuickPickが閉じて結果が消えるため、再検索が必要になる。TreeViewで結果を常時表示することで再利用性を高める。

## 設計方針
- QuickPickをTreeViewに完全置換
- `BaseTreeProvider` を直接継承（connections.ts / related-notes.ts と同じパターン）
- `ResourceTreeItem` を再利用し、description にスコア表示（`R:0.950 V:0.832`）
- viewsWelcomeに検索コマンドへのリンクボタンを表示
- AI無効時はview自体を非表示（`when: config.foam.experimental.ai.enabled`）

## ファイル構成

| ファイル | 種類 | 内容 |
|---------|------|------|
| `semantic-search-results.ts` | 新規 | SemanticSearchProvider クラス |
| `semantic-search-results.spec.ts` | 新規 | Provider の単体テスト |
| `semantic-search.ts` | 修正 | QuickPick → Provider 連携、TreeView 初期化 |
| `semantic-search.spec.ts` | 修正 | QuickPick 検証 → Provider 検証に変更 |
| `package.json` | 修正 | views, viewsWelcome, commands, menus 追加 |

## 実装ステップ

### 1. SemanticSearchProvider の実装 (`semantic-search-results.ts`)
- [x] `BaseTreeProvider<vscode.TreeItem>` を継承
- [x] `SearchResultEntry` インターフェース定義（uri, relevanceScore, vectorScore, snippet）
- [x] `setResults(query, results)` — 結果設定 + refresh
- [x] `clearResults()` — 結果クリア + refresh
- [x] `getState()` — `'no-search' | 'no-results' | 'has-results'`
- [x] `getChildren()` — `ResourceTreeItem` 生成、description に `R:x.xxx V:x.xxx` スコア表示
- [x] `nValues`, `currentQuery` プロパティ

### 2. semantic-search.ts の修正
- [x] feature 関数内で Provider + TreeView を初期化
- [x] QuickPick 表示を `provider.setResults()` + TreeView フォーカスに置換
- [x] `clear-results` コマンドの登録
- [x] viewsWelcome 用の `setContext` 呼び出し（状態変更時）
- [x] context.subscriptions に treeView, provider を push

### 3. package.json の修正
- [x] `views.explorer` に `foam-vscode.semantic-search-results` 追加
      - `when: "config.foam.experimental.ai.enabled"`
      - `name: "Semantic Search"`
      - `icon: "$(search)"`
- [x] `viewsWelcome` に検索未実行時メッセージ追加（Search ボタンリンク付き）
- [x] `commands` に `foam-vscode.semantic-search.clear-results` 追加
- [x] `menus.view/title` にクリアボタン追加
- [x] `menus.commandPalette` でクリアコマンドの when 条件設定

### 4. テスト実装

#### semantic-search-results.spec.ts（新規）
- [x] 初期状態: getChildren() が空、nValues が 0、getState() が 'no-search'
- [x] setResults 後: getChildren() が ResourceTreeItem の配列を返す
- [x] description にスコア表示: `R:x.xxx V:x.xxx` 形式
- [x] TreeItem の command が vscode.open で正しい URI を持つ
- [x] 結果の順序が setResults で渡した順序を維持する
- [x] workspace に存在しない URI のエントリはスキップされる
- [x] getState() の状態遷移: no-search → has-results → no-results
- [x] clearResults() で全てリセットされる
- [x] 新しい検索が前の結果を上書きする
- [x] setResults / clearResults で onDidChangeTreeData が発火する

#### semantic-search.spec.ts（修正）
- [x] 既存テスト: QuickPick 検証を Provider 検証に変更
- [x] 新規: TreeView フォーカスの検証
- [x] 新規: clear-results コマンドの検証

### 5. 検証
- [x] `yarn test:unit` 通過
- [x] `yarn lint` 通過
- [x] `yarn build` 通過

## 設計詳細

### SemanticSearchProvider クラス
```typescript
interface SearchResultEntry {
  uri: URI;
  relevanceScore: number;
  vectorScore: number;
  snippet: string;
}

class SemanticSearchProvider extends BaseTreeProvider<vscode.TreeItem> {
  public nValues = 0;
  private results: SearchResultEntry[] = [];
  private _query: string = '';

  constructor(private workspace: FoamWorkspace) { super(); }

  get currentQuery(): string;
  setResults(query: string, results: SearchResultEntry[]): void;
  clearResults(): void;
  getState(): 'no-search' | 'no-results' | 'has-results';
  getChildren(item?: vscode.TreeItem): vscode.TreeItem[];
}
```

### TreeView 初期化（semantic-search.ts 内）
```typescript
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
```

### package.json 追加内容
- view: `foam-vscode.semantic-search-results`（AI 有効時のみ表示）
- viewsWelcome: 状態別メッセージ（no-search → 検索ボタン、no-results → 結果なしメッセージ）
- command: `foam-vscode.semantic-search.clear-results`（クリアボタン）

## 注意点
- `ResourceTreeItem` を再利用（独自 TreeItem クラスは不要）
- `core/` 内のコードはモックしない
- 動的インポートを使用しない
- `index.ts` の import パスは変更不要（既存の `semantic-search.ts` を修正するだけ）
