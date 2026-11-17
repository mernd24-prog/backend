const inventory = require("../templates/notification-use-cases.json");
const cases = new Map(inventory.cases.map(entry => [entry.id, entry]));
const statusOf = payload => String(payload.status || payload.verificationStatus || payload.approvalStatus || "").toLowerCase().replace(/[ -]/g, "_");
const returnCases = {
  reverse_pickup_scheduled: "N052", pickup_scheduled: "N052", picked_up: "N053",
  in_reverse_transit: "N053", pickup_failed: "N054", manual_ship_back: "N093",
  shipped_back: "N094", received: "N055", qc_passed: "N088", qc_completed: "N088",
  qc_failed: "N089", qc_failure_upheld: "N092", refund_pending: "N095",
  refunded: "N096", partially_refunded: "N097", refund_failed: "N098",
  replacement_requested: "N100", replacement_pending: "N101", replacement_created: "N102",
  replacement_shipped: "N103", replacement_delivered: "N104", replaced: "N105", closed: "N106",
};
const eventCases = {
  "order.created.v1": "N028", "order.paid.v1": "N030", "order.payment_failed.v1": "N031",
  "order.cancelled.v1": "N048", "return.requested.v1": "N049", "return.approved.v1": "N050",
  "return.rejected.v1": "N051", "return.received.v1": "N055", "return.refunded.v1": "N096",
  "refund.processed.v1": "N096", "payment.refunded.v1": "N096", "refund.failed.v1": "N098",
  "shipment.delivered.v1": "N043", "shipment.failed.v1": "N044", "shipment.rto.v1": "N045",
  "credit_note.generated.v1": "N066", "product.submitted.v1": "N019",
  "product.approved.v1": "N020", "product.rejected.v1": "N021",
  "deal.submitted.v1": "N023", "deal.approved.v1": "N024", "deal.rejected.v1": "N025", "deal.cancelled.v1": "N026",
  "support.reply_created.v1": "N069", "support.status_updated.v1": "N071",
  "warranty.registered.v1": "N072", "warranty.claimed.v1": "N073", "warranty.claim_status_updated.v1": "N074",
};

function resolveNotificationContent(eventName, payload = {}, recipientType = "buyer") {
  const status = statusOf(payload);
  let id = eventCases[eventName];
  if (eventName === "notification.use_case.v1" && cases.has(payload.notificationCaseId)) id = payload.notificationCaseId;
  if (eventName === "return.status_updated.v1") id = ({ customer_disputed: "N090", evidence_requested: "N091", admin_review: "N089" })[payload.qcReviewStatus] || returnCases[status];
  if (eventName === "shipment.tracking_updated.v1") id = status === "out_for_delivery" ? "N042" : null;
  if (eventName === "order.status_updated.v1") {
    id = ({ confirmed: "N029", shipped: "N040", dispatched: "N040", out_for_delivery: "N042" })[status];
    if (status === "confirmed" && !["cod", "cash_on_delivery"].includes(String(payload.paymentProvider || payload.payment_provider || "").toLowerCase())) id = "N030";
  }
  if (eventName === "kyc.status_updated.v1") {
    if (!["approved", "verified", "rejected"].includes(status)) return null;
    id = payload.sellerId || recipientType === "seller" ? "N015" : "N012";
  }
  if (eventName === "seller.payout_status_updated.v1") id = ({ paid: "N062", completed: "N062", failed: "N063", rejected: "N063", cancelled: "N063", reversed: "N107" })[status];
  if (/refund/.test(eventName)) {
    if (payload.refundStatus === "manual_review") id = "N099";
    else if (status === "partially_refunded") id = "N097";
  }
  if (eventName === "inventory.low_stock.v1") id = Number(payload.availableStock ?? payload.stock ?? 1) <= 0 ? "N058" : "N057";
  const entry = cases.get(id);
  if (!entry) return null;
  let title = entry.title;
  let message = entry.message;
  if (eventName === "kyc.status_updated.v1") {
    title = status === "rejected" ? "Verification not approved" : "Verification approved";
    message = status === "rejected" ? "Verification was not approved. Review the decision and requested corrections in your account." : "Verification was approved. Review the current account status for the next permitted step.";
  }
  if (id === "N074") {
    title = `Warranty claim ${status.replace(/_/g, " ")}`;
    message = "The warranty claim status changed. Review the recorded decision and next steps in claim details.";
  }
  // Operator copy must not imply that an order/refund belongs to the operator.
  if (["seller", "admin"].includes(recipientType)) message = message.replace(/\bYour\b/g, "The").replace(/\byour\b/g, "the");
  return { useCaseId: id, templateKey: entry.key, subject: title, title, message, ctaText: entry.ctaText };
}

// Each field has a single contextual meaning. A payout template never renders a
// refund amount, and coins never pass through INR currency formatting.
const specs = {
  order: [["Order", "orderNumber", "reference"], ["Order status", "status", "text"], ["Payment status", "paymentStatus", "text"], ["Payment method", "paymentProvider", "text"], ["Order total", "totalAmount", "money"]],
  returns: [["Return", "returnNumber", "reference"], ["Order", "orderNumber", "reference"], ["Return status", "status", "text"], ["Decision reason", "reason", "text"]],
  refund: [["Order", "orderNumber", "reference"], ["Return", "returnNumber", "reference"], ["Refund status", "refundStatus", "text"], ["Refund amount", "refundAmount", "money"], ["Total refunded to date", "refundTotalAmount", "money"], ["Approved refund", "approvedRefundAmount", "money"], ["Refund destination", "refundMethod", "text"], ["Refund reference", "refundReference", "reference"]],
  payout: [["Payout", "payoutNumber", "reference"], ["Payout status", "status", "text"], ["Payout amount", "payoutAmount", "money"], ["Transfer reference", "utr", "reference"], ["Reason", "reason", "text"]],
  support: [["Ticket", "queryNumber", "reference"], ["Ticket status", "status", "text"], ["Category", "category", "text"]],
  product: [["Product", "productName", "text"], ["SKU", "sku", "text"], ["Status", "status", "text"], ["Reason", "reason", "text"]],
  account: [["Action", "purpose", "text"], ["Account status", "status", "text"], ["Reason", "reason", "text"]],
  referral: [["Order", "orderNumber", "reference"], ["Reward status", "status", "text"], ["Referral coins", "coinAmount", "coins"], ["Reason", "reason", "text"]],
  shipment: [["Order", "orderNumber", "reference"], ["Shipment status", "status", "text"], ["Tracking number", "trackingNumber", "reference"], ["Carrier", "carrierName", "text"]],
  warranty: [["Warranty reference", "warrantyNumber", "reference"], ["Claim reference", "claimNumber", "reference"], ["Status", "status", "text"], ["Decision reason", "reason", "text"]],
};
function detailGroup(entry) {
  const name = entry.name.toLowerCase();
  if (/refund/.test(name)) return "refund";
  if (/payout|withdrawal/.test(name)) return "payout";
  if (/warranty/.test(name)) return "warranty";
  if (/return|replacement|inspection|pickup/.test(name)) return "returns";
  if (/support|ticket|agent replied/.test(name)) return "support";
  if (/referral|reward|coins/.test(name)) return "referral";
  if (/product|stock|inventory|deal|pric/.test(name)) return "product";
  if (/shipment|delivery|dispatched|transit/.test(name)) return "shipment";
  if (/order|invoice|credit note|payment/.test(name)) return "order";
  return "account";
}
function normalizeNotificationPayload(eventName, payload = {}) {
  const normalized = { ...payload,
    orderNumber: payload.orderNumber ?? payload.order_number,
    returnNumber: payload.returnNumber ?? payload.return_number,
    payoutNumber: payload.payoutNumber ?? payload.payout_number,
    queryNumber: payload.queryNumber ?? payload.ticketNumber ?? payload.queryId,
    productName: payload.productName ?? payload.productTitle,
    reason: payload.rejectionReason ?? payload.reason,
    status: payload.status ?? payload.verificationStatus ?? payload.approvalStatus,
  };
  if (/refund/.test(eventName)) normalized.refundAmount = payload.refundAmount ?? payload.refund_amount ?? payload.amount;
  if (/payout/.test(eventName)) normalized.payoutAmount = payload.payoutAmount ?? payload.netAmount ?? payload.amount;
  if (/referral|reward/.test(eventName)) normalized.coinAmount = payload.coinAmount ?? payload.rewardCoins ?? payload.coins;
  return normalized;
}
function sellerNotificationPayload(payload = {}, sellerId) {
  const scoped = { ...payload, sellerId };
  if (Array.isArray(payload.items)) scoped.items = payload.items.filter(item => String(item.sellerId || item.seller_id || "") === String(sellerId));
  const exactSeller = String(payload.sellerId || payload.seller_id || "") === String(sellerId);
  for (const key of ["sellerEmail", "seller_email", "totalAmount", "total_amount", "grandTotal", "subtotal", "walletAmount", "discountAmount"]) {
    if (!exactSeller) delete scoped[key];
  }
  return scoped;
}
module.exports = { resolveNotificationContent, normalizeNotificationPayload, sellerNotificationPayload, statusOf, returnCases, specs, detailGroup };
