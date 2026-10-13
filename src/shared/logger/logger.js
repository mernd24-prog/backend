const pino = require("pino");
const { env } = require("../../config/env");

const prettySetting = String(process.env.LOG_PRETTY || "").trim().toLowerCase();
const prettyLogs = prettySetting
  ? ["1", "true", "yes", "on"].includes(prettySetting)
  : env.nodeEnv !== "production";

// Production installs omit devDependencies; JSON logging must still start.
let prettyTarget;
if (prettyLogs) {
  try {
    prettyTarget = require.resolve("pino-pretty");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }
}

const transport =
  prettyTarget
    ? pino.transport({
        target: prettyTarget,
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
        "req.body.password",
        "req.body.currentPassword",
        "req.body.newPassword",
        "req.body.otp",
        "req.body.refreshToken",
        "req.body.razorpaySignature",
        "*.password",
        "*.otp",
        "*.token",
        "*.tokenHash",
        "*.apiKey",
        "*.apiSecret",
      ],
      censor: "[REDACTED]",
    },
  },
  transport,
);

module.exports = { logger };
