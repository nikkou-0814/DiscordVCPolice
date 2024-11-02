# DiscordVCPolice

## 機能

- 設定したデシベルを超えたユーザーは切断されます。
- **スラッシュコマンド:**
    - `/vcpolice`: ボイスチャンネルの監視を開始
    - `/dcpolice`: ボットをボイスチャンネルから切断
    - `/setdb`: サーバーのデシベルしきい値を設定

## インストール

面倒な方は[既存のBOT](https://discord.com/oauth2/authorize?client_id=1302234098110042204&permissions=17910786&integration_type=0&scope=bot+applications.commands)をサーバーに招待してください

1. **Discordボットを作成:**
   - [Discord開発者ポータル](https://discord.com/developers/applications)にてBOTを作成してください
2. **`.env`ファイルの作成**
    ```
    TOKEN=<YOUR_BOT_TOKEN>
    CLIENT_ID=<YOUR_BOT_CLIENT_ID>
    ```
3. **依存関係をインストール**
    ```bash
    npm install
    ```
4. **BOTの起動**
    ```bash
    node index.js
    ```

## 設定

- **デシベルしきい値:** デフォルトの値は`70dB`です。これは`/setdb`コマンドを使用して変更できます。

## 貢献

貢献は歓迎です！問題の報告やプルリクエストの提出で、貢献することができます！