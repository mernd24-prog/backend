const { PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const {
  getRazorpayClient,
  verifyRazorpaySignature,
} = require("../razorpay-client");
const { AppError } = require("../../../shared/errors/app-error");
const { env } = require("../../../config/env");

class RazorpayProvider {
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
    const order = await client.orders.create({
      amount: Math.round(Number(payload.amount) * 100),
      currency: payload.currency || "INR",
      receipt: payload.receipt,
      notes: payload.notes || {},
    });

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
