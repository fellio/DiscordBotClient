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

## iOS クライアント（SwiftUI + WKWebView）

`ios/` は Electron とは独立したネイティブ iOS アプリです。iPhone 11 / iOS 18.5 以上を対象に、WKWebView で本物の Discord Web を読み込み、Vencord とネイティブブリッジを注入します。localhost の HTTP サーバーは使用しません。

```
SwiftUI (ContentView)
  └─ WKWebView (discord.com/login, 非永続データストア)
       ├─ UserScript: bridge.js（fetch / XHR / WebSocket パッチ）
       ├─ UserScript: Vencord ビルド + window.Vencord
       └─ window.webkit.messageHandlers.bcApi
            └─ DiscordAPIBridge（URLSession, ephemeral）
                 └─ Authorization: Bot <token> / User-Agent: DiscordBot (...)
```

- **WebView**: iPhone Safari UA、`WKWebsiteDataStore.nonPersistent()`、`.atDocumentStart` で全フレームに注入。アプリ終了時に Cookie / localStorage / IndexedDB を破棄します。
- **REST ブリッジ**: `fetch` と `XMLHttpRequest` の両方を `bcApi`（`WKScriptMessageHandlerWithReply`）経由でネイティブへ渡します。Discord Web の HTTP クライアントには XHR を使う経路があり、中継しないと履歴取得や typing が 401 になります。
  - 許可: `https` + `discord.com` / `*.discord.com` + `/api/` 配下のみ。
  - ヘッダー正規化は Electron 版と同じ（Bot スキーム付与 / DiscordBot UA / Origin・Referer・Cookie・Sec-* 除去）。ネイティブ側で改めて検証します。
  - `Authorization` の付かない API 呼び出しには、メモリ上のトークン（`getBotInfo` 成功時のみ保持）を補います。
- **Gateway**: Vencord の WebSocket を Proxy で包み、IDENTIFY（op 2）に計算済みの `intents` と `shard` を強制します。Discord Web が送るユーザー用 Intent では `4004` になるためです。FAST CONNECT の IDENTIFY も同じ Proxy を通り、`localStorage` がないコンテキストではシャード 0 として処理します。
- **Vencord**: CSS を data URL として配信し、`vencord:meta` で初期化。`window.BotClientNative` のシムを提供します。`requestOpenMessageEditorWindow` はネイティブのエディタを開きます。iOS にない `mediaDevices` / `getDisplayMedia` / `setAppBadge` などはスタブを設置します。
- **メッセージエディタ**: 同梱の `desktop/editor` を `bc-editor://local/index.html`（`WKURLSchemeHandler`）で配信し、`.overFullScreen` のモーダルで表示します。`bridge.js` がコンポーザの絵文字ボタン左にエディタボタンを挿入し、タップで Vencord プラグインのチャットバーボタンを起動します。エディタの `MessageChannel` ポートを Discord ページ（`bridge.js`）経由で受け取り、`bcEditor` メッセージハンドラで init / submit / close を中継します。localhost は使いません。`.fullScreen` だと背後の Discord WKWebView がイベントを処理できず init が遅延するため、`.overFullScreen` が必要です。
- **SPA 遷移**: ログイン後は Vencord の NavigationRouter で `/channels/...` へ遷移します（ローカルストレージにトークンがないため、再読み込みするとログイン画面に戻る）。

Intent 計算とシャード算出はデスクトップ版と同じロジックです（[Bot 情報と Intent 計算](#bot-情報と-intent-計算)）。詳細は [ios.md](ios.md) を参照してください。

## 設定とメニュー

- 設定は `userData/settings.json`（`clientMod`, `zoom`）。
- メニュー: 再読み込み / ログイン画面 / ログアウト / MOD 切替（radio）/ 再起動 / 開発者ツール / 診断。
- MOD 切替は再起動を伴い、未ビルドの MOD は選択時にエラー表示。
