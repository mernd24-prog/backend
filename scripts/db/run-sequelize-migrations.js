#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { sequelize, Sequelize } = require("../../src/infrastructure/sequelize/sequelize-client");

async function ensureMigrationTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS _app_migrations (
      id VARCHAR(128) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrationIds() {
  const [rows] = await sequelize.query("SELECT id FROM _app_migrations");
  return new Set(rows.map((row) => row.id));
}

function loadMigrationFiles() {
  const dir = path.resolve(__dirname, "../../sequelize/migrations");
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => {
      const migration = require(path.join(dir, fileName));
      if (!migration || typeof migration.up !== "function") {
        throw new Error(`Invalid migration file: ${fileName}`);
      }
      const derivedId = fileName.replace(/\.js$/i, "");
      if (!migration.id) {
        migration.id = derivedId;
      }
      return migration;
    });
}

async function applyMigration(migration) {
  const queryInterface = sequelize.getQueryInterface();
  const transaction = await sequelize.transaction();
  const context = { queryInterface, Sequelize, transaction };

  try {
    if (migration.up.length >= 2) {
      await migration.up(queryInterface, Sequelize, { transaction });
    } else {
      await migration.up(context);
    }
    await sequelize.query("INSERT INTO _app_migrations (id) VALUES ($1)", {
      bind: [migration.id],
      transaction,
    });
    await transaction.commit();
    process.stdout.write(`Applied migration: ${migration.id}\n`);
  } catch (error) {
    await transaction.rollback();
    error.migrationId = migration.id;
    throw error;
  }
}

function formatMigrationError(error) {
  const details = [
    `Migration failed${error.migrationId ? ` (${error.migrationId})` : ""}: ${error.message || error.name || "Unknown error"}`,
  ];

  const source = error.parent || error.original;
  if (source) {
    for (const key of ["code", "severity", "detail", "hint", "table", "column", "constraint"]) {
      if (source[key]) {
        details.push(`${key}: ${source[key]}`);
      }
    }
  }

  const sql = error.sql || source?.sql;
  if (sql) {
    details.push(`sql: ${String(sql).replace(/\s+/g, " ").trim()}`);
  }

  if (error.stack) {
    details.push(error.stack);
  }

  return details.join("\n");
}

async function main() {
  await sequelize.authenticate();
  await ensureMigrationTable();
  const applied = await getAppliedMigrationIds();
  const migrations = loadMigrationFiles();

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      await applyMigration(migration);
    }
  }

  process.stdout.write("Sequelize migrations completed\n");
}

main()
  .catch((error) => {
    process.stderr.write(`${formatMigrationError(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
