const { redis } = require("../../infrastructure/redis/redis-client");

class RedisRateLimitStore {
  constructor({ prefix = "rate:", windowMs = 60000 } = {}) {
    this.prefix = prefix;
    this.windowMs = windowMs;
  }

  init(options = {}) {
    this.windowMs = Number(options.windowMs || this.windowMs);
  }

  async increment(key) {
    const redisKey = `${this.prefix}${key}`;
    const result = await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}",
      1, redisKey, this.windowMs,
    );
    const ttl = Math.max(Number(result?.[1] || this.windowMs), 1);
    return { totalHits: Number(result?.[0] || 1), resetTime: new Date(Date.now() + ttl) };
  }

  async decrement(key) {
    await redis.decr(`${this.prefix}${key}`);
  }

  async resetKey(key) {
    await redis.del(`${this.prefix}${key}`);
  }
}

module.exports = { RedisRateLimitStore };
