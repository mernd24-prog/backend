const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const path = require("node:path");
const file = path.resolve(__dirname, "../src/modules/cancellation/services/cancellation.service.js");
const localRequire = createRequire(file);
const moduleStub = { exports: {} };
vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(file, "utf8")}\n})`, {})(
  name => name.includes("shared/domain/") || name === "crypto" ? localRequire(name) : {},
  moduleStub, moduleStub.exports,
);
const service = Object.create(moduleStub.exports.CancellationService.prototype);

for (const [name, order, expected] of [
  ["legacy inclusive fee", { metadata: { pricingSummary: { customerPlatformFeeAmount: 100 } } }, 100],
  ["separate GST", { metadata: { pricingSummary: { customerPlatformFeeAmount: 100, customerPlatformFeeTaxAmount: 18 } } }, 118],
  ["summary fee and GST", { summary: { customerPlatformFeeAmount: 84.75, customerPlatformFeeTaxAmount: 15.25 } }, 100],
  ["no customer fee", { platform_fee_amount: 500 }, 0],
]) {
  test(`seller cancellation refunds ${name} without using seller commission`, () => {
    const fee = service.getCustomerPlatformFeeAmount(order);
    assert.equal(fee, expected);
    const refund = service.calculateRefund(
      { ...order, subtotal_amount: 165000, payment_status: "captured" },
      [{ refundAmount: 165000, itemAmount: 165000 }],
      { status: "captured" }, true, fee,
    );
    assert.equal(refund.refundAmount, 165000 + expected);
    assert.equal(refund.providerRefundAmount, 165000 + expected);
  });
}
