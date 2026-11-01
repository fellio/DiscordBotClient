# アーキテクチャ

BotClientは Electron のマルチプロセス構成で、Discord Web を「Bot として」動作させるための調整をメインプロセス側で行います。

## プロセス構成

```
┌─ Main (desktop/main.js) ─────────────────────────────┐
│  BrowserWindow 管理 / 設定 / メニュー / 診断           │
│  session.webRequest で API ヘッダー正規化・CSP 除去     │
│  Bot 情報取得 (getBotInfo) / Intent 計算               │
│  Vencord / Equicord 拡張の読込                        │
│  エディタ用ローカル HTTP サーバ (Node http)             │
└──────────────┬───────────────────────┬───────────────┘
               │ preload.js            │ editor-preload.js
┌──────────────▼──────────┐  ┌─────────▼───────────────┐
│ Main Window (Discord Web)│  │ Editor Window (Discohook)│
│  window.BotClientNative  │◄─┤  window.electronAPI      │
│  window.protoAPI         │  │  MessagePort ブリッジ     │
└──────────────────────────┘  └──────────────────────────┘
```

- **メインウィンドウ**: `https://discord.com/channels/@me` を読み込み、`preload.js` が `BotClientNative` / `protoAPI` を公開します。
- **エディタウィンドウ**: `desktop/editor/`（Discohook ビルド）を `127.0.0.1` のローカル HTTP で配信して読み込みます。`modal: true`・`parent: mainWindow`。

## Bot API ヘッダー正規化

Discord Web はユーザー用の生トークンを送りますが、Bot API は `Bot ` スキームを要求し、ブラウザ由来のヘッダーが付くと `40333 (internal network error)` で拒否されます。
そこで `session.webRequest.onBeforeSendHeaders`（`/api/*` 対象）で以下を行います（本家 DiscordBotClient のプロキシと同じ正規化）。

1. `Authorization` が `Bot`/`Bearer` で始まらなければ `Bot <token>` に付与。
2. `User-Agent` を `DiscordBot (https://github.com/aiko-chan-ai/DiscordBotClient, v<version>)` に置換。
3. `Origin` / `Referer` / `Cookie` / `Sec-*` ヘッダーを削除。

## CSP 除去と権限

- Vencord / Equicord は CSP のない Discord ページを前提とするため、メイン/サブフレームの `Content-Security-Policy(-Report-Only)` を `onHeadersReceived` で除去します。
- 権限は Discord オリジンに限定。マイクは OS に許可を問い合わせ、**画面収録（video）は拒否**。通知 / フルスクリーン / クリップボード書き込みは許可。

## Bot 情報と Intent 計算

`getBotInfo(token)` は `GET /api/v10/applications/@me?with_counts=true` を呼び、アプリの `flags` から Intent を計算します（`computeIntents`）。

- `PRESENCE` / `GUILD_MEMBERS` / `MESSAGE_CONTENT` の各フラグ（limited 含む）に応じて対応する Intent ビットを付与/除去。
- **Message Content Intent が無効な場合はログインを拒否**し、Developer Portal での有効化を案内します。
- 参加サーバー数からシャード数を算出（`GUILDS_PER_SHARD = 1000`）。

## エディタブリッジ（MessagePort）

1. エディタが `electronAPI.reactReady()` を送信 → メインが `MessageChannelMain` を生成。
2. 片方のポートをエディタへ（`editor-preload.js` が `window.postMessage("forward-editor-port", …)` で転送）、もう片方をメインウィンドウへ（`preload.js` が同様に転送）。
3. メインウィンドウ側の Discohook 統合コードがポート経由で init / submit をやり取りし、`window.DiscohookEditor`（getMode / getData / setData / getProfile）を公開します。

これにより「本家と同じ UI」で Embed / Components V2 を編集し、送信時にメインウィンドウ経由で Discord へ投稿します。

## UI の補助注入（メインプロセスから）

プレロードの isolated world での DOM 注入はページ読込で消えることがあるため、確実な `webContents.insertCSS` / `executeJavaScript` を `did-finish-load` で行います。

- **エディタの閉じる×ボタン**（`#bc-editor-close`）: Settings ボタンの親要素に追加。クリックで `electronAPI.closeWindow()`。
- **macOS の back/forward 位置**: `hiddenInset` の信号機と重ならないよう `[class*="backForwardButtons"]{margin-left:76px;}` を注入（darwin のみ）。

## iPhone クライアント（Web + bridge）

`iPhone/` は Electron とは独立したモバイル Web クライアントです。iOS 18.5 以上の Safari（iPhone 11 基準）を対象に、静的 UI と Node 製のローカルブリッジで構成します。

```
Safari ── POST /api/proxy {token, method, path, body} ──▶ bridge (127.0.0.1:8787)
                                                           │ Authorization: Bot <token>
                                                           │ User-Agent: DiscordBot (...)
                                                           ▼
                                                  discord.com/api/v10
```

- **静的 UI** (`web/`): ログイン / サーバー / チャンネル / チャットの 4 画面。`100dvh` と `env(safe-area-inset-*)` でモバイル表示に対応し、`manifest.webmanifest` で PWA（ホーム画面追加）に対応します。
- **ブリッジ** (`server/bridge.mjs`): `web/` の配信と `/api/proxy` を提供。依存パッケージなし。
  - メソッドは `GET` / `POST` / `PATCH` / `DELETE` のみ、パスは `/` 始まりかつ `..` を含まないもののみ許可。
  - 静的配信は `web/` 配下に解決できるファイルだけを返す（`web/` 外は 403）。
  - トークンはリクエストボディから受け取り、`Authorization: Bot <token>` を付けて Discord へ転送。ログ・ディスクには残さない。
  - 既定で `127.0.0.1` にバインド。`--lan` 指定時のみ `0.0.0.0` に公開。
- **なぜ Electron のヘッダー正規化を再利用しないか**: iPhone の Safari は Electron の `session.webRequest` を持たないため、同じ正規化（Bot スキーム / Bot UA / ブラウザヘッダー除去）を HTTP ブリッジとして独立実装しています。ブラウザ UA のままでは Discord が `40333` を返すことを実 API で確認済みです。
- メッセージ取得はチャンネルを開いた時と送信後の REST 再取得のみで、Gateway によるリアルタイム受信は行いません。

詳細は [iphone.md](iphone.md) を参照してください。

## 設定とメニュー

- 設定は `userData/settings.json`（`clientMod`, `zoom`）。
- メニュー: 再読み込み / ログイン画面 / ログアウト / MOD 切替（radio）/ 再起動 / 開発者ツール / 診断。
- MOD 切替は再起動を伴い、未ビルドの MOD は選択時にエラー表示。
