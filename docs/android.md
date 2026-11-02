# Android クライアント (Android Studio / WebView)

Android 8.0（API 26）以上向けのネイティブ Android アプリです。`WebView` で本物の Discord Web を読み込み、iOS 版と同じ `bridge.js` と Vencord の Bot ログインプラグインを注入して、Bot アカウントを通常の Discord UI で操作します。localhost のプロキシサーバーは使用しません。

## 必要要件

| 項目 | 内容 |
| --- | --- |
| 開発環境 | Android Studio（Rabbit 2026.2.2 で確認）/ JDK 17（Android Studio 同梱 JBR）/ Android SDK Platform 37 / Build-Tools 36.0.0 |
| 実行環境 | Android 8.0（API 26）以上、Android System WebView 88 以上（`WebMessageListener`） |
| 検証端末 | Pixel 7 / API 35 エミュレータ（Android 15、WebView 124） |
| Bot | Discord Bot トークン |
| Discord 設定 | [Developer Portal](https://discord.com/developers/applications) で **Message Content Intent** を有効化 |

## ビルドと起動

Android Studio で `android/` ディレクトリを開き、`app` 構成を実行します。初回は SDK のダウンロードと Gradle の同期が走ります。

コマンドラインでビルドする場合:

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- `android/local.properties` の `sdk.dir` は Android Studio が生成します（リポジトリ管理外）。
- JDK は Android Studio 同梱の JBR（Temurin 17）を使用します。`JAVA_HOME` を指定する場合は `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` を付けて実行してください。
- APK は `android/app/build/outputs/apk/debug/app-debug.apk` に出力されます。
- Application ID は `local.botclient.android`、`minSdk = 26`、`targetSdk = 34`、`compileSdk = 37` です。
- Gradle 9.4.1 / Android Gradle Plugin 9.2.1（AGP 内蔵 Kotlin）を使用します。リリース署名は未設定のため、検証は Debug ビルドで行っています。

## 構成

```
android/
  settings.gradle.kts / build.gradle.kts / gradle.properties
  gradle/wrapper/                     # Gradle 9.4.1
  app/build.gradle.kts                # AGP 9.2.1 / editor アセットのステージング
  app/src/main/
    AndroidManifest.xml
    java/local/botclient/android/
      BotClientApp.kt                 # Application（WebView / Activity の WeakReference）
      MainActivity.kt                 # Discord WebView・注入・ブリッジ・DEBUG フック
      DiscordRestBridge.kt            # REST 中継（HttpURLConnection）
      MessageEditorActivity.kt        # メッセージエディタ Activity
    assets/
      android-shim.js                 # window.webkit.messageHandlers.* を BCNative 上に再現
      uitest.js                       # DEBUG ビルド用 UI テスト
    res/                              # テーマ・文字列・ランチャーアイコン
  （ビルド時に ios/BotClient/Resources と desktop/editor を assets へ取り込み）
```

`app/build.gradle.kts` の `stageEditorAssets` が `desktop/editor/` を `build/generated/botclient-assets/` へコピーし、`sourceSets` が `ios/BotClient/Resources/`（`bridge.js` / `Vencord.js` / `Vencord.css`）とあわせて APK の assets に含めます。iOS 版と同じブリッジと Vencord ビルドを共有する構成です。

## 動作の仕組み

### WebView とスクリプト注入

- `https://discord.com/login` を Android Chrome モバイルの User-Agent で読み込みます。
- 起動時に Cookie と WebStorage（localStorage / IndexedDB）を消去します。ログイン状態は永続化しません。
- `WebViewCompat.addDocumentStartJavaScript` で `discord.com` オリジンに以下を注入します。
  1. `android-shim.js` — iOS の `window.webkit.messageHandlers.bcApi` / `bcEditor` / `bcLog` を、Android の `WebMessageListener`（`BCNative`）上に Promise ベースで再現します。
  2. `bridge.js` — `fetch` / `XMLHttpRequest` / `WebSocket` のパッチ、`BotClientNative` シム、Vencord 初期化、エディタボタンの挿入。
- Vencord バンドル（約 1.69MB）は 200,000 文字ずつの base64 チャンクに分けて複数の document-start スクリプトで渡し、最後に `atob` + `TextDecoder` + 間接 `eval` で実行します。Discord の CSP は `'unsafe-eval'` を許可しているため成立します。
- `window.__bcPlatformName = "BotClient Android"` を設定し、`getBotClientName` が Android 版として応答します。

### REST / Gateway

- Discord Web の API 呼び出しは `BCNative.postMessage({kind:"api"})` でネイティブへ渡し、`DiscordRestBridge` が `HttpURLConnection` で中継します。
  - 許可: `https` + `discord.com` / `*.discord.com` + パスが `/api/` で始まるもの。
  - メソッド: `GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD` / `OPTIONS`。
  - `Authorization` を `Bot <token>` に正規化し、`Origin` / `Referer` / `Cookie` / `Host` / `Content-Length` / `Accept-Encoding` / `Sec-*` を除去、`User-Agent` を DiscordBot 用に固定します。
  - レスポンスは `{status, statusText, headers, body(base64), url}` で返し、JS 側で `Response` / XHR イベントへ復元します。
- Gateway の Intent / Shard 強制は iOS 版と共通の `bridge.js`（WebSocket Proxy）が行います。FAST CONNECT の IDENTIFY も同じ経路を通ります。

### メッセージエディタ

- コンポーザ内のエディタボタン（絵文字ボタンの左）から `MessageEditorActivity` を開きます。
- エディタ本体は `WebViewAssetLoader` で `https://appassets.androidplatform.net/index.html` として配信します。`desktop/editor` の絶対パス（`/assets/...`）がそのまま解決されます。
- エディタの `MessageChannel` ポートは `editor-frame.js` → Discord ページの `bridge.js` → `BCNative` の順でリレーし、`window.__bcEditorEvent` / `window.__bcEditorInit` で init / submit / close をやり取りします。
- 送信はエディタ → `BCNative` → Discord ページの Vencord プラグイン → REST の順で行われます。エディタを開いただけ、または × で閉じただけでは送信されません。

### ライフサイクル

- `MainActivity` が Discord WebView を保持し、エディタは別 Activity（`exported=false`）で表示します。
- エディタ Activity と Discord WebView は `BotClientApp` の `WeakReference` で相互参照し、init データと送信結果を中継します。
- 画面回転などは Manifest の `configChanges` で再生成を抑止しています。

## 検証結果（Pixel 7 / API 35 エミュレータ / WebView 124）

| 項目 | 結果 |
| --- | --- |
| Debug ビルド | 成功（`assembleDebug`、APK 約 9.2MB） |
| Bot トークンログイン | 成功。デバッグフックでログインし、`[Client]: Ready event` と Gateway 接続を確認 |
| ギルド / チャンネル | `1566086514020974604` / `1566086515367612438` を表示 |
| メッセージ履歴 | `GET /api/v9/channels/1566086515367612438/messages` を XHR ブリッジ経由で取得 |
| UI テスト送信 | コンポーザへ入力して送信ボタンをタップ。`POST /api/v9/channels/1566086515367612438/messages 200`、チャンネルに表示 |
| エディタボタン | コンポーザに 1 つだけ表示（プラグインのチャットバーボタンとの重複なし） |
| エディタ起動 | Advanced Message Editor (Beta) が Activity として開き、Discohook が初期化されることを確認 |
| エディタを閉じる | × で送信せずに閉じ、`POST /messages` が発生しないことを確認 |
| エディタ送信 | 本文を入力して `Send Message` をタップ。`POST .../messages 200`、Activity が閉じ、チャンネルに「Editor test from Android」を表示 |
| 通常メッセージ送信 | コンポーザへ入力して送信ボタンをタップ。`POST .../messages 200`、チャンネルに「Composer test from Android」を表示 |

送信検証は BotClient の UI（実際の Discord コンポーザ / エディタと送信ボタン）から行い、Python などの外部スクリプトで API を直接叩いていません。

## エラー時の挙動

- **Message Content Intent 無効**: ログイン前にエラーを返し、Developer Portal での有効化を案内します（ブリッジ共通）。
- **トークン不正 / 期限切れ**: `applications/@me` が `401` を返し、Discord のログイン画面へ戻ります。
- **ネットワークエラー**: WebView の読み込み失敗時に「Discord を読み込めませんでした」と「再試行」ボタンを表示します。
- **WebView プロセス終了**: 再読み込みして復帰します（エディタ側はエラーダイアログ後に閉じられます）。

## 制限事項

- 検証はエミュレータ（Pixel 7 / API 35）で実施済みです。実機 Android での動作確認は未実施です。
- Android System WebView のバージョンに依存します。`WebMessageListener`（88+）と `addDocumentStartJavaScript`（83+）が必要です。Discord Web の描画には新しい WebView が望ましく、検証は WebView 124 で行いました。初回読み込みは Vencord と Discord バンドルの評価に時間がかかります。
- ログイン状態は保存しません。アプリを再起動するたびに Bot トークンの入力が必要です。
- エディタの添付ファイル送信は実装済み（base64 → `ArrayBuffer` 中継）ですが、Android での検証は未実施です。
- 音声 / 画面共有 / プッシュ通知は対象外です。
- Vencord が Electron 向けに描画するウィンドウコントロール（最小化・閉じる等）が Web UI 上に表示されますが、no-op です。
- リリースビルドの署名設定は未構成です。

## セキュリティ

- Bot トークンはメモリ上でのみ扱い、ディスク・ログ・UI に出力しません。
- 起動時に Cookie / WebStorage を消去し、トークンやセッションを永続化しません。
- Debug ビルドの自動ログイン用 intent extra（`bc_bot_token`）は `BuildConfig.DEBUG` でのみ読み取ります。リリースビルドには含まれません。
- ネイティブブリッジは Discord API の URL とメソッドを検証し、ブラウザ由来のヘッダーを除去します。
- `usesCleartextTraffic=false` で平文 HTTP を禁止し、localhost の HTTP サーバーや LAN 公開は行いません。

## DEBUG 検証用フック

Debug ビルドのみ、起動 intent の extra で自動ログインと UI 検証を実行できます。

| intent extra | 用途 |
| --- | --- |
| `bc_bot_token` | ログイン画面でトークンを自動入力（メモリのみ、保存なし） |
| `bc_ui_test` | `<guild_id>/<channel_id>` 形式。Vencord のルーターでチャンネルへ遷移し、実コンポーザへ入力 |
| `bc_ui_test_message` | `bc_ui_test` で送信するメッセージ本文 |

起動例（トークンはシェル変数で渡し、ログには出しません）:

```bash
adb shell am start -n local.botclient.android/.MainActivity \
  --es bc_bot_token "$BOT_TOKEN" \
  --es bc_ui_test "<guild_id>/<channel_id>" \
  --es bc_ui_test_message "動作確認メッセージ"
```

`adb shell` 経由では空白を含む extra が分割されることがあります。空白を含む本文を渡す場合は、端末側でクォートするか `%s` を使ってください。
