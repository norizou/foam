# セマンティック検索リランク結果表示問題 - 調査・テスト・修正計画

## 問題
Embedしたデータはあるものの、リランク（rerank）の検索結果が何も表示されない。

## 現状確認
- `semantic-search.ts` でのフロー:
  1. `foam.embeddings.search(query, 30)` で類似度上位30件を取得
  2. 各ノートの本文を取得
  3. Cust API `/v1/rerank` に `query`, `documents`, `top_k: 20` を送信
  4. `data.results` を VSCode QuickPick に表示
- テストが存在しない:
  - `semantic-search.ts` のテストなし
  - `FoamEmbeddings.search` のテストなし
  - `CustEmbeddingProvider` のテストなし

## 作業ステップ

### 1. 調査・原因切り分け
- [x] 設計書 `Foam_Cust_Integration_Design.md` の確認
- [x] 関連コード（`cust-provider.ts`, `embeddings.ts`, `semantic-search.ts`, `extension.ts`, `foam.ts`）の確認
- [x] 設定 `foam.experimental.ai.rerank.url` が `package.json` に定義されていることを確認
- [x] 実際の `embed_reranker` API のリクエスト/レスポンス形式を確認
  - 実装: `~/AI/embed_reranker/mlx_embed_rerank_server.py`
  - レスポンス形式: `{ "model": "...", "results": [{ "index": ..., "relevance_score": ... }] }`
  - `document` フィールドはレスポンスに含まれない（サーバー側で `pop` している）
- [x] `semantic-search.ts` の潜在的な問題を特定:
  - `data.results` が空の場合の表示処理 → **問題を確認**: 空の `showQuickPick` を呼び出し、結果が何も表示されない
  - `fetch` の動作 → 問題なし
  - レスポンス形式の不一致 → 今回のテスト範囲では確認されず
  - エラーハンドリング → 問題なし

### 2. テスト設計
- `semantic-search.ts` 用の統合テスト（`.spec.ts`）:
  - 正常系: リランカーが結果を返す → QuickPick に項目が表示される
  - 空結果: リランカーが空配列を返す → ユーザーに「No matches found」が通知される
  - 初期検索0件: `foam.embeddings.search` が空を返す → ユーザーに「No matches found」が通知される
  - エラー系: リランカーAPIがエラーを返す → エラーメッセージが表示される
  - 設定読み込み: `foam.experimental.ai.rerank.url` が正しく使用される
- `FoamEmbeddings.search` 用の単体テスト（`.test.ts`）:
  - クエリに対して類似度順に結果を返す
  - `topK` パラメータを尊重する
  - 空のワークスペースでは空配列を返す
- `CustEmbeddingProvider` 用の単体テスト（`.test.ts`）:
  - `embed` 正常系
  - エラーレスポンス
  - タイムアウト
  - `isAvailable`

### 3. テスト実装
- [x] `semantic-search.spec.ts` を作成
- [x] `embeddings.test.ts` に `search` のテストを追加
- [x] `cust-provider.test.ts` を作成

### 4. 機能確認と修正
- [x] テストを実行して失敗させ、問題を再現
- [x] 特定した問題を修正:
  - 空の結果に対するユーザー通知 → `semantic-search.ts` に `data.results` が空の場合の処理を追加
  - レスポンス形式の不一致があれば修正 → 今回のテスト範囲では未確認
  - エラーハンドリングの強化 → 既存の `try/catch` でカバー済み
- [x] テストを再実行して確認

### 5. 検証
- [x] 単体テスト: `yarn test:unit` → 追加したテストは全て通過。ただし `daily-notes/daily-note-service.spec.ts` が4件失敗（日本語ロケールによる既存の問題）
- [x] リンタ: `yarn lint` → エラー0、警告76件（新規ファイルからの警告は0）
- [ ] 手動での統合確認（可能であれば） → 未実施

## 注意点
- `semantic-search.ts` は VSCode API に依存するため `.spec.ts` 統合テストとなる
- `global.fetch` をモックしてリランカーAPIを再現する
- `core/` 内のコードはモックしない
- 動的インポートを使用しない
