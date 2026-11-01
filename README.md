# BotClient

Discord の **Bot アカウント**を、通常の Discord クライアントと同じ UI で操作できる macOS 向け Electron アプリです。
[aiko-chan-ai/DiscordBotClient](https://github.com/aiko-chan-ai/DiscordBotClient) の体験を、Electron + Vencord / Equicord で再現しています。
iPhone 11 / iOS 18.5 以上の Safari から使える **モバイル Web クライアント**（`iPhone/`）も同梱しています。

- **Bot トークンでログイン** — Vencord / Equicord に同梱した Bot ログインプラグイン経由で Discord Web に Bot として接続します（iPhone 版はトークン入力式）。
- **クライアント MOD 切替** — Vencord / Equicord / なし をメニューから切り替え（再起動で適用）。
- **Embed / Components V2 / 通常メッセージ** — 本家 DiscordBotClient と同じ Discohook ベースのエディタで Embed と Components V2 を作成・送信。通常メッセージは普通の Discord と同じ挙動。
- **通常の Discord 機能** — チャンネル作成・リアクション・投票（_poll）・監査ログの閲覧などを Bot の権限範囲で実行可能（UI から実動作検証済み）。
- **iPhone / iPad（Web）** — Safari からサーバー・チャンネル・メッセージを操作し、通常 / Embed / Components V2 を送信できます。

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

## iPhone / iPad から使う

```bash
cd iPhone
./start.sh --lan    # 同一 Wi-Fi からアクセス可能（0.0.0.0:8787）
```

iPhone の Safari で `http://<Mac の IP>:8787/` を開き、Bot トークンを入力します。iPhone 11（414×896pt）を基準にレイアウトを実装し、iOS 18.5 以上の Safari / ホーム画面追加（PWA）に対応しています。

ブラウザの User-Agent では Discord API が `40333` を返すため、UA と認証ヘッダーを正規化するローカルブリッジ（`iPhone/server/bridge.mjs`、依存なし）を経由します。トークンはメモリ上のみで扱い、保存・ログ出力はしません。要件・仕組み・検証結果・制限事項は [docs/iphone.md](docs/iphone.md) を参照してください。

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
iPhone/
  start.sh           # モバイル Web クライアント用ブリッジの起動
  server/bridge.mjs  # 静的配信 + Discord API 中継（依存なし）
  web/               # iPhone 11 / iOS 18.5+ 向け UI・PWA マニフェスト・アイコン
scripts/
  package.sh         # electron-packager + 署名 + dist への配置
docs/                # ドキュメント（architecture / usage / build / iphone）
```

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | プロセス構成・API 正規化・Intent 計算・エディタブリッジ |
| [docs/usage.md](docs/usage.md) | ログイン・MOD 切替・メッセージ送信・エディタの使い方 |
| [docs/build.md](docs/build.md) | ビルド / パッケージング・同梱物の由来・git 管理方針 |
| [docs/iphone.md](docs/iphone.md) | iPhone / iPad 版の構成・起動・検証結果・制限事項 |

## セキュリティに関する注意

- Bot トークンは**ディスクに保存せず、ログや UI にも出力しません**。ログイン時のみメモリ上で扱います。
- Discord Web が送る生トークンを Bot API 用の `Bot ` スキームに正規化し、ブラウザ由来のヘッダー（Origin / Referer / Cookie / `Sec-*`）を除去して 40333 エラーを回避します（[docs/architecture.md](docs/architecture.md) 参照）。
- iPhone 版のブリッジは既定で `127.0.0.1` のみに公開されます。`--lan` は認証のない HTTP サーバーを同一ネットワークへ公開するため、信頼できるネットワーク内でのみ使用し、インターネットへ晒さないでください。

## ライセンス

本体は `GPL-3.0-or-later`（`desktop/package.json` 参照）。
同梱の Vencord / Equicord / Discohook ビルドはそれぞれの上流ライセンスに従います。
