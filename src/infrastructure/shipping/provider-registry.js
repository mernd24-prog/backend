"use strict";

const { ManualShippingProvider } = require("./manual-shipping-provider");

class ShippingProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.register("manual", new ManualShippingProvider());
  }

  register(name, provider) {
    this.providers.set(String(name || "").toLowerCase(), provider);
  }

  get(name = "manual") {
    return this.providers.get(String(name || "manual").toLowerCase()) || this.providers.get("manual");
  }
}

const shippingProviderRegistry = new ShippingProviderRegistry();

module.exports = { shippingProviderRegistry, ShippingProviderRegistry };
