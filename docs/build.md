# ビルド / パッケージング

## 開発起動

```bash
cd desktop
npm install        # electron / @electron/packager を取得
npm start          # electron .
```

開発時は任意のポートで CDP を開けます（例: `--remote-debugging-port=9341`）。

## パッケージ版

```bash
bash scripts/package.sh
```

`scripts/package.sh` の処理:

1. `desktop/` で `npm run package` を実行（electron-packager）。
   - `--platform=darwin --arch=arm64`
   - `--asar`（ソースを asar 化）
   - `--ignore="^/(extensions|assets)"` で extensions / assets を asar から除外し、
     `--extra-resource=extensions --extra-resource=assets` で `Resources/` に同梱。
   - 出力: `dist-desktop/BotClient-darwin-arm64/BotClient.app`
2. アイコンを `AppIcon.icns` にリネームし `Info.plist` の `CFBundleIconFile` を更新。
3. `codesign --force --deep --sign -` で ad-hoc 署名。
4. `dist/BotClient.app` へ `ditto` で配置。

実行時、メインプロセスは `app.isPackaged` に応じて `process.resourcesPath`（パッケージ版）か `__dirname`（開発）から `extensions/` と `assets/` を解決します。

## 同梱物の由来

| パス | 内容 | 由来 |
| --- | --- | --- |
| `desktop/extensions/vencord/` | Vencord ビルド + Bot ログインプラグイン | [Vencord](https://github.com/Vendicated/Vencord) をベースにビルド |
| `desktop/extensions/equicord/` | Equicord ビルド + Bot ログインプラグイン | [Equicord](https://github.com/Equicord/Equicord) をベースにビルド |
| `desktop/editor/` | Discohook ビルド（エディタ UI） | [aiko-chan-ai/discohook](https://github.com/aiko-chan-ai/discohook)（DiscordBotClient 同梱版）をビルド |
| `desktop/assets/` | アプリアイコン（通常の Discord アイコン） | `DiscordIcon.png` から `iconutil` で `AppIcon.icns` を生成 |

これらは**ビルド済みバンドルをリポジトリに同梱**しています（アプリ動作に必須のため）。
再生成する場合は各上流を取得してビルドし、該当ディレクトリを置き換えてください。

## git 管理方針

`.gitignore` により以下を除外します（再生成可能なため）。

- `desktop/node_modules/` — `npm install` で復元
- `dist-desktop/` — packager の中間出力
- `dist/*` — パッケージ成品（`dist/.gitkeep` のみプレースホルダとして追跡）
- `.DS_Store` / `*.xcuserstate`

ソース（`desktop/*.js` / `package.json` / `package-lock.json`）、同梱バンドル（`extensions/` / `editor/` / `assets/`）、`scripts/`、`docs/` はすべて追跡対象です。コミットはファイルの内容・役割ごとに分割しています。

## バージョン / ライセンス

- バージョン: `2.0.0`（`desktop/package.json`、`APP_ID = local.botclient.air`）。
- 本体ライセンス: `GPL-3.0-or-later`。同梱の上流ビルドはそれぞれのライセンスに従います。