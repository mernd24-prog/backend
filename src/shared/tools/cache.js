const { redis } = require("../../infrastructure/redis/redis-client");

async function remember(key, ttlSeconds, fetcher) {
  let cachedValue = null;
  try {
    cachedValue = await redis.get(key);
  } catch (err) {
    cachedValue = null;
  }

  if (cachedValue) {
    try {
      return JSON.parse(cachedValue);
    } catch (err) {
      await forget(key);
    }
  }

  const value = await fetcher();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
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
