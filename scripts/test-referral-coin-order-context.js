const assert = require("node:assert/strict");
const { coinOrderContext } = require("../src/modules/referral/utils/coin-order-context");

const now = new Date("2026-11-03T00:00:00Z");
const order = {
  status: "fulfilled", payment_status: "paid",
  return_eligible_until: "2026-11-10T00:00:00Z",
};
const context = (changes = {}, returns = [], status = "locked") =>
  coinOrderContext({ ...order, ...changes }, returns, status, now);

assert.equal(context().lockReason, "return_window_open");
assert.equal(context().expectedReleaseDate, order.return_eligible_until);
assert.equal(context({ status: "delivered" }).lockReason, "return_window_open");
assert.equal(context({ status: "delivered" }).expectedReleaseDate, order.return_eligible_until);
assert.equal(context({ status: "delivered", return_eligible_until: "2026-11-01T00:00:00Z" }).lockReason, "awaiting_order_finalization");
assert.equal(context({ status: "delivered" }, [{ status: "requested" }]).expectedReleaseDate, null);
assert.equal(context({ status: "delivered", payment_status: "partially_refunded" }).lockReason, "payment_not_settled");
assert.equal(context({ status: "confirmed" }).lockReason, "awaiting_order_fulfillment");
assert.equal(context({ payment_status: "partially_refunded" }).lockReason, "payment_not_settled");
for (const status of ["cancelled", "returned", "refunded", "payment_failed"]) {
  assert.equal(context({ status }).lockReason, "awaiting_reversal");
  assert.equal(context({ status }).expectedReleaseDate, null);
}
const dispute = [{ status: "qc_failed", qcReview: { status: "customer_disputed" } }];
assert.equal(context({}, dispute).lockReason, "return_dispute_open");
assert.equal(context({}, dispute).expectedReleaseDate, null);
assert.equal(context({}, [{ status: "requested" }]).lockReason, "return_in_progress");
assert.equal(context({}, [{ status: "rejected" }]).lockReason, "return_window_open");
assert.equal(context({ return_eligible_until: "2026-11-01T00:00:00Z" }).lockReason, "awaiting_coin_release");
for (const status of ["available", "paid", "reversed", "expired", "payout_requested"]) {
  assert.equal(context({}, [], status).lockReason, null);
}
assert.equal(coinOrderContext(null, [], "pending").lockReason, "order_details_unavailable");
assert.equal(context({}, [{ status: "closed" }, ...dispute]).lockReason, "return_dispute_open");
console.log("Referral coin order context checks passed.");
