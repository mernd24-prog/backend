function buildCashfreeCheckoutFromMetadata(payment = {}) {
  const metadata = payment.metadata || {};
  const response = metadata.response || {};
  const paymentSessionId =
    response.payment_session_id ||
    response.paymentSessionId ||
    metadata.payment_session_id ||
    metadata.paymentSessionId ||
    null;

  if (String(payment.provider || "").toLowerCase() !== "cashfree" || !paymentSessionId) {
    return null;
  }

  return {
    provider: "cashfree",
    paymentSessionId,
    orderToken: response.order_token || response.cftoken || null,
    orderId:
      payment.providerOrderId ||
      payment.provider_order_id ||
      response.order_id ||
      response.orderId ||
      null,
    amount: Number(payment.amount),
    currency: payment.currency || response.order_currency || "INR",
    mode: response.order_meta?.mode || metadata.mode || "sandbox",
  };
}

function mapPaymentResponse(payment) {
  return {
    id: payment.id,
    orderId: payment.orderId || payment.order_id,
    buyerId: payment.buyerId || payment.buyer_id,
    provider: payment.provider,
    status: payment.status,
    amount: Number(payment.amount),
    currency: payment.currency,
    transactionReference: payment.transactionReference || payment.transaction_reference,
    providerOrderId: payment.providerOrderId || payment.provider_order_id,
    providerPaymentId: payment.providerPaymentId || payment.provider_payment_id,
    verificationMethod: payment.verificationMethod || payment.verification_method,
    metadata: payment.metadata || {},
    verifiedAt: payment.verifiedAt || payment.verified_at || null,
    failedReason: payment.failedReason || payment.failed_reason || null,
    checkout: payment.checkout || buildCashfreeCheckoutFromMetadata(payment),
    createdAt: payment.createdAt || payment.created_at || null,
  };
}

module.exports = { mapPaymentResponse };
