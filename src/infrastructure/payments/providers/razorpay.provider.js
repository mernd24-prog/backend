const { PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const {
  getRazorpayClient,
  verifyRazorpaySignature,
} = require("../razorpay-client");
const { AppError } = require("../../../shared/errors/app-error");
const { env } = require("../../../config/env");

class RazorpayProvider {
  normalizeProviderError(error, operation) {
    if (error?.statusCode && error?.error) {
      return new AppError(error.error.description || `Razorpay ${operation} failed`, error.statusCode >= 500 ? 503 : 400);
    }
    return new AppError(
      `Razorpay ${operation} could not be confirmed. Please check the transaction status before retrying.`,
      503,
      { operation, retrySafe: false },
      "PAYMENT_PROVIDER_UNCERTAIN",
    );
  }
  createMockOrder(payload) {
    const amount = Number(payload.amount || 0);
    const amountInPaise = Math.round(amount * 100);
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const providerOrderId = `rzp_mock_order_${suffix}`;
    const providerPaymentId = `rzp_mock_payment_${suffix}`;

    return {
      providerOrderId,
      providerPaymentId,
      amount,
      currency: payload.currency || "INR",
      metadata: {
        provider: "razorpay",
        mode: "mock",
        mock: true,
        receipt: payload.receipt,
        notes: payload.notes || {},
      },
      checkout: {
        provider: "razorpay",
        mode: "mock",
        mock: true,
        keyId: env.razorpay.configured ? env.razorpay.keyId : "rzp_mock_key",
        amount: amountInPaise,
        currency: payload.currency || "INR",
        orderId: providerOrderId,
        paymentId: providerPaymentId,
      },
      autoCapture: env.razorpay.mockAutoCapture,
    };
  }

  async createOrder(payload) {
    if (env.razorpay.mock) {
      return this.createMockOrder(payload);
    }

    if (!env.razorpay.live) {
      throw new AppError("Razorpay is disabled. Please select another payment method.", 503);
    }

    const client = getRazorpayClient();
    let order;
    try {
      order = await client.orders.create({
        amount: Math.round(Number(payload.amount) * 100),
        currency: payload.currency || "INR",
        receipt: payload.receipt,
        notes: payload.notes || {},
      });
    } catch (error) {
      throw this.normalizeProviderError(error, "order creation");
    }

    return {
      providerOrderId: order.id,
      amount: Number(order.amount) / 100,
      currency: order.currency,
      metadata: order,
      checkout: {
        keyId: env.razorpay.keyId,
        amount: order.amount,
        currency: order.currency,
        orderId: order.id,
      },
    };
  }

  async createRefund(payload) {
    const { providerPaymentId, amount, notes = {}, returnId } = payload;
    if (!providerPaymentId) {
      throw new AppError("Provider payment ID is required to initiate refund", 400);
    }

    if (env.razorpay.mock || !env.razorpay.live || String(providerPaymentId).startsWith("rzp_mock")) {
      const mockRefundId = `rfnd_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        refundId: mockRefundId,
        amount: Number(amount || 0),
        status: "processed",
        mock: true,
        metadata: { provider: "razorpay", mode: "mock", returnId },
      };
    }

    const client = getRazorpayClient();
    const refundBody = { speed: "normal", notes: { ...notes, returnId: String(returnId || "") } };
    if (amount) refundBody.amount = Math.round(Number(amount) * 100);

    let refund;
    try {
      refund = await client.payments.refund(providerPaymentId, refundBody);
    } catch (error) {
      throw this.normalizeProviderError(error, "refund");
    }

    return {
      refundId: refund.id,
      amount: Number(refund.amount) / 100,
      status: refund.status,
      mock: false,
      metadata: refund,
    };
  }

  async fetchRefund(refundId) {
    if (!refundId) {
      throw new AppError("Provider refund ID is required", 400);
    }
    if (env.razorpay.mock || !env.razorpay.live || String(refundId).startsWith("rfnd_mock")) {
      return {
        refundId,
        status: "processed",
        mock: true,
        metadata: { provider: "razorpay", mode: "mock" },
      };
    }

    const client = getRazorpayClient();
    let refund;
    try {
      refund = await client.refunds.fetch(refundId);
    } catch (error) {
      throw this.normalizeProviderError(error, "refund lookup");
    }
    return {
      refundId: refund.id,
      amount: Number(refund.amount || 0) / 100,
      status: refund.status,
      failureReason: refund.error_description || refund.error_reason || null,
      mock: false,
      metadata: refund,
    };
  }

  async verifyPayment(payload) {
    if (env.razorpay.mock) {
      return {
        status: PAYMENT_STATUS.CAPTURED,
        providerPaymentId: payload.razorpayPaymentId,
        providerOrderId: payload.razorpayOrderId,
        verificationMethod: "mock_signature",
        metadata: {
          mock: true,
          razorpaySignature: payload.razorpaySignature,
        },
      };
    }

    const isValid = verifyRazorpaySignature({
      orderId: payload.razorpayOrderId,
      paymentId: payload.razorpayPaymentId,
      signature: payload.razorpaySignature,
    });

    if (!isValid) {
      throw new AppError("Invalid Razorpay payment signature", 401);
    }

    return {
      status: PAYMENT_STATUS.CAPTURED,
      providerPaymentId: payload.razorpayPaymentId,
      providerOrderId: payload.razorpayOrderId,
      verificationMethod: "signature",
      metadata: {
        razorpaySignature: payload.razorpaySignature,
      },
    };
  }
}

module.exports = { RazorpayProvider };
