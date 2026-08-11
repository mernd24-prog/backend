const pino = require("pino");
const { env } = require("../../config/env");

const prettyLogs = ["1", "true", "yes", "on"].includes(
  String(process.env.LOG_PRETTY || "").trim().toLowerCase(),
) || env.nodeEnv !== "production";

const transport =
  prettyLogs
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname,name,req,res,responseTime,statusCode,errorCode",
          singleLine: true,
          levelFirst: true,
          messageFormat: "{msg}",
        },
      })
    : undefined;

const logger = pino(
  {
    name: env.appName,
    // Keep normal runtime output quiet. Set LOG_LEVEL=info/debug explicitly
    // only when temporary diagnostics are needed.
    level: process.env.LOG_LEVEL || "warn",
    base: env.nodeEnv === "production" ? undefined : { pid: false, hostname: false },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-api-key']",
        "headers.authorization",
        "headers.cookie",
        "headers['x-api-key']",
        "res.headers['set-cookie']",
      ],
      censor: "[REDACTED]",
    },
  },
  transport,
);

module.exports = { logger };
