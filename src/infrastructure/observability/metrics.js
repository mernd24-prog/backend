const { logger } = require("../../shared/logger/logger");
const { redis } = require("../redis/redis-client");

/**
 * Observability & Metrics Tracking
 * For 200k+ users, track:
 * - API response times
 * - Error rates
 * - Business metrics (orders/min, revenue/min)
 * - Resource usage
 */

const metrics = {
  // Counters
  requests: 0,
  errors: 0,
  orders: 0,
  payments: 0,
  users: 0,

  // Histograms (response times)
  responseTimes: [],
};

async function trackMetric(metricName, value = 1) {
  try {
    if (redis.status !== "ready") return;
    await redis.incrby(`metric:${metricName}`, value);
  } catch (error) {
    logger.warn({ err: error, metricName }, "Metric tracking error");
  }
}

async function trackLatency(endpoint, latencyMs) {
  const bucketKey = `latency:${endpoint}`;
  try {
    if (redis.status !== "ready") return;
    await redis.multi().incrby(`${bucketKey}:total`, latencyMs).incrby(`${bucketKey}:count`, 1).exec();
  } catch (error) {
    logger.warn({ err: error, endpoint }, "Latency tracking error");
  }
}

function createMetricsMiddleware() {
  return (req, res, next) => {
    const startTime = Date.now();

    res.on("finish", async () => {
      const latency = Date.now() - startTime;
      const normalizedPath = String(req.baseUrl || "") + String(req.route?.path || req.path || "")
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
        .replace(/\b[0-9a-f]{24}\b/gi, ":id")
        .replace(/\/\d+(?=\/|$)/g, "/:id");
      const endpoint = `${req.method}:${normalizedPath}`;

      if (redis.status === "ready") {
        const pipeline = redis.multi()
          .incrby(`latency:${endpoint}:total`, latency)
          .incrby(`latency:${endpoint}:count`, 1)
          .incrby("metric:requests", 1);
        if (res.statusCode >= 400) pipeline.incrby("metric:errors", 1);
        await pipeline.exec().catch((error) => logger.warn({ err: error, endpoint }, "Metric tracking error"));
      }

      logger.debug({ endpoint, statusCode: res.statusCode, latency }, "Request completed");
    });

    next();
  };
}

module.exports = {
  metrics,
  trackMetric,
  trackLatency,
  createMetricsMiddleware,
};
