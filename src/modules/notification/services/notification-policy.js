const { DOMAIN_EVENTS: E } = require('../../../contracts/events/domain-events');

// Internal milestones do not require a separate user notification.
const suppressed = new Set([E.SHIPMENT_CREATED_V1, E.INVOICE_GENERATED_V1]);
const statusOf = payload => String(payload.status || payload.orderStatus || payload.shipmentStatus || '').toLowerCase().replace(/[ -]/g, '_');
function shouldNotify(eventName, payload = {}) {
  if (!eventName) return true; // Explicit admin campaigns and direct messages.
  if (suppressed.has(eventName)) return false;
  if (eventName === E.AUTH_USER_REGISTERED_V1) return false;
  if (eventName === E.SELLER_PAYOUT_STATUS_UPDATED_V1) return ["completed", "paid", "failed", "rejected", "cancelled"].includes(statusOf(payload));
  const status = statusOf(payload);
  if (eventName === E.SHIPMENT_TRACKING_UPDATED_V1) return status === 'out_for_delivery';
  if (eventName === E.ORDER_STATUS_UPDATED_V1) return ['confirmed', 'shipped', 'dispatched', 'out_for_delivery'].includes(status);
  if (eventName === E.RETURN_STATUS_UPDATED_V1) return ['pickup_scheduled', 'picked_up', 'pickup_failed'].includes(status);
  return true;
}
module.exports = { shouldNotify };

// Stable identities merge equivalent domain events; never use orderId alone for refunds.
function notificationIdentity(eventName, payload = {}, now = Date.now()) {
  const orderId = payload.orderId || payload.order_id;
  if (orderId && (eventName === E.ORDER_PAID_V1 || (eventName === E.ORDER_STATUS_UPDATED_V1 && statusOf(payload) === 'confirmed'))) return `order:${orderId}:confirmed`;
  const refundId = payload.refundId || payload.refund_id || payload.refundReference || payload.paymentReference || payload.referenceId;
  if ([E.RETURN_REFUNDED_V1, E.REFUND_PROCESSED_V1, E.PAYMENT_REFUNDED_V1].includes(eventName) && refundId) return `refund:${refundId}:processed`;
  if (eventName === E.SHIPMENT_DELIVERED_V1 && orderId) return `shipment:${payload.shipmentId || orderId}:delivered`;
  if ([E.ORDER_STATUS_UPDATED_V1, E.SHIPMENT_TRACKING_UPDATED_V1].includes(eventName) && statusOf(payload) === 'out_for_delivery' && orderId) return `shipment:${payload.shipmentId || orderId}:out_for_delivery`;
  if (eventName === E.INVENTORY_LOW_STOCK_V1) {
    const product = payload.variantId || payload.sku || payload.productId;
    if (product) return `low-stock:${product}:${Math.floor(now / (24 * 60 * 60 * 1000))}`;
  }
  if (eventName === E.SELLER_PAYOUT_STATUS_UPDATED_V1 && payload.payoutId) return `payout:${payload.payoutId}:${statusOf(payload)}`;
  return null;
}
module.exports.notificationIdentity = notificationIdentity;
