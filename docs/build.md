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

## iOS アプリ

`ios/BotClient.xcodeproj` を Xcode 16.4 で開き、`BotClient` スキームを実行します。iPhone 11 / iOS 18.5 以上のシミュレータまたは実機が対象です。

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/BotClient.xcodeproj \
  -scheme BotClient \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 11,OS=18.5' \
  build
```

- `xcode-select` が Command Line Tools を指している場合は `DEVELOPER_DIR` の指定が必要です。
- Bundle ID は `local.botclient.ios`、Deployment Target は iOS 18.5、対応端末は iPhone（`TARGETED_DEVICE_FAMILY = 1`）。実機で動かす場合は Signing & Capabilities で Team / Bundle ID を変更してください。
- Vencord ビルド（`ios/BotClient/Resources/Vencord.js` / `Vencord.css`）と `bridge.js` はビルド済みバンドルを同梱しています。
- Xcode 16.4 で Debug ビルドが成功し、iPhone 11（iOS 18.5）シミュレータでログイン・Gateway 接続・メッセージ送信・無効トークンのエラー処理を実 Discord API に対して確認済みです。詳細は [ios.md](ios.md) を参照してください。実機 iPhone での確認は未実施です。
- DEBUG ビルドでは環境変数 `BC_BOT_TOKEN` / `BC_UI_TEST` / `BC_UI_TEST_MESSAGE` / `BC_DESKTOP_UA` で自動ログインと UI 検証を実行できます（リリースビルドには含まれません）。

## Android アプリ

`android/` を Android Studio（Rabbit 2026.2.2 で確認）で開き、`app` 構成を実行します。JDK は Android Studio 同梱の JBR（Temurin 17）を使用します。Android SDK Platform 37 / Build-Tools 36.0.0 が必要です。

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- Application ID は `local.botclient.android`、`minSdk = 26`、`targetSdk = 34`、`compileSdk = 37`。
- Gradle 9.4.1 / Android Gradle Plugin 9.2.1（AGP 内蔵 Kotlin）を使用します。外部の `org.jetbrains.kotlin.android` プラグインは AGP 9 と競合するため適用していません。
- `app/build.gradle.kts` の `stageEditorAssets` が `desktop/editor/` をビルド時の generated assets にコピーし、`sourceSets` が `ios/BotClient/Resources/`（`bridge.js` / `Vencord.js` / `Vencord.css`）とあわせて APK へ同梱します。
- `local.properties`（`sdk.dir`）は Android Studio が生成します。リポジトリ管理外です。
- リリース署名は未設定です。検証は Debug ビルドで行っています（[android.md](android.md) 参照）。
- Debug ビルドでは起動 intent の `bc_bot_token` / `bc_ui_test` / `bc_ui_test_message` extra で自動ログインと UI 検証を実行できます（リリースビルドには含まれません）。

## ビルド済みファイル（リポジトリ直下）

検証済みの成果物をリポジトリ直下に `BotClient.apk` / `BotClient.ipa` として配置しています。再生成する場合:

```bash
# Android（Debug 署名済み）
cp android/app/build/outputs/apk/debug/app-debug.apk BotClient.apk

# iOS（署名なし Release アーカイブ → Payload → IPA）
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/BotClient.xcodeproj -scheme BotClient -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/BotClient.xcarchive \
  archive CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM=""

rm -rf /tmp/bc-ipa && mkdir -p /tmp/bc-ipa/Payload
cp -R /tmp/BotClient.xcarchive/Products/Applications/BotClient.app /tmp/bc-ipa/Payload/
(cd /tmp/bc-ipa && zip -qry /tmp/BotClient.ipa Payload)
cp /tmp/BotClient.ipa BotClient.ipa
```

- `DEVELOPER_DIR` は Xcode のインストール先に合わせて変更してください（この環境では `/Users/harutoueda/Downloads/Xcode.app`）。
- `BotClient.apk` は debug keystore 署名済みのため、そのまま実機へインストールできます（[android.md](android.md) 参照）。
- `BotClient.ipa` は署名なしのため、実機では再署名が必要です（[ios.md](ios.md#実機へのインストール署名) 参照）。

## git 管理方針

`.gitignore` により以下を除外します（再生成可能なため）。

- `desktop/node_modules/` — `npm install` で復元
- `dist-desktop/` — packager の中間出力
- `dist/*` — パッケージ成品（`dist/.gitkeep` のみプレースホルダとして追跡）
- `.DS_Store` / `*.xcuserstate`
- `ios/build/` — Xcode のビルド成果物（DerivedData をリポジトリ内に指定した場合）
- `ios/**/xcuserdata/` — Xcode のユーザー固有設定
- `android/.gradle/` / `android/build/` / `android/app/build/` — Gradle のキャッシュとビルド成果物
- `android/local.properties` — SDK パス（環境依存）
- `android/.idea/` / `*.iml` — Android Studio のユーザー固有設定

ソース（`desktop/*.js` / `package.json` / `package-lock.json`）、同梱バンドル（`extensions/` / `editor/` / `assets/`）、iOS アプリ（`ios/BotClient.xcodeproj`・Swift ソース・`Resources/` の Vencord / bridge.js・アプリアイコン）、Android アプリ（`android/` の Gradle 設定・Kotlin ソース・assets・res・Gradle wrapper）、リポジトリ直下に配置する検証済みビルド（`BotClient.apk` / `BotClient.ipa`）、`scripts/`、`docs/` はすべて追跡対象です。コミットはファイルの内容・役割ごとに分割しています。

## バージョン / ライセンス

- バージョン: `2.0.0`（`desktop/package.json`、`APP_ID = local.botclient.air`）。
- 本体ライセンス: `GPL-3.0-or-later`。同梱の上流ビルドはそれぞれのライセンスに従います。
