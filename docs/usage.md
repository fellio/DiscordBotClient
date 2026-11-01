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

## 8. iPhone / iPad から使う

iPhone 11（iOS 18.5 以上）の Safari から使える Web クライアントです。Mac 側でブリッジを起動します。

```bash
cd iPhone
./start.sh --lan       # 0.0.0.0:8787（同一 Wi-Fi からアクセス可能）
```

1. iPhone の Safari で `http://<Mac の IP>:8787/` を開きます（Mac の IP は `ipconfig getifaddr en0` などで確認）。
2. Bot トークンを入力してログインします（トークンはメモリ上のみ、保存されません）。
3. サーバー → チャンネルを選び、通常 / Embed / Components V2 を送信します。

- 共有メニューの「ホーム画面に追加」で PWA として全画面表示できます。
- ブリッジを停止していると「ネットワークに接続できません」と表示されます。`./start.sh` で再起動してください。
- `--lan` は認証なしの HTTP サーバーを LAN に公開します。信頼できるネットワーク内でのみ使用してください。
- 詳細・検証結果・制限事項は [iphone.md](iphone.md) を参照してください。
