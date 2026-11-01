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
    Resources/
      bridge.js               # ページ注入（fetch/XHR/WebSocket パッチ、BotClientNative シム）
      Vencord.js              # Vencord ビルド（Bot ログインプラグイン同梱）
      Vencord.css             # Vencord のスタイル
    Assets.xcassets           # アプリアイコン
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
5. `WebSocket` を Proxy で包み、IDENTIFY（op 2）送信時に `intents` と `shard` を強制します。これにより Discord Web が送るユーザー用 Intent による `4004 Invalid intent(s)` を回避します。

### Vencord と BotClientNative

- Vencord の CSS は `window.__bcVencordCss` として先に注入し、`fetch` の data URL パッチで配信します。
- `DOMContentLoaded` で `vencord:meta` イベントを発火し、Vencord の Web 拡張を初期化します。
- `window.BotClientNative` を提供します。
  - `getBotInfo` / `getBotClientName("BotClient iOS")` / `getPrivateChannelDefault` / experiments
  - ウィンドウ操作系は no-op、`requestOpenMessageEditorWindow` は false
- iOS の WKWebView には `navigator.mediaDevices` / `getDisplayMedia` / `setAppBadge` / `clearAppBadge` がないため、Vencord 起動前にスタブを設置します。

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
- iOS アプリには Discohook エディタ（Embed / Components V2 ビルダー）は同梱していません。通常の Discord メッセージ UI を使用します。
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

シミュレータでの起動例（トークンはシェル変数で渡し、ログには出しません）:

```bash
SIMCTL_CHILD_BC_BOT_TOKEN="$BOT_TOKEN" \
SIMCTL_CHILD_BC_UI_TEST="<guild_id>/<channel_id>" \
SIMCTL_CHILD_BC_UI_TEST_MESSAGE="動作確認メッセージ" \
xcrun simctl launch <device-udid> local.botclient.ios
```
