'use strict';

const crypto = require('crypto');
const express = require('express');

const KEYS = require('../lib/redisKeys');
const { shortSha256Hex } = require('../lib/hash');
const { createAuthToken } = require('../auth');
const createTokenBucket = require('../utils/tokenBucket');
const { normalizeUsername, isValidUsername } = require('../lib/validation');

const AUTH_TTL_SEC = 24 * 60 * 60;

function createApiAuthRouter({ redisClient }) {
  const router = express.Router();
  const tokenBucket = createTokenBucket(redisClient);

  router.post('/', async (req, res) => {
    try {
      const ip = typeof req.ip === 'string' && req.ip ? req.ip : '0.0.0.0';
      const rateKey = KEYS.tokenBucketAuthIp(shortSha256Hex(ip, 16));

      const result = await tokenBucket.allow(rateKey, {
        capacity: 3,
        refillPerSec: 3 / AUTH_TTL_SEC,
      });

      if (!result.allowed) {
        return res.sendStatus(429);
      }

      const providedUsername = normalizeUsername(req.body?.username);
      if (providedUsername && !isValidUsername(providedUsername)) {
        return res.status(400).json({ error: 'Username too long' });
      }

      const username = providedUsername || `guest-${crypto.randomBytes(3).toString('hex')}`;
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
