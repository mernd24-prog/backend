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

function registerBackgroundServices() {
  registerWorkers();
  registerCronJobs();
  registerRealtimeSubscribers();
  registerDomainHandlers();
}

function requestLoggerOptions() {
  return {
    logger,
    // Request failures are logged once by the central error handler. Disabling
    // pino-http completion logs removes successful requests and duplicate 5xx logs.
    autoLogging: false,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          organizationId: req.headers?.["x-organization-id"] || undefined,
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
      err(error) {
        return pinoHttp.stdSerializers.err(error);
      },
    },
    customLogLevel(req, res, error) {
      if (error || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage(req, res, responseTime) {
      const organization = req.headers?.["x-organization-id"];
      const context = [
        req.id !== undefined ? `#${req.id}` : null,
        req.ip ? `ip=${req.ip}` : null,
        organization ? `org=${organization}` : null,
      ].filter(Boolean).join(" ");
      return `${req.method} ${req.url} -> ${res.statusCode} (${Math.round(responseTime)}ms)${context ? ` [${context}]` : ""}`;
    },
    customErrorMessage(req, res, error) {
      return `${req.method} ${req.url} -> ${res.statusCode || 500}: ${error?.message || "request failed"}${req.id !== undefined ? ` [#${req.id}]` : ""}`;
    },
  };
}

async function createApp({ startBackgroundServices = true } = {}) {
  await Promise.all([connectMongo(), connectPostgres()]);

  const app = express();

  app.disable("x-powered-by");
  app.disable("etag");
  app.set("trust proxy", 1);

  app.use(pinoHttp(requestLoggerOptions()));
  app.use(helmet());
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      res.set("Surrogate-Control", "no-store");
    }
    next();
  });
  app.use(
    cors({
      origin: env.cors.origin === "*" ? true : env.cors.origin,
      credentials: true,
      exposedHeaders: [
        "X-Selected-Organization-Id",
        "X-Organization-Context-Changed",
      ],
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
  if (startBackgroundServices) registerBackgroundServices();

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, registerBackgroundServices, requestLoggerOptions };
