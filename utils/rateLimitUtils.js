'use strict';

module.exports = {
  async checkRateLimitMs(redisClient, key, windowMs) {
    if (!redisClient || typeof redisClient.set !== 'function') {
      return false;
    }
    if (typeof key !== 'string' || key.trim() === '') {
      return false;
    }

    const ttl = Number(windowMs);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return false;
    }

    try {
      const result = await redisClient.set(key, String(Date.now()), 'PX', Math.floor(ttl), 'NX');
      return result === 'OK';
    } catch (err) {
      console.error('checkRateLimitMs error', err);
      return false;
    }
  },
};