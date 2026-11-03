# BotClient

Discord の **Bot アカウント**を、通常の Discord クライアントと同じ UI で操作できるクライアントです。
[aiko-chan-ai/DiscordBotClient](https://github.com/aiko-chan-ai/DiscordBotClient) の体験を、macOS 版は Electron + Vencord / Equicord、iOS 版は SwiftUI + WKWebView、Android 版は Kotlin + WebView で再現しています。

## プラットフォーム

| プラットフォーム | 実装 | 対応環境 | ビルド / 配布 |
| --- | --- | --- | --- |
| macOS | Electron + Vencord / Equicord | macOS arm64 | `desktop/` + `scripts/package.sh` |
| iOS | SwiftUI + WKWebView | iPhone 11 以降 / iOS 18.5 以上 | `ios/` + Xcode 16.4（配布 IPA は要署名） |
| Android | Kotlin + WebView | Android 8.0（API 26）以上 | `android/` + Android Studio（APK はそのままインストール可） |

iOS / Android 版は本物の Discord Web を WebView に読み込み、macOS 版と同じ Vencord の Bot ログインプラグインと `bridge.js` を注入します。localhost のプロキシサーバーや LAN 公開は行いません。

## 主な機能

- **Bot トークンでログイン** — Vencord / Equicord に同梱した Bot ログインプラグイン経由で Discord Web に Bot として接続します。iOS / Android 版は Bot Token 入力式です。
- **Embed / Components V2 / 通常メッセージ** — 本家 DiscordBotClient と同じ Discohook ベースのエディタで Embed と Components V2 を作成・送信します。macOS 版は別ウィンドウ、iOS 版はモーダル、Android 版は別 Activity で開きます。通常メッセージは普通の Discord と同じ挙動です。
- **通常の Discord 機能** — チャンネル作成・リアクション・投票（_poll）・スレッド作成・監査ログの閲覧などを Bot の権限範囲で実行できます（UI から実動作検証済み）。
- **クライアント MOD 切替（macOS 版）** — Vencord / Equicord / なし をメニューから切り替えます（再起動で適用）。
- **ネイティブ REST ブリッジ** — Discord Web の `fetch` / XHR をネイティブ側で中継し、`Authorization` を Bot 用に正規化、ブラウザ由来のヘッダーを除去します。
- **ネイティブアプリとしての分離** — iOS は `WKScriptMessageHandlerWithReply`、Android は `WebMessageListener` を使用します。トークンはメモリ上のみで扱い、ディスク・ログ・UI には出力しません。

## ビルド済みファイル（リポジトリ直下）

検証済みのビルドをリポジトリ直下に配置しています。いずれも Git に追跡しており、クローンするだけで入手できます。

| ファイル | 内容 | 実機へのインストール |
| --- | --- | --- |
| `BotClient.apk` | Android Debug ビルド（debug keystore で署名済み） | **そのままインストール可能**。`adb install -r BotClient.apk`、または端末へ転送してタップ |
| `BotClient.ipa` | iOS Release ビルド（arm64 / iOS 18.5 以上、**未署名**） | 署名が必要。Xcode でビルドし直すか、Sideloadly / AltStore などで再署名してインストール |

### Android へのインストール

```bash
adb install -r BotClient.apk
```

USB を使わない場合は APK を端末へ転送してタップし、「提供元不明のアプリ」を許可します。Debug 署名のため Play Protect の警告が出ることがあります。配布用には keystore と `signingConfig` を設定したリリース署名済み APK を作成してください。

### iOS へのインストール（署名が必要）

未署名の IPA は、非脱獄の iPhone にはそのままインストールできません。Apple のコード署名が必要です。Xcode の GUI には IPA を読み込んで再署名する機能がないため、次のいずれかを使います。

1. **Mac + Xcode（推奨）** — `ios/BotClient.xcodeproj` を開き、Signing & Capabilities で Team を設定して実機へ Run します。Xcode がビルドと署名を行います（[docs/ios.md](docs/ios.md#実機へのインストール署名)）。
2. **Mac がない場合** — Windows の **Sideloadly**、または **AltStore**（Windows 版 AltServer）/ **SideStore** で `BotClient.ipa` を Apple ID により再署名してインストールします。無料 Apple ID は **7 日で失効**します。有料の署名サービスを使う方法もあります。
3. **配布する場合** — 不特定の端末へ配布するには Apple Developer Program が必要です（UDID 登録による Ad Hoc、TestFlight、App Store のいずれか）。1 つの署名済み IPA を全端末でインストールできるわけではありません。

Mac・Windows・署名サービスのいずれも使えない場合、未署名 IPA を実機へ入れる手段はありません（脱獄端末は対象外）。

## 必要要件

- Discord Bot トークン
- [Discord Developer Portal](https://discord.com/developers/applications) で **Message Content Intent** を有効化（必須。無効の場合はログイン時に案内を表示）
- macOS 版: macOS（arm64）、Node.js / npm
- iOS 版のビルド: macOS + Xcode 16.4 以上
- Android 版のビルド: Android Studio、JDK 17、Android SDK Platform 37 / Build-Tools 36.0.0

## セットアップと起動

### macOS（Electron）

```bash
cd desktop
npm install
npm start          # 開発起動
```

パッケージ版のビルド:

```bash
bash scripts/package.sh   # → dist/BotClient.app
```

### iOS（Xcode）

`ios/BotClient.xcodeproj` を Xcode 16.4 で開き、`BotClient` スキームを iPhone 11（iOS 18.5）シミュレータまたは実機で実行します。実機では Signing & Capabilities の Team 設定が必要です。

コマンドラインでビルドする場合（`DEVELOPER_DIR` は環境に合わせて変更）:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/BotClient.xcodeproj \
  -scheme BotClient \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 11,OS=18.5' \
  build
```

起動後、Discord の Bot Token ログイン画面でトークンを入力します。要件・仕組み・実機への署名手順・検証結果・制限事項は [docs/ios.md](docs/ios.md) を参照してください。

### Android（Android Studio）

`android/` を Android Studio で開き、`app` 構成を実行します。コマンドラインの場合:

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

起動後、Discord のログイン画面で Bot Token を入力します。要件・仕組み・検証結果・制限事項は [docs/android.md](docs/android.md) を参照してください。

## リポジトリ構成

```
desktop/
  main.js            # Electron メインプロセス（ウィンドウ・API 正規化・MOD 読込・エディタサーバ）
  preload.js         # メインウィンドウ用ブリッジ（BotClientNative / protoAPI）
  editor-preload.js  # エディタウィンドウ用ブリッジ（electronAPI）
  editor/            # Discohook ビルド済みエディタ（macOS / iOS / Android で共用）
  extensions/        # Vencord / Equicord のビルド済み拡張（Bot ログインプラグイン同梱）
  assets/            # アプリアイコン（通常の Discord アイコン）
  package.json
ios/
  BotClient.xcodeproj/        # Xcode プロジェクト（iOS 18.5 / iPhone）
  BotClient/
    BotClientApp.swift        # @main / SwiftUI App
    ContentView.swift         # 全画面 WKWebView + 読み込み / エラー表示
    DiscordWebView.swift      # WKWebView 設定・UserScript 注入
    DiscordAPIBridge.swift    # ネイティブ REST 中継（ヘッダー正規化）
    MessageEditorController.swift  # エディタのモーダル表示とリレー
    EditorSchemeHandler.swift # bc-editor:// でエディタを配信
    Resources/                # bridge.js / editor-frame.js / Vencord ビルド / アセット
android/
  build.gradle.kts / settings.gradle.kts / gradle.properties
  gradle/wrapper/             # Gradle 9.4.1
  app/
    build.gradle.kts          # AGP 9.2.1 / editor アセットのステージング
    src/main/java/local/botclient/android/  # MainActivity / REST ブリッジ / エディタ Activity
    src/main/assets/          # android-shim.js / uitest.js
    src/main/res/             # テーマ・文字列・アイコン
scripts/
  package.sh         # electron-packager + 署名 + dist への配置
docs/                # ドキュメント（architecture / usage / build / ios / android）
BotClient.apk        # ビルド済み Android APK（Git 追跡 / debug keystore 署名）
BotClient.ipa        # ビルド済み iOS IPA（Git 追跡 / 未署名）
```

## 検証状況

| プラットフォーム | 検証環境 | 結果 |
| --- | --- | --- |
| macOS | macOS arm64 | ログイン・Gateway・メッセージ送信・Embed / Components V2・リアクション・投票・監査ログを実 Discord API で確認 |
| iOS | iPhone 11 シミュレータ / iOS 18.5（Xcode 16.4） | ログイン・チャンネル表示・通常送信・エディタ開閉 / 送信を確認。実機 iPhone は未検証 |
| Android | Pixel 7 エミュレータ / API 35 / WebView 124 | ログイン・チャンネル表示・通常送信・エディタ開閉 / 送信を確認。実機 Android は未検証 |

送信検証は各 BotClient の UI（実際の Discord コンポーザとエディタ）から行い、Python などの外部スクリプトで API を直接叩いていません。

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | プロセス構成・API 正規化・Intent 計算・エディタブリッジ・iOS / Android 構成 |
| [docs/usage.md](docs/usage.md) | ログイン・MOD 切替・メッセージ送信・エディタ・iOS / Android の使い方 |
| [docs/build.md](docs/build.md) | ビルド / パッケージング・APK / IPA の生成・同梱物の由来・git 管理方針 |
| [docs/ios.md](docs/ios.md) | iOS アプリの構成・ビルド・実機署名・検証結果・制限事項 |
| [docs/android.md](docs/android.md) | Android アプリの構成・ビルド・インストール・検証結果・制限事項 |

## セキュリティに関する注意

- Bot トークンは**ディスクに保存せず、ログや UI にも出力しません**。ログイン時のみメモリ上で扱います。
- Discord Web が送る生トークンを Bot API 用の `Bot ` スキームに正規化し、ブラウザ由来のヘッダー（Origin / Referer / Cookie / `Sec-*`）を除去して 40333 エラーを回避します（[docs/architecture.md](docs/architecture.md) 参照）。
- iOS 版は WKWebView の非永続データストアを使い、ネイティブブリッジで Discord API の URL とメソッドを検証します。localhost の HTTP サーバーや LAN 公開は行いません（[docs/ios.md](docs/ios.md) 参照）。
- Android 版は起動時に Cookie / WebStorage を消去し、`usesCleartextTraffic=false` で平文 HTTP を禁止します。ブリッジは Discord API の URL とメソッドを検証し、自動ログイン用の intent extra は Debug ビルドでのみ読み取ります（[docs/android.md](docs/android.md) 参照）。
- 配布用の APK / IPA を配る場合は、署名鍵・プロビジョニングプロファイル・トークンを含めないよう注意してください。リポジトリ直下の成果物（`BotClient.apk` / `BotClient.ipa`）はトークンを埋め込まず、Debug keystore 署名の APK と未署名の IPA のみを追跡しています。

## 制限事項

- ログイン状態は保存されません。各アプリを再起動するたびに Bot トークンの入力が必要です。
- iOS 版は iPhone 11 シミュレータ（iOS 18.5）で検証済みですが、実機 iPhone での動作確認は未実施です。Android 版もエミュレータ（Pixel 7 / API 35）のみで、実機確認は未実施です。
- エディタの添付ファイル送信は実装済みですが、iOS / Android での検証は未実施です。
- 音声・画面共有・プッシュ通知はモバイル版の対象外です。
- Android 版のリリース署名、iOS 版の配布用署名は未設定です。
- Vencord が Electron 向けに描画するウィンドウコントロール（最小化・閉じる等）が Web UI 上に表示されることがありますが、no-op です。

## ライセンス

本体は `GPL-3.0-or-later`（`desktop/package.json` 参照）。
同梱の Vencord / Equicord / Discohook ビルドはそれぞれの上流ライセンスに従います。
