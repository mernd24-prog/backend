#!/usr/bin/env node
const { execSync } = require("child_process");
const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { postgresPool } = require("../../src/infrastructure/postgres/postgres-client");
const { env } = require("../../src/config/env");

function redactUri(uri) {
  return String(uri || "").replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");
}

async function resetMongo() {
  console.time("resetMongo");
  await connectMongo();
  await mongoose.connection.dropDatabase();
  process.stdout.write(`Dropped MongoDB database for URI: ${redactUri(env.mongoUri)}\n`);
  await mongoose.connection.close();
  console.timeEnd("resetMongo");
}

async function resetPostgres() {
  console.time("resetPostgres");
  await postgresPool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await postgresPool.query("CREATE SCHEMA public");
  process.stdout.write(`Dropped and recreated PostgreSQL public schema for: ${redactUri(env.postgresUrl)}\n`);
  await postgresPool.end();
  console.timeEnd("resetPostgres");
}

function resetSchemaAndSeed() {
  console.time("resetSchemaAndSeed");
  execSync("node scripts/db/run-sequelize-migrations.js", { stdio: "inherit" });
  execSync("node scripts/db/seed-rbac.js", { stdio: "inherit" });
  // Allow skipping the heavy master seed via SKIP_SEED=1 in the environment.
  if (process.env.SKIP_SEED === "1") {
    process.stdout.write("SKIP_SEED=1 set — skipping master seed modules\n");
  } else {
    execSync("node scripts/seed/master-seed.js all --reset", { stdio: "inherit" });
  }
  execSync("node scripts/db/repair-rbac-role-assignments.js", { stdio: "inherit" });
  console.timeEnd("resetSchemaAndSeed");
}

async function main() {
  await resetMongo();
  await resetPostgres();
  resetSchemaAndSeed();
  process.stdout.write("All databases reset and rebuilt successfully\n");
}

main().catch((error) => {
  process.stderr.write(`Reset failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
