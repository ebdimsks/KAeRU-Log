'use strict';

const express = require('express');

const KEYS = require('../lib/redisKeys');
const { checkRateLimitMs } = require('../utils/rateLimitUtils');
const { createSafeToastEmitter } = require('../lib/emitToast');
const { isValidUsername, normalizeUsername, USERNAME_MAX_LENGTH } = require('../lib/validation');

const USERNAME_RATE_LIMIT_MS = 30_000;
const USERNAME_TTL_SEC = 24 * 60 * 60;

function createApiUsernameRouter({ redisClient, emitUserToast }) {
  const router = express.Router();
  const notifyUser = createSafeToastEmitter(emitUserToast);

  router.post('/username', async (req, res) => {
    try {
      const clientId = typeof req.clientId === 'string' ? req.clientId : '';
      if (!clientId) {
        return res.status(403).json({ error: 'Authentication required', code: 'no_token' });
      }

      const normalizedUsername = normalizeUsername(req.body?.username);
      if (!normalizedUsername) {
        notifyUser(clientId, 'ユーザー名を入力してください');
        return res.status(400).json({ error: 'Invalid username' });
      }

      if (!isValidUsername(normalizedUsername)) {
        notifyUser(clientId, `ユーザー名は${USERNAME_MAX_LENGTH}文字以内にしてください`);
        return res.status(400).json({ error: 'Username too long' });
      }

      const key = KEYS.username(clientId);
      const current = await redisClient.get(key);
      const currentNormalized = normalizeUsername(current);

      if (currentNormalized === normalizedUsername) {
        return res.json({ ok: true });
      }

      const rateKey = KEYS.rateUsername(clientId);
      if (!(await checkRateLimitMs(redisClient, rateKey, USERNAME_RATE_LIMIT_MS))) {
        notifyUser(clientId, 'ユーザー名の変更は30秒以上間隔をあけてください');
        return res.sendStatus(429);
      }

      await redisClient.set(key, normalizedUsername, 'EX', USERNAME_TTL_SEC);

      if (!currentNormalized) {
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
