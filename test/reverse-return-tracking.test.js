const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const {
  projectReverseReturn,
  assertReverseTrackingTransition,
} = require("../src/shared/domain/reverse-return-tracking");
const shipment = (status, extra = {}) => ({
  id: "reverse-a",
  return_id: "return-a",
  order_id: "order-a",
  direction: "reverse",
  status,
  tracking_number: "AWB-1",
  delivered_at: status === "delivered" ? "2026-11-16T13:15:00Z" : null,
  ...extra,
});
const request = (status = "reverse_pickup_scheduled", extra = {}) => ({
  _id: "return-a",
  orderId: "order-a",
  status,
  items: [
    {
      orderItemId: "item-a",
      quantity: 2,
      approvedQuantity: 1,
      receivedQuantity: 0,
    },
  ],
  reverseShipment: { shipmentId: "reverse-a", status: "initiated", events: [] },
  timeline: [],
  ...extra,
});
function document(value) {
  return {
    ...structuredClone(value),
    saves: 0,
    toObject() {
      return JSON.parse(JSON.stringify(this));
    },
    set(patch) {
      Object.assign(this, patch);
    },
    async save() {
      this.saves++;
    },
  };
}
const stub = new Proxy({}, { get: () => class Stub {} });
function load(relative, overrides) {
  const file = path.resolve(__dirname, "..", relative);
  const localRequire = createRequire(file);
  const module = { exports: {} };
  const requireMock = (name) =>
    Object.hasOwn(overrides, name)
      ? overrides[name]
      : name.includes("/shared/domain/") ||
          name.includes("/shared/errors/") ||
          name.endsWith("/delivery.model") ||
          name.endsWith("/domain-events")
        ? localRequire(name)
        : stub;
  vm.runInNewContext(
    `(function(require,module,exports){${fs.readFileSync(file, "utf8")}\n})`,
    { Date },
  )(requireMock, module, module.exports);
  return module.exports;
}
function setup(
  status = "reverse_pickup_scheduled",
  shipmentStatus = "initiated",
  extra = {},
) {
  const doc = document(request(status, extra));
  let current = shipment(shipmentStatus);
  let writes = 0;
  const events = [];
  const cancellationCalls = [];
  const repo = {
    findShipmentById: async () => current,
    addTrackingEvent: async (id, payload) => {
      writes++;
      current = {
        ...current,
        status: payload.status,
        ...(payload.status === "delivered"
          ? { delivered_at: "2026-11-16T13:15:00Z" }
          : {}),
      };
      return { shipment: current };
    },
  };
  const { ReturnServiceClass } = load(
    "src/modules/returns/services/return.service.js",
    {
      uuid: { v4: () => "replacement-new" },
      "../../cancellation/services/cancellation.service": { CancellationService: class {
        async cancelOrder(orderId, payload, actor) {
          cancellationCalls.push({ orderId, payload, actor });
          return { id: "replacement-cancel-a", status: "completed" };
        }
      } },
      "../../delivery/services/delivery.service": { DeliveryService: class {
        async addTrackingEvent(id, payload) {
          doc.status = "replacement_delivered"; doc.replacement.status = "delivered"; doc.replacement.deliveredAt = new Date();
        }
      } },
      "../models/return.model": {
        ReturnModel: {
          findById: async () => doc,
          find: () => ({
            sort: () => ({
              skip: () => ({
                limit: () => ({ lean: async () => [doc.toObject()] }),
              }),
            }),
          }),
          countDocuments: async () => 1,
        },
      },
      "../../../infrastructure/postgres/postgres-client": {
        knex: () => ({ whereIn: async () => [current] }),
      },
    },
  );
  const service = Object.create(ReturnServiceClass.prototype);
  service.deliveryRepository = repo;
  service.orderRepository = {
    findOrderNumbersByIds: async () => [
      { id: "order-a", order_number: "ORD-1" },
    ],
  };
  service.assertCanManage = async () => {};
  service.appendTimeline = (req, status) => req.timeline.push({ status });
  service.publishReturnEvent = async (name) => events.push(name);
  service.publishReturnStatusUpdated = async () =>
    events.push("return.status_updated.v1");
  const { DeliveryService } = load(
    "src/modules/delivery/services/delivery.service.js",
    {
      "../../returns/models/return.model": {
        ReturnModel: { findById: async () => doc },
      },
      "../../returns/services/return.service": { ReturnService: service },
    },
  );
  const delivery = Object.create(DeliveryService.prototype);
  delivery.deliveryRepository = repo;
  delivery.orderRepository = {
    findById: async () => ({ payment_status: "captured" }),
  };
  delivery.assertCanManageShipment = async () => {};
  delivery.syncOrderForTracking = async () => {};
  delivery.syncReplacementReturnForTracking = async () => {};
  delivery.syncDealDeliveryForShipment = async () => {};
  delivery.publishShipmentTrackingEvent = async () => {};
  return {
    doc,
    service,
    delivery,
    events,
    cancellationCalls,
    writes: () => writes,
    current: () => current,
  };
}
const actor = { userId: "admin-a", role: "admin" };

test("reverse shipment stages project the correct return logistics stage", () => {
  const states = {
    initiated: "reverse_pickup_scheduled",
    manifested: "reverse_pickup_scheduled",
    pickup_scheduled: "reverse_pickup_scheduled",
    picked_up: "in_reverse_transit",
    in_transit: "in_reverse_transit",
    out_for_delivery: "in_reverse_transit",
    failed: "pickup_failed",
    pickup_failed: "pickup_failed",
    delivered: "received",
    received: "received",
  };
  for (const [tracking, status] of Object.entries(states))
    assert.equal(
      projectReverseReturn(request(), shipment(tracking)).status,
      status,
    );
});
test("courier receipt fills approved quantities and never changes another return, order, or forward shipment", () => {
  const projected = projectReverseReturn(request(), shipment("delivered"));
  assert.equal(projected.status, "received");
  assert.equal(projected.items[0].receivedQuantity, 1);
  for (const extra of [
    { return_id: "other" },
    { id: "old-reverse" },
    { order_id: "other" },
    { direction: "forward" },
  ])
    assert.equal(
      projectReverseReturn(request(), shipment("delivered", extra)).status,
      "reverse_pickup_scheduled",
    );
});
test("QC, refund, replacement and terminal return states never reopen from delayed tracking", () => {
  for (const state of [
    "received",
    "qc_passed",
    "qc_completed",
    "qc_failed",
    "qc_failure_upheld",
    "refund_pending",
    "refund_failed",
    "partially_refunded",
    "refunded",
    "replacement_created",
    "replacement_shipped",
    "replacement_delivered",
    "replaced",
    "rejected",
    "closed",
  ]) {
    for (const tracking of ["initiated", "picked_up", "failed", "delivered"])
      assert.equal(
        projectReverseReturn(request(state), shipment(tracking)).status,
        state,
      );
  }
  assert.equal(
    projectReverseReturn(request("in_reverse_transit"), shipment("initiated"))
      .status,
    "in_reverse_transit",
  );
});
test("delivered reverse packages cannot move backwards; failure allows pickup retry", () => {
  for (const status of [
    "initiated",
    "picked_up",
    "in_transit",
    "pickup_failed",
  ])
    assert.throws(
      () => assertReverseTrackingTransition("delivered", status),
      /cannot move/,
    );
  for (const status of ["picked_up", "in_transit", "delivered"])
    assert.doesNotThrow(() =>
      assertReverseTrackingTransition("pickup_failed", status),
    );
  assert.throws(
    () => assertReverseTrackingTransition("in_transit", "picked_up"),
    /cannot move/,
  );
});
test("Shipment Tracking updates the linked return, received quantity and receipt event, once", async () => {
  const ctx = setup();
  await ctx.delivery.addTrackingEvent(
    "reverse-a",
    { status: "delivered" },
    actor,
  );
  assert.equal(ctx.doc.status, "received");
  assert.equal(ctx.doc.reverseShipment.status, "delivered");
  assert.equal(ctx.doc.items[0].receivedQuantity, 1);
  assert.equal(ctx.doc.receivedAt, "2026-11-16T13:15:00Z");
  assert.equal(
    ctx.events.filter((name) => name === "return.received.v1").length,
    1,
  );
  await ctx.delivery.addTrackingEvent(
    "reverse-a",
    { status: "delivered" },
    actor,
  );
  assert.equal(ctx.doc.saves, 1);
  assert.equal(ctx.events.length, 1);
});
test("Returns tracking uses the same receipt behavior as Shipment Tracking", async () => {
  const ctx = setup();
  await ctx.service.updateReverseShipment(
    "return-a",
    { status: "picked_up" },
    actor,
  );
  assert.equal(ctx.doc.status, "in_reverse_transit");
  await ctx.service.updateReverseShipment(
    "return-a",
    { status: "delivered" },
    actor,
  );
  assert.equal(ctx.doc.status, "received");
  assert.equal(
    ctx.events.filter((name) => name === "return.received.v1").length,
    1,
  );
});
test("both entry points reject terminal workflow actions before a shipment write", async () => {
  for (const status of [
    "qc_passed",
    "refunded",
    "replaced",
    "closed",
    "rejected",
  ]) {
    const ctx = setup(status);
    await assert.rejects(
      ctx.delivery.addTrackingEvent(
        "reverse-a",
        { status: "picked_up" },
        actor,
      ),
      /no longer open/,
    );
    await assert.rejects(
      ctx.service.updateReverseShipment(
        "return-a",
        { status: "picked_up" },
        actor,
      ),
      /no longer open/,
    );
    assert.equal(ctx.writes(), 0);
  }
});
test("stale delivered records are projected before action validation, so pickup cannot be repeated", async () => {
  const ctx = setup("reverse_pickup_scheduled", "delivered");
  await assert.rejects(
    ctx.service.updateReverseShipment(
      "return-a",
      { status: "picked_up" },
      actor,
    ),
    /no longer open/,
  );
  assert.equal(ctx.doc.status, "received");
  assert.equal(ctx.writes(), 0);
});
test("pickup failure can be retried without claiming replacement delivery", async () => {
  const ctx = setup("pickup_failed", "failed", {
    replacement: { orderId: "replacement-a", status: "created" },
  });
  await ctx.delivery.addTrackingEvent(
    "reverse-a",
    { status: "picked_up" },
    actor,
  );
  assert.equal(ctx.doc.status, "in_reverse_transit");
  assert.equal(ctx.doc.replacement.status, "created");
});
test("events for superseded or unrelated reverse shipments cannot update the active return", async () => {
  const ctx = setup();
  for (const extra of [
    { id: "old-shipment" },
    { return_id: "other-return" },
    { order_id: "other-order" },
  ]) {
    assert.equal(
      await ctx.service.syncReverseShipmentForTracking(
        shipment("delivered", extra),
        actor,
      ),
      null,
    );
  }
  assert.equal(ctx.doc.saves, 0);
});

test("the actual return list projects historical courier receipt before showing row actions", async () => {
  const ctx = setup("reverse_pickup_scheduled", "delivered");
  const result = await ctx.service.listReturns({}, actor);
  assert.equal(result.items[0].status, "received");
  assert.equal(result.items[0].reverseShipment.status, "delivered");
  assert.equal(result.items[0].orderNumber, "ORD-1");
  assert.equal(ctx.doc.saves, 0);
});
test("QC and refunds remain blocked before receipt and accepted QC respectively", async () => {
  for (const status of [
    "reverse_pickup_scheduled",
    "in_reverse_transit",
    "pickup_failed",
  ]) {
    const ctx = setup(
      status,
      status === "in_reverse_transit" ? "in_transit" : "initiated",
    );
    await assert.rejects(
      ctx.service.qcReturn("return-a", {}, actor),
      /only after receipt/,
    );
    await assert.rejects(
      ctx.service.processRefund("return-a", actor),
      /only after accepted QC/,
    );
  }
  const received = setup("received", "delivered");
  await assert.rejects(
    received.service.processRefund("return-a", actor),
    /only after accepted QC/,
  );
});
test("pickup cannot be arranged again while the existing pickup is scheduled or in transit", async () => {
  for (const [status, tracking] of [
    ["reverse_pickup_scheduled", "initiated"],
    ["in_reverse_transit", "in_transit"],
    ["received", "delivered"],
  ]) {
    const ctx = setup(status, tracking);
    await assert.rejects(
      ctx.service.scheduleReversePickup("return-a", {}, actor),
      /only be arranged/,
    );
  }
});
test("rescheduling a failed pickup creates a new active courier attempt", async () => {
  const ctx = setup("pickup_failed", "failed");
  const keys = [];
  ctx.service.orderRepository.findByIdWithItems = async () => ({});
  ctx.service.deliveryRepository.createShipment = async (payload) => {
    keys.push(payload.idempotencyKey);
    return shipment("initiated", {
      id: "retry-a",
      courier_name: payload.courierName,
      tracking_number: payload.trackingNumber,
    });
  };
  await ctx.service.scheduleReversePickup(
    "return-a",
    { courierName: "Courier", trackingNumber: "NEW-1" },
    actor,
  );
  assert.equal(ctx.doc.status, "reverse_pickup_scheduled");
  assert.equal(ctx.doc.reverseShipment.shipmentId, "retry-a");
  assert.equal(ctx.doc.reverseShipment.status, "initiated");
  assert.match(keys[0], /reverse-retry:/);
  assert.equal(
    await ctx.service.syncReverseShipmentForTracking(
      shipment("delivered"),
      actor,
    ),
    null,
  );
});
test("switching a failed pickup to customer shipping detaches the old courier package", async () => {
  const ctx = setup("pickup_failed", "failed");
  await ctx.service.scheduleReversePickup(
    "return-a",
    { mode: "manual_ship_back" },
    actor,
  );
  assert.equal(ctx.doc.status, "manual_ship_back");
  assert.equal(ctx.doc.reverseShipment.shipmentId, undefined);
  assert.equal(
    ctx.doc.reverseShipment.metadata.previousShipmentId,
    "reverse-a",
  );
  assert.equal(
    await ctx.service.syncReverseShipmentForTracking(
      shipment("delivered"),
      actor,
    ),
    null,
  );
});

test("courier receipt preserves an existing partial warehouse count and zero-approved lines", () => {
  const req = request("received", {
    receivedAt: "2026-11-16T13:00:00Z",
    items: [
      { quantity: 3, approvedQuantity: 3, receivedQuantity: 1 },
      { quantity: 1, approvedQuantity: 1, receivedQuantity: 0 },
    ],
  });
  const result = projectReverseReturn(req, shipment("delivered"));
  assert.deepEqual(
    result.items.map((item) => item.receivedQuantity),
    [1, 0],
  );
  const unapproved = projectReverseReturn(
    request("reverse_pickup_scheduled", {
      items: [{ quantity: 1, approvedQuantity: 0, receivedQuantity: 0 }],
    }),
    shipment("delivered"),
  );
  assert.equal(unapproved.items[0].receivedQuantity, 0);
});


test("reverse pickup keeps pickup date and warehouse ETA separate", async () => {
  const ctx = setup("approved", "initiated", { reverseShipment: {} });
  const pickup = new Date(Date.now() + 86400000).toISOString();
  const arrival = new Date(Date.now() + 172800000).toISOString();
  let created;
  ctx.service.orderRepository.findByIdWithItems = async () => ({});
  ctx.service.deliveryRepository.createShipment = async (payload) => {
    created = payload;
    return shipment("initiated", { expected_delivery_at: payload.expectedDeliveryAt });
  };
  await ctx.service.scheduleReversePickup("return-a", {
    courierName: "Courier", trackingNumber: "AWB-1",
    pickupScheduledAt: pickup, expectedDeliveryAt: arrival,
  }, actor);
  assert.equal(created.expectedDeliveryAt, arrival);
  assert.equal(ctx.doc.reverseShipment.pickupScheduledAt, pickup);
  assert.equal(ctx.doc.status, "reverse_pickup_scheduled");
});

test("warehouse ETA before pickup is rejected before booking", async () => {
  const ctx = setup("approved", "initiated", { reverseShipment: {} });
  await assert.rejects(ctx.service.scheduleReversePickup("return-a", {
    courierName: "Courier", trackingNumber: "AWB-1",
    pickupScheduledAt: new Date(Date.now() + 172800000).toISOString(),
    expectedDeliveryAt: new Date(Date.now() + 86400000).toISOString(),
  }, actor), /after pickup/);
  assert.equal(ctx.doc.status, "approved");
});

test("replacement customer ETA is saved independently of the reverse shipment", async () => {
  const ctx = setup("replacement_created", "delivered", {
    replacementOrderId: "replacement-order", replacement: { status: "created" },
  });
  const arrival = new Date(Date.now() + 172800000).toISOString();
  let created;
  ctx.service.deliveryRepository.createShipment = async (payload) => {
    created = payload;
    return { id: "replacement-shipment" };
  };
  await ctx.service.createReplacement("return-a", {
    action: "ship", courierName: "Courier", trackingNumber: "REPLACE-1", expectedDeliveryAt: arrival,
  }, actor);
  assert.equal(created.expectedDeliveryAt, arrival);
  assert.equal(created.direction, "forward");
  assert.equal(created.orderId, "replacement-order");
  assert.equal(ctx.doc.reverseShipment.shipmentId, "reverse-a");
  assert.equal(ctx.doc.replacement.shipmentId, "replacement-shipment");
});


test("forward and replacement transit retain overdue ETA relative to the original handover", async () => {
  for (const shipmentType of ["forward", "replacement"]) {
    const ctx = setup();
    const forward = shipment("picked_up", {
      direction: "forward", return_id: null, shipment_type: shipmentType,
      shipped_at: "2020-01-01T10:00:00Z", expected_delivery_at: "2020-01-03T10:00:00Z",
      courier_name: "Courier", tracking_number: "AWB-1",
    });
    let writes = 0;
    ctx.delivery.deliveryRepository.findShipmentById = async () => forward;
    ctx.delivery.deliveryRepository.updateShipmentFulfillmentSnapshot = async () => {};
    ctx.delivery.deliveryRepository.addTrackingEvent = async (id, payload) => {
      writes++;
      assert.equal(payload.expectedDeliveryAt, "2020-01-03T10:00:00.000Z");
      return { shipment: { ...forward, status: payload.status } };
    };
    ctx.delivery.orderRepository.findByIdWithItems = async () => ({});
    ctx.delivery.getForwardFulfillmentItems = async () => [];
    ctx.delivery.assertHasFulfillableQuantity = () => {};
    await ctx.delivery.addTrackingEvent("reverse-a", {
      status: "in_transit", shippedAt: new Date().toISOString(),
    }, actor);
    assert.equal(writes, 1);
  }
});

test("booking a replacement return pickup does not create the replacement before QC", async () => {
  const ctx = setup("approved", "initiated", { reverseShipment: {}, resolution: "replacement" });
  let replacements = 0;
  ctx.service.createReplacement = async () => { replacements++; };
  ctx.service.orderRepository.findByIdWithItems = async () => ({});
  ctx.service.deliveryRepository.createShipment = async () => shipment("initiated");
  await ctx.service.scheduleReversePickup("return-a", { courierName: "Courier", trackingNumber: "AWB-1" }, actor);
  assert.equal(replacements, 0);
  assert.equal(ctx.doc.status, "reverse_pickup_scheduled");
});

function qcFixture(extra = {}) {
  const ctx = setup("received", "delivered", {
    resolution: "replacement", refund: {}, replacement: {}, ...extra,
  });
  ctx.service.getReturnOrThrow = async () => ctx.doc;
  ctx.doc.items[0].toObject = () => ({ orderItemId: "item-a" });
  ctx.service.inventoryService = { restockForReturn: async () => {} };
  ctx.service.maybeAutoProcessRefund = async doc => doc;
  return ctx;
}

test("accepted QC requests replacement approval and cannot claim delivery", async () => {
  const ctx = qcFixture();
  await ctx.service.qcReturn("return-a", { passed: true }, actor);
  assert.equal(ctx.doc.status, "replacement_requested");
  assert.equal(ctx.doc.replacement.status, "requested");
  await assert.rejects(ctx.service.createReplacement("return-a", { action: "complete" }, actor), /delivery must be confirmed/);
});

test("QC resumes legacy pre-created orders without trusting inferred delivery", async () => {
  const ctx = qcFixture({ replacement: { orderId: "replacement-order", status: "delivered", deliveredAt: new Date() } });
  await ctx.service.qcReturn("return-a", { passed: true }, actor);
  assert.equal(ctx.doc.status, "replacement_created");
  assert.equal(ctx.doc.replacement.orderId, "replacement-order");
  assert.equal(ctx.doc.replacement.deliveredAt, undefined);
});

test("QC resumes linked replacement shipments; only confirmed delivery enables explicit completion", async () => {
  for (const [status, next] of [["in_transit", "replacement_shipped"], ["delivered", "replacement_delivered"]]) {
    const ctx = qcFixture({ replacement: { orderId: "replacement-order", shipmentId: "replacement-package" } });
    ctx.service.deliveryRepository.findShipmentById = async () => shipment(status, {
      id: "replacement-package", order_id: "replacement-order", shipment_type: "replacement", direction: "forward",
    });
    await ctx.service.qcReturn("return-a", { passed: true }, actor);
    assert.equal(ctx.doc.status, next);
    assert.notEqual(ctx.doc.status, "replaced");
    if (status === "delivered") {
      await ctx.service.createReplacement("return-a", { action: "complete" }, actor);
      assert.equal(ctx.doc.status, "replaced");
    }
  }
});


test("policy matrix governs refund, replacement, non-returnable and legacy requests", () => {
  const ctx = setup();
  for (const [policy, expected] of [
    [{ resolution: "refund" }, ["refund"]],
    [{ resolution: "replacement" }, ["replacement"]],
    [{ resolution: "refund_or_replacement" }, ["refund", "replacement"]],
    [{ type: "replacement_only" }, ["replacement"]],
    [{ returnable: false }, []],
    [{ type: "non_returnable" }, []],
    [{}, ["refund", "replacement"]],
  ]) {
    assert.deepEqual(Array.from(ctx.service.getAllowedReturnResolutions(policy)), expected);
  }
  assert.deepEqual(Array.from(ctx.service.getReturnAllowedResolutions({ items: [
    { policySnapshot: { resolution: "refund" } },
    { policySnapshot: { resolution: "refund_or_replacement" } },
  ] })), ["refund"]);
});

test("refund-only products reject replacement requests before order creation", async () => {
  const ctx = setup("qc_passed", "delivered", { policySnapshot: { allowedResolutions: ["refund"] } });
  await assert.rejects(ctx.service.createReplacement("return-a", { action: "request" }, actor), /policy does not allow/);
  assert.equal(ctx.doc.status, "qc_passed");
});

test("replacement-only products reject a new refund before payment lookup", async () => {
  const ctx = setup("qc_passed", "delivered", { policySnapshot: { allowedResolutions: ["replacement"] } });
  await assert.rejects(ctx.service.processRefund("return-a", actor), /policy does not allow/);
  assert.equal(ctx.doc.status, "qc_passed");
});

test("customer requests cannot select a resolution outside purchased policy", async () => {
  const ctx = setup();
  ctx.service.orderRepository.findByIdWithItems = async () => ({
    buyer_id: "buyer-a", items: [{ id: "item-a", product_id: "product-a", delivered_at: new Date() }],
  });
  ctx.service.resolveReturnPolicy = async () => ({ allowedResolutions: ["refund"] });
  await assert.rejects(ctx.service.requestReturn("order-a", "buyer-a", [
    { orderItemId: "item-a", productId: "product-a", quantity: 1 },
  ], "defective", "", actor, { resolution: "replacement" }), /not allowed/);
});

for (const action of ["request", "approve"]) {
  test(`replacement ${action} preserves the customer's refund choice even when policy allows both`, async () => {
    const ctx = setup(action === "request" ? "qc_passed" : "replacement_requested", "delivered", {
      resolution: "refund",
      policySnapshot: { allowedResolutions: ["refund", "replacement"] },
      replacement: {},
    });
    await assert.rejects(ctx.service.createReplacement("return-a", { action }, actor), /customer selected a refund/);
    assert.equal(ctx.doc.resolution, "refund");
    assert.equal(ctx.doc.saves, 0);
  });
}

for (const resolution of ["replacement", "exchange"]) {
  test(`customer-selected ${resolution} remains available after accepted QC`, async () => {
    const ctx = setup("qc_passed", "delivered", { resolution, replacement: {} });
    await ctx.service.createReplacement("return-a", { action: "request" }, actor);
    assert.equal(ctx.doc.status, "replacement_requested");
    assert.equal(ctx.doc.resolution, "replacement");
  });
}

const doorstepPayload = (extra = {}) => ({
  inspectionMode: "doorstep", collectionConfirmed: false,
  items: [{ orderItemId: "item-a", quantity: 1, acceptedQuantity: 1, result: "sellable",
    checks: { identity: "pass", serialNumber: "pass", accessories: "pass", packaging: "not_applicable", condition: "pass" },
    notes: "Identity and condition checked against purchased policy", photos: ["https://example.com/inspection.jpg"] }],
  ...extra,
});
function doorstepSetup(status = "reverse_pickup_scheduled", extra = {}) {
  const ctx = setup(status, "initiated", {
    resolution: "refund", reason: "defective", collectionQc: { required: true, status: "pending", visitStartedAt: "2026-11-26T06:00:00Z" },
    refundAmount: 100, refund: { approvedAmount: 100 },
    ...extra,
  });
  Object.assign(ctx.doc.items[0], { eligibleRefundAmount: 200, refundAmount: 100, requestedQuantity: 2, receivedQuantity: 0 });
  ctx.service.maybeAutoProcessRefund = async doc => doc;
  ctx.service.inventoryService = {
    restockForReturn: async () => { throw new Error("Unexpected restock before warehouse receipt"); },
    recordReturnDamage: async () => { throw new Error("Unexpected damage booking before warehouse receipt"); },
  };
  return ctx;
}

test("doorstep passing QC without collection never unlocks a refund or warehouse inventory", async () => {
  const ctx = doorstepSetup();
  await ctx.service.qcReturn("return-a", doorstepPayload(), actor);
  assert.equal(ctx.doc.collectionQc.status, "passed");
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
  assert.equal(ctx.doc.status, "reverse_pickup_scheduled");
  assert.equal(ctx.doc.items[0].receivedQuantity, 0);
  await assert.rejects(ctx.service.processRefund("return-a", actor), /after accepted QC/);
});

test("doorstep collection unlocks only the accepted refund and preserves separate warehouse receipt", async () => {
  const ctx = doorstepSetup();
  let refundTrigger = 0;
  ctx.service.maybeAutoProcessRefund = async doc => { refundTrigger++; return doc; };
  await ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true }), actor);
  assert.equal(ctx.doc.status, "qc_passed");
  assert.equal(ctx.doc.refund.approvedAmount, 100);
  assert.equal(ctx.doc.items[0].collectedQuantity, 1);
  assert.equal(ctx.doc.items[0].receivedQuantity, 0);
  assert.equal(refundTrigger, 1);
  await assert.rejects(ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true }), actor), /already confirmed/);
});

test("failed doorstep QC leaves the item with the customer and offers review", async () => {
  const ctx = doorstepSetup();
  const payload = doorstepPayload();
  Object.assign(payload.items[0], { acceptedQuantity: 0, result: "rejected" });
  payload.items[0].checks.condition = "fail";
  await ctx.service.qcReturn("return-a", payload, actor);
  assert.equal(ctx.doc.status, "qc_failed");
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
  assert.equal(ctx.doc.qcReview.location, "customer");
  assert.equal(ctx.doc.items[0].qcResult, "rejected");
});

for (const field of ["identity", "serialNumber", "accessories", "packaging", "condition"]) {
  test(`doorstep QC requires the ${field} check before any mutation`, async () => {
    const ctx = doorstepSetup();
    const payload = doorstepPayload(); delete payload.items[0].checks[field];
    await assert.rejects(ctx.service.qcReturn("return-a", payload, actor), /Complete all doorstep checks/);
    assert.equal(ctx.doc.saves, 0);
  });
}
for (const change of [
  item => { item.photos = []; }, item => { item.notes = ""; },
  item => { item.quantity = 2; }, item => { item.acceptedQuantity = -1; },
  item => { item.acceptedQuantity = 2; }, item => { item.checks.identity = "fail"; },
  item => { item.result = "rejected"; },
]) {
  test("invalid doorstep evidence or quantity never changes collection state", async () => {
    const ctx = doorstepSetup(); const payload = doorstepPayload(); change(payload.items[0]);
    await assert.rejects(ctx.service.qcReturn("return-a", payload, actor));
    assert.equal(ctx.doc.saves, 0);
    assert.equal(ctx.doc.collectionQc.status, "pending");
  });
}

test("failed QC cannot be submitted as a successful collection", async () => {
  const ctx = doorstepSetup(); const payload = doorstepPayload({ collectionConfirmed: true });
  Object.assign(payload.items[0], { acceptedQuantity: 0, result: "rejected" });
  payload.items[0].checks.condition = "fail";
  await assert.rejects(ctx.service.qcReturn("return-a", payload, actor), /remain with the customer/);
});

test("courier return tracking cannot bypass doorstep inspection through either endpoint", async () => {
  for (const status of ["picked_up", "in_transit", "delivered"]) {
    const ctx = doorstepSetup();
    await assert.rejects(ctx.service.updateReverseShipment("return-a", { status }, actor), /doorstep QC/);
    await assert.rejects(ctx.delivery.addTrackingEvent("reverse-a", { status, note: "courier update" }, actor), /doorstep QC/);
    assert.equal(ctx.writes(), 0);
  }
});

test("warehouse QC cannot bypass doorstep collection", async () => {
  const ctx = doorstepSetup("received");
  await assert.rejects(ctx.service.qcReturn("return-a", { passed: true }, actor), /Use doorstep inspection/);
});

test("doorstep rejection review allows reinspection without automatic refund or stock changes", async () => {
  const ctx = doorstepSetup("qc_failed");
  ctx.doc.qcReview = { location: "customer" };
  await ctx.service.decideQcFailure("return-a", { decision: "override", reason: "Inspect again" }, actor);
  assert.equal(ctx.doc.status, "pickup_failed");
  assert.equal(ctx.doc.collectionQc.status, "reinspection_required");
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
});

test("upheld doorstep rejection never asks to ship an uncollected item back to the customer", async () => {
  const ctx = doorstepSetup("qc_failed");
  let released = 0; ctx.service.releaseReturnItemPayoutHolds = async () => { released++; };
  await ctx.service.decideQcFailure("return-a", { decision: "uphold", reason: "Policy mismatch" }, actor);
  assert.equal(ctx.doc.status, "qc_failure_upheld");
  assert.equal(ctx.doc.returnToCustomer.required, false);
  assert.equal(ctx.doc.refund.approvedAmount, 0);
  assert.equal(released, 1);
});

test("doorstep exchange requires replacement availability and a linked package before collecting", async () => {
  const ctx = doorstepSetup("reverse_pickup_scheduled", { resolution: "replacement" });
  await assert.rejects(ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true }), actor), /physically available/);
  await assert.rejects(ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true, replacementReady: true }), actor), /Prepare and dispatch/);
  assert.equal(ctx.doc.saves, 0);
});

test("doorstep exchange records collection before a separate explicit handover", async () => {
  const ctx = doorstepSetup("reverse_pickup_scheduled", { resolution: "replacement", replacementOrderId: "replacement-a", replacement: { shipmentId: "forward-a", status: "shipped" } });
  const find = ctx.service.deliveryRepository.findShipmentById;
  ctx.service.deliveryRepository.findShipmentById = async id => id === "forward-a"
    ? { id, direction: "forward", shipment_type: "replacement", order_id: "replacement-a", return_id: "return-a", status: "out_for_delivery" }
    : find(id);
  await ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true, replacementReady: true }), actor);
  assert.equal(ctx.doc.status, "replacement_shipped");
  assert.ok(ctx.doc.collectionQc.collectedAt);
  assert.equal(ctx.doc.replacement.deliveredAt, undefined);
  await assert.rejects(ctx.service.createReplacement("return-a", { action: "deliver" }, actor), /physically handed/);
  await ctx.service.createReplacement("return-a", { action: "deliver", handoverConfirmed: true }, actor);
  assert.equal(ctx.doc.status, "replacement_delivered");
  await ctx.service.createReplacement("return-a", { action: "complete" }, actor);
  assert.equal(ctx.doc.status, "replaced");
});

test("warehouse receipt restocks only collected units once, without reopening refunds", async () => {
  const ctx = doorstepSetup();
  await ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true }), actor);
  ctx.doc.status = "refunded";
  let quantity = 0;
  ctx.service.inventoryService.restockForReturn = async (doc, actor, items) => { quantity += items.reduce((sum, item) => sum + item.quantity, 0); };
  const received = shipment("delivered");
  await ctx.service.syncReverseShipmentForTracking(received, actor);
  await ctx.service.syncReverseShipmentForTracking(received, actor);
  assert.equal(ctx.doc.status, "refunded");
  assert.equal(quantity, 1);
  assert.equal(ctx.doc.items[0].receivedQuantity, 1);
});

test("partial doorstep refund uses accepted units and leaves rejected units uncollected", async () => {
  const ctx = doorstepSetup();
  ctx.doc.items[0].approvedQuantity = 2;
  const payload = doorstepPayload({ collectionConfirmed: true }); payload.items[0].quantity = 2;
  await ctx.service.qcReturn("return-a", payload, actor);
  assert.equal(ctx.doc.status, "qc_completed");
  assert.equal(ctx.doc.items[0].collectedQuantity, 1);
  assert.equal(ctx.doc.refund.approvedAmount, 100);
});

test("partial exchange pauses for review without collecting or handing over any unit", async () => {
  const ctx = doorstepSetup("reverse_pickup_scheduled", { resolution: "replacement" });
  ctx.doc.items[0].approvedQuantity = 2;
  const payload = doorstepPayload(); payload.items[0].quantity = 2;
  await ctx.service.qcReturn("return-a", payload, actor);
  assert.equal(ctx.doc.status, "qc_failed");
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
});

test("doorstep replacement preparation reserves approved stock before QC, without inventing collection", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", replacement: {}, reverseShipment: {} });
  let reservations = 0;
  ctx.service.inventoryService.reserveForOrder = async (id, buyerId, items) => { reservations++; assert.equal(items[0].quantity, 1); };
  ctx.service.orderRepository.findByIdWithItems = async () => ({ order_number: "ORD-TEST", items: [{ id: "item-a", product_id: "product-a", seller_id: "seller-a" }] });
  ctx.service.orderRepository.createOrder = async payload => {
    assert.equal(payload.payableAmount, 0);
    assert.equal(payload.items[0].quantity, 1);
    return { orderNumber: payload.orderNumber };
  };
  await ctx.service.createReplacement("return-a", { action: "approve", advanceExchange: true }, actor);
  assert.equal(ctx.doc.status, "approved");
  assert.equal(ctx.doc.replacementOrderId, "replacement-new");
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
  await ctx.service.createReplacement("return-a", { action: "approve", advanceExchange: true }, actor);
  assert.equal(reservations, 1);
});

test("replacement reservation failure never creates an order or changes the return", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", replacement: {}, reverseShipment: {} });
  ctx.service.orderRepository.findByIdWithItems = async () => ({ items: [{ id: "item-a" }] });
  ctx.service.inventoryService.reserveForOrder = async () => { throw new Error("Out of stock"); };
  ctx.service.orderRepository.createOrder = async () => { throw new Error("Must not create an order"); };
  await assert.rejects(ctx.service.createReplacement("return-a", { action: "approve", advanceExchange: true }, actor), /Out of stock/);
  assert.equal(ctx.doc.saves, 0);
  assert.equal(ctx.doc.replacementOrderId, undefined);
});

test("dispatching a doorstep replacement preserves reverse pickup status", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", replacementOrderId: "replacement-a", replacement: {}, reverseShipment: {} });
  ctx.service.deliveryRepository.createShipment = async payload => {
    assert.equal(payload.returnId, "return-a"); assert.equal(payload.direction, "forward"); return { id: "forward-a" };
  };
  await ctx.service.createReplacement("return-a", { action: "ship", courierName: "Courier", trackingNumber: "AWB-A" }, actor);
  assert.equal(ctx.doc.status, "approved");
  assert.equal(ctx.doc.replacementShipmentId, "forward-a");
  assert.equal(ctx.doc.replacement.status, "shipped");
});

test("generic replacement delivery cannot bypass collection even when QC passed", async () => {
  const ctx = doorstepSetup("reverse_pickup_scheduled", { replacementShipmentId: "forward-a", replacementOrderId: "replacement-a" });
  ctx.doc.collectionQc.status = "passed";
  ctx.delivery.deliveryRepository.findShipmentById = async () => ({
    id: "forward-a", shipment_type: "replacement", direction: "forward", return_id: "return-a", order_id: "replacement-a", status: "out_for_delivery",
  });
  await assert.rejects(ctx.delivery.addTrackingEvent("forward-a", { status: "delivered" }, actor), /collect the old item/);
  assert.equal(ctx.writes(), 0);
});

test("doorstep workflow cannot close after collection while handover is unresolved", async () => {
  const ctx = doorstepSetup("replacement_shipped", { resolution: "replacement" });
  ctx.doc.collectionQc.collectedAt = new Date().toISOString();
  await assert.rejects(ctx.service.closeReturn("return-a", { reason: "Close" }, actor), /Resolve the collected/);
});

test("manual ship-back is preserved and cannot silently discard a dispatched exchange", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", replacementShipmentId: "forward-a", reverseShipment: {} });
  await assert.rejects(ctx.service.scheduleReversePickup("return-a", { mode: "manual_ship_back" }, actor), /Recover the dispatched/);
  assert.equal(ctx.doc.saves, 0);
});

test("damage reported in a defective return can pass condition eligibility", async () => {
  const ctx = doorstepSetup(); const payload = doorstepPayload({ collectionConfirmed: true });
  payload.items[0].result = "damaged";
  await ctx.service.qcReturn("return-a", payload, actor);
  assert.equal(ctx.doc.status, "qc_passed");
  assert.equal(ctx.doc.items[0].qcResult, "damaged");
  assert.equal(ctx.doc.items[0].receivedQuantity, 0);
});

test("new damage on a change-of-mind return cannot be accepted as reported damage", async () => {
  const ctx = doorstepSetup("reverse_pickup_scheduled", { reason: "changed_mind" });
  const payload = doorstepPayload({ collectionConfirmed: true }); payload.items[0].result = "damaged";
  await assert.rejects(ctx.service.qcReturn("return-a", payload, actor), /Unreported damage/);
  assert.equal(ctx.doc.saves, 0);
});

test("doorstep preparation uses the established cross-process order lock", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", replacementOrderId: "replacement-a", replacement: { orderId: "replacement-a" }, reverseShipment: {} });
  let locks = 0;
  ctx.service.orderRepository.withCheckoutLocks = async (keys, callback) => {
    locks++; assert.deepEqual(Array.from(keys), ["doorstep-replacement:return-a"]); return callback();
  };
  await ctx.service.createReplacement("return-a", { action: "approve", advanceExchange: true }, actor);
  assert.equal(locks, 1);
});


test("closing an unused replacement delegates stock cleanup to the established cancellation flow", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", reverseShipment: {}, replacementOrderId: "replacement-a", replacement: { status: "created" } });
  await ctx.service.closeReturn("return-a", { reason: "Exchange cancelled before visit" }, actor);
  assert.equal(ctx.cancellationCalls[0].orderId, "replacement-a");
  assert.equal(ctx.cancellationCalls[0].payload.source, undefined);
  assert.equal(ctx.doc.replacement.status, "cancelled");
  assert.equal(ctx.doc.status, "closed");
});

test("an RTO replacement uses the existing RTO settlement path during closure", async () => {
  const ctx = doorstepSetup("qc_failure_upheld", { resolution: "replacement", reverseShipment: {}, replacementOrderId: "replacement-a", replacementShipmentId: "forward-a", replacement: { status: "shipped" }, returnToCustomer: { required: false } });
  ctx.service.deliveryRepository.findShipmentById = async () => ({ id: "forward-a", status: "rto", seller_id: "seller-a", organization_id: "org-a" });
  await ctx.service.closeReturn("return-a", { reason: "Rejected exchange returned to origin" }, actor);
  assert.equal(ctx.cancellationCalls[0].payload.source, "shipment_rto");
  assert.equal(ctx.cancellationCalls[0].payload.shipmentId, "forward-a");
  assert.equal(ctx.cancellationCalls[0].payload.sellerId, "seller-a");
  assert.equal(ctx.doc.status, "closed");
});

test("one exchange action prepares, dispatches and schedules the same-visit exchange", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", reverseShipment: {}, replacement: {} });
  const calls = [];
  ctx.service.applyReplacementAction = async (id, payload) => {
    calls.push(payload.action);
    if (payload.action === "approve") ctx.doc.replacementOrderId = "replacement-a";
    if (payload.action === "ship") { ctx.doc.replacementShipmentId = "forward-a"; ctx.doc.replacement.trackingNumber = payload.trackingNumber; }
    return ctx.doc;
  };
  ctx.service.scheduleReversePickup = async (id, payload) => {
    calls.push("schedule"); assert.equal(payload.mode, "reverse_pickup");
    assert.equal(payload.trackingNumber, "OLD-AWB"); ctx.doc.status = "reverse_pickup_scheduled"; return ctx.doc;
  };
  await ctx.service.arrangeDoorstepExchange(ctx.doc, { courierName: "Courier", pickupTrackingNumber: "OLD-AWB", replacementTrackingNumber: "NEW-AWB" }, actor);
  assert.deepEqual(calls, ["approve", "ship", "schedule"]);
  assert.equal(ctx.doc.replacement.trackingNumber, "NEW-AWB");
});

test("interrupted exchange scheduling resumes without preparing or dispatching again", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", reverseShipment: {}, replacement: {} });
  const calls = [];
  ctx.service.applyReplacementAction = async (id, payload) => {
    calls.push(payload.action);
    if (payload.action === "approve") ctx.doc.replacementOrderId = "replacement-a";
    if (payload.action === "ship") {
      ctx.doc.replacementShipmentId = "forward-a";
      ctx.doc.replacement.trackingNumber = payload.trackingNumber;
    }
  };
  ctx.service.deliveryRepository.findShipmentById = async () => ({ id: "forward-a", status: "initiated" });
  ctx.service.scheduleReversePickup = async () => { calls.push("schedule_failed"); throw new Error("Courier temporarily unavailable"); };
  const payload = { courierName: "Courier", pickupTrackingNumber: "OLD-AWB", replacementTrackingNumber: "NEW-AWB" };
  await assert.rejects(ctx.service.arrangeDoorstepExchange(ctx.doc, payload, actor), /temporarily unavailable/);
  ctx.service.scheduleReversePickup = async () => { calls.push("schedule"); ctx.doc.status = "reverse_pickup_scheduled"; };
  await ctx.service.arrangeDoorstepExchange(ctx.doc, { courierName: "Courier", pickupTrackingNumber: "OLD-AWB" }, actor);
  assert.deepEqual(calls, ["approve", "ship", "schedule_failed", "schedule"]);
});

test("exchange arrangement rejects refund-only returns", async () => {
  const ctx = doorstepSetup("approved", { resolution: "refund", reverseShipment: {} });
  await assert.rejects(ctx.service.arrangeDoorstepExchange(ctx.doc, {}, actor), /only for doorstep replacement/);
  assert.equal(ctx.doc.saves, 0);
});


test("initiated booking alone never authorizes doorstep QC", async () => {
  const ctx = doorstepSetup(); delete ctx.doc.collectionQc.visitStartedAt;
  await assert.rejects(ctx.service.qcReturn("return-a", doorstepPayload(), actor), /courier has arrived/);
  assert.equal(ctx.doc.saves, 0);
});

test("recording actual courier arrival unlocks inspection without claiming collection", async () => {
  const ctx = doorstepSetup(); delete ctx.doc.collectionQc.visitStartedAt;
  await assert.rejects(ctx.service.startCollectionVisit("return-a", { courierAtDoorstep: false }, actor), /physically/);
  await ctx.service.startCollectionVisit("return-a", { courierAtDoorstep: true }, actor);
  assert.ok(ctx.doc.collectionQc.visitStartedAt);
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
  assert.equal(ctx.doc.reverseShipment.status, "initiated");
  await ctx.service.qcReturn("return-a", doorstepPayload(), actor);
  assert.equal(ctx.doc.collectionQc.status, "passed");
});

test("a failed visit must be rescheduled before a new doorstep inspection", async () => {
  const ctx = doorstepSetup("pickup_failed");
  ctx.service.deliveryRepository.findShipmentById = async () => shipment("failed");
  await assert.rejects(ctx.service.qcReturn("return-a", doorstepPayload(), actor), /courier has arrived/);
  await assert.rejects(ctx.service.startCollectionVisit("return-a", { courierAtDoorstep: true }, actor), /scheduled/);
});

test("customer inspection detail allows only the owner without administrator module access", async () => {
  const ctx = doorstepSetup(); ctx.doc.buyerId = "buyer-a";
  ctx.service.getReturnById = async id => ({ id, buyerId: "buyer-a" });
  const detail = await ctx.service.getBuyerReturnById("return-a", { userId: "buyer-a", role: "customer" });
  assert.equal(detail.buyerId, "buyer-a");
  await assert.rejects(ctx.service.getBuyerReturnById("return-a", { userId: "another-buyer", role: "customer" }), /only your own/);
});

test("retrying pickup preserves inspection history but requires new arrival and QC evidence", async () => {
  const ctx = setup("pickup_failed", "failed", {
    collectionQc: { required: true, status: "reinspection_required", visitStartedAt: "2026-11-25T10:00:00Z", inspectedAt: "2026-11-25T10:05:00Z", items: [{ orderItemId: "item-a", notes: "Previous inspection", photos: ["old-photo"] }] },
  });
  ctx.service.orderRepository.findByIdWithItems = async () => ({});
  ctx.service.deliveryRepository.createShipment = async payload => {
    assert.equal(payload.metadata.previousShipmentId, "reverse-a");
    return shipment("initiated", { id: "retry-a", courier_name: payload.courierName, tracking_number: payload.trackingNumber });
  };
  await ctx.service.scheduleReversePickup("return-a", { courierName: "Express Metro", trackingNumber: "NEW-111111" }, actor);
  assert.equal(ctx.doc.status, "reverse_pickup_scheduled");
  assert.equal(ctx.doc.collectionQc.visitStartedAt, undefined);
  assert.equal(ctx.doc.collectionQc.inspectedAt, undefined);
  assert.equal(ctx.doc.collectionQc.items, undefined);
  assert.equal(ctx.doc.collectionQc.history[0].items[0].notes, "Previous inspection");
  assert.equal(ctx.doc.reverseShipment.shipmentId, "retry-a");
  assert.equal(ctx.doc.reverseShipment.trackingNumber, "NEW-111111");
});

test("collection confirmation reuses saved QC without repeating or changing the inspection", async () => {
  const ctx = doorstepSetup();
  await ctx.service.qcReturn("return-a", doorstepPayload(), actor);
  const inspectedAt = ctx.doc.collectionQc.inspectedAt;
  const inspectedBy = ctx.doc.collectionQc.inspectedBy;
  await ctx.service.qcReturn("return-a", {
    inspectionMode: "doorstep", confirmCollectionOnly: true, collectionConfirmed: true,
    items: [{ orderItemId: "item-a", acceptedQuantity: 999, result: "rejected" }],
  }, actor);
  assert.equal(ctx.doc.collectionQc.inspectedAt, inspectedAt);
  assert.equal(ctx.doc.collectionQc.inspectedBy, inspectedBy);
  assert.equal(ctx.doc.items[0].collectedQuantity, 1);
  assert.equal(ctx.doc.status, "qc_passed");
});

test("collection-only confirmation is blocked before inspection is saved", async () => {
  const ctx = doorstepSetup();
  await assert.rejects(ctx.service.qcReturn("return-a", { inspectionMode: "doorstep", confirmCollectionOnly: true, collectionConfirmed: true }, actor), /Save an eligible inspection/);
  assert.equal(ctx.doc.saves, 0);
});

test('doorstep refund collection and warehouse receipt reuse the original pickup parcel', async () => {
  const ctx = doorstepSetup();
  const originalId = ctx.doc.reverseShipment.shipmentId;
  let creations = 0;
  ctx.service.deliveryRepository.createShipment = async () => { creations++; throw new Error('No second shipment should be created'); };
  await ctx.service.qcReturn('return-a', doorstepPayload({ collectionConfirmed: true }), actor);
  assert.equal(ctx.doc.status, 'qc_passed');
  assert.equal(ctx.doc.reverseShipment.shipmentId, originalId);
  await assert.rejects(ctx.service.scheduleReversePickup('return-a', {}, actor), /already|only be arranged/);
  ctx.service.inventoryService.restockForReturn = async () => {};
  await ctx.service.syncReverseShipmentForTracking(shipment('delivered'), actor);
  assert.equal(ctx.doc.reverseShipment.shipmentId, originalId);
  assert.equal(ctx.doc.status, 'qc_passed');
  assert.ok(ctx.doc.collectionQc.warehouseReceivedAt);
  assert.equal(creations, 0);
});

test('zero accepted units cannot contradict all passing doorstep checks', async () => {
  const ctx = doorstepSetup();
  const payload = doorstepPayload();
  Object.assign(payload.items[0], { acceptedQuantity: 0, result: 'rejected' });
  await assert.rejects(ctx.service.qcReturn('return-a', payload, actor), /Zero accepted units require a failed/);
  assert.equal(ctx.doc.saves, 0);
});
test('zero accepted units with failed checks require a rejection decision', async () => {
  const ctx = doorstepSetup();
  const payload = doorstepPayload();
  payload.items[0].acceptedQuantity = 0;
  payload.items[0].checks.condition = 'fail';
  await assert.rejects(ctx.service.qcReturn('return-a', payload, actor), /rejected or missing/);
  assert.equal(ctx.doc.saves, 0);
});

test('collection cannot be undone by pickup failure or another pickup event', async () => {
  const ctx = doorstepSetup();
  await ctx.service.qcReturn('return-a', doorstepPayload({ collectionConfirmed: true }), actor);
  for (const status of ['failed', 'pickup_failed', 'picked_up', 'initiated', 'cancelled']) {
    await assert.rejects(ctx.service.updateReverseShipment('return-a', { status }, actor), /already been collected/);
    assert.equal(ctx.doc.status, 'qc_passed');
    assert.ok(ctx.doc.collectionQc.collectedAt);
  }
});

test('refund collection automatically completes seller responsibility without inventing warehouse receipt', async () => {
  const ctx = doorstepSetup();
  await ctx.service.qcReturn('return-a', doorstepPayload({ collectionConfirmed: true }), actor);
  assert.ok(ctx.doc.collectionQc.sellerResponsibilityCompletedAt);
  assert.equal(ctx.doc.reverseShipment.metadata.completionReason, 'doorstep_collection_seller_responsibility');
  assert.equal(ctx.doc.items[0].receivedQuantity, 0);
  assert.equal(ctx.doc.collectionQc.warehouseReceivedAt, undefined);
  assert.equal(ctx.doc.status, 'qc_passed');
});

test("one exchange reference is applied to both linked movements", async () => {
  const ctx = doorstepSetup("approved", { resolution: "replacement", replacement: {}, reverseShipment: {} });
  const references = [];
  ctx.service.applyReplacementAction = async (id, payload) => {
    if (payload.action === "approve") ctx.doc.replacementOrderId = "replacement-a";
    if (payload.action === "ship") { references.push(payload.trackingNumber); ctx.doc.replacementShipmentId = "forward-a"; }
  };
  ctx.service.scheduleReversePickup = async (id, payload) => { references.push(payload.trackingNumber); ctx.doc.status = "reverse_pickup_scheduled"; };
  await ctx.service.arrangeDoorstepExchange(ctx.doc, { courierName: "Seller delivery", exchangeReference: "EXCHANGE-123" }, actor);
  assert.deepEqual(references, ["EXCHANGE-123", "EXCHANGE-123"]);
  assert.equal(ctx.doc.collectionQc.sameVisitExchange, true);
});
function sameVisitFixture() {
  const ctx = doorstepSetup("reverse_pickup_scheduled", { resolution: "replacement", replacementOrderId: "replacement-a", replacementShipmentId: "forward-a", replacement: { shipmentId: "forward-a", status: "shipped" } });
  ctx.doc.collectionQc.sameVisitExchange = true;
  ctx.service.deliveryRepository.findShipmentById = async () => shipment("out_for_delivery", { id: "forward-a", direction: "forward", shipment_type: "replacement", order_id: "replacement-a" });
  return ctx;
}
test("same-visit exchange cannot collect without replacement inspection and customer acceptance", async () => {
  const ctx = sameVisitFixture();
  await assert.rejects(ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true, replacementReady: true }), actor), /replacement inspection/);
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
});
test("one confirmation records collection and replacement delivery and marks replaced", async () => {
  const ctx = sameVisitFixture();
  await ctx.service.qcReturn("return-a", doorstepPayload({ collectionConfirmed: true, replacementReady: true,
    exchangeCompleted: true, replacementInspected: true, customerAccepted: true, handoverConfirmed: true }), actor);
  assert.equal(ctx.doc.status, "replaced");
  assert.ok(ctx.doc.collectionQc.collectedAt);
  assert.ok(ctx.doc.collectionQc.exchangeCompletedAt);
  assert.equal(ctx.doc.replacement.status, "completed");
  assert.equal(ctx.doc.items[0].receivedQuantity, 0);
  assert.equal(ctx.doc.collectionQc.sellerResponsibilityCompletedAt, undefined);
});
test("failed exchange leaves the old item uncollected and permits rescheduling", async () => {
  const ctx = sameVisitFixture();
  await ctx.service.createReplacement("return-a", { action: "exchange_failure", note: "Replacement damaged; customer refused" }, actor);
  assert.equal(ctx.doc.status, "pickup_failed");
  assert.equal(ctx.doc.collectionQc.collectedAt, undefined);
  assert.equal(ctx.doc.replacement.status, "shipped");
  assert.equal(ctx.doc.collectionQc.exchangeFailure.reason, "Replacement damaged; customer refused");
});

test('interrupted same-visit completion can resume without collecting or inspecting twice', async () => {
  const ctx = sameVisitFixture();
  const original = ctx.service.applyReplacementAction.bind(ctx.service);
  let failed = false;
  ctx.service.applyReplacementAction = async (...args) => { if (!failed) { failed = true; throw new Error('Delivery update unavailable'); } return original(...args); };
  await assert.rejects(ctx.service.qcReturn('return-a', doorstepPayload({ collectionConfirmed: true, replacementReady: true,
    exchangeCompleted: true, replacementInspected: true, customerAccepted: true, handoverConfirmed: true }), actor), /unavailable/);
  const collected = ctx.doc.collectionQc.collectedAt;
  await ctx.service.qcReturn('return-a', { exchangeCompleted: true, inspectionMode: 'doorstep' }, actor);
  assert.equal(ctx.doc.status, 'replaced');
  assert.equal(ctx.doc.collectionQc.collectedAt, collected);
});

test('exchange shipment presentation shares one state without claiming warehouse receipt', () => {
  const { DeliveryService } = load('src/modules/delivery/services/delivery.service.js', {});
  const delivery = Object.create(DeliveryService.prototype);
  const ctx = sameVisitFixture();
  ctx.doc.collectionQc.sameVisitExchange = true;
  let result = delivery.shipmentReturnWorkflow(ctx.doc);
  assert.equal(result.sameVisitExchange, true);
  assert.equal(result.collected, false);
  ctx.doc.status = 'replaced';
  ctx.doc.collectionQc.collectedAt = 'now';
  ctx.doc.collectionQc.exchangeCompletedAt = 'now';
  result = delivery.shipmentReturnWorkflow(ctx.doc);
  assert.equal(result.exchangeCompletedAt, 'now');
  assert.equal(result.collected, true);
  assert.equal(ctx.doc.collectionQc.warehouseReceivedAt, undefined);
});
test('completed exchange blocks manual reverse transit edits', async () => {
  const ctx = sameVisitFixture();
  ctx.doc.collectionQc.collectedAt = 'now';
  ctx.doc.collectionQc.exchangeCompletedAt = 'now';
  ctx.doc.status = 'replaced';
  await assert.rejects(ctx.service.updateReverseShipment('return-a', { status: 'in_transit' }, actor), /exchange is complete/);
});

test('a failed exchange stays failed when a stale courier booking is projected', async () => {
  const ctx = sameVisitFixture();
  await ctx.service.createReplacement('return-a', { action: 'exchange_failure', note: 'Customer declined replacement' }, actor);
  const projected = projectReverseReturn(ctx.doc.toObject(), shipment('initiated'));
  assert.equal(projected.status, 'pickup_failed');
  assert.equal(projected.collectionQc.exchangeFailure.reason, 'Customer declined replacement');
  assert.equal(projected.collectionQc.collectedAt, undefined);
});
