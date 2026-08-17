#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(target) : entry.name.endsWith(".js") ? [target] : [];
  });
}

const files = [...filesUnder(path.resolve("src")), ...filesUnder(path.resolve("sequelize/migrations"))];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`);
    process.exit(1);
  }
}

const migrationIds = new Map();
for (const file of filesUnder(path.resolve("sequelize/migrations"))) {
  const migration = require(file);
  const id = migration.id || path.basename(file, ".js");
  if (migrationIds.has(id)) throw new Error(`Duplicate migration id ${id}: ${migrationIds.get(id)} and ${file}`);
  migrationIds.set(id, file);
}
process.stdout.write(`Checked ${files.length} JavaScript files and ${migrationIds.size} migration IDs\n`);
