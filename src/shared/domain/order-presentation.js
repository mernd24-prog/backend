const {
  itemDeliveryProgress,
  forwardDeliveryProgress,
  shipmentMatchesItem,
  isForwardShipment,
} = require("./order-fulfillment");
const key = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const json = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};
const protectedStatuses = [
  "pending_payment",
  "payment_failed",
  "cancelled",
  "on_hold",
  "fulfilled",
  "return_requested",
  "return_approved",
  "partially_returned",
  "returned",
  "refunded",
];
const preHandover = ["confirmed", "processing", "packed", "ready_to_ship"];
function itemLifecycleStatus(item, order) {
  const matches = (entry) => {
    const id = entry.orderItemId || entry.order_item_id;
    if (id) return String(id) === String(item.id || item._id || "");
    const product = entry.productId || entry.product_id;
    if (
      !product ||
      String(product) !== String(item.product_id || item.productId || "")
    )
      return false;
    return (
      String(
        entry.variantSku ||
          entry.variant_sku ||
          entry.variantId ||
          entry.variant_id ||
          "",
      ) ===
      String(
        item.variant_sku ||
          item.variantSku ||
          item.variant_id ||
          item.variantId ||
          "",
      )
    );
  };
  const cancellation = (order.relations?.cancellations || []).find((entry) =>
    (entry.items || []).some(matches),
  );
  if (
    cancellation &&
    !["rejected", "failed", "completed"].includes(cancellation.status)
  ) {
    if (
      ["pending", "provider_pending", "manual_review"].includes(
        cancellation.refund_status,
      ) ||
      ["refund_pending", "manual_review"].includes(cancellation.status)
    )
      return "refund_pending";
    return `cancellation_${cancellation.status}`;
  }
  const request = (order.relations?.returns || []).find((entry) =>
    (entry.items || []).some(matches),
  );
  if (
    request &&
    !["rejected", "qc_failure_upheld", "replaced"].includes(request.status)
  ) {
    if (request.refund?.status === "completed" || request.status === "refunded")
      return "refunded";
    if (request.status === "partially_refunded") return "partially_refunded";
    if (
      ["pending", "provider_pending", "manual_review"].includes(
        request.refund?.status,
      )
    )
      return "refund_pending";
    if (request.refund?.status === "failed") return "refund_failed";
    if (request.status === "requested") return "return_requested";
    if (request.status === "approved") return "return_approved";
    if (request.status !== "closed") return request.status;
  }
  return key(item.return_status || item.returnStatus);
}
function itemOrderStatus(item = {}, order = {}) {
  const shipments = order.relations?.shipments || [];
  const progress = itemDeliveryProgress(item, shipments);
  if (progress.status === "cancelled") return "cancelled";
  const lifecycle = itemLifecycleStatus(item, order);
  if (lifecycle) return lifecycle;
  const stored = key(order.status || order.order_status);
  if (
    ["pending_payment", "payment_failed", "cancelled", "on_hold"].includes(
      stored,
    )
  )
    return stored;
  if (
    [
      "delivered",
      "partially_delivered",
      "shipment_cancelled",
      "failed",
      "rto",
      "lost",
      "damaged",
      "out_for_delivery",
    ].includes(progress.status)
  )
    return progress.status;
  if (["in_transit", "picked_up"].includes(progress.status)) return "shipped";
  if (progress.status === "manifested") return "ready_to_ship";
  if (progress.status === "initiated") {
    // Automatic label creation is not packing evidence. Explicit packing is
    // recorded by the order-status or manual shipment workflow.
    const stages = shipments
      .filter(
        (shipment) =>
          shipment.status !== "cancelled" &&
          shipmentMatchesItem(shipment, item),
      )
      .map((shipment) => {
        const metadata = json(shipment.metadata);
        return (
          metadata.orderStatus ||
          (metadata.source === "order_auto_shipment" ? "confirmed" : null)
        );
      })
      .filter((stage) => preHandover.includes(stage));
    if (stages.length)
      return stages.sort(
        (a, b) => preHandover.indexOf(a) - preHandover.indexOf(b),
      )[0];
    const local = key(
      item.order_status || item.status || item.effective_status,
    );
    if (preHandover.includes(local)) return local;
    return preHandover.includes(stored) ? stored : "confirmed";
  }
  if (Number(item.cancelled_quantity || item.cancelledQuantity || 0) > 0)
    return "partially_cancelled";
  if (item.delivered_at || item.deliveredAt) return "delivered";
  return (
    key(item.effective_status || item.status || item.order_status || stored) ||
    "pending"
  );
}
function orderPresentation(order = {}) {
  const stored = key(order.status || order.order_status);
  const rows = Array.isArray(order.items) ? order.items : [];
  const items = rows.map((item) => ({
    ...item,
    effective_status: itemOrderStatus(item, order),
  }));
  const statuses = items.map((item) => item.effective_status);
  const active = statuses.filter((status) => status !== "cancelled");
  let displayStatus = stored;
  if (!protectedStatuses.includes(stored) && items.length) {
    if (!active.length) displayStatus = "cancelled";
    else if (active.every((status) => status === "delivered"))
      displayStatus = "delivered";
    else if (
      active.some((status) =>
        ["delivered", "partially_delivered"].includes(status),
      )
    )
      displayStatus = "partially_delivered";
    else if (
      statuses.includes("cancelled") ||
      statuses.includes("partially_cancelled")
    )
      displayStatus = "partially_cancelled";
    else if (active.every((status) => status === active[0]))
      displayStatus = active[0];
    else if (active.includes("out_for_delivery"))
      displayStatus = "out_for_delivery";
    else if (active.includes("shipped")) displayStatus = "shipped";
    else if (active.every((status) => preHandover.includes(status)))
      displayStatus = active
        .slice()
        .sort((a, b) => preHandover.indexOf(a) - preHandover.indexOf(b))[0];
  }
  if (
    ["delivered", "fulfilled", "shipped", "out_for_delivery"].includes(
      stored,
    ) &&
    (order.relations?.returns || []).some(
      (entry) =>
        ![
          "rejected",
          "qc_failure_upheld",
          "replaced",
          "refunded",
          "closed",
        ].includes(entry.status),
    )
  ) {
    displayStatus = "return_requested";
  }
  const forward = (order.relations?.shipments || []).filter(isForwardShipment);
  const delivery = forwardDeliveryProgress(rows, forward);
  const shipmentStatus =
    delivery.aggregateDeliveryStatus ||
    (forward.length ? forward[0].status : "not_created");
  return {
    display_status: displayStatus,
    shipment_status: shipmentStatus,
    shipmentStatus,
    items,
  };
}
module.exports = { itemOrderStatus, orderPresentation };
