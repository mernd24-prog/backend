const { createApp, registerBackgroundServices } = require("./app/create-app");
const { env } = require("./config/env");
const { logger } = require("./shared/logger/logger");
const http = require("http");
const net = require("net");
const os = require("os");

const { attachSocketServer, closeSocketServer } = require("./infrastructure/realtime/socket-server");
const { closeWorkers } = require("./workers/register-workers");
const { stopCronJobs } = require("./infrastructure/cron/register-cron");
const { mongoose } = require("./infrastructure/mongo/mongo-client");
const { postgresPool, knex } = require("./infrastructure/postgres/postgres-client");
const { redis } = require("./infrastructure/redis/redis-client");

let httpServer = null;
let shuttingDown = false;
const RECOVERABLE_PROCESS_ERROR_CODES = new Set([
  "EPIPE",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_HTTP_REQUEST_TIMEOUT",
]);

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen({ port, host: "::", exclusive: true }, () => {
      probe.close(resolve);
    });
  });
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();

  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (
        iface.family === "IPv4" &&
        !iface.internal
      ) {
        return iface.address;
      }
    }
  }

  return "localhost";
}

async function bootstrap() {
  // Fail before opening database connections, workers, or cron jobs when a
  // nodemon/cluster instance is already serving the configured port.
  await assertPortAvailable(env.port);
  const app = await createApp({ startBackgroundServices: false });

  httpServer = http.createServer(app);

  attachSocketServer(httpServer);
  registerBackgroundServices();

  const localIp = getLocalIp();

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(env.port);
  });

  logger.info(
    {
      port: env.port,
      localhost: `http://localhost:${env.port}`,
      network: `http://${localIp}:${env.port}`,
    },
    "HTTP server started"
  );

  httpServer.on("error", (error) => shutdown("http_server_error", error, 1));
  httpServer.on("clientError", (error, socket) => {
    logger.warn({ err: error }, "Malformed or aborted HTTP client connection");
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    else socket.destroy();
  });
}

async function closeHttpServer() {
  if (!httpServer?.listening) return;
  await new Promise((resolve) => httpServer.close(() => resolve()));
}

async function shutdown(reason, error = null, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger[error ? "error" : "info"]({ err: error || undefined, reason }, "Server shutdown started");

  const forcedExit = setTimeout(() => {
    logger.fatal({ reason }, "Graceful shutdown timed out");
    process.exit(1);
  }, 10000);
  forcedExit.unref();

  // Socket.IO owns connections on the HTTP server. Close it first to avoid
  // racing two server.close() calls during nodemon and container shutdowns.
  await Promise.allSettled([stopCronJobs(), closeSocketServer(), closeWorkers()]);
  await Promise.allSettled([closeHttpServer()]);
  await Promise.allSettled([
    mongoose.connection.readyState ? mongoose.disconnect() : Promise.resolve(),
    postgresPool.end(),
    knex.destroy(),
    redis.status === "end" ? Promise.resolve() : redis.quit(),
  ]);

  clearTimeout(forcedExit);
  logger.info({ reason, exitCode }, "Server shutdown completed");
  await new Promise((resolve) => logger.flush(resolve));
  process.exit(exitCode);
}

function handleUncaughtException(error) {
  if (RECOVERABLE_PROCESS_ERROR_CODES.has(error?.code)) {
    logger.warn({ err: error, code: error.code }, "Recovered from a client transport error");
    return;
  }
  void shutdown("uncaughtException", error, 1);
}

function handleUnhandledRejection(error) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (RECOVERABLE_PROCESS_ERROR_CODES.has(normalized.code)) {
    logger.warn({ err: normalized, code: normalized.code }, "Recovered from a rejected client transport operation");
    return;
  }
  void shutdown("unhandledRejection", normalized, 1);
}

process.once("SIGTERM", () => shutdown("SIGTERM", null, 0));
process.once("SIGINT", () => shutdown("SIGINT", null, 0));
process.on("uncaughtException", handleUncaughtException);
process.on("unhandledRejection", handleUnhandledRejection);

bootstrap().catch(async (error) => {
  if (error?.code === "EADDRINUSE") {
    logger.info(
      {
        port: env.port,
        action: `Stop the existing process or configure a different PORT`,
      },
      `Port ${env.port} is already in use; this instance was not started`,
    );
  } else {
    logger.error({ err: error }, "Bootstrap failed");
  }
  await shutdown("bootstrap_failure", error, 1);
});
