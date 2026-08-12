const { redis } = require("../../infrastructure/redis/redis-client");

const memoryCache = new Map();
const REDIS_CACHE_TIMEOUT_MS = 75;

function withTimeout(promise, ms = REDIS_CACHE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

function getMemoryCache(key) {
  const cached = memoryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt && cached.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return cached.value;
}

function setMemoryCache(key, value, ttlSeconds) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  if (memoryCache.size > 500) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
}

async function remember(key, ttlSeconds, fetcher) {
  const memoryValue = getMemoryCache(key);
  if (memoryValue) return memoryValue;

  let cachedValue = null;
  try {
    cachedValue = await withTimeout(redis.get(key));
  } catch (err) {
    cachedValue = null;
  }

  if (cachedValue) {
    try {
      const parsed = JSON.parse(cachedValue);
      setMemoryCache(key, parsed, ttlSeconds);
      return parsed;
    } catch (err) {
      await forget(key);
    }
  }

  const value = await fetcher();
  setMemoryCache(key, value, ttlSeconds);
  try {
    await withTimeout(redis.set(key, JSON.stringify(value), "EX", ttlSeconds));
  } catch (err) {
    // Cache should never make the backing product flow unavailable.
  }
  return value;
}

function patternFromInput(input) {
  if (input instanceof RegExp) {
    const source = input.source || "";
    const prefixMatch = source.match(/^\^([A-Za-z0-9:_-]+)/);
    return prefixMatch ? `${prefixMatch[1]}*` : "*";
  }
  return String(input || "");
}

async function forget(input) {
  const pattern = patternFromInput(input);
  if (!pattern) return 0;

  try {
    if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes("[")) {
      return redis.del(pattern);
    }

    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== "0");

    return deleted;
  } catch (err) {
    return 0;
  }
}

module.exports = { remember, forget };
