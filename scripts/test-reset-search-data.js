const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resetSearchData, PRODUCT_SEARCH_INDEX } = require("./utils/reset-search-data");
const logger = { info() {} };

test("clears only product documents without requiring refresh privileges or changing mappings", async () => {
  let request;
  const result = await resetSearchData({ enabled: true, logger, client: {
    deleteByQuery: async params => { request = params; return { deleted: 23 }; },
  } });
  assert.equal(request.index, PRODUCT_SEARCH_INDEX);
  assert.equal(request.index.includes("*"), false);
  assert.deepEqual(request.query, { match_all: {} });
  assert.equal(request.refresh, false);
  assert.equal(request.wait_for_completion, true);
  assert.deepEqual(result, { skipped: false, deleted: 23 });
});
test("disabled search skips network cleanup", async () => {
  const result = await resetSearchData({ enabled: false, logger, client: { deleteByQuery: () => { throw new Error("unexpected request"); } } });
  assert.equal(result.skipped, true);
});
test("a missing product index is safe for first-time and repeated resets", async () => {
  const error = { meta: { statusCode: 404, body: { error: { type: "index_not_found_exception" } } } };
  const result = await resetSearchData({ enabled: true, logger, client: { deleteByQuery: async () => { throw error; } } });
  assert.equal(result.deleted, 0);
});
test("unavailable search, authorization errors and unrelated 404 errors stop reset", async () => {
  for (const error of [new Error("connection refused"), { meta: { statusCode: 403 } }, { meta: { statusCode: 404 } }]) {
    await assert.rejects(resetSearchData({ enabled: true, logger, client: { deleteByQuery: async () => { throw error; } } }));
  }
});
test("partial cleanup, timeout and conflicts fail instead of reporting success", async () => {
  for (const response of [{ timed_out: true }, { failures: [{ reason: "failed" }] }, { version_conflicts: 1 }]) {
    await assert.rejects(resetSearchData({ enabled: true, logger, client: { deleteByQuery: async () => response } }), /did not complete/);
  }
});

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
test("db:reset clears search before databases even when SKIP_SEED=1", async () => {
  const calls = [];
  const file = path.join(__dirname, "db/reset-all-databases.js");
  const context = {
    console: { time() {}, timeEnd() {} },
    process: { env: { SKIP_SEED: "1" }, stdout: { write() {} }, stderr: { write() {} } },
    require(name) {
      if (name === "child_process") return { execSync: cmd => calls.push(cmd) };
      if (name.includes("reset-search-data")) return { resetSearchData: async () => calls.push("search") };
      if (name.includes("mongo-client")) return { connectMongo: async () => {}, mongoose: { connection: { dropDatabase: async () => calls.push("mongo"), close: async () => {} } } };
      if (name.includes("postgres-client")) return { postgresPool: { query: async () => calls.push("postgres"), end: async () => {} } };
      if (name.includes("config/env")) return { env: {} };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 3), ["search", "mongo", "postgres"]);
  assert.ok(!calls.some(value => value.includes("master-seed")));
  assert.equal(context.process.exitCode, undefined);
});

test("seed:all reset stops before truncation when search cleanup fails", async () => {
  const calls = [];
  const file = path.join(__dirname, "seed/master-seed.js");
  const log = { info() {}, warn() {}, error() {} };
  const context = {
    __dirname: path.dirname(file), module: { exports: {} }, console,
    process: { argv: ["node", "master-seed.js", "all", "--reset"], env: {}, exit: code => calls.push(`exit:${code}`) },
    require(name) {
      if (name === "path") return path;
      if (name === "fs") return fs;
      if (name === "pino") return () => log;
      if (name === "dotenv") return { config() {} };
      if (name.includes("db-connection")) return {
        connect: async () => {}, disconnect: async () => {},
        truncate: async () => calls.push("truncate"), dropMongoDB: async () => calls.push("mongo"),
      };
      if (name.includes("reset-search-data")) return { resetSearchData: async () => { calls.push("search"); throw new Error("search unavailable"); } };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["search", "exit:1"]);
});

test("reset works with an app account that denies explicit index refresh", async () => {
  const result = await resetSearchData({ enabled: true, logger, client: {
    deleteByQuery: async request => {
      if (request.refresh) {
        const error = new Error("indices:admin/refresh is unauthorized");
        error.meta = { statusCode: 403, body: { error: { type: "security_exception" } } };
        throw error;
      }
      return { deleted: 4, failures: [], version_conflicts: 0, timed_out: false };
    },
  } });
  assert.equal(result.deleted, 4);
});
