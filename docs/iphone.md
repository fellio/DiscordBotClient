# iPhone / iPad クライアント (Web + bridge)

iPhone 11（iOS 18.5 以上）の Safari から Bot アカウントを操作できるモバイル Web クライアントです。
`iPhone/web/` の静的 UI と、`iPhone/server/bridge.mjs` のローカルブリッジで構成されます。npm 依存はありません。

## なぜ bridge が必要か

Discord Bot API は **ブラウザの User-Agent からのリクエストを `40333 (internal network error)` で拒否**します。
Safari の UA（iOS 18.5 / Mac / iPad など）を付け替えても `/channels` や `/messages` は 403 になり、
Bot 用 User-Agent にするとブラウザ由来のヘッダー（Origin / Referer / `Sec-*`）が付いていても 200 が返ることを実 API で確認しました。
JavaScript からは User-Agent を変更できないため、**UA と認証ヘッダーを正規化するブリッジ**を経由します。

```
Safari (iPhone 11 / iOS 18.5+)
   │  POST /api/proxy  { token, method, path, body }
   ▼
iPhone/server/bridge.mjs  (既定 127.0.0.1:8787 / --lan で 0.0.0.0)
   │  Authorization: Bot <token>
   │  User-Agent: DiscordBot (...)
   ▼
https://discord.com/api/v10
```

- トークンは**ブラウザのメモリ上のみ**に保持します（`localStorage` などへ保存しない）。
- ブリッジはトークンをログに出力せず、ディスクにも書きません。
- 許可する API は `GET` / `POST` / `PATCH` / `DELETE`、パスは `/` 始まりかつ `..` を含まないものだけです。

## 必要要件

| 項目 | 要件 |
| --- | --- |
| 端末 | iPhone 11 以降（レイアウト検証は 414×896pt） |
| OS / ブラウザ | iOS 18.5 以上の Safari（ホーム画面追加による PWA 表示に対応） |
| ブリッジ実行環境 | macOS + Node.js 18 以降（追加パッケージ不要） |
| Discord | Bot トークン、**Message Content Intent** 有効化 |
| ネットワーク | iPhone とブリッジ実行端末が同じ Wi-Fi（`--lan` 使用時） |

## 起動

```bash
cd iPhone
./start.sh          # 127.0.0.1:8787（同じ Mac からのみ）
./start.sh --lan    # 0.0.0.0:8787（同一 LAN の iPhone からアクセス可能）
```

- ポート変更: `PORT=9000 ./start.sh --lan`
- 直接起動: `cd iPhone/server && node bridge.mjs --lan`
- macOS のファイアウォールが Node の受信接続を尋ねてきた場合は許可してください。
- Mac の IP アドレスは `ipconfig getifaddr en0` などで確認できます。

iPhone の Safari で `http://<Mac の IP>:8787/` を開き、Bot トークンを入力してログインします。
共有メニューから「ホーム画面に追加」すると、ステータスバー込みの全画面表示になります。

## 画面と機能

| 画面 | 内容 |
| --- | --- |
| ログイン | Bot トークン入力（`type="password"`、自動補正オフ）、メモリ保持のみ |
| サーバー | `GET /users/@me/guilds` の一覧 |
| チャンネル | テキスト / アナウンス / フォーラム（type 0 / 5 / 15） |
| チャット | 直近 50 件の表示、通常 / Embed / Components V2 の送信、戻る、ログアウト |

- 通常: `{ content }`
- Embed: `{ embeds: [{ title, description, color }] }`（色は `#RRGGBB` / `#RGB`）
- Components V2: `{ flags: 32768, components: [{ type: 17, components: [{ type: 10, content }] }] }`
- 表示側は Text Display（10）・Separator（14）・ネストした Container（17）に対応し、Embed / 添付画像も描画します。
- メッセージはチャンネルを開いた時と送信後に再取得します（Gateway によるリアルタイム更新は未実装）。

## エラー表示

| 状況 | 表示 |
| --- | --- |
| トークン未入力 | `Bot トークンを入力してください。` |
| 401 | `トークンが無効です (401)。Bot トークンを確認してください。` |
| 403 / 404 | `アクセス拒否 (403): ...` / `見つかりません (404): ...` |
| 429 | `レート制限 (429): n 秒後に再試行してください。` |
| bridge 停止 | `ネットワークに接続できません。bridge が起動しているか確認してください。` |
| 上流の 5xx / 502 | ブリッジが返したメッセージをそのまま表示 |

## 検証結果

Chrome の CDP で **iPhone 11（414×896、DPR 2、iOS 18.5 Safari UA）** をエミュレートし、実際の Discord API に対して 28/28 項目が成功しました。
トークンは起動中の Electron 版からメモリ上で取得し、出力・保存はしていません。

- iPhone 11 ビューポート、横スクロールなし（`scrollWidth = 414`）
- 画面切替（ログイン / サーバー / チャット）で非表示画面・ペインが描画されないこと
- PWA manifest / 180px / 512px アイコン配信
- 空トークン、無効トークン（401）のエラー表示
- ログイン → サーバー一覧 → テキストチャンネル → 直近メッセージ取得
- 通常メッセージ / Embed（タイトル・説明・色 `#5865F2`）/ Components V2 の送信と描画
- 空メッセージ・空 Embed・空 Text Display のクライアント側ブロック
- 上流エラーのステータス中継（404）、ブリッジの不正リクエスト拒否（400 / パストラバーサル 403）
- ブリッジログにトークンが含まれないこと
- 送信した検証メッセージ 3 件の削除（204）
- ブリッジ停止時のネットワークエラー表示 → 再起動後の再ログイン成功

検証用メッセージはすべて削除済みです。

## 制限事項

- 検証は **Chrome の iPhone 11 エミュレーション**で行っており、実機 iPhone / Safari では未検証です。safe-area（ノッチ・ホームインジケータ）の余白は `env(safe-area-inset-*)` で実装していますが、実機での見え方は確認していません。
- ネイティブ iOS アプリは提供していません（ビルド環境に Xcode / iOS SDK がないため）。iOS 18.5 以上は動作対象の基準であり、コード側でバージョンを検査するものではありません。
- メッセージの編集・削除・リアクション・スレッド操作はモバイル UI に未実装です。必要なら Discord の通常クライアントか macOS 版を使用してください。
- ブリッジは認証を持たないローカルサーバーです。`--lan` は**信頼できる同一ネットワーク内でのみ**使用し、インターネットへ公開しないでください。LAN 上の通信は HTTP（TLS なし）です。
- Bot の権限と Discord のレート制限に従います。

## ファイル構成

```
iPhone/
  start.sh                 # bridge 起動ラッパー
  server/bridge.mjs        # 静的配信 + /api/proxy（依存なし）
  web/index.html           # ログイン / 一覧 / チャット
  web/styles.css           # モバイルレイアウト（safe-area / 100dvh）
  web/app.js               # 状態管理・API 呼び出し・描画
  web/manifest.webmanifest # PWA マニフェスト
  web/icon-180.png         # apple-touch-icon
  web/icon-512.png         # PWA アイコン
```
