const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { AppError } = require("../src/shared/errors/app-error");
const source = fs.readFileSync(require.resolve("../src/modules/cancellation/services/cancellation.service"), "utf8");
const methods = ["approveRefund", "processQueuedRefunds"].map((name) => {
  const start = source.indexOf(`  async ${name}(`);
  const end = source.indexOf("\n  async ", start + 10);
  return source.slice(start, end);
}).join("\n");
const sandbox = { AppError, PAYMENT_PROVIDER: { RAZORPAY: "razorpay" } };
vm.runInNewContext(`class Probe { ${methods} } service = new Probe();`, sandbox);
const service = sandbox.service;

async function run() {
  let submissions = 0;
  let claimed = false;
  let row = { id: "refund-1", order_id: "order-1", refund_status: "manual_review", payment_provider: "razorpay", provider_refund_amount: 100 };
  service.isAdmin = () => true;
  service.orderRepository = { findByIdWithItems: async () => ({ id: "order-1" }) };
  service.cancellationRepository = {
    findById: async () => row,
    claimRefundApproval: async () => claimed ? null : (claimed = true, { ...row, refund_status: "pending", metadata: { refundSubmissionState: "queued" } }),
  };
  service.processProviderRefund = async () => { submissions++; };
  const approved = await service.approveRefund("refund-1", {}, {});
  assert.equal(approved.metadata.refundSubmissionState, "queued");
  assert.equal(submissions, 0, "approval must not call the payment provider");
  await assert.rejects(service.approveRefund("refund-1", {}, {}), /already being processed/);
  row = { ...row, metadata: { refundSubmissionUncertain: true } };
  await assert.rejects(service.approveRefund("refund-1", {}, {}), /Verify the previous refund/);

  const updates = [];
  service.cancellationRepository = {
    findInterruptedRefunds: async () => [{ id: "interrupted" }],
    findQueuedRefunds: async () => [{ id: "claimed-by-other" }, { id: "success" }, { id: "failure" }],
    claimQueuedRefund: async (id) => id === "claimed-by-other" ? null : { id },
    update: async (id, payload) => { updates.push({ id, ...payload }); },
  };
  const processed = [];
  service.processApprovedRefund = async ({ id }) => {
    processed.push(id);
    if (id === "failure") throw new Error("Network timeout");
  };
  const result = await service.processQueuedRefunds();
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(processed, ["success", "failure"]);
  assert.ok(updates.every((update) => update.refundStatus === "manual_review" && update.metadata.refundSubmissionUncertain));
  assert.equal(updates[0].id, "interrupted");
  console.log("Cancellation refund queue approval, claims, interruption and failure checks passed.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
