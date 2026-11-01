# BotClient for iPhone

iPhone 11（iOS 18.5 以上）の Safari から使える BotClient です。静的 Web UI と、Discord API への中継ブリッジで構成されます。

```bash
cd iPhone
./start.sh --lan
```

1. 表示された `http://<Mac の IP>:8787` を iPhone の Safari で開く
2. Bot トークンを入力してログイン
3. サーバー → チャンネル → メッセージ送信（通常 / Embed / Components V2）

トークンは保存されません（メモリ上のみ）。ブリッジは既定で `127.0.0.1` にのみ公開され、`--lan` で同一ネットワークへ公開されます。詳しい要件・仕組み・検証結果・制限事項は [docs/iphone.md](../docs/iphone.md) を参照してください。
