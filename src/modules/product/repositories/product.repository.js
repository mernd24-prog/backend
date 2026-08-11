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

  async aggregatePublicCatalog(filter = {}, pagination = {}, projection = null) {
    const page = Math.max(1, Number(pagination.page || 1));
    const limit = Math.min(100, Math.max(1, Number(pagination.limit || 20)));
    const skip = Number.isFinite(Number(pagination.skip))
      ? Number(pagination.skip)
      : (page - 1) * limit;
    const sort = this._buildSort(pagination.sortBy, pagination.sortDir);
    const newArrivalCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const productProjection = projection
      ? { ...projection, variants: 1, attributes: 1, collectionIds: 1, tags: 1 }
      : {};

    const [result = {}] = await ProductModel.aggregate([
      { $match: filter },
      { $lookup: { from: "categorytrees", localField: "category", foreignField: "categoryKey", as: "_activeCategory" } },
      { $unwind: "$_activeCategory" },
      { $match: { "_activeCategory.active": true } },
      {
        $set: {
          _facetAvailableStock: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
              {
                $reduce: {
                  input: {
                    $filter: {
                      input: { $ifNull: ["$variants", []] },
                      as: "variant",
                      cond: { $eq: [{ $ifNull: ["$$variant.status", "active"] }, "active"] },
                    },
                  },
                  initialValue: 0,
                  in: {
                    $add: [
                      "$$value",
                      {
                        $max: [
                          0,
                          { $subtract: [{ $ifNull: ["$$this.stock", 0] }, { $ifNull: ["$$this.reservedStock", 0] }] },
                        ],
                      },
                    ],
                  },
                },
              },
              { $max: [0, { $subtract: [{ $ifNull: ["$stock", 0] }, { $ifNull: ["$reservedStock", 0] }] }] },
            ],
          },
          _facetPrice: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
              {
                $min: {
                  $map: {
                    input: {
                      $filter: {
                        input: { $ifNull: ["$variants", []] },
                        as: "variant",
                        cond: { $ne: [{ $ifNull: ["$$variant.status", "active"] }, "inactive"] },
                      },
                    },
                    as: "variant",
                    in: { $ifNull: ["$$variant.salePrice", "$$variant.price"] },
                  },
                },
              },
              { $ifNull: ["$salePrice", "$price"] },
            ],
          },
          _facetAttributeEntries: {
            $concatArrays: [
              { $objectToArray: { $ifNull: ["$attributes", {}] } },
              {
                $reduce: {
                  input: {
                    $filter: {
                      input: { $ifNull: ["$variants", []] },
                      as: "variant",
                      cond: { $eq: [{ $ifNull: ["$$variant.status", "active"] }, "active"] },
                    },
                  },
                  initialValue: [],
                  in: { $concatArrays: ["$$value", { $objectToArray: { $ifNull: ["$$this.attributes", {}] } }] },
                },
              },
            ],
          },
        },
      },
      {
        $facet: {
          items: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            ...(projection ? [{ $project: productProjection }] : []),
          ],
          total: [{ $count: "count" }],
          categories: [
            { $set: { directCategory: "$_activeCategory" } },
            {
              $graphLookup: {
                from: "categorytrees",
                startWith: "$directCategory.parentKey",
                connectFromField: "parentKey",
                connectToField: "categoryKey",
                as: "ancestorCategories",
                restrictSearchWithMatch: { active: true },
              },
            },
            { $project: { productId: "$_id", nodes: { $concatArrays: [["$directCategory"], "$ancestorCategories"] } } },
            { $unwind: "$nodes" },
            { $group: { _id: "$nodes.categoryKey", node: { $first: "$nodes" }, products: { $addToSet: "$productId" } } },
            { $project: { _id: 0, value: "$_id", key: "$_id", label: "$node.title", parentKey: "$node.parentKey", level: "$node.level", sortOrder: "$node.sortOrder", iconUrl: "$node.iconUrl", bannerUrl: "$node.bannerUrl", count: { $size: "$products" } } },
            { $sort: { level: 1, sortOrder: 1, label: 1 } },
          ],
          brands: [
            { $match: { brand: { $nin: [null, ""] } } },
            { $group: { _id: "$brand", count: { $sum: 1 } } },
            { $project: { _id: 0, value: "$_id", label: "$_id", count: 1 } },
            { $sort: { count: -1, label: 1 } },
          ],
          collections: [
            { $unwind: "$collectionIds" },
            { $match: { collectionIds: { $nin: [null, ""] } } },
            { $group: { _id: "$collectionIds", count: { $sum: 1 } } },
            {
              $lookup: {
                from: "collections",
                let: { collectionRef: { $toString: "$_id" } },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $ne: ["$active", false] },
                          {
                            $or: [
                              { $eq: [{ $toString: "$_id" }, "$$collectionRef"] },
                              { $eq: ["$slug", "$$collectionRef"] },
                              { $eq: ["$name", "$$collectionRef"] },
                            ],
                          },
                        ],
                      },
                    },
                  },
                  { $limit: 1 },
                ],
                as: "collection",
              },
            },
            { $unwind: "$collection" },
            { $project: { _id: 0, value: { $toString: "$_id" }, label: { $ifNull: ["$collection.name", { $ifNull: ["$collection.title", "$collection.slug"] }] }, count: 1 } },
            { $sort: { count: -1, label: 1 } },
          ],
          tags: [
            { $unwind: "$tags" },
            { $match: { tags: { $nin: [null, ""] } } },
            { $group: { _id: "$tags", count: { $sum: 1 } } },
            { $project: { _id: 0, value: "$_id", label: "$_id", count: 1 } },
            { $sort: { count: -1, label: 1 } },
          ],
          attributes: [
            { $unwind: "$_facetAttributeEntries" },
            { $match: { "_facetAttributeEntries.k": { $nin: [null, ""] }, "_facetAttributeEntries.v": { $nin: [null, ""] } } },
            {
              $set: {
                _facetAttributeDefinition: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: { $ifNull: ["$_activeCategory.attributeSchema", []] },
                        as: "definition",
                        cond: {
                          $and: [
                            { $eq: ["$$definition.key", "$_facetAttributeEntries.k"] },
                            { $eq: ["$$definition.isFilterable", true] },
                            { $in: ["$$definition.type", ["select", "multi_select", "boolean"]] },
                          ],
                        },
                      },
                    },
                    0,
                  ],
                },
              },
            },
            { $match: { "_facetAttributeDefinition.key": { $nin: [null, ""] } } },
            { $set: { _facetAttributeValues: { $cond: [{ $isArray: "$_facetAttributeEntries.v" }, "$_facetAttributeEntries.v", ["$_facetAttributeEntries.v"]] } } },
            { $unwind: "$_facetAttributeValues" },
            { $match: { _facetAttributeValues: { $nin: [null, ""] } } },
            {
              $group: {
                _id: {
                  productId: "$_id",
                  key: "$_facetAttributeEntries.k",
                  value: { $toString: "$_facetAttributeValues" },
                },
                definition: { $first: "$_facetAttributeDefinition" },
              },
            },
            {
              $group: {
                _id: { key: "$_id.key", value: "$_id.value" },
                count: { $sum: 1 },
                definition: { $first: "$definition" },
              },
            },
            { $group: { _id: "$_id.key", values: { $push: { value: "$_id.value", label: "$_id.value", count: "$count" } }, count: { $sum: "$count" }, definition: { $first: "$definition" } } },
            { $project: { _id: 0, key: "$_id", label: { $ifNull: ["$definition.label", "$_id"] }, type: "$definition.type", searchable: { $ifNull: ["$definition.isSearchable", false] }, variant: { $ifNull: ["$definition.isVariantAttribute", false] }, count: 1, values: 1 } },
            { $sort: { key: 1 } },
          ],
          price: [{ $match: { _facetPrice: { $type: "number", $gt: 0 } } }, { $group: { _id: null, min: { $min: "$_facetPrice" }, max: { $max: "$_facetPrice" } } }, { $project: { _id: 0, min: 1, max: 1 } }],
          ratings: [{ $match: { rating: { $type: "number", $gt: 0 } } }, { $project: { rating: { $floor: "$rating" } } }, { $group: { _id: "$rating", count: { $sum: 1 } } }, { $project: { _id: 0, value: { $toString: "$_id" }, label: { $concat: [{ $toString: "$_id" }, "★ & up"] }, count: 1 } }, { $sort: { value: -1 } }],
          availability: [{ $group: { _id: null, inStock: { $sum: { $cond: [{ $gt: ["$_facetAvailableStock", 0] }, 1, 0] } }, outOfStock: { $sum: { $cond: [{ $gt: ["$_facetAvailableStock", 0] }, 0, 1] } } } }, { $project: { _id: 0, inStock: 1, outOfStock: 1 } }],
          merchandising: [{
            $group: {
              _id: null,
              featured: { $sum: { $cond: [{ $eq: ["$metadata.featured", true] }, 1, 0] } },
              bestSeller: { $sum: { $cond: [{ $or: [{ $eq: ["$metadata.bestSeller", true] }, { $eq: ["$metadata.isBestSeller", true] }] }, 1, 0] } },
              newArrival: { $sum: { $cond: [{ $gte: ["$createdAt", newArrivalCutoff] }, 1, 0] } },
            },
          }, { $project: { _id: 0, featured: 1, bestSeller: 1, newArrival: 1 } }],
        },
      },
    ]).allowDiskUse(true);

    const ratingBuckets = result.ratings || [];
    const ratings = [5, 4, 3, 2, 1]
      .map((stars) => ({
        value: String(stars),
        label: `${stars}★ & up`,
        count: ratingBuckets.reduce(
          (total, bucket) =>
            total + (Number(bucket.value) >= stars ? Number(bucket.count || 0) : 0),
          0,
        ),
      }))
      .filter((bucket) => bucket.count > 0);

    return {
      items: result.items || [],
      total: result.total?.[0]?.count || 0,
      facets: {
        categories: result.categories || [],
        brands: result.brands || [],
        collections: result.collections || [],
        tags: result.tags || [],
        attributes: result.attributes || [],
        price: result.price?.[0] || { min: null, max: null },
        ratings,
        availability: result.availability?.[0] || { inStock: 0, outOfStock: 0 },
        merchandising: result.merchandising?.[0] || { featured: 0, bestSeller: 0, newArrival: 0 },
      },
    };
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
    const product = await ProductModel.findById(productId).lean();
    if (!product || !Array.isArray(product.variants) || !product.variants.length) return product;

    const stock = product.variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);
    const reservedStock = product.variants.reduce((total, variant) => total + Number(variant.reservedStock || 0), 0);
    return ProductModel.findByIdAndUpdate(
      productId,
      {
        $set: {
          stock,
          reservedStock,
          hasVariants: true,
          "inventorySettings.manageVariantInventory": true,
        },
      },
      { new: true },
    );
  }

  async adjustVariantStock(productId, variantSku, adjustment) {
    if (adjustment === 0) return ProductModel.findById(productId);

    const variantFilter = { _id: productId, "variants.sku": variantSku };

    if (adjustment > 0) {
      const updated = await ProductModel.findOneAndUpdate(
        variantFilter,
        { $inc: { "variants.$.stock": adjustment, stock: adjustment } },
        { new: true },
      );
      return updated;
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
      { $inc: { "variants.$.stock": -quantity, stock: -quantity } },
      { new: true },
    );
    return updated;
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
      { $inc: { "variants.$.reservedStock": quantity, reservedStock: quantity } },
      { new: true },
    );
    return updated;
  }

  async releaseReservedVariantStock(productId, variantSku, quantity) {
    const updated = await ProductModel.findOneAndUpdate(
      {
        _id: productId,
        variants: { $elemMatch: { sku: variantSku, reservedStock: { $gte: quantity } } },
      },
      { $inc: { "variants.$.reservedStock": -quantity, reservedStock: -quantity } },
      { new: true },
    );
    return updated;
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
      {
        $inc: {
          "variants.$.reservedStock": -quantity,
          "variants.$.stock": -quantity,
          reservedStock: -quantity,
          stock: -quantity,
        },
      },
      { new: true },
    );
    return updated;
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
        const primaryDiff = Number(b.analytics?.[key] || 0) - Number(a.analytics?.[key] || 0);
        if (primaryDiff) return primaryDiff;

        return (
          Number(b.analytics?.views || 0) - Number(a.analytics?.views || 0) ||
          Number(b.analytics?.cartAdds || 0) - Number(a.analytics?.cartAdds || 0) ||
          Number(b.analytics?.wishlistAdds || 0) - Number(a.analytics?.wishlistAdds || 0)
        );
      })
      .slice(0, safeLimit);
  }
}

module.exports = { ProductRepository };
