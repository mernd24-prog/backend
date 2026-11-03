const CLOSED_RETURN_STATUSES = [
  "rejected", "refunded", "replaced", "closed", "qc_failure_upheld",
];

function coinOrderContext(order, returns = [], coinStatus, now = new Date()) {
  const activeReturn = returns.find((entry) => !CLOSED_RETURN_STATUSES.includes(entry.status));
  const latestReturn = activeReturn || returns[0];
  const disputeStatus = latestReturn?.qcReview?.status || null;
  const disputed = activeReturn && ["customer_disputed", "admin_review", "evidence_requested"].includes(disputeStatus);
  const returnWindowEndsAt = order?.return_eligible_until || null;
  const eligibleAt = returnWindowEndsAt || order?.fulfillment_eligible_at || null;
  const locked = ["pending", "locked"].includes(coinStatus);
  let lockReason = null;
  if (locked) {
    if (!order) lockReason = "order_details_unavailable";
    else if (["cancelled", "payment_failed", "returned", "refunded"].includes(order.status)) lockReason = "awaiting_reversal";
    else if (disputed) lockReason = "return_dispute_open";
    else if (activeReturn) lockReason = "return_in_progress";
    else if (!["delivered", "fulfilled"].includes(order.status)) lockReason = "awaiting_order_fulfillment";
    else if (!["captured", "paid"].includes(order.payment_status)) lockReason = "payment_not_settled";
    else if (eligibleAt && new Date(eligibleAt) > now) lockReason = "return_window_open";
    else if (order.status === "delivered") lockReason = "awaiting_order_finalization";
    else lockReason = "awaiting_coin_release";
  }
  const messages = {
    order_details_unavailable: "Order details are unavailable.",
    awaiting_reversal: "The order was cancelled or refunded; coin reversal is pending.",
    return_dispute_open: "Coins are locked until the return dispute is resolved.",
    return_in_progress: "Coins are locked while the return is being processed.",
    awaiting_order_fulfillment: "Coins are locked until the order is delivered and its return window ends.",
    awaiting_order_finalization: "The order is delivered; coins are locked until order fulfillment is finalized.",
    payment_not_settled: "Coins are locked until payment is fully settled.",
    return_window_open: "Coins are locked until the return window ends.",
    awaiting_coin_release: "Order conditions are met; coin release is pending.",
  };
  return {
    orderStatus: order?.status || null,
    paymentStatus: order?.payment_status || null,
    returnStatus: latestReturn?.status || null,
    disputeStatus,
    returnWindowEndsAt,
    fulfillmentEligibleAt: order?.fulfillment_eligible_at || null,
    expectedReleaseDate: locked && ["return_window_open", "awaiting_coin_release"].includes(lockReason) ? eligibleAt : null,
    lockReason,
    lockReasonMessage: messages[lockReason] || null,
  };
}

module.exports = { coinOrderContext };
