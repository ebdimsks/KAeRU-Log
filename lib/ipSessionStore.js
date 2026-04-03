'use strict';

const ACQUIRE_IP_SLOT_LUA = `
local key = KEYS[1]
local member = ARGV[1]
local limit = tonumber(ARGV[2])

local curr = redis.call('SCARD', key)
if curr >= limit then
  return {-1, curr}
end

local added = redis.call('SADD', key, member)
curr = redis.call('SCARD', key)
return {added, curr}
`;

const RELEASE_IP_SLOT_LUA = `
local key = KEYS[1]
local member = ARGV[1]

redis.call('SREM', key, member)
local curr = redis.call('SCARD', key)

if curr == 0 then
  redis.call('DEL', key)
end

return curr
`;

function isNoScriptError(err) {
  return /NOSCRIPT/i.test(String(err?.message || err || ''));
}

class IpSessionStore {
  constructor(redisClient, opts = {}) {
    if (!redisClient) {
      throw new Error('redisClient is required');
    }

    this.redis = redisClient;
    const limit = Number(opts.limit);
    this.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;

    this._acquireSha = null;
    this._releaseSha = null;
    this._loadingAcquire = null;
    this._loadingRelease = null;
  }

  _keyForIp(ip) {
    if (typeof ip !== 'string' || ip.trim() === '') {
      throw new Error('ip is required');
    }

    return `ip:${encodeURIComponent(ip)}:sockets`;
  }

  async _ensureAcquireScriptLoaded() {
    if (this._acquireSha) {
      return this._acquireSha;
    }

    if (this._loadingAcquire) {
      return this._loadingAcquire;
    }

    this._loadingAcquire = (async () => {
      try {
        const sha = await this.redis.script('LOAD', ACQUIRE_IP_SLOT_LUA);
        this._acquireSha = sha;
        return sha;
      } finally {
        this._loadingAcquire = null;
      }
    })();

    return this._loadingAcquire;
  }

  async _ensureReleaseScriptLoaded() {
    if (this._releaseSha) {
      return this._releaseSha;
    }

    if (this._loadingRelease) {
      return this._loadingRelease;
    }

    this._loadingRelease = (async () => {
      try {
        const sha = await this.redis.script('LOAD', RELEASE_IP_SLOT_LUA);
        this._releaseSha = sha;
        return sha;
      } finally {
        this._loadingRelease = null;
      }
    })();

    return this._loadingRelease;
  }

  async tryAcquire(ip, socketId) {
    let key;

    try {
      if (typeof socketId !== 'string' || socketId.trim() === '') {
        throw new Error('socketId is required');
      }

      key = this._keyForIp(ip);
      await this._ensureAcquireScriptLoaded();

      try {
        const res = await this.redis.evalsha(this._acquireSha, 1, key, socketId, this.limit);
        const added = Number(res[0]);
        const curr = Number(res[1]);

        if (added === -1) {
          return { success: false, count: curr };
        }

        return { success: added === 1 || added === 0, count: curr };
      } catch (err) {
        if (isNoScriptError(err)) {
          this._acquireSha = null;
          await this._ensureAcquireScriptLoaded();
          const res = await this.redis.evalsha(this._acquireSha, 1, key, socketId, this.limit);
          const added = Number(res[0]);
          const curr = Number(res[1]);

          if (added === -1) {
            return { success: false, count: curr };
          }

          return { success: added === 1 || added === 0, count: curr };
        }

        throw err;
      }
    } catch (err) {
      console.error('IpSessionStore.tryAcquire error', err);
      return { success: false, count: 0 };
    }
  }

  async release(ip, socketId) {
    try {
      if (typeof socketId !== 'string' || socketId.trim() === '') {
        return;
      }

      const key = this._keyForIp(ip);
      await this._ensureReleaseScriptLoaded();

      try {
        await this.redis.evalsha(this._releaseSha, 1, key, socketId);
      } catch (err) {
        if (isNoScriptError(err)) {
          this._releaseSha = null;
          await this._ensureReleaseScriptLoaded();
          await this.redis.evalsha(this._releaseSha, 1, key, socketId);
        } else {
          throw err;
        }
      }
    } catch (err) {
      console.error('IpSessionStore.release error', err);
    }
  }
}

module.exports = IpSessionStore;