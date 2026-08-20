const { CartRepository } = require("../repositories/cart.repository");
const { ProductModel } = require("../../product/models/product.model");
const { AppError } = require("../../../shared/errors/app-error");
const { isPublicProduct } = require("../../../shared/catalog/public-product-filter");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { DealService } = require("../../deal/services/deal.service");

class CartService {
  constructor({ cartRepository = new CartRepository(), dealService = new DealService() } = {}) {
    this.cartRepository = cartRepository;
    this.dealService = dealService;
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
    const hasItems = Object.prototype.hasOwnProperty.call(payload, "items");
    const hasWishlist = Object.prototype.hasOwnProperty.call(payload, "wishlist");
    const existingCart = await this.cartRepository.getByUserId(userId);
    // Wishlist-only changes must not fail because a previously-added cart line
    // later went out of stock. Stock is enforced only when item lines change.
    const nextItems = hasItems
      ? await this.mergeItems(payload.items || [], existingCart?.items || [])
      : existingCart?.items || [];
    const nextWishlist = await this.normalizeWishlist(
      hasWishlist ? payload.wishlist || [] : existingCart?.wishlist || [],
    );

    const cart = await this.cartRepository.upsertCart(userId, {
      $set: {
        items: nextItems,
        wishlist: nextWishlist,
      },
    });

    await this.recordCartAnalyticsDeltas(existingCart, {
      items: nextItems,
      wishlist: nextWishlist,
    });

    return this.refreshCartAvailability(cart);
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

  itemQuantityByProduct(items = []) {
    return (Array.isArray(items) ? items : []).reduce((lookup, item) => {
      const productId = this.productId(item?.productId || item);
      if (!productId) return lookup;
      lookup[productId] = (lookup[productId] || 0) + Math.max(0, Number(item?.quantity || 0));
      return lookup;
    }, {});
  }

  wishlistSet(wishlist = []) {
    return new Set(
      (Array.isArray(wishlist) ? wishlist : [])
        .map((item) => this.productId(item))
        .filter(Boolean),
    );
  }

  wishlistKey(item = {}) {
    return this.itemKey({
      productId: this.productId(item?.productId || item),
      variantId: item?.variantId,
      variantSku: item?.variantSku,
    });
  }

  async incrementProductAnalytics(productId, field, increment = 1) {
    if (!productId || !increment) return null;
    return ProductModel.updateOne(
      { _id: productId },
      { $inc: { [`analytics.${field}`]: increment } },
    );
  }

  async recordCartAnalyticsDeltas(previousCart = {}, nextCart = {}) {
    const previousQuantities = this.itemQuantityByProduct(previousCart?.items);
    const nextQuantities = this.itemQuantityByProduct(nextCart?.items);
    const previousWishlist = this.wishlistSet(previousCart?.wishlist);
    const nextWishlist = this.wishlistSet(nextCart?.wishlist);

    const updates = [];
    Object.entries(nextQuantities).forEach(([productId, quantity]) => {
      const increment = quantity - Number(previousQuantities[productId] || 0);
      if (increment > 0) {
        updates.push(this.incrementProductAnalytics(productId, "cartAdds", increment));
      }
    });

    nextWishlist.forEach((productId) => {
      if (!previousWishlist.has(productId)) {
        updates.push(this.incrementProductAnalytics(productId, "wishlistAdds", 1));
      }
    });

    await Promise.all(updates);
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
    // Never silently switch a requested SKU/variant to the default variant;
    // doing so validates price and stock against the wrong inventory line.
    if (item.variantId || item.variantSku) return null;
    return variants.find((variant) => variant.isDefault) || variants[0] || null;
  }

  resolvePrice(product = {}, variant = null, deal = null) {
    return Number(
      deal?.dealPrice ??
      variant?.salePrice ??
      variant?.price ??
      product.salePrice ??
      product.price ??
      0,
    );
  }

  resolveMrp(product = {}, variant = null, deal = null) {
    return Number(deal?.originalPrice ?? variant?.mrp ?? product.mrp ?? this.resolvePrice(product, variant, deal) ?? 0);
  }

  async findActiveDeal(product = {}, variant = null, item = {}) {
    return this.dealService.findActiveDealForItem({
      productId: String(product._id || product.id || item.productId || ""),
      variantId: variant ? String(variant._id || variant.id || item.variantId || "") : item.variantId,
      variantSku: variant?.sku || item.variantSku || "",
      sellerId: product.sellerId,
    }).catch(() => null);
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

  async refreshCartAvailability(cart = null) {
    if (!cart || !Array.isArray(cart.items)) return cart;

    return {
      ...cart,
      items: await Promise.all(cart.items.map(async (item) => {
        const product = item.productId && typeof item.productId === "object"
          ? item.productId
          : null;
        if (!product) return item;

        const variant = this.resolveVariant(product, item);
        const activeDeal = await this.findActiveDeal(product, variant, item);
        const availableStock = this.availableStock(product, variant);
        const allowBackorder = product.inventorySettings?.allowBackorder === true;
        return {
          ...item,
          price: Math.max(0, this.resolvePrice(product, variant, activeDeal)),
          mrp: this.resolveMrp(product, variant, activeDeal),
          deal: activeDeal?.dealId ? activeDeal : null,
          availableStock,
          stockStatus: allowBackorder && Number(item.quantity || 0) > availableStock
            ? "backorder"
            : this.stockStatus(product, variant),
        };
      })),
    };
  }

  async normalizeWishlist(wishlist = []) {
    const requested = new Map();
    for (const rawItem of wishlist || []) {
      const item = typeof rawItem === "object" && rawItem !== null
        ? rawItem
        : { productId: rawItem };
      const productId = this.productId(item.productId || item);
      if (!productId) continue;
      this.assertProductId(productId);
      requested.set(this.wishlistKey({ ...item, productId }), { ...item, productId });
    }
    const entries = [...requested.values()];
    const ids = [...new Set(entries.map((item) => item.productId))];
    if (!ids.length) return [];
    const products = await ProductModel.find({ _id: { $in: ids } })
      .select("status approvalStatus visibility publishedAt scheduledAt variants")
      .lean();
    const publicProducts = new Map(
      products
        .filter((product) => isPublicProduct(product))
        .map((product) => [String(product._id), product]),
    );
    return entries.flatMap((entry) => {
      const product = publicProducts.get(String(entry.productId));
      if (!product) return [];
      const requestedVariant = entry.variantId || entry.variantSku;
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const variant = requestedVariant ? variants.find((candidate) =>
        (entry.variantId && String(candidate._id || candidate.id || "") === String(entry.variantId)) ||
        (entry.variantSku && String(candidate.sku || "") === String(entry.variantSku))
      ) : null;
      // Out-of-stock variants may still be wishlisted; only removed/inactive
      // variants are invalid wishlist targets.
      if (requestedVariant && (!variant || variant.status === "inactive")) return [];
      return [{
        productId: entry.productId,
        variantId: variant?._id || variant?.id || "",
        variantSku: variant?.sku || entry.variantSku || "",
        variantTitle: variant?.title || entry.variantTitle || "",
        attributes: variant?.attributes || entry.attributes || {},
      }];
    });
  }

  async mergeItems(items = [], baselineItems = []) {
    const byKey = new Map();
    const productIds = [...new Set(
      [...items, ...(baselineItems || [])]
        .map((item) => this.productId(item?.productId))
        .filter(Boolean),
    )];
    productIds.forEach((productId) => this.assertProductId(productId));
    const products = productIds.length
      ? await ProductModel.find({ _id: { $in: productIds } })
        .select("sellerId title sku slug status approvalStatus visibility publishedAt scheduledAt price salePrice mrp currency stock reservedStock inventorySettings images imageUrls thumbnail thumbnailUrl image variants")
        .lean()
      : [];
    const productsById = new Map(products.map((product) => [String(product._id), product]));
    const baselineQuantities = new Map();
    for (const item of baselineItems || []) {
      const productId = this.productId(item?.productId);
      const product = productsById.get(productId);
      const variant = product ? this.resolveVariant(product, item) : null;
      const key = this.itemKey({
        productId,
        variantId: variant?._id || variant?.id || item?.variantId || "",
        variantSku: variant?.sku || item?.variantSku || "",
      });
      baselineQuantities.set(
        key,
        (baselineQuantities.get(key) || 0) + Number(item?.quantity || 0),
      );
    }

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
      const baselineQuantity = Number(baselineQuantities.get(key) || 0);
      if (
        trackInventory &&
        !allowBackorder &&
        nextQuantity > available &&
        nextQuantity > baselineQuantity
      ) {
        throw new AppError(
          `${product.title} has only ${available} item${available === 1 ? "" : "s"} available`,
          409,
        );
      }
      const activeDeal = await this.findActiveDeal(product, variant, item);
      if (activeDeal?.maxQuantityPerOrder && nextQuantity > Number(activeDeal.maxQuantityPerOrder)) {
        throw new AppError(`Deal quantity limit is ${activeDeal.maxQuantityPerOrder} for ${product.title}`, 409);
      }
      const price = this.resolvePrice(product, variant, activeDeal);
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
        mrp: this.resolveMrp(product, variant, activeDeal),
        quantity,
        price: Math.max(0, price),
        deal: activeDeal?.dealId ? activeDeal : null,
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
