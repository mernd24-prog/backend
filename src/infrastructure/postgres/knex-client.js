const Knex = require("knex");
const { env } = require("../../config/env");

const knex = Knex({
  client: "pg",
  connection: {
    connectionString: env.postgresUrl,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  },
  pool: {
    min: env.knex.poolMin,
    max: env.knex.poolMax,
    acquireTimeoutMillis: env.knex.acquireTimeoutMillis,
    createTimeoutMillis: env.knex.createTimeoutMillis,
    idleTimeoutMillis: env.knex.idleTimeoutMillis,
    reapIntervalMillis: 1000,
  },
  useNullAsDefault: true,
});

module.exports = { knex };
