const slugify = require("slugify");
const { getPage } = require("../../../shared/tools/page");
const { ProductRepository } = require("../repositories/product.repository");
const { elasticsearchClient } = require("../../../shared/search/elasticsearch-client");
const { remember, forget } = require("../../../shared/tools/cache");
const { AppError } = require("../../../shared/errors/app-error");
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
} = require("../../../shared/domain/commerce-constants");
const { logger } = require("../../../shared/logger/logger");
const { PlatformRepository } = require("../../platform/repositories/platform.repository");

class ProductService {
  constructor({
    productRepository = new ProductRepository(),
    platformRepository = new PlatformRepository(),
  } = {}) {
    this.productRepository = productRepository;
    this.platformRepository = platformRepository;
  }

  // ─── Category & attribute helpers ─────────────────────────────────────────

  normalizeCategoryAttributes(category = {}) {
    if (Array.isArray(category.attributeSchema) && category.attributeSchema.length) {
      return category.attributeSchema;
    }
    const legacy = category.attributesSchema || {};
    return Object.keys(legacy).map((key) => ({
      key,
      type: Array.isArray(legacy[key]) ? "multi_select" : "text",
      required: false,
      options: Array.isArray(legacy[key]) ? legacy[key] : [],
    }));
  }

  validateDynamicAttributes(attributeSchema = [], attributes = {}) {
    const normalizedAttributes =
      attributes instanceof Map ? Object.fromEntries(attributes) : attributes;
    for (const field of attributeSchema) {
      const value = normalizedAttributes?.[field.key];
      if (field.required && (value === undefined || value === null || value === "")) {
        throw new AppError(`Attribute '${field.key}' is required`, 400);
      }
      if (value === undefined || value === null) continue;
      if (field.type === "number" && Number.isNaN(Number(value))) {
        throw new AppError(`Attribute '${field.key}' must be a number`, 400);
      }
      if (field.type === "boolean" && typeof value !== "boolean") {
        throw new AppError(`Attribute '${field.key}' must be boolean`, 400);
      }
      if (
        field.type === "select" &&
        Array.isArray(field.options) &&
        field.options.length &&
        !field.options.includes(String(value))
      ) {
        throw new AppError(`Attribute '${field.key}' has invalid option`, 400);
      }
      if (field.type === "multi_select") {
        if (!Array.isArray(value)) throw new AppError(`Attribute '${field.key}' must be an array`, 400);
        if (Array.isArray(field.options) && field.options.length) {
          const bad = value.find((item) => !field.options.includes(String(item)));
          if (bad !== undefined) throw new AppError(`Attribute '${field.key}' has invalid option`, 400);
        }
      }
    }
  }

  // ─── Variant helpers ──────────────────────────────────────────────────────

  validateVariants(variants = []) {
    const skus = new Set();
    for (const variant of variants) {
      if (!variant?.sku) continue;
      if (skus.has(variant.sku)) throw new AppError("Variant SKU must be unique", 400);
      skus.add(variant.sku);
      if (variant.stock !== undefined && Number(variant.stock) < 0) {
        throw new AppError("Variant stock must be non-negative", 400);
      }
    }
  }

  generateVariantCombinations(options = []) {
    if (!options.length) return [];
    const [first, ...rest] = options;
    const restCombinations = rest.length ? this.generateVariantCombinations(rest) : [{}];
    return first.values.flatMap((value) =>
      restCombinations.map((combo) => ({
        ...combo,
        [first.name.toLowerCase()]: value,
      })),
    );
  }

  buildVariantsFromOptions(options = [], basePrice = 0, baseMrp = 0) {
    const combinations = this.generateVariantCombinations(options);
    return combinations.map((attributes, index) => ({
      sku: `SKU-${Date.now()}-${index + 1}`,
      attributes,
      price: basePrice,
      mrp: baseMrp,
      stock: 0,
      status: "active",
    }));
  }

  // ─── Media helpers ────────────────────────────────────────────────────────

  normalizeImages(images = []) {
    if (!Array.isArray(images)) return [];
    return Array.from(
      new Set(
        images
          .map((img) => (typeof img === "string" ? img.trim() : ""))
          .filter(Boolean),
      ),
    );
  }

  normalizeProductMedia(payload = {}) {
    const normalized = { ...payload };
    if (Object.prototype.hasOwnProperty.call(payload, "images")) {
      normalized.images = this.normalizeImages(payload.images);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "variants")) {
      normalized.variants = (payload.variants || []).map((v) => ({
        ...v,
        images: this.normalizeImages(v.images),
      }));
    }
    return normalized;
  }

  // ─── Elasticsearch ────────────────────────────────────────────────────────

  _buildSearchDocument(product) {
    return {
      id: String(product._id || product.id),
      title: product.title,
      shortDescription: product.shortDescription || "",
      category: product.category,
      categoryId: product.categoryId,
      brand: product.brand || "",
      description: product.description,
      price: product.price,
      salePrice: product.salePrice || product.price,
      gstRate: product.gstRate || 18,
      hsnCode: product.hsnCode || "",
      color: product.color || "",
      productType: product.productType || PRODUCT_TYPE.SIMPLE,
      tags: Array.isArray(product.tags) ? product.tags : [],
      origin: product.origin || {},
      sellerId: product.sellerId,
      stock: product.stock || 0,
      availableStock: Math.max(0, (product.stock || 0) - (product.reservedStock || 0)),
      rating: product.rating || 0,
      reviewCount: product.reviewCount || 0,
      analytics: {
        views: product.analytics?.views || 0,
        purchases: product.analytics?.purchases || 0,
      },
      attributes: product.attributes
        ? Object.fromEntries(
            product.attributes instanceof Map
              ? product.attributes
              : Object.entries(product.attributes),
          )
        : {},
      status: product.status,
      visibility: product.visibility || PRODUCT_VISIBILITY.PUBLIC,
      publishedAt: product.publishedAt || product.createdAt,
    };
  }

  async _indexProduct(product) {
    try {
      await elasticsearchClient.index({
        index: "products",
        id: String(product._id || product.id),
        document: this._buildSearchDocument(product),
      });
    } catch (err) {
      logger.error({ err, productId: product._id }, "Elasticsearch index failed");
    }
  }

  async _deleteFromIndex(productId) {
    try {
      await elasticsearchClient.delete({ index: "products", id: String(productId) });
    } catch (err) {
      if (err?.meta?.statusCode !== 404) {
        logger.error({ err, productId }, "Elasticsearch delete failed");
      }
    }
  }

  _invalidateProductCache() {
    if (typeof forget === "function") {
      forget(/^products:/);
    }
  }

  // ─── Type-specific validation ─────────────────────────────────────────────

  _validateProductType(productType, payload) {
    if (productType === PRODUCT_TYPE.BUNDLE) {
      if (!Array.isArray(payload.bundleItems) || payload.bundleItems.length === 0) {
        throw new AppError("Bundle products require at least one bundle item", 400);
      }
    }
    if (productType === PRODUCT_TYPE.DIGITAL) {
      if (!payload.digital?.fileUrl && !payload.digital?.previewUrl) {
        logger.warn("Digital product created without file URL");
      }
    }
    if (productType === PRODUCT_TYPE.SUBSCRIPTION) {
      if (!payload.subscription?.recurringPrice && payload.subscription?.recurringPrice !== 0) {
        throw new AppError("Subscription products require a recurring price", 400);
      }
    }
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async createProduct(payload, actor) {
    payload = this.normalizeProductMedia(payload);
    const productType = payload.productType || PRODUCT_TYPE.SIMPLE;

    const categoryKey = payload.categoryId || payload.category;
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw new AppError("Category not found", 400);

    this.validateDynamicAttributes(
      this.normalizeCategoryAttributes(category),
      payload.attributes || {},
    );
    this.validateVariants(payload.variants || []);
    this._validateProductType(productType, payload);

    const isSeller = actor.role === "seller" || actor.role === "seller-sub-admin";
    const status = isSeller
      ? PRODUCT_STATUS.PENDING_APPROVAL
      : payload.status || PRODUCT_STATUS.DRAFT;
    const sellerId = isSeller
      ? actor.ownerSellerId || actor.userId
      : payload.sellerId || actor.userId;

    const hasVariants =
      (payload.hasVariants === true) ||
      (Array.isArray(payload.variants) && payload.variants.length > 0);

    const product = await this.productRepository.create({
      ...payload,
      categoryId: payload.categoryId || payload.category,
      productType,
      status,
      sellerId,
      hasVariants,
      slug: slugify(`${payload.title}-${Date.now()}`, { lower: true, strict: true }),
      publishedAt: status === PRODUCT_STATUS.ACTIVE ? new Date() : null,
      moderation: {
        submittedAt: new Date(),
        checklist: {
          titleVerified: false,
          categoryVerified: false,
          complianceVerified: false,
          mediaVerified: false,
          pricingVerified: false,
          inventoryVerified: false,
        },
      },
      createdBy: actor.userId,
    });

    if (product.status === PRODUCT_STATUS.ACTIVE) {
      await this._indexProduct(product);
    }
    this._invalidateProductCache();

    return product;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async updateProduct(productId, payload, actor) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);

    if (
      (actor.role === "seller" || actor.role === "seller-sub-admin") &&
      existingProduct.sellerId !== (actor.ownerSellerId || actor.userId)
    ) {
      throw new AppError("Permission denied", 403);
    }

    payload = this.normalizeProductMedia(payload);

    const categoryKey =
      payload.categoryId || payload.category || existingProduct.categoryId || existingProduct.category;
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw new AppError("Category not found", 400);

    const nextAttributes = payload.attributes || existingProduct.attributes || {};
    this.validateDynamicAttributes(this.normalizeCategoryAttributes(category), nextAttributes);
    this.validateVariants(payload.variants || existingProduct.variants || []);

    const productType = payload.productType || existingProduct.productType || PRODUCT_TYPE.SIMPLE;
    this._validateProductType(productType, { ...existingProduct.toObject(), ...payload });

    const hasVariants =
      payload.hasVariants !== undefined
        ? payload.hasVariants
        : (Array.isArray(payload.variants) && payload.variants.length > 0) ||
          existingProduct.hasVariants;

    const updatePayload = {
      ...payload,
      ...(payload.categoryId || payload.category
        ? { categoryId: payload.categoryId || payload.category }
        : {}),
      hasVariants,
      lastUpdatedBy: actor.userId,
      version: (existingProduct.version || 1) + 1,
    };

    // Re-submit for review if seller edits a rejected product
    if (
      isSeller(actor) &&
      existingProduct.status === PRODUCT_STATUS.REJECTED
    ) {
      updatePayload.status = PRODUCT_STATUS.PENDING_APPROVAL;
      updatePayload["moderation.submittedAt"] = new Date();
      updatePayload["moderation.revisionCount"] =
        (existingProduct.moderation?.revisionCount || 0) + 1;
    }

    const updatedProduct = await this.productRepository.update(productId, updatePayload);

    if (updatedProduct.status === PRODUCT_STATUS.ACTIVE) {
      await this._indexProduct(updatedProduct);
    } else {
      await this._deleteFromIndex(productId);
    }
    this._invalidateProductCache();

    return updatedProduct;
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async listProducts(query) {
    const pagination = { ...getPage(query), sortBy: query.sortBy || query.sort };
    const filter = {};

    if (query.category) {
      const categoryKeys = await this.platformRepository.getCategoryDescendantKeys(query.category);
      filter.category = categoryKeys.length ? { $in: categoryKeys } : query.category;
    }
    if (query.hsnCode) filter.hsnCode = query.hsnCode;
    if (query.color) filter.color = query.color;
    if (query.productFamilyCode || query.family || query.familyCode) {
      filter.productFamilyCode = query.productFamilyCode || query.family || query.familyCode;
    }
    if (query.sku) filter.sku = query.sku;
    if (query.brand) filter.brand = new RegExp(`^${escapeRegExp(query.brand)}$`, "i");
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.productType) filter.productType = query.productType;
    if (query.visibility) filter.visibility = query.visibility;
    if (query.tags) filter.tags = { $in: query.tags.split(",").map((t) => t.trim()) };
    if (query.rating) filter.rating = { $gte: Number(query.rating) };

    this.applyAttributeFilters(filter, query);

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {};
      if (query.minPrice !== undefined) filter.price.$gte = Number(query.minPrice);
      if (query.maxPrice !== undefined) filter.price.$lte = Number(query.maxPrice);
    }

    if (query.inStock === true || query.inStock === "true") {
      filter.$expr = { $gt: [{ $subtract: ["$stock", "$reservedStock"] }, 0] };
    }

    const searchTerm = query.q || query.keyWord || query.search;
    if (searchTerm) {
      filter.$or = [
        { title: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
        { sku: { $regex: searchTerm, $options: "i" } },
        { brand: { $regex: searchTerm, $options: "i" } },
        { tags: { $regex: searchTerm, $options: "i" } },
      ];
    }

    if (query.country) filter["origin.country"] = query.country;
    if (query.state) filter["origin.state"] = query.state;
    if (query.city) filter["origin.city"] = query.city;

    if (query.includeAllStatuses === true || query.includeAllStatuses === "true") {
      if (query.status) filter.status = query.status;
    } else {
      filter.status = query.status || PRODUCT_STATUS.ACTIVE;
    }

    const cacheKey = `products:${JSON.stringify({ filter, pagination })}`;
    return remember(cacheKey, 60, () =>
      this.productRepository.paginate(filter, pagination),
    );
  }

  async listSellerProducts(query, actor) {
    const pagination = { ...getPage(query), sortBy: query.sortBy || query.sort };
    const sellerId = actor.ownerSellerId || actor.userId;
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.category) {
      const categoryKeys = await this.platformRepository.getCategoryDescendantKeys(query.category);
      filter.category = categoryKeys.length ? { $in: categoryKeys } : query.category;
    }
    if (query.sku) filter.sku = query.sku;
    if (query.brand) filter.brand = new RegExp(`^${escapeRegExp(query.brand)}$`, "i");
    if (query.productFamilyCode || query.family || query.familyCode) {
      filter.productFamilyCode = query.productFamilyCode || query.family || query.familyCode;
    }
    if (query.productType) filter.productType = query.productType;
    this.applyAttributeFilters(filter, query);
    return this.productRepository.paginateBySeller(sellerId, filter, pagination);
  }

  applyAttributeFilters(filter, query = {}) {
    const reserved = new Set([
      "page",
      "limit",
      "q",
      "keyWord",
      "search",
      "category",
      "status",
      "productType",
      "visibility",
      "hsnCode",
      "color",
      "country",
      "state",
      "city",
      "productFamilyCode",
      "family",
      "familyCode",
      "sku",
      "brand",
      "tags",
      "sellerId",
      "minPrice",
      "maxPrice",
      "inStock",
      "includeAllStatuses",
      "sort",
      "sortBy",
      "rating",
    ]);

    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      const attributeKey = key.startsWith("attr_")
        ? key.replace(/^attr_/, "")
        : key.startsWith("attribute.")
          ? key.replace(/^attribute\./, "")
          : null;

      if (attributeKey) {
        filter[`attributes.${attributeKey}`] = parseFilterValue(value);
        return;
      }

      if (!reserved.has(key)) {
        filter[`attributes.${key}`] = parseFilterValue(value);
      }
    });
  }

  // ─── Get single ───────────────────────────────────────────────────────────

  async getProduct(productId) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);
    return product;
  }

  async trackView(productId) {
    try {
      await this.productRepository.recordView(productId);
    } catch (err) {
      logger.warn({ err, productId }, "Failed to track product view");
    }
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async searchProducts(query) {
    try {
      const esQuery = {
        bool: {
          must: [
            {
              multi_match: {
                query: query.q,
                fields: ["title^4", "brand^2", "category^2", "description", "tags^3", "color", "hsnCode"],
                fuzziness: "AUTO",
                prefix_length: 2,
              },
            },
          ],
          filter: [{ term: { status: "active" } }],
        },
      };

      if (query.category) esQuery.bool.filter.push({ term: { category: query.category } });
      if (query.brand) esQuery.bool.filter.push({ term: { brand: query.brand } });
      if (query.productType) esQuery.bool.filter.push({ term: { productType: query.productType } });
      if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        const range = {};
        if (query.minPrice !== undefined) range.gte = Number(query.minPrice);
        if (query.maxPrice !== undefined) range.lte = Number(query.maxPrice);
        esQuery.bool.filter.push({ range: { price: range } });
      }

      const page = Number(query.page || 1);
      const limit = Number(query.limit || 20);

      const response = await elasticsearchClient.search({
        index: "products",
        from: (page - 1) * limit,
        size: limit,
        query: esQuery,
        sort: [{ _score: "desc" }, { "analytics.purchases": "desc" }],
      });

      return {
        items: response.hits.hits.map((hit) => ({ ...hit._source, _score: hit._score })),
        total: response.hits.total?.value ?? response.hits.hits.length,
      };
    } catch (error) {
      logger.warn({ err: error, q: query.q }, "Elasticsearch search failed, falling back to Mongo");
      const items = await this.productRepository.search(query.q, Number(query.limit || 50));
      return { items, total: items.length };
    }
  }

  // ─── Review / moderation ──────────────────────────────────────────────────

  async reviewProduct(productId, payload, actor) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);

    const nextStatus = payload.status;
    const isApproval = nextStatus === PRODUCT_STATUS.ACTIVE;
    const isRejection = nextStatus === PRODUCT_STATUS.REJECTED;

    if (isRejection && !payload.rejectionReason) {
      throw new AppError("Rejection reason is required", 400);
    }

    const updatedProduct = await this.productRepository.reviewProduct(productId, {
      status: nextStatus,
      approvedBy: isApproval ? actor.userId : null,
      approvedAt: isApproval ? new Date() : null,
      publishedAt: isApproval ? new Date() : existingProduct.publishedAt,
      rejectionReason: isRejection ? payload.rejectionReason || null : null,
      moderation: {
        ...(existingProduct.moderation?.toObject?.() || existingProduct.moderation || {}),
        reviewedAt: new Date(),
        reviewedBy: actor.userId,
        rejectionReason: payload.rejectionReason || null,
        notes: payload.notes || null,
        checklist: payload.checklist || existingProduct.moderation?.checklist || {},
      },
    });

    if (nextStatus === PRODUCT_STATUS.ACTIVE) {
      await this._indexProduct(updatedProduct);
    } else {
      await this._deleteFromIndex(productId);
    }
    this._invalidateProductCache();

    return updatedProduct;
  }

  // ─── Bulk operations ─────────────────────────────────────────────────────

  async bulkUpdateStatus(productIds, status, actor) {
    await this.productRepository.bulkUpdateStatus(productIds, status, actor.userId);

    if (status === PRODUCT_STATUS.ACTIVE) {
      const products = await this.productRepository.findByIds(productIds);
      await Promise.allSettled(products.map((p) => this._indexProduct(p)));
    } else {
      await Promise.allSettled(productIds.map((id) => this._deleteFromIndex(id)));
    }
    this._invalidateProductCache();

    return { updated: productIds.length, status };
  }

  async bulkUpdateVisibility(productIds, visibility) {
    await this.productRepository.bulkUpdateVisibility(productIds, visibility);
    this._invalidateProductCache();
    return { updated: productIds.length, visibility };
  }

  // ─── Inventory management ─────────────────────────────────────────────────

  async adjustInventory(productId, payload, actor) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);

    const { adjustment, variantSku } = payload;

    let updatedProduct;
    if (variantSku) {
      updatedProduct = await this.productRepository.adjustVariantStock(
        productId,
        variantSku,
        adjustment,
      );
    } else {
      updatedProduct = await this.productRepository.adjustStock(productId, adjustment);
    }

    if (!updatedProduct) {
      throw new AppError("Insufficient stock for negative adjustment", 400);
    }

    this._invalidateProductCache();
    return updatedProduct;
  }

  async getInventoryStats(sellerId = null) {
    const [stats] = await this.productRepository.getInventoryStats(sellerId);
    return stats || {
      totalProducts: 0,
      totalStock: 0,
      totalReserved: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
    };
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async deleteProduct(productId, actor) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);

    const sellerId = actor.ownerSellerId || actor.userId;
    if (
      ["seller", "seller-sub-admin"].includes(actor.role) &&
      existingProduct.sellerId !== sellerId
    ) {
      throw new AppError("Permission denied", 403);
    }

    await this.productRepository.delete(productId);
    await this._deleteFromIndex(productId);
    this._invalidateProductCache();

    return { deleted: true, productId };
  }

  // ─── Analytics ───────────────────────────────────────────────────────────

  async getTopProducts(limit = 10, metric = "purchases") {
    return this.productRepository.getTopProducts(limit, metric);
  }
}

// helper
function isSeller(actor) {
  return actor.role === "seller" || actor.role === "seller-sub-admin";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFilterValue(value) {
  if (Array.isArray(value)) return { $in: value.map(String) };
  const parts = String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return { $in: parts };
  return parts[0] || value;
}

module.exports = { ProductService };
