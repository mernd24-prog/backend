const { Pool } = require("pg");
const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");
const { knex } = require("./knex-client");

const postgresPool = new Pool({
  connectionString: env.postgresUrl,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  max: env.postgres.poolMax,
  connectionTimeoutMillis: env.postgres.connectionTimeoutMillis,
  idleTimeoutMillis: env.postgres.idleTimeoutMillis,
});

// node-postgres emits idle-client failures on the Pool itself. Without an
// error listener Node treats that event as an uncaught exception and shuts
// down the entire API for a recoverable database/network disconnect. The pool
// automatically removes the failed client and creates a replacement for the
// next request.
postgresPool.on("error", (error) => {
  logger.error({
    code: error?.code || "POSTGRES_IDLE_CONNECTION_ERROR",
    message: error?.message || "PostgreSQL idle connection failed",
  }, "PostgreSQL pool discarded a failed idle connection");
});

function describePostgresTarget() {
  try {
    const url = new URL(env.postgresUrl);
    const database = url.pathname ? url.pathname.replace(/^\/+/, "") : "";
    return {
      host: url.hostname || "unknown-host",
      port: url.port || "5432",
      database: database || "unknown-database",
      user: decodeURIComponent(url.username || "unknown-user"),
      sslmode: url.searchParams.get("sslmode") || "not-set",
    };
  } catch (error) {
    return {
      host: "invalid-postgres-url",
      port: "unknown-port",
      database: "unknown-database",
      user: "unknown-user",
      sslmode: "unknown",
    };
  }
}

function createPostgresBootstrapError(error) {
  const target = describePostgresTarget();
  const message = [
    `PostgreSQL bootstrap check failed for ${target.user}@${target.host}:${target.port}/${target.database}.`,
    `No response was received within ${env.postgres.connectionTimeoutMillis}ms.`,
    "Check POSTGRES_URL, server firewall/security group, postgres listen_addresses/pg_hba.conf, max_connections, and whether sslmode=require is needed.",
  ].join(" ");
  const bootstrapError = new Error(message, { cause: error });
  bootstrapError.code = error?.code || "POSTGRES_BOOTSTRAP_FAILED";
  bootstrapError.postgres = target;
  return bootstrapError;
}

async function connectPostgres() {
  try {
    await postgresPool.query("SELECT 1");
    await knex.raw("SELECT 1");
  } catch (error) {
    throw createPostgresBootstrapError(error);
  }
  logger.info("PostgreSQL connected");
}

module.exports = { postgresPool, connectPostgres, knex };
