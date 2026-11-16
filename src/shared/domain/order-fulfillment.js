const json = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};
const groupKey = (item = {}) =>
  `${item.seller_id || item.sellerId || "platform"}:${item.organization_id || item.organizationId || json(item.metadata).organizationId || "default"}`;
const isForwardShipment = (shipment = {}) =>
  String(shipment.direction || "forward").toLowerCase() !== "reverse" &&
  !["return", "reverse", "rto"].includes(
    String(
      shipment.shipment_type || shipment.shipmentType || "forward",
    ).toLowerCase(),
  );
const manifestLines = (shipment) => {
  const metadata = json(shipment.metadata);
  const snapshot = json(shipment.package_snapshot || shipment.packageSnapshot);
  return Array.isArray(metadata.fulfillmentItems) &&
    metadata.fulfillmentItems.length
    ? metadata.fulfillmentItems
    : Array.isArray(snapshot.items)
      ? snapshot.items
      : [];
};
function shipmentMatchesItem(shipment, item) {
  if (!isForwardShipment(shipment) || groupKey(shipment) !== groupKey(item))
    return false;
  const id = String(item.id || item._id || "");
  const lines = manifestLines(shipment);
  if (lines.length)
    return lines.some(
      (line) =>
        String(line.orderItemId || line.order_item_id || "") === id &&
        Number(line.quantity || 0) > 0,
    );
  const metadata = json(shipment.metadata);
  const ids =
    [
      shipment.orderItemIds,
      shipment.order_item_ids,
      metadata.orderItemIds,
    ].find((value) => Array.isArray(value) && value.length) || [];
  return !ids.length || ids.map(String).includes(id);
}
function itemDeliveryProgress(item, shipments = []) {
  const quantity = Math.max(
    Number(item.quantity || 0) -
      Number(item.cancelled_quantity || item.cancelledQuantity || 0),
    0,
  );
  const matching = shipments.filter((shipment) =>
    shipmentMatchesItem(shipment, item),
  );
  const active = matching.filter((shipment) => shipment.status !== "cancelled");
  const explicit = active.filter((shipment) => manifestLines(shipment).length);
  const deliveredQuantity = explicit.reduce(
    (sum, shipment) =>
      shipment.status !== "delivered"
        ? sum
        : sum +
          manifestLines(shipment)
            .filter(
              (line) =>
                String(line.orderItemId || line.order_item_id || "") ===
                String(item.id || item._id || ""),
            )
            .reduce(
              (count, line) => count + Math.max(Number(line.quantity || 0), 0),
              0,
            ),
    0,
  );
  // Legacy shipments without a manifest cover the group only when all its active
  // packages are delivered. An explicit partial manifest never implies a full unit count.
  const complete =
    quantity > 0 &&
    active.length > 0 &&
    (explicit.length === active.length
      ? deliveredQuantity >= quantity
      : active.every((shipment) => shipment.status === "delivered") &&
        (!explicit.length || deliveredQuantity >= quantity));
  const statuses = active.map((shipment) => shipment.status);
  let status =
    quantity === 0
      ? "cancelled"
      : complete
        ? "delivered"
        : statuses.includes("delivered")
          ? "partially_delivered"
          : [
              "failed",
              "rto",
              "lost",
              "damaged",
              "out_for_delivery",
              "in_transit",
              "picked_up",
              "manifested",
              "initiated",
            ].find((candidate) => statuses.includes(candidate));
  if (!status && matching.length && !active.length)
    status = "shipment_cancelled";
  return {
    itemId: String(item.id || item._id || ""),
    quantity,
    deliveredQuantity: complete
      ? quantity
      : Math.min(deliveredQuantity, quantity),
    status: status || null,
  };
}
function forwardDeliveryProgress(items = [], shipments = []) {
  const itemProgress = items.map((item) =>
    itemDeliveryProgress(item, shipments),
  );
  const active = itemProgress.filter((item) => item.quantity > 0);
  const allDelivered =
    active.length > 0 && active.every((item) => item.status === "delivered");
  const someDelivered = active.some((item) =>
    ["delivered", "partially_delivered"].includes(item.status),
  );
  const statuses = active.map((item) => item.status);
  const aggregateDeliveryStatus = allDelivered
    ? "delivered"
    : someDelivered
      ? "partially_delivered"
      : [
          "failed",
          "rto",
          "lost",
          "damaged",
          "out_for_delivery",
          "in_transit",
          "picked_up",
          "manifested",
          "initiated",
        ].find((status) => statuses.includes(status)) ||
        (active.length &&
        statuses.every((status) => status === "shipment_cancelled")
          ? "cancelled"
          : null);
  return { allDelivered, aggregateDeliveryStatus, items: itemProgress };
}
const FORWARD_ORDER_STATUSES = [
  "confirmed",
  "processing",
  "packed",
  "ready_to_ship",
  "shipped",
  "out_for_delivery",
  "failed_delivery",
];
module.exports = {
  groupKey,
  isForwardShipment,
  manifestLines,
  shipmentMatchesItem,
  itemDeliveryProgress,
  forwardDeliveryProgress,
  FORWARD_ORDER_STATUSES,
};
