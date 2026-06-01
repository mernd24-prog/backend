const { CartRepository } = require("../repositories/cart.repository");
const { ProductModel } = require("../../product/models/product.model");

class CartService {
  constructor({ cartRepository = new CartRepository() } = {}) {
    this.cartRepository = cartRepository;
  }

  async getCart(userId) {
    return this.cartRepository.getByUserId(userId);
  }

  async upsertCart(userId, payload) {
    return this.cartRepository.upsertCart(userId, {
      $set: {
        items: await this.mergeItems(payload.items || []),
        wishlist: [...new Set((payload.wishlist || []).filter(Boolean))],
      },
    });
  }

  itemKey(item = {}) {
    return [String(item.productId || ""), String(item.variantId || item.variantSku || "")].join(":");
  }

  productId(value) {
    if (!value) return "";
    if (typeof value === "object") {
      return String(value._id || value.id || value.productId || "");
    }
    return String(value);
  }

  async mergeItems(items = []) {
    const byKey = new Map();
    const productIds = [...new Set(items.map((item) => this.productId(item?.productId)).filter(Boolean))];
    const products = productIds.length
      ? await ProductModel.find({ _id: { $in: productIds } }).select("variants").lean()
      : [];
    const productsById = new Map(products.map((product) => [String(product._id), product]));

    for (const item of items) {
      if (!item?.productId) continue;
      const productId = this.productId(item.productId);
      const product = productsById.get(productId);
      const defaultVariant = !item.variantId && !item.variantSku && Array.isArray(product?.variants)
        ? product.variants.find((variant) => variant.isDefault) || product.variants[0]
        : null;
      const normalized = {
        productId,
        variantId: item.variantId || defaultVariant?._id || defaultVariant?.id || "",
        variantSku: item.variantSku || defaultVariant?.sku || "",
        variantTitle: item.variantTitle || defaultVariant?.title || "",
        attributes: item.attributes || defaultVariant?.attributes || {},
        quantity: Math.max(1, Number(item.quantity || 1)),
        price: Math.max(0, Number(item.price || defaultVariant?.salePrice || defaultVariant?.price || 0)),
      };
      const key = this.itemKey(normalized);
      const existing = byKey.get(key);
      byKey.set(key, existing
        ? {
            ...existing,
            ...normalized,
            quantity: Number(existing.quantity || 0) + Number(normalized.quantity || 0),
          }
        : normalized);
    }
    return [...byKey.values()];
  }
}

module.exports = { CartService };
