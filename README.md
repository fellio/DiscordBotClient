# BotClient

Discord の **Bot アカウント**を、通常の Discord クライアントと同じ UI で操作できる macOS 向け Electron アプリです。
[aiko-chan-ai/DiscordBotClient](https://github.com/aiko-chan-ai/DiscordBotClient) の体験を、Electron + Vencord / Equicord で再現しています。

- **Bot トークンでログイン** — Vencord / Equicord に同梱した Bot ログインプラグイン経由で Discord Web に Bot として接続します。
- **クライアント MOD 切替** — Vencord / Equicord / なし をメニューから切り替え（再起動で適用）。
- **Embed / Components V2 / 通常メッセージ** — 本家 DiscordBotClient と同じ Discohook ベースのエディタで Embed と Components V2 を作成・送信。通常メッセージは普通の Discord と同じ挙動。
- **通常の Discord 機能** — チャンネル作成・リアクション・投票（_poll）・監査ログの閲覧などを Bot の権限範囲で実行可能（UI から実動作検証済み）。

## 必要要件

- macOS（arm64）
- Node.js / npm
- Discord Bot トークン
- [Discord Developer Portal](https://discord.com/developers/applications) で **Message Content Intent** を有効化（必須。無効の場合はログイン時に案内を表示）

## セットアップと起動

```bash
cd desktop
npm install
npm start          # 開発起動
```

パッケージ版のビルド:

```bash
bash scripts/package.sh   # → dist/BotClient.app
```

詳しい手順は [docs/usage.md](docs/usage.md)、ビルドの仕組みは [docs/build.md](docs/build.md) を参照してください。

## リポジトリ構成

```
desktop/
  main.js            # Electron メインプロセス（ウィンドウ・API 正規化・MOD 読込・エディタサーバ）
  preload.js         # メインウィンドウ用ブリッジ（BotClientNative / protoAPI）
  editor-preload.js  # エディタウィンドウ用ブリッジ（electronAPI）
  editor/            # Discohook ビルド済みエディタ（ローカル HTTP で配信）
  extensions/        # Vencord / Equicord のビルド済み拡張（Bot ログインプラグイン同梱）
  assets/            # アプリアイコン（通常の Discord アイコン）
  package.json
scripts/
  package.sh         # electron-packager + 署名 + dist への配置
docs/                # ドキュメント（architecture / usage / build）
```

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | プロセス構成・API 正規化・Intent 計算・エディタブリッジ |
| [docs/usage.md](docs/usage.md) | ログイン・MOD 切替・メッセージ送信・エディタの使い方 |
| [docs/build.md](docs/build.md) | ビルド / パッケージング・同梱物の由来・git 管理方針 |

## セキュリティに関する注意

- Bot トークンは**ディスクに保存せず、ログや UI にも出力しません**。ログイン時のみメモリ上で扱います。
- Discord Web が送る生トークンを Bot API 用の `Bot ` スキームに正規化し、ブラウザ由来のヘッダー（Origin / Referer / Cookie / `Sec-*`）を除去して 40333 エラーを回避します（[docs/architecture.md](docs/architecture.md) 参照）。

## ライセンス

本体は `GPL-3.0-or-later`（`desktop/package.json` 参照）。
同梱の Vencord / Equicord / Discohook ビルドはそれぞれの上流ライセンスに従います。