const { CartRepository } = require("../repositories/cart.repository");
const { ProductModel } = require("../../product/models/product.model");
const { AppError } = require("../../../shared/errors/app-error");
const { isPublicProduct } = require("../../../shared/catalog/public-product-filter");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

class CartService {
  constructor({ cartRepository = new CartRepository() } = {}) {
    this.cartRepository = cartRepository;
  }

  async getCart(userId) {
    return this.refreshCartAvailability(await this.cartRepository.getByUserId(userId));
  }

  async listCarts(filter = {}, pagination = {}) {
    const result = await this.cartRepository.listCarts(filter, pagination);
    return {
      ...result,
      items: result.items.map((cart) => this.toCartListRow(cart)),
    };
  }

  async getCartById(cartId) {
    const cart = await this.cartRepository.getById(cartId);
    if (!cart) throw new AppError("Cart not found", 404);
    return this.refreshCartAvailability(cart);
  }

  async clearCart(cartId, actor = {}) {
    const existing = await this.cartRepository.getById(cartId);
    if (!existing) throw new AppError("Cart not found", 404);
    return this.cartRepository.clearCart(cartId, {
      clearedBy: actor.userId || "",
      clearedByRole: actor.role || "",
    });
  }

  async upsertCart(userId, payload) {
    return this.cartRepository.upsertCart(userId, {
      $set: {
        items: await this.mergeItems(payload.items || []),
        wishlist: await this.normalizeWishlist(payload.wishlist || []),
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

  assertProductId(productId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError("Invalid product id in cart", 400);
    }
  }

  toCartListRow(cart = {}) {
    const items = Array.isArray(cart.items) ? cart.items : [];
    const wishlist = Array.isArray(cart.wishlist) ? cart.wishlist : [];
    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0,
    );
    return {
      _id: cart._id,
      userId: cart.userId,
      itemCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      lineCount: items.length,
      wishlistCount: wishlist.length,
      subtotal,
      updatedAt: cart.updatedAt,
      createdAt: cart.createdAt,
      items: items.slice(0, 3),
    };
  }

  firstImage(product = {}, variant = null) {
    const variantImage = Array.isArray(variant?.images) ? variant.images.find(Boolean) : "";
    if (variantImage) return variantImage;
    const productImage = Array.isArray(product.images) ? product.images.find(Boolean) : "";
    if (productImage) return productImage;
    if (Array.isArray(product.imageUrls)) return product.imageUrls.find(Boolean) || "";
    return product.thumbnail || product.thumbnailUrl || product.image || "";
  }

  resolveVariant(product = {}, item = {}) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (!variants.length) return null;
    if (item.variantSku) {
      const bySku = variants.find((variant) => String(variant.sku || "") === String(item.variantSku));
      if (bySku) return bySku;
    }
    if (item.variantId) {
      const byId = variants.find((variant) => String(variant._id || variant.id || "") === String(item.variantId));
      if (byId) return byId;
    }
    return variants.find((variant) => variant.isDefault) || variants[0] || null;
  }

  resolvePrice(product = {}, variant = null) {
    return Number(
      variant?.salePrice ??
      variant?.price ??
      product.salePrice ??
      product.price ??
      0,
    );
  }

  resolveMrp(product = {}, variant = null) {
    return Number(variant?.mrp ?? product.mrp ?? this.resolvePrice(product, variant) ?? 0);
  }

  availableStock(product = {}, variant = null) {
    if (variant) {
      return Math.max(0, Number(variant.stock || 0) - Number(variant.reservedStock || 0));
    }
    return Math.max(0, Number(product.stock || 0) - Number(product.reservedStock || 0));
  }

  stockStatus(product = {}, variant = null) {
    const available = this.availableStock(product, variant);
    const threshold = Number(product.inventorySettings?.lowStockThreshold ?? 5);
    if (available <= 0) return "out_of_stock";
    if (available <= threshold) return "low_stock";
    return "in_stock";
  }

  refreshCartAvailability(cart = null) {
    if (!cart || !Array.isArray(cart.items)) return cart;

    return {
      ...cart,
      items: cart.items.map((item) => {
        const product = item.productId && typeof item.productId === "object"
          ? item.productId
          : null;
        if (!product) return item;

        const variant = this.resolveVariant(product, item);
        const availableStock = this.availableStock(product, variant);
        const allowBackorder = product.inventorySettings?.allowBackorder === true;
        return {
          ...item,
          availableStock,
          stockStatus: allowBackorder && Number(item.quantity || 0) > availableStock
            ? "backorder"
            : this.stockStatus(product, variant),
        };
      }),
    };
  }

  async normalizeWishlist(wishlist = []) {
    const ids = [...new Set((wishlist || []).map((item) => this.productId(item)).filter(Boolean))];
    if (!ids.length) return [];
    ids.forEach((id) => this.assertProductId(id));
    const products = await ProductModel.find({ _id: { $in: ids } })
      .select("status visibility publishedAt scheduledAt")
      .lean();
    const publicIds = new Set(
      products
        .filter((product) => isPublicProduct(product))
        .map((product) => String(product._id)),
    );
    return ids.filter((id) => publicIds.has(String(id)));
  }

  async mergeItems(items = []) {
    const byKey = new Map();
    const productIds = [...new Set(items.map((item) => this.productId(item?.productId)).filter(Boolean))];
    productIds.forEach((productId) => this.assertProductId(productId));
    const products = productIds.length
      ? await ProductModel.find({ _id: { $in: productIds } })
        .select("sellerId title sku slug status visibility publishedAt scheduledAt price salePrice mrp currency stock reservedStock inventorySettings images imageUrls thumbnail thumbnailUrl image variants")
        .lean()
      : [];
    const productsById = new Map(products.map((product) => [String(product._id), product]));

    for (const item of items) {
      if (!item?.productId) continue;
      const productId = this.productId(item.productId);
      this.assertProductId(productId);
      const product = productsById.get(productId);
      if (!product || !isPublicProduct(product)) {
        throw new AppError("One or more cart products are no longer available", 409);
      }
      const variant = this.resolveVariant(product, item);
      if ((item.variantId || item.variantSku) && !variant) {
        throw new AppError(`Variant is no longer available for ${product.title}`, 409);
      }
      if (variant && variant.status && variant.status !== "active") {
        throw new AppError(`Variant is inactive for ${product.title}`, 409);
      }
      const quantity = Math.max(1, Number(item.quantity || 1));
      const trackInventory = product.inventorySettings?.trackInventory !== false;
      const allowBackorder = product.inventorySettings?.allowBackorder === true;
      const available = this.availableStock(product, variant);
      const key = this.itemKey({
        productId,
        variantId: variant?._id || variant?.id || "",
        variantSku: variant?.sku || "",
      });
      const existing = byKey.get(key);
      const nextQuantity = Number(existing?.quantity || 0) + quantity;
      if (trackInventory && !allowBackorder && nextQuantity > available) {
        throw new AppError(
          `${product.title} has only ${available} item${available === 1 ? "" : "s"} available`,
          409,
        );
      }
      const price = this.resolvePrice(product, variant);
      const normalized = {
        productId,
        variantId: variant?._id || variant?.id || "",
        variantSku: variant?.sku || "",
        variantTitle: variant?.title || "",
        attributes: variant?.attributes || item.attributes || {},
        title: product.title || "",
        sku: variant?.sku || product.sku || "",
        sellerId: product.sellerId || "",
        image: this.firstImage(product, variant),
        currency: product.currency || "INR",
        mrp: this.resolveMrp(product, variant),
        quantity,
        price: Math.max(0, price),
        availableStock: available,
        stockStatus: allowBackorder && nextQuantity > available ? "backorder" : this.stockStatus(product, variant),
      };
      byKey.set(key, existing
        ? {
            ...existing,
            ...normalized,
            quantity: nextQuantity,
          }
        : normalized);
    }
    return [...byKey.values()];
  }
}

module.exports = { CartService };
