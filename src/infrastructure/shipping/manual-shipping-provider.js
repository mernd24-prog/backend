"use strict";

class ManualShippingProvider {
  constructor({ name = "manual" } = {}) {
    this.name = name;
  }

  async rate(payload = {}) {
    return {
      provider: this.name,
      serviceLevel: payload.shippingMode || "standard",
      amount: Number(payload.amount || 0),
      currency: payload.currency || "INR",
      estimatedDeliveryDays: payload.estimatedDeliveryDays || null,
      metadata: { manual: true },
    };
  }

  async createShipment(payload = {}) {
    return {
      provider: this.name,
      awbNumber: payload.awbNumber || null,
      trackingNumber: payload.trackingNumber || payload.awbNumber || null,
      labelData: payload.labelData || {},
      metadata: { manual: true },
    };
  }

  async cancelShipment(payload = {}) {
    return {
      provider: this.name,
      shipmentId: payload.shipmentId,
      cancelled: true,
      metadata: { manual: true },
    };
  }

  async track(payload = {}) {
    return {
      provider: this.name,
      trackingNumber: payload.trackingNumber || payload.awbNumber || null,
      status: payload.status || "initiated",
      metadata: { manual: true },
    };
  }
}

module.exports = { ManualShippingProvider };
