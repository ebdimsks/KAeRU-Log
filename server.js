'use strict';

require('dotenv').config();

const http = require('http');

const createApp = require('./app');
const createSocketServer = require('./socket');
const { createRedisClient } = require('./redis');
const createCleanupRooms = require('./lib/cleanupRooms');

const DEFAULT_PORT = 3000;
const CLEANUP_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readRequiredEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePort(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : fallback;
}

const PORT = parsePort(process.env.PORT, DEFAULT_PORT);
const REDIS_URL = readRequiredEnv('REDIS_URL');
const ADMIN_PASS = readRequiredEnv('ADMIN_PASS');
const FRONTEND_URL = readRequiredEnv('FRONTEND_URL');

const missing = Object.entries({ ADMIN_PASS, REDIS_URL, FRONTEND_URL })
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(1);
}

let redisClient;
try {
  redisClient = createRedisClient(REDIS_URL);
} catch (err) {
  console.error('Failed to create Redis client', err);
  process.exit(1);
}

const httpServer = http.createServer();
const io = createSocketServer({ httpServer, redisClient, frontendUrl: FRONTEND_URL });
const app = createApp({ redisClient, io, adminPass: ADMIN_PASS, frontendUrl: FRONTEND_URL });

httpServer.on('request', app);

const cleanup = createCleanupRooms({ redisClient, io, thresholdDays: CLEANUP_DAYS });
const cleanupTimer = cleanup.schedule(CLEANUP_INTERVAL_MS);

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);

  clearInterval(cleanupTimer);

  try {
    await new Promise((resolve) => httpServer.close(resolve));
  } catch (err) {
    console.error('Failed to close HTTP server', err);
  }

  try {
    await Promise.allSettled([
      new Promise((resolve) => io.close(resolve)),
      redisClient.quit(),
    ]);
  } catch (err) {
    console.error('Shutdown error', err);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
