const { ProductModel } = require("../models/product.model");

class ProductRepository {
  // ─── Create & basic CRUD ──────────────────────────────────────────────────

  async create(payload) {
    return ProductModel.create(payload);
  }

  async findById(productId) {
    return ProductModel.findById(productId);
  }

  async findByIds(productIds) {
    return ProductModel.find({ _id: { $in: productIds } });
  }

  async findBySku(sku, sellerId = null) {
    const filter = { sku };
    if (sellerId) filter.sellerId = sellerId;
    return ProductModel.findOne(filter);
  }

  async update(productId, payload) {
    return ProductModel.findByIdAndUpdate(productId, { $set: payload }, { new: true });
  }

  async delete(productId) {
    return ProductModel.findByIdAndDelete(productId);
  }

  // ─── Pagination & listing ─────────────────────────────────────────────────

  async paginate(filter, pagination) {
    const sort = this._buildSort(pagination.sortBy);
    const [items, total] = await Promise.all([
      ProductModel.find(filter)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .sort(sort),
      ProductModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async paginateBySeller(sellerId, filter, pagination) {
    return this.paginate({ ...filter, sellerId }, pagination);
  }

  _buildSort(sortBy = "newest") {
    const map = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      rating: { rating: -1 },
      popular: { "analytics.purchases": -1 },
    };
    return map[sortBy] || { createdAt: -1 };
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async search(query, limit = 50) {
    return ProductModel.find(
      { $text: { $search: query }, status: "active" },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit);
  }

  // ─── Moderation ───────────────────────────────────────────────────────────

  async reviewProduct(productId, payload) {
    return ProductModel.findByIdAndUpdate(productId, { $set: payload }, { new: true });
  }

  // ─── Bulk operations ─────────────────────────────────────────────────────

  async bulkUpdateStatus(productIds, status, updatedBy = null) {
    return ProductModel.updateMany(
      { _id: { $in: productIds } },
      {
        $set: {
          status,
          ...(updatedBy ? { lastUpdatedBy: updatedBy } : {}),
        },
      },
    );
  }

  async bulkUpdateVisibility(productIds, visibility) {
    return ProductModel.updateMany(
      { _id: { $in: productIds } },
      { $set: { visibility } },
    );
  }

  // ─── Inventory (root-level) ───────────────────────────────────────────────

  async reserveStock(productId, quantity) {
    return ProductModel.findOneAndUpdate(
      {
        _id: productId,
        $expr: { $gte: [{ $subtract: ["$stock", "$reservedStock"] }, quantity] },
      },
      { $inc: { reservedStock: quantity } },
      { new: true },
    );
  }

  async releaseReservedStock(productId, quantity) {
    return ProductModel.findOneAndUpdate(
      { _id: productId, reservedStock: { $gte: quantity } },
      { $inc: { reservedStock: -quantity } },
      { new: true },
    );
  }

  async commitReservedStock(productId, quantity) {
    return ProductModel.findOneAndUpdate(
      {
        _id: productId,
        reservedStock: { $gte: quantity },
        stock: { $gte: quantity },
      },
      { $inc: { reservedStock: -quantity, stock: -quantity } },
      { new: true },
    );
  }

  async addStock(productId, quantity) {
    return ProductModel.findByIdAndUpdate(
      productId,
      { $inc: { stock: quantity } },
      { new: true },
    );
  }

  async adjustStock(productId, adjustment) {
    if (adjustment === 0) return ProductModel.findById(productId);
    if (adjustment > 0) return this.addStock(productId, adjustment);

    const quantity = Math.abs(adjustment);
    return ProductModel.findOneAndUpdate(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { new: true },
    );
  }

  // ─── Variant inventory ────────────────────────────────────────────────────

  async adjustVariantStock(productId, variantSku, adjustment) {
    if (adjustment === 0) return ProductModel.findById(productId);

    const variantFilter = { _id: productId, "variants.sku": variantSku };

    if (adjustment > 0) {
      return ProductModel.findOneAndUpdate(
        variantFilter,
        { $inc: { "variants.$.stock": adjustment } },
        { new: true },
      );
    }

    const quantity = Math.abs(adjustment);
    return ProductModel.findOneAndUpdate(
      { ...variantFilter, "variants.stock": { $gte: quantity } },
      { $inc: { "variants.$.stock": -quantity } },
      { new: true },
    );
  }

  async reserveVariantStock(productId, variantSku, quantity) {
    return ProductModel.findOneAndUpdate(
      {
        _id: productId,
        "variants.sku": variantSku,
        $expr: {
          $gte: [
            {
              $subtract: [
                { $arrayElemAt: ["$variants.stock", { $indexOfArray: ["$variants.sku", variantSku] }] },
                { $arrayElemAt: ["$variants.reservedStock", { $indexOfArray: ["$variants.sku", variantSku] }] },
              ],
            },
            quantity,
          ],
        },
      },
      { $inc: { "variants.$.reservedStock": quantity } },
      { new: true },
    );
  }

  // ─── Analytics ───────────────────────────────────────────────────────────

  async incrementAnalytics(productId, field, increment = 1) {
    return ProductModel.findByIdAndUpdate(
      productId,
      { $inc: { [`analytics.${field}`]: increment } },
      { new: true },
    );
  }

  async recordView(productId) {
    return ProductModel.findByIdAndUpdate(
      productId,
      {
        $inc: { "analytics.views": 1 },
        $set: { "analytics.lastViewedAt": new Date() },
      },
      { new: true },
    );
  }

  async recordPurchase(productId, quantity = 1, revenue = 0) {
    return ProductModel.findByIdAndUpdate(
      productId,
      {
        $inc: {
          "analytics.purchases": quantity,
          "analytics.revenue": revenue,
        },
      },
      { new: true },
    );
  }

  // ─── Aggregations for dashboard ───────────────────────────────────────────

  async getInventoryStats(sellerId = null, createdBy = null) {
    const match = {
      ...(sellerId ? { sellerId } : {}),
      ...(createdBy ? { createdBy } : {}),
    };
    return ProductModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalStock: { $sum: "$stock" },
          totalReserved: { $sum: "$reservedStock" },
          lowStockCount: {
            $sum: {
              $cond: [
                {
                  $lte: [
                    { $subtract: ["$stock", "$reservedStock"] },
                    { $ifNull: ["$inventorySettings.lowStockThreshold", 5] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          outOfStockCount: {
            $sum: {
              $cond: [{ $lte: [{ $subtract: ["$stock", "$reservedStock"] }, 0] }, 1, 0],
            },
          },
        },
      },
    ]);
  }

  async getTopProducts(limit = 10, metric = "purchases") {
    const sortField = `analytics.${metric}`;
    return ProductModel.find({ status: "active" })
      .sort({ [sortField]: -1 })
      .limit(limit)
      .select("title sku sellerId price analytics status");
  }
}

module.exports = { ProductRepository };
