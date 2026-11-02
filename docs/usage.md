# 使い方

## 1. 起動

```bash
cd desktop
npm install
npm start
```

またはパッケージ版 `dist/BotClient.app` を起動します（ビルドは [build.md](build.md)）。

## 2. Bot トークンでログイン

1. ログイン画面で Vencord / Equicord の **Bot ログイン**欄に Bot トークンを貼り付けてログインします。
2. アプリは `applications/@me` で Bot 情報を検証します。**Message Content Intent が無効**な場合はエラーと有効化案内が出るので、Developer Portal の Bot 設定で有効化してください。
3. ログイン後は通常の Discord と同じ UI でサーバー / チャンネルが表示されます。

> トークンは保存されず、ログにも出力されません。ログアウトはメニュー「トークンを消去してログアウト」。

## 3. クライアント MOD の切替

メニュー「クライアント → クライアントMOD」から **Vencord / Equicord / なし** を選択します。
切替には再起動が必要です（確認ダイアログが出ます）。未ビルドの MOD は「（未ビルド）」と表示され選択できません。

## 4. メッセージの送信

メッセージ欄のボタンは **通常 / Embed / Components V2** で分かれています。

- **通常メッセージ**: 普通の Discord と同じくテキストを送信します。
- **Embed / Components V2**: 本家 DiscordBotClient と同じ **Discohook エディタ**が別ウィンドウで開きます。
  - 左上 `Settings`、右上 `Standard / Components V2` タブでモード切替。
  - Embed（Author / Body / Fields / Images / Footer）や Components V2（Container / Text Display / Section / Separator 等）を編集。
  - `Send` でメインウィンドウ経由でチャンネルに投稿し、エディタは閉じます。

### エディタを間違えて開いたとき

右上の **×（閉じる）ボタン** でエディタだけを閉じられます（送信はされません）。

## 5. macOS のナビゲーション

左上の信号機（閉じる/最小化/最大化）の**右側**に back / forward ボタンが配置され、重なりません。

## 6. その他の機能（Bot の権限範囲）

チャンネル作成・リアクション・投票（poll）・スレッド作成・監査ログの閲覧など、Discord Web の通常操作がそのまま使えます（UI から実動作検証済み）。
権限が足りない操作は Discord 側のエラーが表示されます。

## 7. 診断 / トラブルシュート

- メニュー「ヘルプ → BotClient 診断…」でバージョン / MOD / 状態 / URL を確認。
- MOD が読み込めない場合は診断にエラーが出ます。`extensions/<mod>/manifest.json` が同梱されているか確認してください。
- 開発者ツールはメニュー「クライアント → 開発者ツール」。

## 8. iPhone から使う（iOS アプリ）

iPhone 11（iOS 18.5 以上）向けのネイティブアプリです。Mac 側でサーバーを起動する必要はありません。

1. Xcode 16.4 で `ios/BotClient.xcodeproj` を開き、`BotClient` スキームを iPhone 11（iOS 18.5）シミュレータまたは実機で実行します（[build.md](build.md)）。
2. Discord のログイン画面で **Bot Token** を入力します。アプリは `applications/@me` で Bot を検証し、Message Content Intent が無効なら案内を表示します（トークンはメモリ上のみ、保存されません）。
3. サーバー → チャンネルを選び、通常の Discord UI でメッセージを送信します。
4. Embed / Components V2 を作るときは、メッセージ欄の右側（絵文字ボタンの左）にある **エディタ** ボタンをタップします。Discohook エディタがモーダルで開き、`Send` で投稿して閉じます。開いただけでは送信されません。左上の **×** で送信せずに閉じられます。

- 本物の Discord Web を WKWebView に読み込み、Vencord とネイティブブリッジを注入しています。
- ログイン状態は保存されないため、アプリ再起動のたびにトークン入力が必要です。
- リポジトリ直下の `BotClient.ipa` は未署名です。実機では Xcode で Team を設定して Run するか、Sideloadly などで再署名してください（[ios.md](ios.md#実機へのインストール署名)）。
- 音声、プッシュ通知は iOS 版の対象外です。
- 詳細・検証結果・制限事項は [ios.md](ios.md) を参照してください。

## 9. Android から使う（Android アプリ）

Android 8.0（API 26）以上向けのネイティブアプリです。Mac 側でサーバーを起動する必要はありません。

1. Android Studio で `android/` を開き、`app` 構成を実行します。コマンドラインでは `cd android && ./gradlew assembleDebug` で APK をビルドし、`adb install -r app/build/outputs/apk/debug/app-debug.apk` でインストールします（[build.md](build.md)）。
2. Discord のログイン画面で **Bot Token** を入力します。アプリは `applications/@me` で Bot を検証し、Message Content Intent が無効なら案内を表示します（トークンはメモリ上のみ、保存されません）。
3. サーバー → チャンネルを選び、通常の Discord UI でメッセージを送信します。
4. Embed / Components V2 を作るときは、メッセージ欄の右側（絵文字ボタンの左）にある **エディタ** ボタンをタップします。Discohook エディタが別画面で開き、`Send Message` で投稿して閉じます。開いただけでは送信されません。左上の **×** で送信せずに閉じられます。

- 本物の Discord Web を Android WebView に読み込み、iOS 版と共通の `bridge.js` / Vencord を注入しています。
- 起動時に Cookie / WebStorage を消去するため、アプリ再起動のたびにトークン入力が必要です。
- リポジトリ直下の `BotClient.apk` は Debug 署名済みで、そのまま実機へインストールできます（`adb install -r BotClient.apk`、または端末へ転送してタップ）。
- 音声、画面共有、プッシュ通知は Android 版の対象外です。
- 詳細・検証結果・制限事項は [android.md](android.md) を参照してください。
