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
    min: 2,
    max: 10,
    acquireTimeoutMillis: 10000,
    createTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
  },
  useNullAsDefault: true,
});

module.exports = { knex };
