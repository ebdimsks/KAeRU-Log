'use strict';

const express = require('express');

const KEYS = require('../lib/redisKeys');
const { checkRateLimitMs } = require('../utils/rateLimitUtils');
const { USERNAME_MAX_LENGTH, trimString, isValidUsername } = require('../lib/validation');

const USERNAME_RATE_LIMIT_MS = 30_000;
const USERNAME_TTL_SEC = 24 * 60 * 60;

function safeEmitToast(fn, ...args) {
  if (typeof fn !== 'function') {
    return;
  }

  try {
    fn(...args);
  } catch (err) {
    console.error('toast emit failed', err);
  }
}

function createApiUsernameRouter({ redisClient, emitUserToast }) {
  const router = express.Router();
  const notifyUser = (...args) => safeEmitToast(emitUserToast, ...args);

  router.post('/username', async (req, res) => {
    try {
      const clientId = trimString(req.clientId);
      if (!clientId) {
        return res.status(403).json({ error: 'Authentication required', code: 'no_token' });
      }

      const username = trimString(req.body?.username);
      if (!isValidUsername(username)) {
        notifyUser(clientId, `ユーザー名は1〜${USERNAME_MAX_LENGTH}文字で入力してください`);
        return res.status(400).json({ error: 'Invalid username', code: 'invalid_username' });
      }

      const key = KEYS.username(clientId);
      const current = trimString(await redisClient.get(key));
      if (current === username) {
        return res.json({ ok: true });
      }

      const rateKey = KEYS.rateUsername(clientId);
      if (!(await checkRateLimitMs(redisClient, rateKey, USERNAME_RATE_LIMIT_MS))) {
        notifyUser(clientId, 'ユーザー名の変更は30秒以上間隔をあけてください');
        return res.sendStatus(429);
      }

      await redisClient.set(key, username, 'EX', USERNAME_TTL_SEC);
      notifyUser(clientId, current ? 'ユーザー名を変更しました' : 'ユーザー名が登録されました');

      return res.json({ ok: true });
    } catch (err) {
      console.error('username route failed', err);
      return res.status(500).json({ error: 'Server error', code: 'server_error' });
    }
  });

  return router;
}

module.exports = createApiUsernameRouter;
