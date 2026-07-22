const test = require("node:test");
const assert = require("node:assert/strict");

const { ReturnServiceClass } = require("../src/modules/returns/services/return.service");

const service = new ReturnServiceClass();
const seller = { userId: "seller-1", role: "seller" };
const admin = { userId: "admin-1", role: "admin" };

test("seller cannot perform an administrator-only financial action", () => {
  assert.throws(
    () => service.assertAdmin(seller, "set a refund amount"),
    (error) => error.statusCode === 403 && /administrator/i.test(error.message),
  );
});

test("administrator cannot perform seller return-logistics operations", () => {
  assert.throws(
    () => service.assertSeller(admin, "schedule return pickup"),
    (error) => error.statusCode === 403 && /assigned seller/i.test(error.message),
  );
});

test("seller cannot process, retry, or synchronize a refund", async () => {
  await assert.rejects(service.processRefund("return-1", seller), { statusCode: 403 });
  await assert.rejects(service.retryRefund("return-1", seller), { statusCode: 403 });
  await assert.rejects(service.syncRefund("return-1", seller), { statusCode: 403 });
  await assert.rejects(service.closeReturn("return-1", {}, seller), { statusCode: 403 });
});

test("seller may accept a refund return but cannot change its eligible refund amount", async () => {
  const request = {
    _id: "return-1",
    sellerId: "seller-1",
    status: "requested",
    resolution: "refund",
    items: [{
      orderItemId: "item-1",
      productId: "product-1",
      requestedQuantity: 1,
      quantity: 1,
      eligibleRefundAmount: 63990.59,
      refundAmount: 63990.59,
    }],
    refund: {},
    timeline: [],
    save: async () => {},
  };
  service.getReturnOrThrow = async () => request;
  service.assertCanManage = async () => {};
  service.publishReturnEvent = async () => {};

  const accepted = await service.approveReturn("return-1", 1, seller, {
    items: [{ orderItemId: "item-1", approvedQuantity: 1 }],
  });

  assert.equal(accepted.status, "approved");
  assert.equal(accepted.refund.approvedAmount, 63990.59);
});

const makeQcFailedReturn = () => ({
  _id: "return-qc",
  orderId: "order-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "qc_failed",
  items: [{
    orderItemId: "item-1",
    productId: "product-1",
    requestedQuantity: 1,
    approvedQuantity: 1,
    receivedQuantity: 1,
    eligibleRefundAmount: 100,
    refundAmount: 0,
    qcResult: "rejected",
    qcNotes: "Serial number does not match",
    qcPhotos: ["https://example.test/qc.jpg"],
  }],
  refund: { approvedAmount: 0 },
  refundBreakup: {},
  qcReview: {
    status: "awaiting_customer_or_admin_review",
    disputeDeadline: "2099-01-01T00:00:00.000Z",
  },
  timeline: [],
  save: async () => {},
});

test("buyer can dispute seller QC failure while another user cannot", async () => {
  const qcService = new ReturnServiceClass();
  const request = makeQcFailedReturn();
  qcService.getReturnOrThrow = async () => request;
  qcService.publishReturnStatusUpdated = async () => {};
  qcService.inventoryService.restockForReturn = async () => {};
  qcService.inventoryService.recordReturnDamage = async () => {};

  await assert.rejects(
    qcService.disputeQcFailure("return-qc", { reason: "The submitted photo is not my product", evidence: [] }, seller),
    { statusCode: 403 },
  );
  const disputed = await qcService.disputeQcFailure("return-qc", {
    reason: "The submitted photo is not my product",
    evidence: ["https://example.test/customer.jpg"],
  }, { userId: "buyer-1", role: "buyer" });
  assert.equal(disputed.qcReview.status, "customer_disputed");
});

test("admin can request evidence or override failed QC at item level", async () => {
  const qcService = new ReturnServiceClass();
  qcService.inventoryService.restockForReturn = async () => {};
  qcService.inventoryService.recordReturnDamage = async () => {};
  let request = makeQcFailedReturn();
  qcService.getReturnOrThrow = async () => request;
  qcService.publishReturnStatusUpdated = async () => {};

  const evidenceRequested = await qcService.decideQcFailure("return-qc", {
    decision: "request_evidence",
    reason: "Provide a clear serial-number photograph",
  }, admin);
  assert.equal(evidenceRequested.qcReview.status, "evidence_requested");

  request = makeQcFailedReturn();
  const overridden = await qcService.decideQcFailure("return-qc", {
    decision: "override",
    reason: "Customer evidence confirms the returned serial number",
    items: [{ orderItemId: "item-1", approvedQuantity: 1, disposition: "damaged" }],
  }, admin);
  assert.equal(overridden.status, "qc_passed");
  assert.equal(overridden.refund.approvedAmount, 100);
});
