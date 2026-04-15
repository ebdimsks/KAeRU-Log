# KAeRU Log

Redis を使った軽量リアルタイムチャットです。Express と Socket.IO で HTTP API と WebSocket を提供し、認証トークン、ユーザー名、メッセージ履歴、管理セッションを Redis に保存します。

## 特徴

- ルーム単位のリアルタイム配信
- 認証トークンによるセッション管理
- メッセージ履歴の永続化と古いルームの自動掃除
- ユーザー名変更と管理者機能
- スパム対策、送信制限、IP 単位の同時接続制御
- CSP、HSTS などのセキュリティヘッダー

## 構成

- `server.js`  起動処理、終了処理、Redis 接続、定期クリーンアップ
- `app.js`  Express アプリ、API ルーティング、静的配信、セキュリティヘッダー
- `socket.js`  Socket.IO の初期化、認証、ルーム参加、接続制御
- `routes/`  認証、メッセージ、ユーザー名、管理 API
- `services/`  スパム判定などのドメインロジック
- `lib/`  Redis キー、メッセージ整形、共通ユーティリティ
- `public/`  ブラウザ UI
- `lua/`  Redis Lua スクリプト

## 要件

- Node.js `>=22.0.0`
- Redis 互換サーバー
- モダンブラウザ

## 起動

```bash
npm install
export REDIS_URL=redis://localhost:6379
export FRONTEND_URL=http://localhost:3000
export ADMIN_PASS=change-me
export TRUST_PROXY=false
export PORT=3000
npm start
```

## 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `REDIS_URL` | はい | Redis 接続 URL |
| `FRONTEND_URL` | はい | 許可するフロントエンドのオリジン |
| `ADMIN_PASS` | はい | 管理者ログイン用パスワード |
| `PORT` | いいえ | HTTP サーバーの待受ポート。既定は `3000` |
| `TRUST_PROXY` | いいえ | `true` のときプロキシ越しの IP を参照 |

## API

すべての保護 API は `Authorization: Bearer <token>` を必要とします。トークンは `POST /api/auth` で取得します。

### 認証

`POST /api/auth`

リクエスト例:

```json
{
  "username": "taro"
}
```

`username` を省略すると `guest-xxxxxx` 形式が割り当てられます。トークンの有効期限は 24 時間です。

### メッセージ取得

`GET /api/messages/:roomId`

`roomId` は 1〜32 文字で、英数字、`_`、`-` のみ使用できます。レスポンスは時刻を ISO 8601 形式で返します。

### メッセージ送信

`POST /api/messages/:roomId`

```json
{
  "message": "こんにちは"
}
```

`message` は最大 300 文字です。`general` は最大 300 件、それ以外のルームは最大 100 件まで履歴を保持します。

### ユーザー名変更

`POST /api/username`

```json
{
  "username": "new-name"
}
```

`username` は 1〜20 文字です。変更は 30 秒ごとに 1 回までに制限されます。

### 管理機能

`POST /api/admin/login` で管理者認証を行います。`GET /api/admin/status` で権限確認、`POST /api/admin/logout` で管理者セッションを終了します。`POST /api/admin/clear/:roomId` は指定ルームのメッセージを削除します。

## 実装メモ

- メッセージ本文と履歴は JSON として Redis に保存されます。
- ルームの古い履歴は定期処理で削除されます。
- IP ベースの制御とトークンレート制限は Redis キーで管理されます。
- WebSocket 接続は認証トークンが必要です。

## 開発

このリポジトリは単一コマンドで起動できるように構成されています。追加のビルドステップはありません。
