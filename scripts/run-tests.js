#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const testDirectory = path.resolve("test");
const testFiles = fs.existsSync(testDirectory)
  ? fs.readdirSync(testDirectory)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => path.join(testDirectory, name))
  : [];

if (!testFiles.length) {
  process.stderr.write("No test files found in test/. Refusing to report an empty suite as successful.\n");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
