const test = require("node:test");
const assert = require("node:assert/strict");

const { ReturnServiceClass } = require("../src/modules/returns/services/return.service");

const service = new ReturnServiceClass();
const seller = { userId: "seller-1", role: "seller" };

test("seller cannot perform an administrator-only financial action", () => {
  assert.throws(
    () => service.assertAdmin(seller, "set a refund amount"),
    (error) => error.statusCode === 403 && /administrator/i.test(error.message),
  );
});

test("seller cannot process, retry, or synchronize a refund", async () => {
  await assert.rejects(service.processRefund("return-1", seller), { statusCode: 403 });
  await assert.rejects(service.retryRefund("return-1", seller), { statusCode: 403 });
  await assert.rejects(service.syncRefund("return-1", seller), { statusCode: 403 });
});
