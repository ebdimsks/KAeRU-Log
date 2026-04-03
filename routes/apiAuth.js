'use strict';

const crypto = require('crypto');
const express = require('express');

const KEYS = require('../lib/redisKeys');
const { createAuthToken } = require('../auth');
const createTokenBucket = require('../utils/tokenBucket');

const AUTH_TTL_SEC = 24 * 60 * 60;

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 8);
}

function normalizeUsernameInput(username) {
  if (typeof username !== 'string') {
    return '';
  }
  return username.trim();
}

function createApiAuthRouter({ redisClient }) {
  const router = express.Router();
  const tokenBucket = createTokenBucket(redisClient);

  router.post('/', async (req, res) => {
    try {
      const ip = typeof req.ip === 'string' && req.ip ? req.ip : '0.0.0.0';
      const rateKey = `${KEYS.tokenBucketAuthIp(ip)}:${hashIp(ip)}`;

      const result = await tokenBucket.allow(rateKey, {
        capacity: 3,
        refillPerSec: 3 / (24 * 60 * 60),
      });

      if (!result.allowed) {
        return res.sendStatus(429);
      }

      let username = normalizeUsernameInput(req.body?.username);

      if (!username) {
        username = `guest-${crypto.randomBytes(3).toString('hex')}`;
      }

      if (username.length > 20) {
        return res.status(400).json({ error: 'Username too long' });
      }

      const clientId = crypto.randomUUID();
      const token = createAuthToken();

      const tx = redisClient.multi();
      tx.set(KEYS.token(token), clientId, 'EX', AUTH_TTL_SEC);
      tx.set(KEYS.username(clientId), username, 'EX', AUTH_TTL_SEC);

      const resultSet = await tx.exec();
      if (!Array.isArray(resultSet) || resultSet.some(([err]) => err)) {
        throw new Error('Failed to persist auth session');
      }

      return res.json({ token, username });
    } catch (err) {
      console.error('auth route failed', err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
}

module.exports = createApiAuthRouter;