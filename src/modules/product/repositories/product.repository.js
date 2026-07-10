const { ProductModel } = require("../models/product.model");
const { ProductRevisionModel } = require("../models/product-revision.model");
const { knex } = require("../../../infrastructure/postgres/postgres-client");

class ProductRepository {
  // ─── Create & basic CRUD ──────────────────────────────────────────────────

  async create(payload) {
    return ProductModel.create(payload);
  }

  async findById(productId) {
    return ProductModel.findById(productId);
  }

  async findOne(filter) {
    return ProductModel.findOne(filter);
  }

  async findByIds(productIds) {
    return ProductModel.find({ _id: { $in: productIds } });
  }

  async findScheduledForPublish(now = new Date(), limit = 100) {
    return ProductModel.find({
      scheduledAt: { $lte: now },
      $or: [
        { status: "scheduled" },
        { status: "active", visibility: "scheduled" },
      ],
    })
      .sort({ scheduledAt: 1 })
      .limit(limit);
  }

  async findBySku(sku, sellerId = null) {
    const filter = { $or: [{ sku }, { "variants.sku": sku }] };
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

  async paginate(filter, pagination, options = {}) {
    const sort = this._buildSort(pagination.sortBy, pagination.sortDir);
    const buildQuery = () => {
      let query = ProductModel.find(filter)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .sort(sort);

      if (options.projection) {
        query = query.select(options.projection);
      }
      if (options.lean) {
        query = query.lean();
      }

      return query;
    };

    const [items, total] = await Promise.all([
      buildQuery(),
      ProductModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async paginateBySeller(sellerId, filter, pagination, options = {}) {
    return this.paginate({ ...filter, sellerId }, pagination, options);
  }

  async listInventoryProducts(filter = {}, pagination = {}) {
    const safePage = Math.max(1, Number(pagination.page || 1));
    const safeLimit = Math.min(200, Math.max(1, Number(pagination.limit || 50)));
    const sortDir = pagination.sortDir === "asc" ? 1 : -1;
    const sortMap = {
      productName: "title",
      title: "title",
      sku: "sku",
      status: "status",
      updatedAt: "updatedAt",
      createdAt: "createdAt",
    };
    const sortBy = sortMap[pagination.sortBy] || "updatedAt";

    const query = {
      ...filter,
      variants: { $exists: true, $ne: [] },
    };

    const [items, total] = await Promise.all([
      ProductModel.find(query)
        .select("title sku sellerId organizationId organizationSnapshot category categoryId brand status visibility variants inventorySettings updatedAt createdAt")
        .sort({ [sortBy]: sortDir })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean({ virtuals: true }),
      ProductModel.countDocuments(query),
    ]);

    return { items, total, page: safePage, limit: safeLimit };
  }

  _buildSort(sortBy = "newest", sortDir = "desc") {
    const direction = sortDir === "asc" ? 1 : -1;
    const map = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      rating: { rating: -1 },
      popular: { "analytics.purchases": -1 },
    };
    const fieldMap = {
      title: "title",
      productTitle: "title",
      sku: "sku",
      stock: "stock",
      reservedStock: "reservedStock",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };
    if (fieldMap[sortBy]) return { [fieldMap[sortBy]]: direction };
    return map[sortBy] || { createdAt: -1 };
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async search(query, limit = 50, baseFilter = {}) {
    return ProductModel.find(
      { ...baseFilter, $text: { $search: query } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit);
  }

  // ─── Moderation ───────────────────────────────────────────────────────────

  async reviewProduct(productId, payload) {
    return ProductModel.findByIdAndUpdate(productId, { $set: payload }, { new: true });
  }

  // ─── Product revisions ───────────────────────────────────────────────────

  async createRevision(payload) {
    return ProductRevisionModel.create(payload);
  }

  async findRevisionById(revisionId) {
    return ProductRevisionModel.findById(revisionId);
  }

  async findPendingRevision(productId) {
    return ProductRevisionModel.findOne({
      productId: String(productId),
      status: "pending",
    }).sort({ createdAt: -1 });
  }

  async listRevisions(productId, { page = 1, limit = 20, status = null } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const filter = { productId: String(productId) };
    if (status) filter.status = status;

    const [items, total] = await Promise.all([
      ProductRevisionModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      ProductRevisionModel.countDocuments(filter),
    ]);
    return { items, total, page: safePage, limit: safeLimit };
  }

  async updateRevision(revisionId, payload) {
    return ProductRevisionModel.findByIdAndUpdate(
      revisionId,
      { $set: payload },
      { new: true },
    );
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
      {
        _id: productId,
        stock: { $gte: quantity },
        $expr: { $gte: [{ $subtract: ["$stock", "$reservedStock"] }, quantity] },
      },
      { $inc: { stock: -quantity } },
      { new: true },
    );
  }

  // ─── Variant inventory ────────────────────────────────────────────────────

  async syncRootInventoryFromVariants(productId) {
    const product = await ProductModel.findById(productId);
    if (!product || !Array.isArray(product.variants) || !product.variants.length) return product;

    const stock = product.variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);
    const reservedStock = product.variants.reduce((total, variant) => total + Number(variant.reservedStock || 0), 0);
    product.stock = stock;
    product.reservedStock = reservedStock;
    product.hasVariants = true;
    product.inventorySettings = {
      ...(product.inventorySettings?.toObject ? product.inventorySettings.toObject() : product.inventorySettings || {}),
      manageVariantInventory: true,
    };
    await product.save();
    return product;
  }

  async adjustVariantStock(productId, variantSku, adjustment) {
    if (adjustment === 0) return ProductModel.findById(productId);

    const variantFilter = { _id: productId, "variants.sku": variantSku };

    if (adjustment > 0) {
      const updated = await ProductModel.findOneAndUpdate(
        variantFilter,
        { $inc: { "variants.$.stock": adjustment } },
        { new: true },
      );
      return updated ? this.syncRootInventoryFromVariants(productId) : null;
    }

    const quantity = Math.abs(adjustment);
    const updated = await ProductModel.findOneAndUpdate(
      {
        ...variantFilter,
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
      { $inc: { "variants.$.stock": -quantity } },
      { new: true },
    );
    return updated ? this.syncRootInventoryFromVariants(productId) : null;
  }

  async ensureDefaultVariant(productId) {
    const product = await ProductModel.findById(productId);
    if (!product) return null;

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const existingDefault = variants.find((variant) => variant.isDefault) || variants[0];
    if (existingDefault?.sku) return existingDefault;

    const defaultSku = product.sku || `DEFAULT-${String(product._id).slice(-8)}`;
    const defaultVariant = {
      sku: defaultSku,
      title: "Default variant",
      price: Number(product.price || 0),
      mrp: Number(product.mrp || 0),
      salePrice: product.salePrice,
      stock: Number(product.stock || 0),
      reservedStock: Number(product.reservedStock || 0),
      attributes: {},
      images: [],
      status: "active",
      isDefault: true,
      sortOrder: 0,
    };

    const updated = await ProductModel.findByIdAndUpdate(
      productId,
      {
        $set: {
          variants: [defaultVariant],
          hasVariants: false,
          "inventorySettings.manageVariantInventory": true,
        },
      },
      { new: true },
    );

    return (updated?.variants || []).find((variant) => variant.isDefault) || updated?.variants?.[0] || null;
  }

  async reserveVariantStock(productId, variantSku, quantity) {
    const updated = await ProductModel.findOneAndUpdate(
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
    return updated ? this.syncRootInventoryFromVariants(productId) : null;
  }

  async releaseReservedVariantStock(productId, variantSku, quantity) {
    const updated = await ProductModel.findOneAndUpdate(
      {
        _id: productId,
        variants: { $elemMatch: { sku: variantSku, reservedStock: { $gte: quantity } } },
      },
      { $inc: { "variants.$.reservedStock": -quantity } },
      { new: true },
    );
    return updated ? this.syncRootInventoryFromVariants(productId) : null;
  }

  async commitReservedVariantStock(productId, variantSku, quantity) {
    const updated = await ProductModel.findOneAndUpdate(
      {
        _id: productId,
        variants: {
          $elemMatch: {
            sku: variantSku,
            reservedStock: { $gte: quantity },
            stock: { $gte: quantity },
          },
        },
      },
      { $inc: { "variants.$.reservedStock": -quantity, "variants.$.stock": -quantity } },
      { new: true },
    );
    return updated ? this.syncRootInventoryFromVariants(productId) : null;
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

  async getLowStockProducts(limit = 10, filter = {}) {
    return ProductModel.find({
      ...filter,
      $expr: {
        $lte: [
          { $subtract: ["$stock", "$reservedStock"] },
          { $ifNull: ["$inventorySettings.lowStockThreshold", 5] },
        ],
      },
    })
      .sort({ stock: 1, updatedAt: -1 })
      .limit(limit)
      .select("title sku sellerId price stock reservedStock inventorySettings status analytics");
  }

  async getTopProducts(limit = 10, metric = "purchases", filter = {}, range = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const products = await ProductModel.find({ status: "active", ...filter })
      .select("title sku sellerId price analytics status")
      .lean();
    const productIds = products.map((product) => String(product._id || product.id || "")).filter(Boolean);

    if (!productIds.length) {
      return [];
    }

    const salesRows = await knex("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .whereIn("oi.product_id", productIds)
      .modify((builder) => {
        if (filter.sellerId) builder.where("oi.seller_id", String(filter.sellerId));
        if (range.fromDate) builder.where("o.created_at", ">=", range.fromDate);
        if (range.toDate) builder.where("o.created_at", "<=", `${range.toDate} 23:59:59`);
      })
      .select("oi.product_id")
      .sum({ purchases: "oi.quantity" })
      .sum({ revenue: "oi.line_total" })
      .countDistinct({ orderCount: "o.id" })
      .groupBy("oi.product_id");

    const salesByProduct = new Map(salesRows.map((row) => [
      String(row.product_id),
      {
        purchases: Number(row.purchases || 0),
        revenue: Number(row.revenue || 0),
        orderCount: Number(row.orderCount || row.order_count || 0),
      },
    ]));

    return products
      .map((product) => {
        const productId = String(product._id || product.id || "");
        const sales = salesByProduct.get(productId) || {};
        return {
          ...product,
          analytics: {
            ...(product.analytics || {}),
            purchases: Number(sales.purchases || 0),
            revenue: Number(sales.revenue || 0),
            orderCount: Number(sales.orderCount || 0),
          },
        };
      })
      .sort((a, b) => {
        const key = metric === "revenue" ? "revenue" : metric === "views" ? "views" : "purchases";
        return Number(b.analytics?.[key] || 0) - Number(a.analytics?.[key] || 0);
      })
      .slice(0, safeLimit);
  }
}

module.exports = { ProductRepository };
