'use strict';

const crypto = require('crypto');
const KEYS = require('./lib/redisKeys');

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

function createAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function validateAuthToken(redisClient, token) {
  if (typeof token !== 'string') {
    return null;
  }

  const normalizedToken = token.trim();
  if (!normalizedToken || !TOKEN_PATTERN.test(normalizedToken)) {
    return null;
  }

  try {
    const clientId = await redisClient.get(KEYS.token(normalizedToken));
    return clientId || null;
  } catch (err) {
    console.error('validateAuthToken error', err);
    return null;
  }
}

module.exports = { createAuthToken, validateAuthToken };