#!/usr/bin/env node
const { execSync } = require("child_process");
const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { postgresPool } = require("../../src/infrastructure/postgres/postgres-client");
const { env } = require("../../src/config/env");

function redactUri(uri) {
  return String(uri || "").replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");
}

async function resetMongo() {
  await connectMongo();
  await mongoose.connection.dropDatabase();
  process.stdout.write(`Dropped MongoDB database for URI: ${redactUri(env.mongoUri)}\n`);
  await mongoose.connection.close();
}

async function resetPostgres() {
  await postgresPool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await postgresPool.query("CREATE SCHEMA public");
  process.stdout.write(`Dropped and recreated PostgreSQL public schema for: ${redactUri(env.postgresUrl)}\n`);
  await postgresPool.end();
}

function resetSchemaAndSeed() {
  execSync("node scripts/db/run-sequelize-migrations.js", { stdio: "inherit" });
  execSync("node scripts/db/seed-rbac.js", { stdio: "inherit" });
  execSync("node scripts/seed/master-seed.js all --reset", { stdio: "inherit" });
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
