'use strict';

const express = require('express');

const KEYS = require('../lib/redisKeys');
const { checkRateLimitMs } = require('../utils/rateLimitUtils');

const USERNAME_MAX_LENGTH = 20;
const USERNAME_RATE_LIMIT_MS = 30_000;
const USERNAME_TTL_SEC = 24 * 60 * 60;

function safeEmitToast(fn, ...args) {
  try {
    if (typeof fn === 'function') {
      fn(...args);
    }
  } catch (err) {
    console.error('toast emit failed', err);
  }
}

function createApiUsernameRouter({ redisClient, emitUserToast }) {
  const router = express.Router();
  const notifyUser = (...args) => safeEmitToast(emitUserToast, ...args);

  router.post('/username', async (req, res) => {
    try {
      const clientId = typeof req.clientId === 'string' ? req.clientId : '';
      if (!clientId) {
        return res.status(403).json({ error: 'Authentication required', code: 'no_token' });
      }

      const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
      const normalizedUsername = rawUsername.trim();

      if (!normalizedUsername) {
        notifyUser(clientId, 'ユーザー名を入力してください');
        return res.status(400).json({ error: 'Invalid username' });
      }

      if (normalizedUsername.length > USERNAME_MAX_LENGTH) {
        notifyUser(clientId, 'ユーザー名は20文字以内にしてください');
        return res.status(400).json({ error: 'Username too long' });
      }

      const key = KEYS.username(clientId);
      const current = await redisClient.get(key);
      const currentNormalized = typeof current === 'string' ? current.trim() : '';

      if (currentNormalized === normalizedUsername) {
        return res.json({ ok: true });
      }

      const rateKey = KEYS.rateUsername(clientId);
      if (!(await checkRateLimitMs(redisClient, rateKey, USERNAME_RATE_LIMIT_MS))) {
        notifyUser(clientId, 'ユーザー名の変更は30秒以上間隔をあけてください');
        return res.sendStatus(429);
      }

      await redisClient.set(key, normalizedUsername, 'EX', USERNAME_TTL_SEC);

      if (!current) {
        notifyUser(clientId, 'ユーザー名が登録されました');
      } else {
        notifyUser(clientId, 'ユーザー名を変更しました');
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('username route failed', err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
}

module.exports = createApiUsernameRouter;