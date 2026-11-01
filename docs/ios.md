# iOS クライアント (Xcode / WKWebView)

iPhone 11 / iOS 18.5 以上向けのネイティブ iOS アプリです。SwiftUI + `WKWebView` で本物の Discord Web を読み込み、Vencord の Bot ログインプラグインとネイティブブリッジを注入して、Bot アカウントを通常の Discord UI で操作します。localhost のプロキシサーバーは使用しません。

## 必要要件

| 項目 | 内容 |
| --- | --- |
| 開発環境 | Xcode 16.4 以上（Swift 5 / iOS 18.5 SDK） |
| 実行環境 | iPhone 11 以降、iOS 18.5 以上 |
| Bot | Discord Bot トークン |
| Discord 設定 | [Developer Portal](https://discord.com/developers/applications) で **Message Content Intent** を有効化 |

## ビルドと起動

Xcode で `ios/BotClient.xcodeproj` を開き、`BotClient` スキームを iPhone 11（iOS 18.5）シミュレータまたは実機で実行します。

- Bundle ID: `local.botclient.ios`（実機で配布する場合は Signing & Capabilities で Team と Bundle ID を変更）
- Deployment Target: iOS 18.5
- 対応端末: iPhone（`TARGETED_DEVICE_FAMILY = 1`）
- 向き: 縦・左右の横画面

コマンドラインでビルドする場合:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/BotClient.xcodeproj \
  -scheme BotClient \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 11,OS=18.5' \
  build
```

`xcode-select` が Command Line Tools を指している場合は `DEVELOPER_DIR` の指定が必要です。

## 構成

```
ios/
  BotClient.xcodeproj/        # 手書きの Xcode プロジェクト（objectVersion 77）
  BotClient/
    BotClientApp.swift        # @main / SwiftUI App
    ContentView.swift         # 全画面 WKWebView + 読み込み表示 + 再試行オーバーレイ
    DiscordWebView.swift      # WKWebView 設定・UserScript 注入・ナビゲーション処理
    DiscordAPIBridge.swift    # WKScriptMessageHandlerWithReply による REST 中継
    MessageEditorController.swift  # メッセージエディタのモーダル表示と Discord とのリレー
    EditorSchemeHandler.swift # bc-editor:// でエディタ本体を配信する WKURLSchemeHandler
    Resources/
      bridge.js               # ページ注入（fetch/XHR/WebSocket パッチ、BotClientNative シム）
      editor-frame.js         # エディタページへ注入するブリッジ（ポート確立・submit 中継）
      Vencord.js              # Vencord ビルド（Bot ログインプラグイン同梱）
      Vencord.css             # Vencord のスタイル
    Assets.xcassets           # アプリアイコン
desktop/editor/               # Discohook ベースのエディタ（アプリへ editor フォルダとして同梱）
```

## 動作の仕組み

### WKWebView

- `https://discord.com/login` を iPhone Safari の User-Agent で読み込みます。
- `WKWebsiteDataStore.nonPersistent()` を使用します。Cookie / localStorage / IndexedDB はアプリ終了時に破棄され、トークンがディスクへ残りません。
- ページ読み込みのたびに `.atDocumentStart` で以下を注入します。
  1. `bridge.js`（ページワールド）
  2. Vencord バンドル + `window.Vencord` のエクスポート

### REST ブリッジ

Discord Web が `fetch` / `XMLHttpRequest` で送る `https://discord.com/api/*` を `window.webkit.messageHandlers.bcApi` 経由でネイティブへ渡します。

- 許可: `https` + `discord.com` / `*.discord.com` + パスが `/api/` で始まるもの
- メソッド: `GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD` / `OPTIONS`
- ヘッダー正規化:
  - `Authorization` が `Bot` / `Bearer` で始まらなければ `Bot <token>` を付与
  - `Origin` / `Referer` / `Cookie` / `Host` / `Content-Length` / `Accept-Encoding` / `Sec-*` を削除
  - `User-Agent` を DiscordBot 用 UA に固定
- セッションは ephemeral（Cookie なし・キャッシュなし）
- レスポンスは `{status, statusText, headers, body(base64), url}` で返し、JS 側で `Response` / XHR イベントへ復元

`bridge.js` は `fetch` だけでなく `XMLHttpRequest` も同じブリッジへ通します。Discord Web の HTTP クライアントは XHR を使う経路があり、これを中継しないとメッセージ履歴や typing が `401` になります。また、`Authorization` が付かない API 呼び出しには、メモリ上に保持したトークン（`getBotInfo` 成功時のみ）を補います。

### Gateway（Intent / Shard）

1. `GET /api/v10/applications/@me?with_counts=true` で Bot 情報と `flags` を取得します。
2. `flags` から Intent を計算します（`ALL_INTENTS` = bit 0–16, 20, 21, 24, 25）。Presence / Guild Members / Message Content が無効なら対応ビットを除去します。
3. Message Content Intent が無効な場合はログインを中断して案内を返します。
4. 参加サーバー数からシャード数を計算します（`GUILDS_PER_SHARD = 1000`）。
5. `WebSocket` を Proxy で包み、IDENTIFY（op 2）送信時に `intents` と `shard` を強制します。FAST CONNECT の IDENTIFY もこのプロキシを通りますが、そのコンテキストでは `localStorage` が使えないため、シャード値の読み取りに失敗した場合は 0 として継続します。これにより Discord Web が送るユーザー用 Intent による `4004 Invalid intent(s)` を回避します。

### Vencord と BotClientNative

- Vencord の CSS は `window.__bcVencordCss` として先に注入し、`fetch` の data URL パッチで配信します。
- `DOMContentLoaded` で `vencord:meta` イベントを発火し、Vencord の Web 拡張を初期化します。
- `window.BotClientNative` を提供します。
  - `getBotInfo` / `getBotClientName("BotClient iOS")` / `getPrivateChannelDefault` / experiments
  - ウィンドウ操作系は no-op、`requestOpenMessageEditorWindow` は iOS ネイティブのエディタを開きます
- iOS の WKWebView には `navigator.mediaDevices` / `getDisplayMedia` / `setAppBadge` / `clearAppBadge` がないため、Vencord 起動前にスタブを設置します。

### Advanced Message Editor (Beta)

Discord 上に注入した Vencord の BotClient プラグインから、Discohook ベースのエディタを iOS ネイティブのモーダルとして開きます。ホスト型の localhost サーバーは使わず、アプリに同梱した `desktop/editor` を `bc-editor://local/index.html` として配信します。

- **起動**: メッセージ欄の右側、絵文字ボタンの左にエディタボタンを挿入します（Mac 版のチャットバーボタンと同じ位置）。タップすると Vencord プラグインのチャットバーボタンをプログラム的にクリックし、通常のプラグイン経路でエディタを要求します。ボタンはコンポーザの描画後に自動で追加され、チャンネル以外では非表示になります。
- **ボタンの一本化**: プラグイン自身が登録する Vencord のチャットバーボタンは、モバイルのコンポーザにも描画されると上のインラインボタンと重複します。`bridge.js` が 1 秒ごとに `removeChatBarButton("BotClient")` で登録を解除し、すでに描画済みの `.vc-chatbar-button` は `display: none` で隠します。エディタを開く処理はプラグインの render を直接呼ぶため、登録解除後も動作します。
- **配信**: `EditorSchemeHandler`（`WKURLSchemeHandler`）がバンドル内の `editor` フォルダを読み、`index.html` の `<head>` 直後に `editor-frame.js` をインライン注入します。パスは正規化してルート外への参照を拒否します。
- **ブリッジ**: エディタは `window.electronAPI.reactReady()` で `MessageChannel` を作り、`window.postMessage("forward-editor-port", "*", [port])` でホストへ渡します。Discord ページ側の `bridge.js` がポートを受け取り、`window.__bcEditorEvent` / `window.__bcEditorInit` を介してネイティブ（`bcEditor` メッセージハンドラ）と JSON を中継します。localhost も CSP 緩和も不要です。
- **初期化**: ネイティブはプラグインの init データを `window.__bcEditorInit` でエディタへ渡します。
- **送信**: エディタの submit（`action` / `profile` / `messages` / `files`）をネイティブが受け取り、Discord ページへ転送します。`bridge.js` はファイルを base64 から `ArrayBuffer` に戻し、`type: "submit"` を付けてプラグインのポートへ送ります。プラグインが REST でメッセージを作成し、成功後にモーダルを閉じます。
- **モーダル**: `UINavigationController` + `.overFullScreen` で表示します。`.fullScreen` だと背後の Discord WKWebView がウィンドウから外れてイベント配信が止まり、初期化が届かなくなるためです。左上の × で閉じられます。
- **ストレージ**: カスタムスキームでは WebKit が localStorage を拒否するため、`editor-frame.js` がメモリ上の Map ベースの shim を設置します。`crypto.randomUUID` の shim も同梱します。
- **エラー**: エディタの読み込み失敗時はアラートを表示し、× で閉じられるようにしています。Web プロセス終了時は再読み込みします。

## 検証結果（Xcode 16.4 / iPhone 11 シミュレータ / iOS 18.5）

| 項目 | 結果 |
| --- | --- |
| Debug ビルド | 成功（`** BUILD SUCCEEDED **`） |
| Bot トークンログイン | 成功。Bot Token フォームからログインし `/app` へ遷移 |
| Gateway | `Ready event` 受信。`Bot Intents: 53608447 Shard ID: 0 (All: 1)` |
| ギルド / チャンネル | `1566086514020974604` / `1566086515367612438` を表示 |
| メッセージ履歴 | `GET /api/v9/channels/1566086515367612438/messages 200` |
| 通常メッセージ送信 | UI のコンポーザに入力し送信ボタンをクリック。`POST /api/v9/channels/1566086515367612438/messages 200`、送信後にコンポーザがクリアされ、チャンネルにメッセージが表示されることを確認 |
| typing | `POST /api/v9/channels/1566086515367612438/typing 204` |
| エディタボタンの重複なし | プラグインのチャットバーボタンを描画させても、コンポーザに表示されるエディタボタンはインラインの 1 つだけであることを確認 |
| エディタ起動 | コンポーザ内のエディタボタンから Advanced Message Editor (Beta) がモーダルで開くことを確認 |
| エディタ初期化 | モーダル表示中に init がエディタへ届き、Discohook エディタが操作可能になることを確認 |
| エディタ起動時の自動送信なし | エディタを開いたまま 1 分以上待機し、`submit` / `POST /messages` が発生せずモーダルが開いたままであることを確認 |
| エディタを閉じる | 左上の × で送信せずにモーダルが閉じ、`POST /messages` が発生しないことを確認 |
| エディタ送信（Embed） | エディタで Embed を設定して送信。`POST /api/v9/channels/1566086515367612438/messages 200`、チャンネルに Embed が表示され、モーダルが閉じることを確認 |
| エディタ送信（本文） | エディタで本文を入力して `Send Message` をタップ。`POST /api/v9/channels/1566086515367612438/messages 200`、モーダルが閉じ、チャンネルにメッセージが表示されることを確認 |
| エディタ後の通常送信 | エディタを閉じた後も通常のコンポーザから送信でき、`POST .../messages 200` を確認 |
| 無効トークン | `401 Unauthorized` を検出し、Bot Token ログイン画面へ戻る（クラッシュなし） |
| Bot 制限エンドポイント | billing / quests / powerups などは `403`。Discord UI は継続動作し、致命的エラーにならない |

送信検証は BotClient の UI（実際の Discord コンポーザと送信ボタン）から行い、Python などの外部スクリプトで API を直接叩いていません。

## エラー時の挙動

- **Message Content Intent 無効**: ログイン前にエラーを返し、Developer Portal での有効化を案内します。
- **トークン不正 / 期限切れ**: `applications/@me` が `401` を返し、Discord のログイン画面へ戻ります。
- **ネットワークエラー**: WKWebView の読み込み失敗時に `Discord を読み込めませんでした` オーバーレイと「再試行」ボタンを表示します。
- **Bot 権限不足**: Discord 側の 403 / 権限エラーがそのまま UI に表示されます。

## 制限事項

- 検証は iPhone 11 シミュレータ（iOS 18.5）で実施済みです。実機 iPhone での動作確認は未実施です。実機では Xcode の Signing Team 設定が必要です。
- ログイン状態は保存しません（`nonPersistent`）。アプリを再起動するたびに Bot トークンの入力が必要です。
- Advanced Message Editor はメッセージ欄右側（絵文字ボタンの左）のエディタボタンから開きます。モバイル版 Discord の DOM はデスクトップ版と異なるため、`aria-label` を持つ Send / 絵文字ボタンを基準にボタン行を検出して挿入しています。
- エディタの添付ファイル送信は実装済み（base64 → `ArrayBuffer` 中継）ですが、検証は未実施です。
- 音声 / 画面共有 / プッシュ通知は対象外です。Vencord の一部機能は iOS にない Web API のため動作しません（スタブで起動のみ維持）。
- Vencord が Electron 向けに描画するウィンドウコントロール（最小化・閉じる等）が Web UI 上に表示されますが、no-op です。

## セキュリティ

- Bot トークンはメモリ上でのみ扱い、ディスク・ログ・UI に出力しません。
- WKWebView のデータストアは非永続で、アプリ終了時に Cookie / localStorage / IndexedDB を破棄します。
- ネイティブブリッジは Discord API の URL とメソッドを検証し、ブラウザ由来のヘッダーを除去します。
- localhost の HTTP サーバーや LAN 公開は行いません。

## DEBUG 検証用フック

DEBUG ビルドのみ、環境変数で自動ログインと UI 検証を実行できます。リリースビルドには含まれません。

| 環境変数 | 用途 |
| --- | --- |
| `BC_BOT_TOKEN` | ログイン画面でトークンを自動入力（メモリのみ、保存なし） |
| `BC_DESKTOP_UA=1` | デスクトップ UA + 0.6 ズームで表示確認 |
| `BC_UI_TEST=<guild>/<channel>` | Vencord のルーターでチャンネルへ遷移し、実コンポーザへ入力 |
| `BC_UI_TEST_MESSAGE` | `BC_UI_TEST` で送信するメッセージ本文 |

エディタの起動・送信確認は、実際のコンポーザ内エディタボタンとエディタの `Send Message` を操作して行います。自動送信を伴うテストフックは、開いただけで送信される誤動作の原因になるため削除しました。

シミュレータでの起動例（トークンはシェル変数で渡し、ログには出しません）:

```bash
SIMCTL_CHILD_BC_BOT_TOKEN="$BOT_TOKEN" \
SIMCTL_CHILD_BC_UI_TEST="<guild_id>/<channel_id>" \
SIMCTL_CHILD_BC_UI_TEST_MESSAGE="動作確認メッセージ" \
xcrun simctl launch <device-udid> local.botclient.ios
```
