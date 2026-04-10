'use strict';

const fs = require('fs');
const path = require('path');

const LUA_PATH = path.join(__dirname, '..', 'lua', 'tokenBucket.lua');

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return n;
  }
  return fallback;
}

function toNonNegativeNumber(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) {
    return n;
  }
  return fallback;
}

function isNoScriptError(err) {
  return /NOSCRIPT/i.test(String(err?.message || err || ''));
}

module.exports = function createTokenBucket(redisClient) {
  if (!redisClient) {
    throw new Error('redisClient required');
  }

  let sha = null;
  let loadPromise = null;
  let luaSource = null;
  let luaSourcePromise = null;

  async function loadLuaSource() {
    if (luaSource) {
      return luaSource;
    }

    if (!luaSourcePromise) {
      luaSourcePromise = fs.promises
        .readFile(LUA_PATH, 'utf8')
        .then((src) => {
          luaSource = src;
          return src;
        })
        .finally(() => {
          luaSourcePromise = null;
        });
    }

    return luaSourcePromise;
  }

  async function loadScript() {
    if (sha) {
      return sha;
    }

    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = (async () => {
      try {
        const src = await loadLuaSource();
        sha = await redisClient.script('LOAD', src);
        return sha;
      } finally {
        loadPromise = null;
      }
    })();

    return loadPromise;
  }

  async function evalSafe(numKeys, keysAndArgs) {
    try {
      if (!sha) {
        await loadScript();
      }

      return await redisClient.evalsha(sha, numKeys, ...keysAndArgs);
    } catch (err) {
      if (isNoScriptError(err)) {
        sha = null;
        await loadScript();
        return await redisClient.evalsha(sha, numKeys, ...keysAndArgs);
      }

      throw err;
    }
  }

  async function allow(key, opts = {}) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error('tokenBucket.allow: key required');
    }

    const capacity = toPositiveNumber(opts.capacity, 1);
    const refillPerSec = toNonNegativeNumber(opts.refillPerSec, 0);
    const refillPerMs = refillPerSec / 1000;
    const nowMs = Date.now();

    const keysAndArgs = [
      key,
      String(capacity),
      String(refillPerMs),
      String(nowMs),
    ];

    try {
      const res = await evalSafe(1, keysAndArgs);
      const allowed = Array.isArray(res) && Number(res[0]) === 1;
      const tokens = Array.isArray(res) ? Number(res[1]) : 0;

      return {
        allowed,
        tokens: Number.isFinite(tokens) ? tokens : 0,
      };
    } catch (err) {
      console.error('[tokenBucket] eval error', err);
      return { allowed: false, tokens: 0, error: err };
    }
  }

  return { allow, loadScript };
};
