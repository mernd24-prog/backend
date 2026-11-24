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
