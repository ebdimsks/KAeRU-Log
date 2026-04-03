'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  baseMuteSec: 60,
  maxMuteSec: 60 * 60 * 24,
  repeatLimit: 3,
  sameMessageLimit: 3,
  messageRateLimitMs: 1200,
  intervalJitterMs: 300,
  intervalWindowSec: 60 * 60,
  shortRateWindowSec: 15,
  shortRateLimit: 6,
};

const LUA_PATH = path.join(__dirname, '..', 'lua', 'spamService.lua');

function normalizeNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeMessage(msg) {
  if (typeof msg !== 'string') {
    return '';
  }

  try {
    const s = msg.normalize ? msg.normalize('NFKC') : String(msg);
    return s
      .replace(/[-\u001F\u007F\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (err) {
    return String(msg).trim().replace(/\s+/g, ' ');
  }
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

function validKey(k) {
  return typeof k === 'string' && k.length > 0;
}

function loadSpamLua(redis) {
  try {
    const luaScript = fs.readFileSync(LUA_PATH, 'utf8');
    if (typeof redis.defineCommand === 'function' && typeof redis.spamCheckLua !== 'function') {
      redis.defineCommand('spamCheckLua', { numberOfKeys: 8, lua: luaScript });
    }
  } catch (err) {
    console.error('spamServiceLuaLoadFailed', String(err));
  }
}

module.exports = function createSpamService(redis, KEYS, config = {}) {
  const BASE_MUTE_SEC = normalizeNumber(config.baseMuteSec, DEFAULTS.baseMuteSec);
  const MAX_MUTE_SEC = normalizeNumber(config.maxMuteSec, DEFAULTS.maxMuteSec);
  const REPEAT_LIMIT = normalizeNumber(config.repeatLimit, DEFAULTS.repeatLimit);
  const SAME_MESSAGE_LIMIT = normalizeNumber(
    config.sameMessageLimit,
    DEFAULTS.sameMessageLimit
  );
  const MESSAGE_RATE_LIMIT_MS = normalizeNumber(
    config.messageRateLimitMs,
    DEFAULTS.messageRateLimitMs
  );
  const INTERVAL_JITTER_MS = normalizeNumber(
    config.intervalJitterMs,
    DEFAULTS.intervalJitterMs
  );
  const INTERVAL_WINDOW_SEC = normalizeNumber(
    config.intervalWindowSec,
    DEFAULTS.intervalWindowSec
  );
  const SHORT_RATE_WINDOW_SEC = normalizeNumber(
    config.shortRateWindowSec,
    DEFAULTS.shortRateWindowSec
  );
  const SHORT_RATE_LIMIT = normalizeNumber(config.shortRateLimit, DEFAULTS.shortRateLimit);

  loadSpamLua(redis);

  async function isMuted(clientId) {
    if (!clientId) {
      return false;
    }

    try {
      return !!(await redis.exists(KEYS.mute(clientId)));
    } catch (err) {
      console.error('isMutedRedisError', String(err));
      return true;
    }
  }

  async function jsFallbackCheck(clientId) {
    const lastKey = KEYS.spamLastTime(clientId);

    try {
      const last = await redis.get(lastKey);
      const now = Date.now();

      if (last && now - Number(last) < MESSAGE_RATE_LIMIT_MS) {
        return { muted: false, rejected: true, reason: 'rate-limit', muteSec: 0 };
      }

      await redis.set(lastKey, String(now), 'EX', INTERVAL_WINDOW_SEC);
      return { muted: false, rejected: false, reason: null, muteSec: 0 };
    } catch (err) {
      return { muted: true, rejected: true, reason: 'error', muteSec: 0 };
    }
  }

  async function applyMute(clientId, reason, muteSec) {
    if (!clientId) {
      return;
    }

    const safeMuteSec = Math.max(1, Number(muteSec) || BASE_MUTE_SEC);
    const muteKey = KEYS.mute(clientId);
    const muteLevelKey = KEYS.muteLevel(clientId);

    await redis.set(muteKey, '1', 'EX', safeMuteSec);
    const level = await redis.incr(muteLevelKey);
    await redis.expire(muteLevelKey, safeMuteSec + 600);

    try {
      await redis.del(`short_rate:${clientId}`);
    } catch (err) {
      // best effort
    }

    return { reason, muteSec: safeMuteSec, level };
  }

  async function check(clientId, message) {
    if (!clientId) {
      return { muted: false, rejected: false, reason: null, muteSec: 0 };
    }

    const lastKey = KEYS.spamLastTime(clientId);
    const prevDeltaKey = KEYS.spamLastInterval(clientId);
    const repeatKey = KEYS.spamRepeatCount(clientId);
    const muteKey = KEYS.mute(clientId);
    const muteLevelKey = KEYS.muteLevel(clientId);
    const lastMsgHashKey = KEYS.spamLastMsgHash ? KEYS.spamLastMsgHash(clientId) : '';
    const repeatMsgKey = KEYS.spamRepeatMsgCount ? KEYS.spamRepeatMsgCount(clientId) : '';
    const shortRateKey = `short_rate:${clientId}`;

    const now = Date.now();
    const normalized = normalizeMessage(message);
    const msgHash = normalized ? sha256Hex(normalized) : '';

    const luaAvailable = typeof redis.spamCheckLua === 'function';
    const msgKeysValid =
      validKey(lastMsgHashKey) &&
      validKey(repeatMsgKey) &&
      validKey(shortRateKey);

    if (!luaAvailable || !msgKeysValid) {
      return jsFallbackCheck(clientId, message);
    }

    try {
      const res = await redis.spamCheckLua(
        lastKey,
        prevDeltaKey,
        repeatKey,
        muteKey,
        muteLevelKey,
        lastMsgHashKey,
        repeatMsgKey,
        shortRateKey,
        String(now),
        String(MESSAGE_RATE_LIMIT_MS),
        String(INTERVAL_JITTER_MS),
        String(INTERVAL_WINDOW_SEC),
        String(BASE_MUTE_SEC),
        String(MAX_MUTE_SEC),
        String(REPEAT_LIMIT),
        String(SAME_MESSAGE_LIMIT),
        msgHash,
        String(SHORT_RATE_WINDOW_SEC),
        String(SHORT_RATE_LIMIT)
      );

      if (!res || !Array.isArray(res) || res.length < 4) {
        console.error('spamLuaBadResponse', res);
        return jsFallbackCheck(clientId, message);
      }

      const muted = res[0] === '1';
      const rejected = res[1] === '1';
      const reason = res[2] || null;
      const muteSec = Number(res[3]) || 0;

      return { muted, rejected, reason, muteSec };
    } catch (err) {
      console.error('spamLuaError', String(err));
      return { muted: true, rejected: true, reason: 'error', muteSec: 0 };
    }
  }

  return {
    check,
    handleMessage: check,
    isMuted,
    applyMute,
  };
};