"use strict";

const { v4: uuidv4 } = require("uuid");
const { knex } = require("../../src/infrastructure/postgres/postgres-client");

const STATUS_TO_SHIPMENT_STATUS = {
  packed: "initiated",
  shipped: "in_transit",
  delivered: "delivered",
  fulfilled: "delivered",
};

function normalizeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function advanceShipmentStatus(currentStatus, requestedStatus) {
  if (!requestedStatus) return currentStatus || "initiated";
  if (!currentStatus) return requestedStatus;
  if (currentStatus === "delivered_verified") return currentStatus;
  const rank = new Map([
    ["initiated", 1],
    ["manifested", 2],
    ["picked_up", 3],
    ["in_transit", 4],
    ["out_for_delivery", 5],
    ["delivered", 6],
    ["delivered_verified", 7],
  ]);
  return (rank.get(requestedStatus) || 0) >= (rank.get(currentStatus) || 0)
    ? requestedStatus
    : currentStatus;
}

async function ensureShipment(trx, order, sellerId, sellerItems) {
  const requestedStatus = STATUS_TO_SHIPMENT_STATUS[order.status];
  if (!requestedStatus || !sellerId) return { created: 0, updated: 0 };

  const metadata = normalizeJson(order.metadata, {});
  const tracking = metadata.tracking || {};
  const fulfillment = sellerItems.reduce(
    (acc, item) => {
      const itemFulfillment = normalizeJson(item.fulfillment_snapshot, {});
      const deal = normalizeJson(item.deal_snapshot, {});
      if (!acc.dealId) acc.dealId = item.deal_id || itemFulfillment.dealId || deal.dealId || null;
      if (!acc.fulfillmentModel) acc.fulfillmentModel = itemFulfillment.fulfillmentModel || deal.fulfillmentModel || null;
      if (itemFulfillment.deliveryVerificationRequired || deal.deliveryVerificationRequired) {
        acc.verificationRequired = true;
      }
      const methods = itemFulfillment.deliveryVerificationMethods || deal.deliveryVerificationMethods || [];
      if (Array.isArray(methods)) acc.verificationMethods.push(...methods);
      return acc;
    },
    { dealId: null, fulfillmentModel: null, verificationRequired: false, verificationMethods: [] },
  );
  fulfillment.verificationMethods = Array.from(new Set(fulfillment.verificationMethods.filter(Boolean)));

  const [existing] = await trx("shipments")
    .where("order_id", order.id)
    .where("seller_id", String(sellerId))
    .where((builder) => builder.where("direction", "forward").orWhereNull("direction"))
    .orderBy("created_at", "desc")
    .limit(1)
    .forUpdate();

  const nextStatus = advanceShipmentStatus(existing?.status, requestedStatus);
  const now = new Date();
  const trackingNumber = tracking.trackingNumber || null;
  const courierName = tracking.carrierName || null;
  const shipmentMetadata = {
    source: "backfill_missing_order_shipments",
    orderStatus: order.status,
    ...(tracking.carrierUrl ? { carrierUrl: tracking.carrierUrl } : {}),
  };

  if (existing) {
    if (nextStatus === existing.status && (order.delivery_status || null) === nextStatus) {
      return { created: 0, updated: 0 };
    }

    const [updated] = await trx("shipments")
      .where("id", existing.id)
      .update({
        status: nextStatus,
        courier_name: courierName || existing.courier_name,
        awb_number: trackingNumber || existing.awb_number,
        tracking_number: trackingNumber || existing.tracking_number,
        metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify(shipmentMetadata)]),
        updated_at: knex.fn.now(),
      })
      .returning("*");

    if (updated && nextStatus !== existing.status) {
      await trx("shipment_tracking_events").insert({
        id: uuidv4(),
        shipment_id: existing.id,
        order_id: order.id,
        status: nextStatus,
        event_time: now,
        note: `Backfilled shipment status from order ${order.status}`,
        source: "backfill",
        raw_payload: shipmentMetadata,
        actor_id: "backfill",
        idempotency_key: `backfill:${order.id}:${sellerId}:${nextStatus}`,
      }).catch((error) => {
        if (!String(error?.message || "").includes("duplicate")) throw error;
      });
    }
    return { created: 0, updated: updated ? 1 : 0 };
  }

  const shipmentId = uuidv4();
  await trx("shipments").insert({
    id: shipmentId,
    order_id: order.id,
    seller_id: String(sellerId),
    provider: "manual",
    courier_name: courierName,
    awb_number: trackingNumber,
    tracking_number: trackingNumber,
    status: nextStatus,
    shipping_mode: "standard",
    cod: order.payment_provider === "cod",
    package_snapshot: {},
    pickup_address_snapshot: {},
    ship_to_snapshot: normalizeJson(order.shipping_address, {}),
    rate_snapshot: {},
    label_data: {},
    shipment_type: "forward",
    direction: "forward",
    deal_id: fulfillment.dealId,
    fulfillment_model: fulfillment.fulfillmentModel,
    verification_required: fulfillment.verificationRequired,
    verification_methods: fulfillment.verificationMethods,
    delivery_proof_snapshot: {},
    expected_delivery_at: null,
    idempotency_key: `backfill:${order.id}:${sellerId}`,
    metadata: shipmentMetadata,
    created_by: "backfill",
    updated_by: "backfill",
    created_at: now,
    updated_at: now,
  });

  await trx("shipment_tracking_events").insert({
    id: uuidv4(),
    shipment_id: shipmentId,
    order_id: order.id,
    status: nextStatus,
    event_time: now,
    note: `Backfilled shipment from order ${order.status}`,
    source: "backfill",
    raw_payload: shipmentMetadata,
    actor_id: "backfill",
    idempotency_key: `backfill:${order.id}:${sellerId}:${nextStatus}`,
  }).catch((error) => {
    if (!String(error?.message || "").includes("duplicate")) throw error;
  });

  return { created: 1, updated: 0 };
}

async function main() {
  const orders = await knex("orders")
    .whereIn("status", Object.keys(STATUS_TO_SHIPMENT_STATUS))
    .orderBy("created_at", "asc");

  let created = 0;
  let updated = 0;
  let deliveryStatusUpdated = 0;

  for (const order of orders) {
    await knex.transaction(async (trx) => {
      const items = await trx("order_items").where("order_id", order.id);
      const itemsBySeller = items.reduce((groups, item) => {
        const sellerId = String(item.seller_id || "");
        if (!sellerId) return groups;
        if (!groups.has(sellerId)) groups.set(sellerId, []);
        groups.get(sellerId).push(item);
        return groups;
      }, new Map());

      for (const [sellerId, sellerItems] of itemsBySeller.entries()) {
        const result = await ensureShipment(trx, order, sellerId, sellerItems);
        created += result.created;
        updated += result.updated;
      }

      const nextDeliveryStatus = order.delivery_status === "delivered_verified"
        ? order.delivery_status
        : STATUS_TO_SHIPMENT_STATUS[order.status];
      if (nextDeliveryStatus && order.delivery_status !== nextDeliveryStatus) {
        await trx("orders").where("id", order.id).update({
          delivery_status: nextDeliveryStatus,
          updated_at: knex.fn.now(),
        });
        deliveryStatusUpdated += 1;
      }
    });
  }

  console.log(JSON.stringify({ scannedOrders: orders.length, created, updated, deliveryStatusUpdated }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
