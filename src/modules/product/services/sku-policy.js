const { randomUUID } = require("node:crypto");
const { AppError } = require("../../../shared/errors/app-error");

// Symbols stay inside the request and are never persisted or accepted from JSON.
const AUTO_SKU = Symbol("automaticallyGeneratedSku");
const generateSku = () => `SKU-${randomUUID().replace(/-/g, "").toUpperCase()}`;

function assignGeneratedSku(variant) {
  variant.sku = generateSku();
  variant.skuNormalized = variant.sku.toLowerCase();
  variant[AUTO_SKU] = true;
  return variant;
}

function regenerateSku(payload, variant) {
  const previous = variant.sku;
  assignGeneratedSku(variant);
  if (payload.sku === previous) payload.sku = variant.sku;
}

function isSkuConflict(error) {
  return error?.code === 11000 && (
    error.keyPattern?.["variants.skuNormalized"] ||
    String(error.message || "").includes("unique_seller_variant_sku_normalized")
  );
}

async function saveWithSkuRetry(payload, save) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await save(payload);
    } catch (error) {
      if (!isSkuConflict(error)) throw error;
      const conflict = error.keyValue?.["variants.skuNormalized"];
      const candidates = (payload.variants || []).filter((variant) =>
        variant[AUTO_SKU] && (!conflict || variant.sku.toLowerCase() === String(conflict).toLowerCase()),
      );
      if (!candidates.length) {
        throw new AppError("SKU is already used by another product for this seller", 409);
      }
      if (attempt === 4) throw new AppError("Could not allocate a unique SKU. Please retry saving the product.", 409);
      candidates.forEach((variant) => regenerateSku(payload, variant));
    }
  }
}

module.exports = { AUTO_SKU, generateSku, assignGeneratedSku, regenerateSku, saveWithSkuRetry };
