const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyPostgresError,
  isTransientDatabaseError,
  withTransientDatabaseRetry,
} = require("../src/shared/errors/database-error");

test("connection termination is classified as a retryable service outage", () => {
  const error = new Error('select * from "orders" - Connection terminated unexpectedly');
  assert.equal(isTransientDatabaseError(error), true);
  assert.deepEqual(classifyPostgresError(error), {
    statusCode: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "The service is temporarily unavailable. Please retry this request.",
    retryAfterSeconds: 1,
  });
});

test("PostgreSQL constraint errors receive stable client responses", () => {
  assert.equal(classifyPostgresError({ code: "23505" }).code, "DUPLICATE_ENTRY");
  assert.equal(classifyPostgresError({ code: "23503" }).code, "DEPENDENCY_CONFLICT");
  assert.equal(classifyPostgresError({ code: "22P02" }).code, "INVALID_VALUE");
});

test("safe database operation retries one transient failure", async () => {
  let calls = 0;
  const result = await withTransientDatabaseRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    return "ok";
  }, { attempts: 2, delayMs: 0 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("non-transient failures are never retried", async () => {
  let calls = 0;
  await assert.rejects(withTransientDatabaseRetry(async () => {
    calls += 1;
    throw Object.assign(new Error("duplicate"), { code: "23505" });
  }, { attempts: 3, delayMs: 0 }));
  assert.equal(calls, 1);
});
