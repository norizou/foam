<RULE[user_project]>
## Foam-cust 拡張機能の表示・バージョンに関するルール

1. **アプリタイトル・表示名の変更**
   - 拡張機能の名前を変更する際（例: `Foam-cust`）、`displayName` の変更だけでは不十分です。VSCodeがMarketplaceの公式データ（ダウンロード数や元の名前など）で上書き表示してしまうのを防ぐため、`package.json` 内の以下の項目をすべて変更して完全に独立したIDにすること。
     - `name` (例: `foam-cust`)
     - `publisher` (例: `foam-cust`)
     - `displayName`
     - `publisherDisplayName`
   - また、UI上の表示を統一するため、`contributes.configuration.title` や `contributes.views.explorer` 内の `contextualTitle` も併せて変更すること。

2. **バージョニングのルール**
   - 拡張機能のバージョンは、常に直近のコミットハッシュを含めること。
   - フォーマット: `<ベースバージョン>-<コミットのShort Hash>` (例: `0.44.1-419cf4dd`)
   - コミットを行った後、そのコミットのハッシュを取得し、`package.json` の `version` に反映させてパッケージ化（ビルド）を行うこと。
</RULE[user_project]>
