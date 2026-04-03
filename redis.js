'use strict';

const Redis = require('ioredis');

function createRedisClient(redisUrl) {
  if (typeof redisUrl !== 'string' || redisUrl.trim() === '') {
    throw new Error('redisUrl is required');
  }

  const redisClient = new Redis(redisUrl);

  redisClient.on('connect', () => console.log('Redis connected'));
  redisClient.on('error', (err) => console.error('Redis error', err));

  return redisClient;
}

module.exports = { createRedisClient };