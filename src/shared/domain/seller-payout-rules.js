const applyShippingPolicy = (baseAmount, shippingAmount, policy) => {
  const base = Number(baseAmount || 0);
  const shipping = Number(shippingAmount || 0);
  if (policy === "reimburse_seller") return Math.max(0, base + shipping);
  if (policy === "deduct_from_seller") return Math.max(0, base - shipping);
  return Math.max(0, base);
};

const uniqueCommissionRates = (rates = []) => [...new Set(
  rates.map(Number).filter((rate) => Number.isFinite(rate) && rate > 0),
)].sort((left, right) => left - right);

module.exports = { applyShippingPolicy, uniqueCommissionRates };
