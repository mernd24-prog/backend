const IORedis = require("ioredis");
const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");

const redis = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy(times) {
    if (times > 20) return null;
    return Math.min(250 * (2 ** Math.min(times - 1, 5)), 10000);
  },
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (error) => logger.error({ err: error }, "Redis connection error"));

module.exports = { redis };
