const { AppError } = require("../errors/app-error");

const REVERSE_STATUS_MAP = {
  initiated: "reverse_pickup_scheduled",
  manifested: "reverse_pickup_scheduled",
  pickup_scheduled: "reverse_pickup_scheduled",
  failed: "pickup_failed",
  pickup_failed: "pickup_failed",
  picked_up: "in_reverse_transit",
  in_transit: "in_reverse_transit",
  out_for_delivery: "in_reverse_transit",
  delivered: "received",
  received: "received",
};
const LOGISTICS_STATES = [
  "approved",
  "reverse_pickup_scheduled",
  "pickup_failed",
  "manual_ship_back",
  "shipped_back",
  "in_reverse_transit",
];
const SCHEDULED = ["initiated", "manifested", "pickup_scheduled"];
const FAILED = ["failed", "pickup_failed"];
const TRANSIT = ["picked_up", "in_transit", "out_for_delivery"];
const RECEIVED = ["delivered", "received"];
const reverseShipment = (shipment) =>
  shipment?.direction === "reverse" && !!shipment.return_id;
const shipmentBelongsToReturn = (request, shipment) =>
  reverseShipment(shipment) &&
  String(shipment.return_id) === String(request._id || request.id) &&
  String(request.reverseShipment?.shipmentId || "") === String(shipment.id) &&
  String(request.orderId) === String(shipment.order_id);

function assertReverseTrackingTransition(current, next) {
  if (!REVERSE_STATUS_MAP[next])
    throw new AppError("Unsupported reverse shipment status", 400);
  if (current === next) return;
  let allowed = [];
  if (SCHEDULED.includes(current))
    allowed = [...SCHEDULED, ...TRANSIT, ...FAILED, ...RECEIVED];
  if (FAILED.includes(current))
    allowed = [...SCHEDULED, ...TRANSIT, ...RECEIVED];
  if (current === "picked_up")
    allowed = ["in_transit", "out_for_delivery", ...FAILED, ...RECEIVED];
  if (current === "in_transit")
    allowed = ["out_for_delivery", ...FAILED, ...RECEIVED];
  if (current === "out_for_delivery") allowed = [...FAILED, ...RECEIVED];
  if (!allowed.includes(next))
    throw new AppError(
      `Reverse shipment cannot move from '${current}' to '${next}'`,
      409,
    );
}

// A courier event may advance logistics, but must never reopen QC, refunds or a closed return.
function reverseReturnStatus(request, shipment) {
  if (
    !shipmentBelongsToReturn(request, shipment) ||
    !LOGISTICS_STATES.includes(request.status)
  )
    return request.status;
  const next = REVERSE_STATUS_MAP[shipment.status];
  if (!next) return request.status;
  if (
    next === "reverse_pickup_scheduled" &&
    ["in_reverse_transit", "shipped_back"].includes(request.status)
  )
    return request.status;
  return next;
}
function projectReverseReturn(request, shipment) {
  if (!shipmentBelongsToReturn(request, shipment)) return request;
  const status = reverseReturnStatus(request, shipment);
  const received = RECEIVED.includes(shipment.status);
  const receivedAt =
    shipment.delivered_at || request.receivedAt || shipment.updated_at;
  return {
    ...request,
    status,
    ...(received && receivedAt
      ? { receivedAt: request.receivedAt || receivedAt }
      : {}),
    items: (request.items || []).map((item) =>
      received && status === "received"
        ? {
            ...item,
            receivedQuantity: request.receivedAt
              ? (item.receivedQuantity ?? 0)
              : item.receivedQuantity > 0
                ? item.receivedQuantity
                : (item.approvedQuantity ??
                  item.requestedQuantity ??
                  item.quantity ??
                  0),
          }
        : item,
    ),
    reverseShipment: {
      ...request.reverseShipment,
      status: shipment.status,
      trackingNumber:
        shipment.tracking_number || request.reverseShipment?.trackingNumber,
      ...(shipment.shipped_at
        ? {
            pickedUpAt:
              request.reverseShipment?.pickedUpAt || shipment.shipped_at,
          }
        : {}),
      ...(received && receivedAt ? { deliveredToWarehouseAt: receivedAt } : {}),
    },
  };
}
module.exports = {
  REVERSE_STATUS_MAP,
  LOGISTICS_STATES,
  reverseShipment,
  shipmentBelongsToReturn,
  assertReverseTrackingTransition,
  reverseReturnStatus,
  projectReverseReturn,
};
