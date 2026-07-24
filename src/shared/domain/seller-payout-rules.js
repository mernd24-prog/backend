const applyShippingPolicy = (baseAmount, shippingAmount, policy) => {
  const base = Number(baseAmount || 0);
  const shipping = Number(shippingAmount || 0);
  if (policy === "reimburse_seller") return Math.max(0, base + shipping);
  if (policy === "deduct_from_seller") return Math.max(0, base - shipping);
  return Math.max(0, base);
};

const resolveShippingPolicy = (configuredPolicy, delivery = {}) => {
  if (delivery.settlementPolicy) return delivery.settlementPolicy;
  if (delivery.fulfillmentParty === "seller") return "reimburse_seller";
  if (
    delivery.fulfillmentParty !== "platform" &&
    delivery.sellerId &&
    (delivery.ruleSource || delivery.shippingProfileId || delivery.shippingProfiles?.length)
  ) {
    return "reimburse_seller";
  }
  return configuredPolicy || "reimburse_seller";
};

const calculateInclusiveShippingTax = (shippingAmount, productTaxableAmount, productTaxAmount) => {
  const shipping = Math.max(Number(shippingAmount || 0), 0);
  const taxable = Math.max(Number(productTaxableAmount || 0), 0);
  const tax = Math.max(Number(productTaxAmount || 0), 0);
  const productInvoiceValue = taxable + tax;
  if (!shipping || !productInvoiceValue || !tax) {
    return { taxableAmount: Number(shipping.toFixed(2)), taxAmount: 0 };
  }
  const shippingTaxableAmount = Number((shipping * taxable / productInvoiceValue).toFixed(2));
  return {
    taxableAmount: shippingTaxableAmount,
    taxAmount: Number((shipping - shippingTaxableAmount).toFixed(2)),
  };
};

const uniqueCommissionRates = (rates = []) => [...new Set(
  rates.map(Number).filter((rate) => Number.isFinite(rate) && rate > 0),
)].sort((left, right) => left - right);

module.exports = {
  applyShippingPolicy,
  calculateInclusiveShippingTax,
  resolveShippingPolicy,
  uniqueCommissionRates,
};
