'use strict';

// Lua script:
// KEYS[1] = key
// ARGV[1] = member (socketId)
// ARGV[2] = limit (number)
// ARGV[3] = ttl (seconds)
// Returns: array [status, curr]
//  - if current >= limit -> {-1, curr}
//  - else -> {added(0 or 1), curr_after}
const ACQUIRE_IP_SLOT_LUA = `
local key = KEYS[1]
local member = ARGV[1]
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local curr = redis.call('SCARD', key)
if curr >= limit then
  return {-1, curr}
end

local added = redis.call('SADD', key, member)
redis.call('EXPIRE', key, ttl)
curr = redis.call('SCARD', key)
return {added, curr}
`;

class IpSessionStore {
  constructor(redisClient, opts = {}) {
    if (!redisClient) throw new Error('redisClient is required');
    this.redis = redisClient;
    this.limit = 5;
    this.ttl = 6;
    this._acquireSha = null;
    this._loading = null;
  }

  // Redis key for an IP; encodeURIComponent to be safe with special chars
  _keyForIp(ip) {
    return `ip:${encodeURIComponent(ip)}:sockets`;
  }

  // load script once (concurrent-safe)
  async _ensureScriptLoaded() {
    if (this._acquireSha) return this._acquireSha;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      try {
        const sha = await this.redis.script('LOAD', ACQUIRE_IP_SLOT_LUA);
        this._acquireSha = sha;
        return sha;
      } finally {
        this._loading = null;
      }
    })();

    return this._loading;
  }

  // Try to acquire a slot for ip/socketId
  // Returns { success: boolean, count: number }
  async tryAcquire(ip, socketId) {
    const key = this._keyForIp(ip);
    const limit = this.limit;
    const ttl = this.ttl;

    try {
      // ensure script loaded
      await this._ensureScriptLoaded();
      try {
        const res = await this.redis.evalsha(this._acquireSha, 1, key, socketId, limit, ttl);
        // res is array-like [added, curr]
        const added = Number(res[0]);
        const curr = Number(res[1]);
        if (added === -1) return { success: false, count: curr };
        return { success: added === 1 || added === 0, count: curr };
      } catch (err) {
        // NOSCRIPT -> fallback to EVAL
        if (err && /NOSCRIPT/.test(String(err))) {
          const res = await this.redis.eval(ACQUIRE_IP_SLOT_LUA, 1, key, socketId, limit, ttl);
          const added = Number(res[0]);
          const curr = Number(res[1]);
          if (added === -1) return { success: false, count: curr };
          return { success: added === 1 || added === 0, count: curr };
        }
        throw err;
      }
    } catch (err) {
      // Redis が使えない/エラー時の挙動は安全側で拒否する（可変にしたければ true にする）
      console.error('IpSessionStore.tryAcquire error', err);
      return { success: false, count: 0 };
    }
  }

  // Release a socketId from the ip set.
  // Ensures key deletion when set is empty.
  async release(ip, socketId) {
    const key = this._keyForIp(ip);
    try {
      await this.redis.srem(key, socketId);
      const remaining = await this.redis.scard(key);
      if (remaining === 0) {
        await this.redis.del(key);
      } else {
        // 保守的に TTL を更新
        await this.redis.expire(key, this.ttl);
      }
    } catch (err) {
      console.error('IpSessionStore.release error', err);
    }
  }
}

module.exports = IpSessionStore;