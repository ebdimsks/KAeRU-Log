'use strict';

async function pushAndTrimList(redisClient, key, value, max = 100) {
  if (!redisClient || typeof redisClient.eval !== 'function') {
    throw new Error('redisClient is required');
  }
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('key is required');
  }

  const maxItems = Number(max);
  if (!Number.isInteger(maxItems) || maxItems <= 0) {
    throw new Error('max must be a positive integer');
  }

  const lua = `
    local max = tonumber(ARGV[2])
    redis.call('RPUSH', KEYS[1], ARGV[1])
    redis.call('LTRIM', KEYS[1], -max, -1)
    return 1
  `;

  try {
    return await redisClient.eval(lua, 1, key, value, String(maxItems));
  } catch (err) {
    console.error('pushAndTrimList error', err);
    throw err;
  }
}

async function processKeysByPattern(redisClient, pattern, handler, scanCount = 500) {
  if (!redisClient || typeof redisClient.scan !== 'function') {
    throw new Error('redisClient.scan is required');
  }
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new Error('pattern is required');
  }
  if (typeof handler !== 'function') {
    throw new Error('handler must be a function');
  }

  let cursor = '0';
  const count = Number.isInteger(scanCount) && scanCount > 0 ? scanCount : 500;

  do {
    const result = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    const nextCursor = Array.isArray(result) ? String(result[0]) : '0';
    const keys = Array.isArray(result) && Array.isArray(result[1]) ? result[1] : [];

    if (keys.length > 0) {
      await handler(keys);
    }

    cursor = nextCursor;
  } while (cursor !== '0');
}

module.exports = {
  pushAndTrimList,
  processKeysByPattern,
};