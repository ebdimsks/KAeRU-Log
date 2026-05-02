'use strict';

const Redis = require('ioredis');

const DEFAULT_RETRY_DELAY_MS = 50;
const MAX_RETRY_DELAY_MS = 1000;

function createRedisClient(redisUrl) {
  if (typeof redisUrl !== 'string' || redisUrl.trim() === '') {
    throw new Error('redisUrl is required');
  }

  const redisClient = new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    autoResubscribe: true,
    retryStrategy(times) {
      const delay = times * DEFAULT_RETRY_DELAY_MS;
      return Math.min(delay, MAX_RETRY_DELAY_MS);
    },
  });

  redisClient.on('connect', () => console.log('Redis connected'));
  redisClient.on('ready', () => console.log('Redis ready'));
  redisClient.on('reconnecting', (delay) => console.warn(`Redis reconnecting in ${delay}ms`));
  redisClient.on('end', () => console.warn('Redis connection ended'));
  redisClient.on('error', (err) => console.error('Redis error', err));

  return redisClient;
}

module.exports = { createRedisClient };
