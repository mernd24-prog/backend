const { AppError } = require("../../../shared/errors/app-error");

function plainProduct(product) {
  return product?.toObject ? product.toObject() : product || {};
}
function resolveDealVariant(product, deal = {}) {
  const variants = plainProduct(product).variants || [];
  if (!deal.variantId && !deal.variantSku) return null;
  return variants.find((variant) =>
    (!deal.variantId || String(variant._id || variant.id || "") === String(deal.variantId)) &&
    (!deal.variantSku || String(variant.sku || "") === String(deal.variantSku)),
  ) || null;
}
function variantPrices(product, variant) {
  const value = plainProduct(product);
  const sellingPrice = Number(variant.salePrice ?? variant.price ?? value.salePrice ?? value.price);
  const catalogPrice = Number(variant.mrp ?? value.mrp ?? sellingPrice);
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0 || !Number.isFinite(catalogPrice)) {
    throw new AppError("Selected variant must have a valid selling price", 400);
  }
  return { sellingPrice, catalogPrice, discountRate: catalogPrice > sellingPrice
    ? Number((((catalogPrice - sellingPrice) / catalogPrice) * 100).toFixed(2)) : 0 };
}
function variantLabel(variant) {
  const attributes = variant.attributes instanceof Map ? Object.fromEntries(variant.attributes) : variant.attributes || {};
  return variant.title || Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join(", ") || variant.sku;
}
function projectDealVariant(product, deal) {
  const value = plainProduct(product);
  const variant = resolveDealVariant(value, deal);
  if (!variant || variant.status === "inactive") return null;
  const price = variantPrices(value, variant);
  return {
    ...value,
    title: `${value.title} – ${variantLabel(variant)}`,
    selectedVariant: { ...variant, isDefault: true },
    variantId: String(variant._id || variant.id || ""),
    variantSku: variant.sku,
    images: variant.images?.length ? variant.images : value.images,
    price: price.sellingPrice, salePrice: price.sellingPrice, sellingPrice: price.sellingPrice,
    mrp: price.catalogPrice, compareAtPrice: price.catalogPrice, discountPercent: price.discountRate,
    stock: Number(variant.stock || 0),
    availableStock: Math.max(0, Number(variant.stock || 0) - Number(variant.reservedStock || 0)),
  };
}
module.exports = { resolveDealVariant, variantPrices, projectDealVariant, variantLabel };
