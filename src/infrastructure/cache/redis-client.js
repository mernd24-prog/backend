const { redis: redisClient } = require("../redis/redis-client");
const { logger } = require("../../shared/logger/logger");

// Cache TTL constants (in seconds)
const CACHE_TTL = {
  PRODUCT: 3600, // 1 hour
  USER: 1800, // 30 minutes
  CART: 600, // 10 minutes
  SESSION: 86400, // 24 hours
  ANALYTICS: 300, // 5 minutes
  COUPON: 3600, // 1 hour
  RECOMMENDATION: 7200, // 2 hours
  INVENTORY: 300, // 5 minutes
};

// Cache key builders
const cacheKeys = {
  product: (productId) => `product:${productId}`,
  products: (filters = "") => `products:list:${filters || "all"}`,
  user: (userId) => `user:${userId}`,
  userProfile: (userId) => `user:profile:${userId}`,
  userWallet: (userId) => `user:wallet:${userId}`,
  cart: (userId) => `cart:${userId}`,
  session: (sessionId) => `session:${sessionId}`,
  coupon: (code) => `coupon:${code}`,
  inventory: (productId) => `inventory:${productId}`,
  recommendations: (userId) => `recommendations:${userId}`,
  searchResults: (query) => `search:${query}`,
  trending: (period) => `trending:${period}`,
};

// Cache tools
async function getCached(key) {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.warn({ err: error, key }, "Cache get error");
    return null;
  }
}

async function setCached(key, value, ttl = 3600) {
  try {
    await redisClient.setex(key, ttl, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.warn({ err: error, key }, "Cache set error");
    return false;
  }
}

async function deleteCached(key) {
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    logger.warn({ err: error, key }, "Cache delete error");
    return false;
  }
}

async function deletePatternCached(pattern) {
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = nextCursor;
      if (keys.length > 0) await redisClient.unlink(...keys);
    } while (cursor !== "0");
    return true;
  } catch (error) {
    logger.warn({ err: error, pattern }, "Cache pattern delete error");
    return false;
  }
}

async function incrementCounter(key, increment = 1) {
  try {
    return await redisClient.incrby(key, increment);
  } catch (error) {
    logger.warn({ err: error, key }, "Counter increment error");
    return null;
  }
}

module.exports = {
  redisClient,
  CACHE_TTL,
  cacheKeys,
  getCached,
  setCached,
  deleteCached,
  deletePatternCached,
  incrementCounter,
};
