const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { env } = require("../config/env");
const { logger } = require("../shared/logger/logger");
const { notFoundHandler } = require("../shared/middleware/not-found");
const { errorHandler } = require("../shared/middleware/error-handler");
const { connectMongo } = require("../infrastructure/mongo/mongo-client");
const { connectPostgres } = require("../infrastructure/postgres/postgres-client");
// const { connectRedis } = require("../infrastructure/redis/redis-client");
const { registerRoutes } = require("../api/register-routes");
const { registerWorkers } = require("../workers/register-workers");
const { registerCronJobs } = require("../infrastructure/cron/register-cron");
const { auditLog } = require("../shared/middleware/audit-log");
const { registerRealtimeSubscribers } = require("../infrastructure/realtime/register-realtime");
const { registerDomainHandlers } = require("../infrastructure/events/register-domain-handlers");
const { createMetricsMiddleware } = require("../infrastructure/observability/metrics");

async function createApp() {
  await Promise.all([connectMongo(), connectPostgres()]);

  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(
    cors({
      origin: env.cors.origin === "*" ? true : env.cors.origin,
      credentials: true,
    })
  );

  // app.use(
  //   rateLimit({
  //     windowMs: 60 * 1000,
  //     max: 300,
  //     standardHeaders: true,
  //     legacyHeaders: false,
  //   })
  // );

  app.use(
    express.json({
      limit: env.upload.jsonBodyLimit,
      verify: (req, res, buffer) => {
        req.rawBody = buffer;
      },
    })
  );

  app.use(express.urlencoded({ extended: true, limit: env.upload.jsonBodyLimit }));

  app.get("/", (req, res) => {
    res.status(200).json({
      success: true,
      service: env.appName,
      message: "Sam Global Backend Running Successfully 🚀",
      status: "ok",
    });
  });

  app.get("/health", (req, res) => {
    res.json({ success: true, service: env.appName, status: "ok" });
  });

  app.use("/uploads", express.static(path.resolve(__dirname, "../../uploads")));
  app.use(auditLog);
  app.use(createMetricsMiddleware());

  registerRoutes(app);
  registerWorkers();
  registerCronJobs();
  registerRealtimeSubscribers();
  registerDomainHandlers();

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
