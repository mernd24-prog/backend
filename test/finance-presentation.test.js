"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFinancePresentation } = require("../src/modules/seller/services/finance-presentation");

test("finance presentation keeps transaction, earnings, recovery and payout meanings separate", () => {
  const result = buildFinancePresentation({
    amount: 400,
    net_amount: 49,
    currency: "INR",
    metadata: {
      financialBreakdown: {
        shippingReimbursementAmount: 49,
        gstTcsAmount: 1.69,
        incomeTaxTdsAmount: 0.34,
      },
    },
    commission_amount: 6.78,
    releaseStatus: "pending",
    releaseReason: "waiting_for_return_window",
    eligibleAt: "2026-11-24T00:00:00.000Z",
  });
  assert.equal(result.transaction.grossAmount, 400);
  assert.equal(result.transaction.shippingAmount, 49);
  assert.equal(result.earnings.sellerEarning, 49);
  assert.equal(result.earnings.tcsAmount, 1.69);
  assert.equal(result.recovery.codOwed, 0);
  assert.equal(result.payout.status, "pending");
  assert.equal(result.payout.reason, "waiting_for_return_window");
});

test("presentation never turns an item net amount into payable now", () => {
  const result = buildFinancePresentation({ net_amount: 49, codOwed: 549 });
  assert.equal(result.earnings.sellerEarning, 49);
  assert.equal(result.recovery.codOwed, 549);
  assert.equal(result.payout.payableNow, 0);
});
