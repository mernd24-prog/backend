const { PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");

class ManualPaymentProvider {
  constructor(providerName) {
    this.providerName = providerName;
  }

  async createOrder(payload) {
    return {
      providerOrderId: payload.referenceId || `${this.providerName}_${Date.now()}`,
      amount: Number(payload.amount || 0),
      currency: payload.currency || "INR",
      metadata: {
        provider: this.providerName,
        manual: true,
        notes: payload.notes || {},
      },
      checkout: {
        provider: this.providerName,
        manual: true,
        instructions: "Submit payment reference for admin approval.",
      },
    };
  }

  async verifyPayment(payload) {
    return {
      status: PAYMENT_STATUS.INITIATED,
      providerPaymentId: payload.referenceId || null,
      providerOrderId: payload.providerOrderId || null,
      verificationMethod: "manual_pending",
      metadata: payload.metadata || {},
    };
  }
}

module.exports = { ManualPaymentProvider };
