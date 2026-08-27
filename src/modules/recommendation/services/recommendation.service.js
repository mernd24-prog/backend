const { RecommendationModel } = require("../models/recommendation.model");
const { ProductModel } = require("../../product/models/product.model");
const {
  applyPublicProductFilter,
} = require("../../../shared/catalog/public-product-filter");
const {
  setCached,
  getCached,
  deleteCached,
  deletePatternCached,
  cacheKeys,
  CACHE_TTL,
} = require("../../../infrastructure/cache/redis-client");

// Shared by recommendation carousels. It intentionally contains everything a
// product card and its add-to-cart action need, while excluding descriptions,
// SEO content, audit history, and other product-detail-only fields.
const PRODUCT_CARD_FIELDS = [
  "title", "slug", "brand", "category", "images", "commonImages",
  "price", "mrp", "salePrice", "currency", "rating", "reviewCount",
  "ratingCount", "stock", "reservedStock", "availableStock", "inStock",
  "variants", "options", "shipping", "metadata", "deal", "sellerId",
  "organizationId", "storeId", "warehouseId", "sku", "status",
  "approvalStatus", "visibility",
].join(" ");

/**
 * Recommendation Engine
 */
class RecommendationService {
  escapeRegex(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  normalizeLimit(limit, fallback = 10) {
    const parsed = Number(limit || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), 1), 50);
  }

  productFilter(category) {
    const filter = applyPublicProductFilter();
    if (category) {
      filter.category = { $regex: `^${this.escapeRegex(String(category).trim())}$`, $options: "i" };
    }
    return filter;
  }

  productSort(period = "week") {
    if (period === "today") {
      return { "analytics.views": -1, "analytics.cartAdds": -1, createdAt: -1 };
    }
    if (period === "month") {
      return { "analytics.purchases": -1, rating: -1, reviewCount: -1, createdAt: -1 };
    }
    return {
      "analytics.purchases": -1,
      "analytics.cartAdds": -1,
      "analytics.views": -1,
      rating: -1,
      reviewCount: -1,
      createdAt: -1,
    };
  }

  async findPublicProductsByIds(productIds = [], limit = 10, options = {}) {
    const ids = [...new Set(productIds.filter(Boolean).map(String))].slice(0, limit);
    if (!ids.length) return [];

    const products = await ProductModel.find({
      _id: { $in: ids },
      ...this.productFilter(options.category),
    }).select(PRODUCT_CARD_FIELDS).lean();

    const byId = new Map(products.map((product) => [String(product._id), product]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async getFallbackProducts({ category = null, period = "week", limit = 10, excludeIds = [] } = {}) {
    const normalizedLimit = this.normalizeLimit(limit);
    const exclude = [...new Set(excludeIds.filter(Boolean).map(String))];
    const filter = this.productFilter(category);
    if (exclude.length) filter._id = { $nin: exclude };

    let products = await ProductModel.find(filter)
      .select(PRODUCT_CARD_FIELDS)
      .sort(this.productSort(period))
      .limit(normalizedLimit)
      .lean();

    if (!products.length && category) {
      products = await ProductModel.find(this.productFilter())
        .select(PRODUCT_CARD_FIELDS)
        .sort(this.productSort(period))
        .limit(normalizedLimit)
        .lean();
    }

    return products;
  }

  // ==============================
  // Get Recommendations
  // ==============================
  async getRecommendations(userId, options = {}) {
    const limit = this.normalizeLimit(options.limit);
    const category = options.category ? String(options.category).trim().toLowerCase() : "all";
    const period = options.period || "week";
    const contextProductId = options.productId ? String(options.productId).trim() : "";
    const excludeIds = contextProductId ? [contextProductId] : [];

    if (!userId) {
      return this.getTrendingProducts(options.category, options.period, { limit, excludeIds });
    }

    const cacheKey = `${cacheKeys.recommendations(userId)}:${category}:${period}:${limit}:${contextProductId || "none"}`;

    let recs = await getCached(cacheKey);

    if (!recs) {
      recs = await RecommendationModel.findOne({ userId }).lean();

      if (!recs) {
        const newDoc = await RecommendationModel.create({
          userId,
          recommendedProducts: [],
          trending: [],
        });

        recs = newDoc.toObject();
      }

      await setCached(cacheKey, recs, CACHE_TTL.RECOMMENDATION);
    }

    const ranked = (recs.recommendedProducts || [])
      .filter((item) => !contextProductId || String(item.productId) !== contextProductId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const recommended = await this.findPublicProductsByIds(
      ranked.map((item) => item.productId),
      limit,
      { category: options.category },
    );

    if (recommended.length >= limit) return recommended;

    const fallback = await this.getFallbackProducts({
      category: options.category,
      period: options.period,
      limit: limit - recommended.length,
      excludeIds: [...excludeIds, ...recommended.map((product) => product._id)],
    });

    return [...recommended, ...fallback].slice(0, limit);
  }

  // ==============================
  // Add Recommendation
  // ==============================
  async addRecommendation(userId, productId, reason, score = 75) {
    let recs = await RecommendationModel.findOne({ userId });

    if (!recs) {
      recs = new RecommendationModel({
        userId,
        recommendedProducts: [],
      });
    }

    const existing = recs.recommendedProducts.find(
      (r) => r.productId.toString() === productId.toString()
    );

    if (existing) {
      existing.score = Math.max(existing.score, score);
    } else {
      recs.recommendedProducts.push({
        productId,
        score,
        reason,
      });
    }

    // Keep top 100
    recs.recommendedProducts.sort((a, b) => b.score - a.score);
    recs.recommendedProducts = recs.recommendedProducts.slice(0, 100);

    recs.lastUpdated = new Date();

    await recs.save();
    await this.clearCache(userId);

    return recs;
  }

  // ==============================
  // Record User Interaction
  // ==============================
  async recordInteraction(userId, productId, interactionType) {
    const recs = await RecommendationModel.findOne({ userId });

    if (!recs) return;

    const product = recs.recommendedProducts.find(
      (r) => r.productId.toString() === productId.toString()
    );

    if (!product) return;

    const now = new Date();

    switch (interactionType) {
      case "clicked":
        product.clickedAt = now;
        product.score += 5;
        break;
      case "purchased":
        product.purchasedAt = now;
        product.score += 20;
        break;
      case "viewed":
        product.score += 1;
        break;
    }

    await recs.save();
    await this.clearCache(userId);
  }

  // ==============================
  // Trending Products
  // ==============================
  async getTrendingProducts(category = null, period = "week", options = {}) {
    const limit = this.normalizeLimit(options.limit);
    const excludeIds = [...new Set((options.excludeIds || []).filter(Boolean).map(String))];
    const cacheLimit = excludeIds.length ? Math.min(limit + excludeIds.length, 50) : limit;
    const cacheKey = `trending:${category || "all"}:${period}:${cacheLimit}`;

    let trending = await getCached(cacheKey);
    if (trending) {
      // Cached product snapshots may have been approved when cached and later
      // rejected/deactivated. Re-read by id so customer responses always honor
      // the current public approval state.
      const cachedProducts = await this.findPublicProductsByIds(
        trending.map((product) => product?._id || product?.id),
        cacheLimit,
        { category },
      );
      const filteredProducts = cachedProducts
        .filter((product) => !excludeIds.includes(String(product._id || product.id)))
        .slice(0, limit);

      if (filteredProducts.length >= limit || !category) {
        return filteredProducts;
      }

      const fallback = await this.getFallbackProducts({
        period,
        limit: limit - filteredProducts.length,
        excludeIds: [
          ...excludeIds,
          ...filteredProducts.map((product) => product._id || product.id),
        ],
      });
      return [...filteredProducts, ...fallback].slice(0, limit);
    }

    trending = await this.getFallbackProducts({ category, period, limit: cacheLimit });

    await setCached(cacheKey, trending, CACHE_TTL.RECOMMENDATION);

    const filteredProducts = trending
      .filter((product) => !excludeIds.includes(String(product._id || product.id)))
      .slice(0, limit);

    if (filteredProducts.length >= limit || !category) {
      return filteredProducts;
    }

    const fallback = await this.getFallbackProducts({
      period,
      limit: limit - filteredProducts.length,
      excludeIds: [
        ...excludeIds,
        ...filteredProducts.map((product) => product._id || product.id),
      ],
    });
    return [...filteredProducts, ...fallback].slice(0, limit);
  }

  // ==============================
  // Cache Invalidation
  // ==============================
  async clearCache(userId) {
    await deleteCached(cacheKeys.recommendations(userId));
    await deletePatternCached(`${cacheKeys.recommendations(userId)}:*`);
  }
}

module.exports = {
  RecommendationService: new RecommendationService(),
};
