const { RecommendationModel } = require("../models/recommendation.model");
const { ProductModel } = require("../../product/models/product.model");
const {
  applyPublicProductFilter,
} = require("../../../shared/catalog/public-product-filter");
const {
  setCached,
  getCached,
  deleteCached,
  cacheKeys,
  CACHE_TTL,
} = require("../../../infrastructure/cache/redis-client");

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

  async findPublicProductsByIds(productIds = [], limit = 10) {
    const ids = [...new Set(productIds.filter(Boolean).map(String))].slice(0, limit);
    if (!ids.length) return [];

    const products = await ProductModel.find({
      _id: { $in: ids },
      ...this.productFilter(),
    }).lean();

    const byId = new Map(products.map((product) => [String(product._id), product]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async getFallbackProducts({ category = null, period = "week", limit = 10, excludeIds = [] } = {}) {
    const normalizedLimit = this.normalizeLimit(limit);
    const exclude = [...new Set(excludeIds.filter(Boolean).map(String))];
    const filter = this.productFilter(category);
    if (exclude.length) filter._id = { $nin: exclude };

    let products = await ProductModel.find(filter)
      .sort(this.productSort(period))
      .limit(normalizedLimit)
      .lean();

    if (!products.length && category) {
      products = await ProductModel.find(this.productFilter())
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

    if (!userId) {
      return this.getTrendingProducts(options.category, options.period, { limit });
    }

    const cacheKey = `${cacheKeys.recommendations(userId)}:${limit}`;

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
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const recommended = await this.findPublicProductsByIds(
      ranked.map((item) => item.productId),
      limit,
    );

    if (recommended.length >= limit) return recommended;

    const fallback = await this.getFallbackProducts({
      category: options.category,
      period: options.period,
      limit: limit - recommended.length,
      excludeIds: recommended.map((product) => product._id),
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
    const cacheKey = `trending:${category || "all"}:${period}:${limit}`;

    let trending = await getCached(cacheKey);
    if (trending) {
      // Cached product snapshots may have been approved when cached and later
      // rejected/deactivated. Re-read by id so customer responses always honor
      // the current public approval state.
      return this.findPublicProductsByIds(
        trending.map((product) => product?._id || product?.id),
        limit,
      );
    }

    trending = await this.getFallbackProducts({ category, period, limit });

    await setCached(cacheKey, trending, CACHE_TTL.RECOMMENDATION);

    return trending;
  }

  // ==============================
  // Cache Invalidation
  // ==============================
  async clearCache(userId) {
    await deleteCached(cacheKeys.recommendations(userId));
  }
}

module.exports = {
  RecommendationService: new RecommendationService(),
};
