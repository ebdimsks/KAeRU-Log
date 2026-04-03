'use strict';

const KEYS = require('./redisKeys');
const { processKeysByPattern } = require('./redisHelpers');

const ROOM_PREFIX = 'messages:';
const GENERAL_ROOM_ID = 'general';
const DEFAULT_THRESHOLD_DAYS = 30;
const CLEANUP_INTERVAL_DEFAULT_MS = 24 * 60 * 60 * 1000;

function parseJSTTimeString(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  const match = value.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const yyyy = Number(match[1]);
  const mm = Number(match[2]) - 1;
  const dd = Number(match[3]);
  const hh = Number(match[4]);
  const mi = Number(match[5]);

  if (
    !Number.isInteger(yyyy) ||
    !Number.isInteger(mm) ||
    !Number.isInteger(dd) ||
    !Number.isInteger(hh) ||
    !Number.isInteger(mi)
  ) {
    return null;
  }

  const ts = Date.UTC(yyyy, mm, dd, hh - 9, mi);
  const d = new Date(ts);

  if (
    d.getUTCFullYear() !== yyyy ||
    d.getUTCMonth() !== mm ||
    d.getUTCDate() !== dd ||
    d.getUTCHours() !== hh - 9 ||
    d.getUTCMinutes() !== mi
  ) {
    return null;
  }

  return ts;
}

function safeParseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

module.exports = function createCleanupRooms({ redisClient, io, thresholdDays = DEFAULT_THRESHOLD_DAYS }) {
  if (!redisClient) {
    throw new Error('redisClient required');
  }

  const thresholdDaysNumber = Number(thresholdDays);
  const effectiveThresholdDays = Number.isFinite(thresholdDaysNumber) && thresholdDaysNumber >= 0
    ? thresholdDaysNumber
    : DEFAULT_THRESHOLD_DAYS;

  const thresholdMs = effectiveThresholdDays * 24 * 60 * 60 * 1000;

  async function runOnce() {
    const now = Date.now();

    await processKeysByPattern(redisClient, KEYS.messagesPattern(), async (keys) => {
      for (const key of keys) {
        try {
          if (typeof key !== 'string' || !key.startsWith(ROOM_PREFIX)) {
            continue;
          }

          const roomId = key.slice(ROOM_PREFIX.length);
          if (!roomId || roomId === GENERAL_ROOM_ID) {
            continue;
          }

          const lastMsgRaw = await redisClient.lindex(key, -1);
          let lastActiveTs = null;

          if (lastMsgRaw) {
            const parsed = safeParseMessage(lastMsgRaw);
            if (parsed && typeof parsed.time === 'string') {
              const ts = parseJSTTimeString(parsed.time);
              if (ts !== null && !Number.isNaN(ts)) {
                lastActiveTs = ts;
              }
            }
          }

          const last = lastActiveTs || 0;

          if (now - last > thresholdMs) {
            await redisClient.del(key);

            const roomLastActiveKey = typeof KEYS.roomLastActive === 'function'
              ? KEYS.roomLastActive(roomId)
              : `room:last:${roomId}`;

            try {
              await redisClient.del(roomLastActiveKey);
            } catch (err) {
              // best effort cleanup
            }

            if (io && typeof io.to === 'function') {
              try {
                io.to(roomId).emit('clearMessages');
              } catch (err) {
                // best effort
              }
            }
          }
        } catch (err) {
          console.error('cleanup: error processing key', key, err);
        }
      }
    });
  }

  function schedule(intervalMs = CLEANUP_INTERVAL_DEFAULT_MS) {
    const parsedInterval = Number(intervalMs);
    const safeInterval = Number.isFinite(parsedInterval) && parsedInterval > 0
      ? parsedInterval
      : CLEANUP_INTERVAL_DEFAULT_MS;

    runOnce().catch((err) => console.error('cleanup: initial run failed', err));
    return setInterval(() => {
      runOnce().catch((err) => console.error('cleanup: run failed', err));
    }, safeInterval);
  }

  return { runOnce, schedule };
};