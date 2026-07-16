const test = require("node:test");
const assert = require("node:assert/strict");

const { CommissionService } = require("../src/modules/seller/services/commission.service");

test("item commission becomes available only after item eligibility", () => {
  const releaseData = new Map([
    ["order-1", { order: { id: "order-1", status: "fulfilled" } }],
  ]);
  releaseData.itemsById = new Map([
    ["item-1", { id: "item-1", payout_status: "pending", payout_eligible_at: "2026-07-20T00:00:00.000Z" }],
  ]);
  const commission = {
    id: "commission-1",
    order_id: "order-1",
    order_item_id: "item-1",
    seller_id: "seller-1",
    status: "pending",
    net_amount: 100,
  };

  const pending = CommissionService.evaluateCommissionRelease(commission, releaseData, {}, new Date("2026-07-21T00:00:00.000Z"));
  assert.equal(pending.available, false);
  assert.equal(pending.reason, "waiting_for_item_return_window");

  releaseData.itemsById.get("item-1").payout_status = "eligible";
  const eligible = CommissionService.evaluateCommissionRelease(commission, releaseData, {}, new Date("2026-07-21T00:00:00.000Z"));
  assert.equal(eligible.available, true);
  assert.equal(eligible.releaseStatus, "available");

  releaseData.itemsById.get("item-1").payout_status = "held";
  const held = CommissionService.evaluateCommissionRelease(commission, releaseData, {}, new Date("2026-07-21T00:00:00.000Z"));
  assert.equal(held.releaseStatus, "held");
  assert.equal(held.reason, "item_on_hold");
});
