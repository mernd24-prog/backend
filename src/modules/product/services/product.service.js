const slugify = require("slugify");
const { getPage } = require("../../../shared/tools/page");
const { ProductRepository } = require("../repositories/product.repository");
const {
  elasticsearchClient,
  isElasticsearchEnabled,
} = require("../../../shared/search/elasticsearch-client");
const { remember, forget } = require("../../../shared/tools/cache");
const { AppError } = require("../../../shared/errors/app-error");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { InventoryService } = require("../../inventory/services/inventory.service");
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
  PRODUCT_REVISION_STATUS,
  PRODUCT_REVISION_WORKFLOW_STATUS,
} = require("../../../shared/domain/commerce-constants");
const {
  applyPublicProductFilter,
  buildPublicSearchFilters,
  isPublicProduct,
} = require("../../../shared/catalog/public-product-filter");
const { logger } = require("../../../shared/logger/logger");
const { PlatformRepository } = require("../../platform/repositories/platform.repository");
const { PlatformService } = require("../../platform/services/platform.service");
const { WarehouseModel } = require("../../inventory/models/warehouse.model");
const { UserModel } = require("../../user/models/user.model");
const {
  AdminCountryModel,
  AdminStateModel,
  AdminCityModel,
} = require("../../admin/models/common-management.model");

const SELLER_BLOCKED_COMPLIANCE_FIELDS = [
  "gstRate",
  "cessRate",
  "taxType",
  "taxClass",
  "taxClassId",
  "taxRuleId",
  "platformFee",
  "platformFeeAmount",
  "platformFeeRate",
  "platformFeeConfigId",
  "commissionRate",
  "commissionPercent",
  "commissionAmount",
  "commissionRuleId",
  "settlementRuleId",
  "sellerTier",
];

class ProductService {
  constructor({
    productRepository = new ProductRepository(),
    platformRepository = new PlatformRepository(),
    platformService = null,
    inventoryService = null,
  } = {}) {
    this.productRepository = productRepository;
    this.platformRepository = platformRepository;
    this.platformService = platformService || new PlatformService({ platformRepository });
    this.inventoryService = inventoryService || new InventoryService({ productRepository });
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

  normalizeVariantAxis(option = {}) {
    return String(option.slug || option.name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  normalizeProductOptions(options = []) {
    if (!Array.isArray(options)) return [];
    return options
      .map((option, index) => {
        const name = String(option?.name || "").trim();
        const slug = this.normalizeVariantAxis(option);
        const values = Array.from(
          new Set(
            (Array.isArray(option?.values) ? option.values : [])
              .map((value) => String(value || "").trim())
              .filter(Boolean),
          ),
        );

        if (!name || !values.length) return null;

        return {
          ...option,
          name,
          slug,
          values,
          sortOrder: Number(option.sortOrder) || index,
        };
      })
      .filter(Boolean);
  }

  normalizeVariantAttributes(attributes = {}) {
    const source = attributes instanceof Map ? Object.fromEntries(attributes) : attributes;
    return Object.entries(source || {}).reduce((acc, [key, value]) => {
      const axis = this.normalizeVariantAxis({ name: key });
      if (axis) acc[axis] = value;
      return acc;
    }, {});
  }

  validateVariants(variants = [], options = []) {
    const skus = new Set();
    const optionMap = new Map(
      options.map((option) => [
        this.normalizeVariantAxis(option),
        new Set((option.values || []).map((value) => String(value))),
      ]),
    );

    for (const variant of variants) {
      if (!variant?.sku) continue;
      if (skus.has(variant.sku)) throw new AppError("Variant SKU must be unique", 400);
      skus.add(variant.sku);
      if (variant.stock !== undefined && Number(variant.stock) < 0) {
        throw new AppError("Variant stock must be non-negative", 400);
      }

      const attributes = this.normalizeVariantAttributes(variant.attributes || {});
      for (const [axis, value] of Object.entries(attributes)) {
        if (!optionMap.has(axis)) {
          throw new AppError(`Variant attribute '${axis}' is not configured as a product option`, 400);
        }
        if (!optionMap.get(axis).has(String(value))) {
          throw new AppError(`Variant attribute '${axis}' has invalid value '${value}'`, 400);
        }
      }
    }
  }

  generateVariantCombinations(options = []) {
    if (!options.length) return [];
    const [first, ...rest] = options;
    const restCombinations = rest.length ? this.generateVariantCombinations(rest) : [{}];
    const axis = this.normalizeVariantAxis(first);
    return first.values.flatMap((value) =>
      restCombinations.map((combo) => ({
        ...combo,
        [axis]: value,
      })),
    );
  }

  buildVariantsFromOptions(options = [], basePrice = 0, baseMrp = 0) {
    const combinations = this.generateVariantCombinations(options);
    return combinations.map((attributes, index) => ({
      sku: `SKU-${Date.now()}-${index + 1}`,
      title: Object.values(attributes).join(" / "),
      attributes,
      price: basePrice,
      mrp: baseMrp,
      stock: 0,
      status: "active",
      isDefault: index === 0,
      sortOrder: index,
    }));
  }

  normalizeProductVariants(payload = {}) {
    const hasOptionPayload = Object.prototype.hasOwnProperty.call(payload, "options");
    const hasVariantPayload = Object.prototype.hasOwnProperty.call(payload, "variants");
    const hasVariantAxisPayload = Object.prototype.hasOwnProperty.call(payload, "variantAxes");

    if (!hasOptionPayload && !hasVariantPayload && !hasVariantAxisPayload) {
      return payload;
    }

    const options = this.normalizeProductOptions(payload.options || []);
    const explicitVariants = Array.isArray(payload.variants) ? payload.variants : [];
    const variants = explicitVariants.length
      ? explicitVariants.map((variant, index) => {
          const attributes = this.normalizeVariantAttributes(variant.attributes || {});
          return {
            ...variant,
            attributes,
            title: variant.title || Object.values(attributes).join(" / "),
            isDefault: variant.isDefault === true || (!explicitVariants.some((v) => v.isDefault) && index === 0),
            sortOrder: variant.sortOrder ?? index,
          };
        })
      : options.length
        ? this.buildVariantsFromOptions(options, payload.price || 0, payload.mrp || 0)
        : [];

    const variantAxes = options.length
      ? options.map((option) => this.normalizeVariantAxis(option))
      : Array.isArray(payload.variantAxes)
        ? payload.variantAxes.map((axis) => this.normalizeVariantAxis({ name: axis })).filter(Boolean)
        : [];

    return {
      ...payload,
      ...(hasOptionPayload ? { options } : {}),
      ...(hasVariantPayload || (hasOptionPayload && variants.length) ? { variants } : {}),
      variantAxes,
      hasVariants: payload.hasVariants === true || variants.length > 0,
      defaultVariantId: payload.defaultVariantId,
    };
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

  // ─── Compliance helpers ──────────────────────────────────────────────────

  stripSellerComplianceFields(payload = {}) {
    const normalized = { ...payload };
    for (const field of SELLER_BLOCKED_COMPLIANCE_FIELDS) {
      delete normalized[field];
    }

    if (Array.isArray(normalized.variants)) {
      normalized.variants = normalized.variants.map((variant) => {
        if (!variant || typeof variant !== "object") return variant;
        const nextVariant = { ...variant };
        for (const field of SELLER_BLOCKED_COMPLIANCE_FIELDS) {
          delete nextVariant[field];
        }
        return nextVariant;
      });
    }

    return normalized;
  }

  async normalizeProductCompliance(payload = {}, actor = {}, existingProduct = null) {
    const isSeller = isSellerRole(actor);
    let normalized = isSeller ? this.stripSellerComplianceFields(payload) : { ...payload };

    if (!Object.prototype.hasOwnProperty.call(normalized, "hsnCode")) {
      return normalized;
    }

    const hsnCode = String(normalized.hsnCode || "").trim();
    if (!hsnCode) {
      if (isSeller && existingProduct) {
        delete normalized.hsnCode;
        delete normalized.gstRate;
        delete normalized.complianceSnapshot;
        return normalized;
      }
      normalized.hsnCode = "";
      normalized.complianceSnapshot = null;
      if (isSeller) {
        delete normalized.gstRate;
      }
      return normalized;
    }

    const hsnRule = await this.platformRepository.getHsnCode(hsnCode);
    if (!hsnRule || hsnRule.active === false) {
      throw new AppError("HSN code must be an active approved master record", 400);
    }

    normalized.hsnCode = hsnRule.code;
    normalized.gstRate = Number(hsnRule.gstRate || 0);
    normalized.complianceSnapshot = {
      hsnCode: hsnRule.code,
      gstRate: Number(hsnRule.gstRate || 0),
      cessRate: Number(hsnRule.cessRate || 0),
      taxType: hsnRule.taxType || "gst",
      exempt: Boolean(hsnRule.exempt),
      source: "hsn_master",
      validatedAt: new Date(),
      validatedBy: actor.userId || existingProduct?.lastUpdatedBy || existingProduct?.createdBy || "system",
    };

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
      scheduledAt: product.scheduledAt || null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  async _indexProduct(product) {
    if (!isElasticsearchEnabled()) return;

    const productId = product?._id || product?.id;
    if (!productId) return;

    if (!isPublicProduct(product)) {
      await this._deleteFromIndex(productId);
      return;
    }

    try {
      await elasticsearchClient.index({
        index: "products",
        id: String(productId),
        document: this._buildSearchDocument(product),
      });
    } catch (err) {
      logger.error({ err, productId }, "Elasticsearch index failed");
    }
  }

  async _deleteFromIndex(productId) {
    if (!isElasticsearchEnabled()) return;

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

  async listRawMasterCollection(collectionName, filter = {}, { sort = {}, limit = 500 } = {}) {
    const collection = mongoose.connection.collection(collectionName);
    return collection
      .find(filter)
      .sort(sort)
      .limit(limit)
      .toArray();
  }

  async getProductPrefillData(query = {}, actor = {}) {
    const includeInactive = query.includeInactive === true || query.includeInactive === "true";
    const includeProducts = query.includeProducts !== false && query.includeProducts !== "false";
    const productLimit = Math.min(200, Math.max(1, Number(query.productLimit || query.limit || 100)));
    const sellerId = isSellerRole(actor)
      ? actor.ownerSellerId || actor.userId
      : query.sellerId || null;

    const cacheKey = `products:prefill:${JSON.stringify({
      includeInactive,
      includeProducts,
      sellerId,
      productLimit,
    })}`;

    return remember(cacheKey, 300, async () => {
      const activeFilter = includeInactive ? {} : { active: true };
      const rawActiveFilter = includeInactive
        ? {}
        : { $or: [{ active: true }, { isActive: true }, { active: { $exists: false }, isActive: { $exists: false } }] };

      const [
        catalog,
        collections,
        tags,
        badges,
        warehouses,
        sellers,
        countries,
        states,
        cities,
      ] = await Promise.all([
        this.platformService.getCatalogPrefillData({ includeInactive }),
        this.listRawMasterCollection("collections", rawActiveFilter, { sort: { sortOrder: 1, name: 1 } }),
        this.listRawMasterCollection("tags", activeFilter, { sort: { group: 1, name: 1 }, limit: 1000 }),
        this.listRawMasterCollection("badges", activeFilter, { sort: { type: 1, priority: 1, name: 1 } }),
        WarehouseModel.find(includeInactive ? {} : { active: true }).sort({ name: 1 }).limit(500).lean(),
        UserModel.find({
          role: { $in: ["seller"] },
          ...(includeInactive ? {} : { accountStatus: "active" }),
        })
          .select("email phone profile sellerProfile accountStatus role")
          .sort({ "sellerProfile.displayName": 1, email: 1 })
          .limit(500)
          .lean(),
        AdminCountryModel.find(includeInactive ? {} : { active: true }).sort({ name: 1 }).limit(500).lean(),
        AdminStateModel.find(includeInactive ? {} : { active: true }).sort({ name: 1 }).limit(2000).lean(),
        AdminCityModel.find(includeInactive ? {} : { active: true }).sort({ name: 1 }).limit(5000).lean(),
      ]);

      const relatedProductFilter = {
        ...(sellerId ? { sellerId } : {}),
        ...(includeInactive
          ? {}
          : { status: { $in: [PRODUCT_STATUS.ACTIVE, PRODUCT_STATUS.INACTIVE, PRODUCT_STATUS.DRAFT, PRODUCT_STATUS.PENDING_APPROVAL] } }),
      };
      const relatedProducts = includeProducts
        ? (await this.productRepository.paginate(relatedProductFilter, {
            page: 1,
            limit: productLimit,
            skip: 0,
            sortBy: "newest",
          })).items.map((product) => ({
            _id: String(product._id || product.id),
            id: String(product._id || product.id),
            title: product.title,
            sku: product.sku || "",
            sellerId: product.sellerId || "",
            status: product.status,
            brand: product.brand || "",
            category: product.category || "",
            image: product.images?.[0] || null,
          }))
        : [];

      const optionValuesByOptionId = (catalog.optionValues || []).reduce((acc, item) => {
        const optionId = String(item.optionId || item.option_id || "");
        if (!optionId) return acc;
        if (!acc[optionId]) acc[optionId] = [];
        acc[optionId].push(item);
        return acc;
      }, {});

      const categoryTree = this.platformService.buildCategoryTree(
        (catalog.categories || []).map((category) =>
          category?.toObject ? category.toObject({ depopulate: true, flattenMaps: true }) : category,
        ),
      );

      const shippingClasses = [
        { value: "light", label: "Light" },
        { value: "standard", label: "Standard" },
        { value: "heavy", label: "Heavy" },
        { value: "fragile", label: "Fragile" },
        { value: "cold_chain", label: "Cold chain" },
        { value: "hazmat", label: "Dangerous goods" },
      ];
      const returnPolicies = [
        { value: "standard", label: "Standard return", days: 7 },
        { value: "replacement_only", label: "Replacement only", days: 7 },
        { value: "non_returnable", label: "Non-returnable", days: 0 },
      ];

      return {
        categories: catalog.categories || [],
        subCategories: (catalog.categories || []).filter((category) => Number(category.level || 0) === 1),
        childCategories: (catalog.categories || []).filter((category) => Number(category.level || 0) >= 2),
        categoryTree,
        categoryAttributes: catalog.categoryAttributes || [],
        attributes: catalog.categoryAttributes || [],
        brands: catalog.brands || [],
        warrantyTemplates: catalog.warrantyTemplates || [],
        productFamilies: catalog.families || [],
        families: catalog.families || [],
        productVariants: catalog.variants || [],
        productOptions: catalog.options || [],
        options: catalog.options || [],
        optionValues: catalog.optionValues || [],
        optionValuesByOptionId,
        hsn: catalog.hsnCodes || [],
        hsnCodes: catalog.hsnCodes || [],
        gst: {
          taxes: catalog.taxes || [],
          subTaxes: catalog.subTaxes || [],
          taxRules: catalog.taxRules || [],
        },
        taxClasses: catalog.taxes || [],
        collections,
        tags,
        badges,
        warehouses,
        sellers: sellers.map((seller) => ({
          ...seller,
          _id: String(seller._id || seller.id),
          id: String(seller._id || seller.id),
          name:
            seller.sellerProfile?.displayName ||
            seller.sellerProfile?.legalBusinessName ||
            [seller.profile?.firstName, seller.profile?.lastName].filter(Boolean).join(" ") ||
            seller.email,
        })),
        shippingClasses,
        returnPolicies,
        countries,
        states,
        cities,
        relatedProducts,
        crossSellProducts: relatedProducts,
        upSellProducts: relatedProducts,
        frequentlyBoughtTogether: relatedProducts,
        featuredProducts: relatedProducts,
        trendingProducts: relatedProducts,
        bestSellerProducts: relatedProducts,
        meta: {
          cached: true,
          generatedAt: new Date().toISOString(),
          includeInactive,
          includeProducts,
        },
      };
    });
  }

  async validateProductReferences(payload = {}, actor = {}, existingProduct = null) {
    const brand = payload.brand;
    if (brand) {
      const brandRecord = await this.platformRepository.getBrandByValue(brand);
      if (!brandRecord || brandRecord.active === false) {
        throw new AppError("Brand must be an active approved master record", 400);
      }
    }

    if (payload.productFamilyCode) {
      const family = await this.platformRepository.getProductFamily(payload.productFamilyCode);
      if (!family || family.status === "inactive" || family.active === false) {
        throw new AppError("Product family must be an active master record", 400);
      }
    }

    await this.validateProductOptionReferences(payload.options || []);
    await this.validateRelatedProductReferences(payload, existingProduct);
    await this.validateCollectionReferences(payload.collectionIds || []);
  }

  async validateProductOptionReferences(options = []) {
    for (const option of options || []) {
      if (!option?.platformOptionId) continue;
      const masterOption = await this.platformRepository.getProductOption(option.platformOptionId);
      if (!masterOption || masterOption.active === false) {
        throw new AppError(`Product option '${option.name || option.platformOptionId}' is not active`, 400);
      }

      const allowedValues = await this.platformRepository.listAllProductOptionValues({
        optionId: String(masterOption._id),
        active: true,
      });
      const allowedNames = new Set(
        allowedValues.flatMap((item) => [
          String(item.name || ""),
          String(item.valueCode || ""),
        ]).filter(Boolean),
      );
      const badValue = (option.values || []).find((value) => allowedNames.size && !allowedNames.has(String(value)));
      if (badValue !== undefined) {
        throw new AppError(`Product option '${masterOption.name}' has invalid value '${badValue}'`, 400);
      }
    }
  }

  async validateRelatedProductReferences(payload = {}, existingProduct = null) {
    const productId = String(existingProduct?._id || existingProduct?.id || "");
    const relationFields = [
      "relatedProducts",
      "crossSellProducts",
      "upSellProducts",
      "frequentlyBoughtTogether",
      "featuredProducts",
      "trendingProducts",
      "bestSellerProducts",
    ];
    const ids = Array.from(new Set([
      ...relationFields.flatMap((field) => Array.isArray(payload[field]) ? payload[field] : []),
      ...(Array.isArray(payload.bundleItems) ? payload.bundleItems.map((item) => item.productId) : []),
    ].map((id) => String(id || "").trim()).filter(Boolean)));

    if (!ids.length) return;
    if (productId && ids.includes(productId)) {
      throw new AppError("Product cannot reference itself", 400);
    }

    const found = await this.productRepository.findByIds(ids);
    const foundIds = new Set(found.map((product) => String(product._id || product.id)));
    const missing = ids.find((id) => !foundIds.has(id));
    if (missing) {
      throw new AppError(`Referenced product not found: ${missing}`, 400);
    }
  }

  async validateCollectionReferences(collectionIds = []) {
    const ids = Array.from(new Set(
      (Array.isArray(collectionIds) ? collectionIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ));
    if (!ids.length) return;

    const collection = mongoose.connection.collection("collections");
    const found = await collection.find({
      $or: [
        { _id: { $in: ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id)) } },
        { slug: { $in: ids } },
        { name: { $in: ids } },
      ],
    }).project({ _id: 1, slug: 1, name: 1 }).toArray();
    const foundIds = new Set(
      found.flatMap((item) => [
        String(item._id || ""),
        String(item.slug || ""),
        String(item.name || ""),
      ]).filter(Boolean),
    );
    const missing = ids.find((id) => !foundIds.has(id));
    if (missing) {
      throw new AppError(`Referenced collection not found: ${missing}`, 400);
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
    payload = this.normalizeProductVariants(payload);
    payload = {
      ...payload,
      gstInclusive: true,
    };
    payload = await this.normalizeProductCompliance(payload, actor);
    const productType = payload.productType || PRODUCT_TYPE.SIMPLE;

    const categoryKey = payload.categoryId || payload.category;
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw new AppError("Category not found", 400);

    this.validateDynamicAttributes(
      this.normalizeCategoryAttributes(category),
      payload.attributes || {},
    );
    this.validateVariants(payload.variants || [], payload.options || []);
    await this.validateProductReferences(payload, actor);
    this._validateProductType(productType, payload);

    const isSeller = isSellerRole(actor);
    const status = isSeller
      ? payload.status === PRODUCT_STATUS.DRAFT
        ? PRODUCT_STATUS.DRAFT
        : PRODUCT_STATUS.PENDING_APPROVAL
      : payload.status || PRODUCT_STATUS.DRAFT;
    const sellerId = isSeller
      ? actor.ownerSellerId || actor.userId
      : payload.sellerId || actor.userId;

    const hasVariants = payload.hasVariants === true || (payload.variants || []).length > 0;

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
        submittedAt: status === PRODUCT_STATUS.DRAFT ? null : new Date(),
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
      revisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
      statusHistory: [
        this.buildStatusHistoryEntry({
          fromStatus: null,
          toStatus: status,
          actor,
          reason: "product_created",
        }),
      ],
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
      isSellerRole(actor) &&
      existingProduct.sellerId !== (actor.ownerSellerId || actor.userId)
    ) {
      throw new AppError("Permission denied", 403);
    }
    if (isScopedSellerRole(actor) && String(existingProduct.createdBy || "") !== String(actor.userId || "")) {
      throw new AppError("Permission denied", 403);
    }

    payload = this.normalizeProductMedia(payload);
    payload = this.normalizeProductVariants(payload);
    payload = await this.normalizeProductCompliance(payload, actor, existingProduct);

    const categoryKey =
      payload.categoryId || payload.category || existingProduct.categoryId || existingProduct.category;
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw new AppError("Category not found", 400);

    const nextAttributes = payload.attributes || existingProduct.attributes || {};
    this.validateDynamicAttributes(this.normalizeCategoryAttributes(category), nextAttributes);
    const nextOptions = payload.options || existingProduct.options || [];
    this.validateVariants(payload.variants || existingProduct.variants || [], nextOptions);
    await this.validateProductReferences(
      { ...this.toPlainObject(existingProduct), ...payload, options: nextOptions },
      actor,
      existingProduct,
    );

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

    if (
      isSellerRole(actor) &&
      existingProduct.status === PRODUCT_STATUS.ACTIVE
    ) {
      return this.createPendingRevision(existingProduct, updatePayload, actor);
    }

    if (isSellerRole(actor)) {
      const requestedStatus = payload.status;
      const shouldSubmitForReview =
        existingProduct.status === PRODUCT_STATUS.REJECTED ||
        (
          requestedStatus !== undefined &&
          requestedStatus !== PRODUCT_STATUS.DRAFT
        );

      if (shouldSubmitForReview) {
        updatePayload.status = PRODUCT_STATUS.PENDING_APPROVAL;
        updatePayload.rejectionReason = null;
        updatePayload["moderation.submittedAt"] = new Date();
        updatePayload["moderation.rejectionReason"] = null;
        updatePayload["moderation.notes"] = null;
        if (existingProduct.status === PRODUCT_STATUS.REJECTED) {
          updatePayload["moderation.revisionCount"] =
            (existingProduct.moderation?.revisionCount || 0) + 1;
        }
      } else if (requestedStatus === PRODUCT_STATUS.DRAFT) {
        updatePayload.status = PRODUCT_STATUS.DRAFT;
      }
    }

    if (updatePayload.status && updatePayload.status !== existingProduct.status) {
      updatePayload.statusHistory = this.appendStatusHistory(existingProduct, {
        fromStatus: existingProduct.status,
        toStatus: updatePayload.status,
        actor,
        reason: payload.rejectionReason || payload.reason || "product_status_updated",
      });
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

  // ─── Product revisions ───────────────────────────────────────────────────

  sanitizeRevisionChanges(payload = {}) {
    const blocked = new Set([
      "approvedAt",
      "approvedBy",
      "createdBy",
      "lastUpdatedBy",
      "moderation",
      "pendingRevisionId",
      "publishedAt",
      "rejectionReason",
      "revisionStatus",
      "status",
      "statusHistory",
      "version",
    ]);
    return Object.entries(payload).reduce((acc, [key, value]) => {
      if (!blocked.has(key)) acc[key] = value;
      return acc;
    }, {});
  }

  getChangedFields(existingProduct, changes = {}) {
    const existing = this.toPlainObject(existingProduct);
    return Object.keys(changes).filter((key) => {
      if (changes[key] === undefined) return false;
      return JSON.stringify(existing[key] ?? null) !== JSON.stringify(changes[key] ?? null);
    });
  }

  async createPendingRevision(existingProduct, updatePayload, actor) {
    const productId = String(existingProduct._id || existingProduct.id);
    const draftChanges = this.sanitizeRevisionChanges(updatePayload);
    const changedFields = this.getChangedFields(existingProduct, draftChanges);

    if (!changedFields.length) {
      const product = this.toPlainObject(existingProduct);
      return { ...product, pendingRevision: null };
    }

    const pendingRevision = await this.productRepository.findPendingRevision(productId);
    const revisionPayload = {
      productId,
      sellerId: existingProduct.sellerId,
      baseVersion: existingProduct.version || 1,
      draftChanges,
      changedFields,
      status: PRODUCT_REVISION_STATUS.PENDING,
      submittedBy: actor.userId,
      submittedByRole: actor.role,
      submittedAt: new Date(),
    };

    const revision = pendingRevision
      ? await this.productRepository.updateRevision(pendingRevision._id, revisionPayload)
      : await this.productRepository.createRevision(revisionPayload);

    const product = await this.productRepository.update(productId, {
      pendingRevisionId: String(revision._id),
      revisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.CHANGE_PENDING,
      lastUpdatedBy: actor.userId,
      statusHistory: this.appendStatusHistory(existingProduct, {
        fromStatus: existingProduct.status,
        toStatus: existingProduct.status,
        fromRevisionStatus:
          existingProduct.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        toRevisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.CHANGE_PENDING,
        actor,
        reason: "seller_active_product_revision_submitted",
        changedFields,
        revisionId: revision._id,
      }),
      "moderation.revisionCount": (existingProduct.moderation?.revisionCount || 0) + 1,
      "moderation.submittedAt": new Date(),
    });

    this._invalidateProductCache();

    return {
      ...this.toPlainObject(product),
      pendingRevision: this.toPlainObject(revision),
    };
  }

  async listProductRevisions(productId, query = {}, actor = {}) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);
    this.assertCanAccessManagementProduct(product, actor);
    return this.productRepository.listRevisions(productId, query);
  }

  async reviewProductRevision(productId, revisionId, payload, actor) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);
    this.assertCanReviewProductStatus(actor, payload.status);

    const revision = await this.productRepository.findRevisionById(revisionId);
    if (
      !revision ||
      String(revision.productId) !== String(productId) ||
      revision.status !== PRODUCT_REVISION_STATUS.PENDING
    ) {
      throw new AppError("Pending product revision not found", 404);
    }

    const isApproval = payload.status === PRODUCT_STATUS.ACTIVE;
    const isRejection = payload.status === PRODUCT_STATUS.REJECTED;
    if (!isApproval && !isRejection) {
      throw new AppError("Revision review must approve or reject", 400);
    }
    if (isRejection && !payload.rejectionReason) {
      throw new AppError("Rejection reason is required", 400);
    }

    if (isRejection) {
      const updatedRevision = await this.productRepository.updateRevision(revisionId, {
        status: PRODUCT_REVISION_STATUS.REJECTED,
        reviewedBy: actor.userId,
        reviewedByRole: actor.role,
        reviewedAt: new Date(),
        rejectionReason: payload.rejectionReason,
        notes: payload.notes || null,
        checklist: payload.checklist || {},
      });
      const updatedProduct = await this.productRepository.update(productId, {
        pendingRevisionId: null,
        revisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        lastUpdatedBy: actor.userId,
        rejectionReason: payload.rejectionReason,
        statusHistory: this.appendStatusHistory(product, {
          fromStatus: product.status,
          toStatus: product.status,
          fromRevisionStatus:
            product.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.CHANGE_PENDING,
          toRevisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
          actor,
          reason: payload.rejectionReason,
          changedFields: revision.changedFields || [],
          revisionId,
        }),
        "moderation.reviewedAt": new Date(),
        "moderation.reviewedBy": actor.userId,
        "moderation.rejectionReason": payload.rejectionReason,
        "moderation.notes": payload.notes || null,
      });
      this._invalidateProductCache();
      return {
        ...this.toPlainObject(updatedProduct),
        reviewedRevision: this.toPlainObject(updatedRevision),
      };
    }

    const nextVersion = (product.version || 1) + 1;
    const updatePayload = {
      ...revision.draftChanges,
      pendingRevisionId: null,
      revisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
      lastUpdatedBy: actor.userId,
      version: nextVersion,
      status: PRODUCT_STATUS.ACTIVE,
      publishedAt: product.publishedAt || new Date(),
      approvedBy: actor.userId,
      approvedAt: new Date(),
      rejectionReason: null,
      statusHistory: this.appendStatusHistory(product, {
        fromStatus: product.status,
        toStatus: PRODUCT_STATUS.ACTIVE,
        fromRevisionStatus:
          product.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.CHANGE_PENDING,
        toRevisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        actor,
        reason: "product_revision_approved",
        changedFields: revision.changedFields || [],
        revisionId,
      }),
      moderation: {
        ...(product.moderation?.toObject?.() || product.moderation || {}),
        reviewedAt: new Date(),
        reviewedBy: actor.userId,
        rejectionReason: null,
        notes: payload.notes || null,
        checklist: payload.checklist || product.moderation?.checklist || {},
      },
    };

    const updatedProduct = await this.productRepository.update(productId, updatePayload);
    const updatedRevision = await this.productRepository.updateRevision(revisionId, {
      status: PRODUCT_REVISION_STATUS.APPROVED,
      reviewedBy: actor.userId,
      reviewedByRole: actor.role,
      reviewedAt: new Date(),
      notes: payload.notes || null,
      checklist: payload.checklist || {},
      targetVersion: nextVersion,
      publishedVersion: nextVersion,
    });

    await this._indexProduct(updatedProduct);
    this._invalidateProductCache();

    return {
      ...this.toPlainObject(updatedProduct),
      reviewedRevision: this.toPlainObject(updatedRevision),
    };
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async listProducts(query, { publicOnly = true } = {}) {
    const pagination = { ...getPage(query), sortBy: query.sortBy || query.sort, sortDir: query.sortDir };
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
    if (!publicOnly && query.visibility) filter.visibility = query.visibility;
    if (query.tags) filter.tags = { $in: query.tags.split(",").map((t) => t.trim()) };
    if (query.rating) filter.rating = { $gte: Number(query.rating) };

    this.applyAttributeFilters(filter, query);

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {};
      if (query.minPrice !== undefined) filter.price.$gte = Number(query.minPrice);
      if (query.maxPrice !== undefined) filter.price.$lte = Number(query.maxPrice);
    }

    this.applyStockFilters(filter, query);

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

    if (!publicOnly) {
      if (query.includeAllStatuses === true || query.includeAllStatuses === "true") {
        if (query.status) filter.status = query.status;
      } else {
        filter.status = query.status || PRODUCT_STATUS.ACTIVE;
      }

      const cacheKey = `products:management:${JSON.stringify({ filter, pagination })}`;
      return remember(cacheKey, 30, () =>
        this.productRepository.paginate(filter, pagination),
      );
    }

    const publicFilter = applyPublicProductFilter(filter);
    const cacheKey = `products:${JSON.stringify({ filter: publicFilter, pagination })}`;
    return remember(cacheKey, 60, () =>
      this.productRepository.paginate(publicFilter, pagination),
    );
  }

  async listSellerProducts(query, actor) {
    const pagination = { ...getPage(query), sortBy: query.sortBy || query.sort, sortDir: query.sortDir };
    const sellerId = actor.ownerSellerId || actor.userId;
    const filter = {};
    if (isScopedSellerRole(actor)) filter.createdBy = actor.userId;
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
    this.applyStockFilters(filter, query);
    this.applyAttributeFilters(filter, query);
    return this.productRepository.paginateBySeller(sellerId, filter, pagination);
  }

  applyStockFilters(filter, query = {}) {
    const availableStock = {
      $subtract: [
        { $ifNull: ["$stock", 0] },
        { $ifNull: ["$reservedStock", 0] },
      ],
    };
    const lowStockThreshold = { $ifNull: ["$inventorySettings.lowStockThreshold", 5] };
    const stockStatus = query.stockStatus || query.inventoryStatus;

    if (stockStatus && stockStatus !== "all") {
      if (stockStatus === "out_of_stock") {
        this.appendExpressionFilter(filter, { $lte: [availableStock, 0] });
      } else if (stockStatus === "low_stock") {
        this.appendExpressionFilter(filter, {
          $and: [
            { $gt: [availableStock, 0] },
            { $lte: [availableStock, lowStockThreshold] },
          ],
        });
      } else if (stockStatus === "in_stock") {
        this.appendExpressionFilter(filter, { $gt: [availableStock, lowStockThreshold] });
      }
      return;
    }

    if (query.inStock === true || query.inStock === "true") {
      this.appendExpressionFilter(filter, { $gt: [availableStock, 0] });
    }
  }

  appendExpressionFilter(filter, expression) {
    if (!filter.$expr) {
      filter.$expr = expression;
      return;
    }

    filter.$and = [
      ...(filter.$and || []),
      { $expr: filter.$expr },
      { $expr: expression },
    ];
    delete filter.$expr;
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
      "stockStatus",
      "inventoryStatus",
      "includeAllStatuses",
      "sort",
      "sortBy",
      "sortDir",
      "rating",
      "minRating",
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

  buildSearchFallbackFilter(query = {}) {
    const filter = applyPublicProductFilter();
    const term = String(query.q || "").trim();
    const addFilter = (condition) => {
      filter.$and = [
        ...(filter.$and || []),
        condition,
      ];
    };

    if (term) {
      const regex = new RegExp(escapeRegExp(term), "i");
      filter.$or = [
        { title: regex },
        { shortDescription: regex },
        { description: regex },
        { category: regex },
        { categoryId: regex },
        { brand: regex },
        { sku: regex },
        { color: regex },
        { hsnCode: regex },
        { productFamilyCode: regex },
        { tags: regex },
      ];
    }

    const category = query.category || query.categoryId || query.categorySlug;
    if (category) {
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { category },
            { categoryId: category },
            { "category.categoryKey": category },
            { "category._id": category },
          ],
        },
      ];
    }

    if (query.brand) {
      filter.brand = new RegExp(`^${escapeRegExp(query.brand)}$`, "i");
    }

    if (query.productType) {
      filter.productType = query.productType;
    }

    if (query.productFamilyCode || query.family || query.familyCode) {
      filter.productFamilyCode = new RegExp(
        `^${escapeRegExp(query.productFamilyCode || query.family || query.familyCode)}$`,
        "i",
      );
    }

    if (query.hsnCode) {
      filter.hsnCode = new RegExp(`^${escapeRegExp(query.hsnCode)}$`, "i");
    }

    if (query.tags) {
      filter.tags = { $in: splitFilterValues(query.tags).map((tag) => new RegExp(`^${escapeRegExp(tag)}$`, "i")) };
    }

    [
      "color",
      "size",
      "material",
      "fit",
      "storage",
      "skinType",
      "shade",
      "finish",
      "room",
      "sport",
      "concern",
    ].forEach((key) => {
      if (!query[key]) return;
      const regexes = splitFilterValues(query[key]).map((value) => new RegExp(`^${escapeRegExp(value)}$`, "i"));
      addFilter({
        $or: [
          { [key]: { $in: regexes } },
          { [`attributes.${key}`]: { $in: regexes } },
        ],
      });
    });

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {};
      if (query.minPrice !== undefined) filter.price.$gte = Number(query.minPrice);
      if (query.maxPrice !== undefined) filter.price.$lte = Number(query.maxPrice);
    }

    const rating = query.minRating ?? query.rating;
    if (rating !== undefined && rating !== null && rating !== "") {
      filter.rating = { $gte: Number(rating) };
    }

    this.applyStockFilters(filter, query);
    this.applyAttributeFilters(filter, query);
    return filter;
  }

  // ─── Get single ───────────────────────────────────────────────────────────

  async getProduct(productId) {
    const product = await this.productRepository.findOne(
      applyPublicProductFilter({ _id: productId }),
    );
    if (!product) throw new AppError("Product not found", 404);
    return product;
  }

  async getProductForManagement(productId, actor = {}) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);
    this.assertCanAccessManagementProduct(product, actor);
    const pendingRevision = await this.productRepository.findPendingRevision(productId);
    return {
      ...this.toPlainObject(product),
      pendingRevision: pendingRevision ? this.toPlainObject(pendingRevision) : null,
    };
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
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const searchMongo = async () => {
      const filter = this.buildSearchFallbackFilter(query);
      const result = await this.productRepository.paginate(filter, {
        page,
        limit,
        skip: (page - 1) * limit,
        sortBy: query.sort || "popular",
      });
      return { items: result.items, total: result.total, source: "mongo" };
    };

    if (!isElasticsearchEnabled()) {
      return searchMongo();
    }

    try {
      const esQuery = {
        bool: {
          must: [
            {
              multi_match: {
                query: query.q,
                fields: [
                  "title^4",
                  "shortDescription^2",
                  "brand^2",
                  "category^2",
                  "description",
                  "sku^2",
                  "tags^3",
                  "color",
                  "hsnCode",
                  "productFamilyCode",
                ],
                fuzziness: "AUTO",
                prefix_length: 2,
              },
            },
          ],
          filter: buildPublicSearchFilters(),
        },
      };

      const category = query.category || query.categoryId || query.categorySlug;
      if (category) {
        esQuery.bool.filter.push({
          bool: {
            should: [
              { term: { "category.keyword": category } },
              { term: { "categoryId.keyword": category } },
            ],
            minimum_should_match: 1,
          },
        });
      }
      if (query.brand) esQuery.bool.filter.push({ term: { "brand.keyword": query.brand } });
      if (query.productType) esQuery.bool.filter.push({ term: { productType: query.productType } });
      if (query.productFamilyCode || query.family || query.familyCode) {
        const familyFilter = buildProductSearchExactFilter(
          ["productFamilyCode.keyword", "productFamilyCode"],
          query.productFamilyCode || query.family || query.familyCode,
        );
        if (familyFilter) esQuery.bool.filter.push(familyFilter);
      }
      if (query.hsnCode) {
        const hsnFilter = buildProductSearchExactFilter(["hsnCode.keyword", "hsnCode"], query.hsnCode);
        if (hsnFilter) esQuery.bool.filter.push(hsnFilter);
      }
      if (query.tags) {
        const tagsFilter = buildProductSearchExactFilter(["tags.keyword", "tags"], query.tags);
        if (tagsFilter) esQuery.bool.filter.push(tagsFilter);
      }
      [
        "color",
        "size",
        "material",
        "fit",
        "storage",
        "skinType",
        "shade",
        "finish",
        "room",
        "sport",
        "concern",
      ].forEach((key) => {
        if (!query[key]) return;
        const attributeFilter = buildProductSearchExactFilter(
          [
            `${key}.keyword`,
            key,
            `attributes.${key}.keyword`,
            `attributes.${key}`,
          ],
          query[key],
        );
        if (attributeFilter) esQuery.bool.filter.push(attributeFilter);
      });
      if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        const range = {};
        if (query.minPrice !== undefined) range.gte = Number(query.minPrice);
        if (query.maxPrice !== undefined) range.lte = Number(query.maxPrice);
        esQuery.bool.filter.push({ range: { price: range } });
      }
      const rating = query.minRating ?? query.rating;
      if (rating !== undefined && rating !== null && rating !== "") {
        esQuery.bool.filter.push({ range: { rating: { gte: Number(rating) } } });
      }
      if (query.inStock === true || query.inStock === "true") {
        esQuery.bool.filter.push({ range: { availableStock: { gt: 0 } } });
      }

      const sortOptions = {
        price_asc: [{ price: "asc" }],
        price_desc: [{ price: "desc" }],
        rating: [{ rating: "desc" }],
        newest: [{ createdAt: "desc" }],
        popular: [{ "analytics.purchases": "desc" }],
        _score: [{ _score: "desc" }, { "analytics.purchases": "desc" }],
      };

      const response = await elasticsearchClient.search({
        index: "products",
        from: (page - 1) * limit,
        size: limit,
        query: esQuery,
        sort: sortOptions[query.sort] || sortOptions._score,
      });

      return {
        items: response.hits.hits.map((hit) => ({ ...hit._source, _score: hit._score })),
        total: response.hits.total?.value ?? response.hits.hits.length,
        source: "elasticsearch",
      };
    } catch (error) {
      logger.warn({ err: error, q: query.q }, "Elasticsearch search failed, falling back to Mongo");
      return searchMongo();
    }
  }

  // ─── Review / moderation ──────────────────────────────────────────────────

  async reviewProduct(productId, payload, actor) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);
    this.assertCanReviewProductStatus(actor, payload.status);

    const pendingRevision = await this.productRepository.findPendingRevision(productId);
    if (
      pendingRevision &&
      existingProduct.status === PRODUCT_STATUS.ACTIVE &&
      [PRODUCT_STATUS.ACTIVE, PRODUCT_STATUS.REJECTED].includes(payload.status)
    ) {
      return this.reviewProductRevision(productId, pendingRevision._id, payload, actor);
    }

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
      statusHistory: this.appendStatusHistory(existingProduct, {
        fromStatus: existingProduct.status,
        toStatus: nextStatus,
        fromRevisionStatus:
          existingProduct.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        toRevisionStatus: existingProduct.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        actor,
        reason: payload.rejectionReason || payload.notes || "product_review",
      }),
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
    const products = await this.productRepository.findByIds(productIds);
    const requestedCount = new Set(productIds.map((id) => String(id))).size;
    if (!products.length || products.length !== requestedCount) {
      throw new AppError("One or more products were not found for bulk update", 404);
    }

    products.forEach((product) => {
      this.assertCanAccessManagementProduct(product, actor);
      if (isSellerRole(actor)) {
        this.assertSellerCanSetStatus(product, status);
      }
    });

    if (!isSellerRole(actor) && [
      PRODUCT_STATUS.ACTIVE,
      PRODUCT_STATUS.REJECTED,
    ].includes(status)) {
      this.assertCanReviewProductStatus(actor, status);
    }

    await Promise.all(products.map((product) =>
      this.productRepository.update(product._id, {
        status,
        lastUpdatedBy: actor.userId,
        ...(status === PRODUCT_STATUS.ACTIVE ? { publishedAt: product.publishedAt || new Date() } : {}),
        ...(status === PRODUCT_STATUS.ARCHIVED ? { visibility: PRODUCT_VISIBILITY.HIDDEN } : {}),
        statusHistory: this.appendStatusHistory(product, {
          fromStatus: product.status,
          toStatus: status,
          fromRevisionStatus: product.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
          toRevisionStatus: product.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
          actor,
          reason: "bulk_status_update",
        }),
      }),
    ));

    if (status === PRODUCT_STATUS.ACTIVE) {
      const updatedProducts = await this.productRepository.findByIds(productIds);
      await Promise.allSettled(updatedProducts.map((p) => this._indexProduct(p)));
    } else {
      await Promise.allSettled(productIds.map((id) => this._deleteFromIndex(id)));
    }
    this._invalidateProductCache();

    return { updated: products.length, status };
  }

  async bulkUpdateVisibility(productIds, visibility, actor = {}) {
    const products = await this.productRepository.findByIds(productIds);
    const requestedCount = new Set(productIds.map((id) => String(id))).size;
    if (!products.length || products.length !== requestedCount) {
      throw new AppError("One or more products were not found for bulk visibility update", 404);
    }

    products.forEach((product) => this.assertCanAccessManagementProduct(product, actor));
    await this.productRepository.bulkUpdateVisibility(productIds, visibility);
    const updatedProducts = await this.productRepository.findByIds(productIds);
    await Promise.allSettled(updatedProducts.map((product) => this._indexProduct(product)));
    this._invalidateProductCache();
    return { updated: productIds.length, visibility };
  }

  // ─── Inventory management ─────────────────────────────────────────────────

  async adjustInventory(productId, payload, actor) {
    const updatedProduct = await this.inventoryService.adjustProductInventory(productId, payload, actor);
    this._invalidateProductCache();
    return updatedProduct;
  }

  async getInventoryStats(sellerId = null, createdBy = null) {
    const [stats] = await this.productRepository.getInventoryStats(sellerId, createdBy);
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
    return this.archiveProduct(productId, { reason: "product_deleted" }, actor);
  }

  async archiveProduct(productId, payload = {}, actor = {}) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);

    const sellerId = actor.ownerSellerId || actor.userId;
    if (
      isSellerRole(actor) &&
      existingProduct.sellerId !== sellerId
    ) {
      throw new AppError("Permission denied", 403);
    }
    if (isScopedSellerRole(actor) && String(existingProduct.createdBy || "") !== String(actor.userId || "")) {
      throw new AppError("Permission denied", 403);
    }

    const updatedProduct = await this.productRepository.update(productId, {
      status: PRODUCT_STATUS.ARCHIVED,
      visibility: PRODUCT_VISIBILITY.HIDDEN,
      lastUpdatedBy: actor.userId,
      statusHistory: this.appendStatusHistory(existingProduct, {
        fromStatus: existingProduct.status,
        toStatus: PRODUCT_STATUS.ARCHIVED,
        fromRevisionStatus:
          existingProduct.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        toRevisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        actor,
        reason: payload.reason || "product_archived",
      }),
    });

    await this._deleteFromIndex(productId);
    this._invalidateProductCache();

    return updatedProduct;
  }

  async restoreProduct(productId, payload = {}, actor = {}) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);
    this.assertCanAccessManagementProduct(existingProduct, actor);

    const nextStatus = payload.status || PRODUCT_STATUS.DRAFT;
    if (nextStatus === PRODUCT_STATUS.ARCHIVED) {
      throw new AppError("Restore status cannot be archived", 400);
    }
    if (isSellerRole(actor) && ![
      PRODUCT_STATUS.DRAFT,
      PRODUCT_STATUS.PENDING_APPROVAL,
    ].includes(nextStatus)) {
      throw new AppError("Seller restore can only return a product to draft or pending approval", 403);
    }

    const updatedProduct = await this.productRepository.update(productId, {
      status: nextStatus,
      visibility: payload.visibility || PRODUCT_VISIBILITY.PRIVATE,
      lastUpdatedBy: actor.userId,
      ...(nextStatus === PRODUCT_STATUS.PENDING_APPROVAL
        ? {
            "moderation.submittedAt": new Date(),
            rejectionReason: null,
          }
        : {}),
      statusHistory: this.appendStatusHistory(existingProduct, {
        fromStatus: existingProduct.status,
        toStatus: nextStatus,
        actor,
        reason: payload.reason || "product_restored",
      }),
    });

    if (updatedProduct.status === PRODUCT_STATUS.ACTIVE) {
      await this._indexProduct(updatedProduct);
    }
    this._invalidateProductCache();
    return updatedProduct;
  }

  async duplicateProduct(productId, payload = {}, actor = {}) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);
    this.assertCanAccessManagementProduct(existingProduct, actor);

    const source = this.toPlainObject(existingProduct);
    delete source._id;
    delete source.id;
    delete source.createdAt;
    delete source.updatedAt;
    delete source.approvedAt;
    delete source.approvedBy;
    delete source.pendingRevisionId;

    const title = payload.title || `Copy of ${existingProduct.title}`;
    const duplicate = await this.productRepository.create({
      ...source,
      title,
      slug: slugify(`${title}-${Date.now()}`, { lower: true, strict: true }),
      sku: payload.sku || (source.sku ? `${source.sku}-COPY-${Date.now()}` : source.sku),
      status: PRODUCT_STATUS.DRAFT,
      visibility: PRODUCT_VISIBILITY.PRIVATE,
      publishedAt: null,
      scheduledAt: null,
      revisionStatus: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
      rejectionReason: null,
      version: 1,
      createdBy: actor.userId,
      lastUpdatedBy: actor.userId,
      statusHistory: [
        this.buildStatusHistoryEntry({
          fromStatus: existingProduct.status,
          toStatus: PRODUCT_STATUS.DRAFT,
          actor,
          reason: "product_duplicated",
        }),
      ],
      metadata: {
        ...(source.metadata || {}),
        duplicatedFromProductId: String(productId),
      },
    });

    this._invalidateProductCache();
    return duplicate;
  }

  async changeProductStatus(productId, payload = {}, actor = {}) {
    const existingProduct = await this.productRepository.findById(productId);
    if (!existingProduct) throw new AppError("Product not found", 404);
    this.assertCanAccessManagementProduct(existingProduct, actor);

    const nextStatus = payload.status;
    if (!Object.values(PRODUCT_STATUS).includes(nextStatus)) {
      throw new AppError("Invalid product status", 400);
    }
    if (nextStatus === PRODUCT_STATUS.REJECTED && !payload.rejectionReason) {
      throw new AppError("Rejection reason is required", 400);
    }

    if (isSellerRole(actor)) {
      if (nextStatus === PRODUCT_STATUS.ARCHIVED) {
        return this.archiveProduct(productId, payload, actor);
      }
      this.assertSellerCanSetStatus(existingProduct, nextStatus);
    } else if ([PRODUCT_STATUS.ACTIVE, PRODUCT_STATUS.INACTIVE, PRODUCT_STATUS.REJECTED].includes(nextStatus)) {
      return this.reviewProduct(productId, payload, actor);
    }

    const updatedProduct = await this.productRepository.update(productId, {
      status: nextStatus,
      ...(nextStatus === PRODUCT_STATUS.SCHEDULED
        ? {
            scheduledAt: payload.scheduledAt || existingProduct.scheduledAt || null,
            visibility: PRODUCT_VISIBILITY.SCHEDULED,
          }
        : {}),
      ...(nextStatus === PRODUCT_STATUS.PENDING_APPROVAL
        ? {
            "moderation.submittedAt": new Date(),
            rejectionReason: null,
          }
        : {}),
      ...(nextStatus === PRODUCT_STATUS.ARCHIVED ? { visibility: PRODUCT_VISIBILITY.HIDDEN } : {}),
      lastUpdatedBy: actor.userId,
      statusHistory: this.appendStatusHistory(existingProduct, {
        fromStatus: existingProduct.status,
        toStatus: nextStatus,
        fromRevisionStatus:
          existingProduct.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        toRevisionStatus:
          nextStatus === PRODUCT_STATUS.CHANGE_PENDING
            ? PRODUCT_REVISION_WORKFLOW_STATUS.CHANGE_PENDING
            : existingProduct.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
        actor,
        reason: payload.reason || payload.rejectionReason || "product_status_changed",
      }),
    });

    if (updatedProduct.status === PRODUCT_STATUS.ACTIVE) {
      await this._indexProduct(updatedProduct);
    } else {
      await this._deleteFromIndex(productId);
    }
    this._invalidateProductCache();
    return updatedProduct;
  }

  // ─── Analytics ───────────────────────────────────────────────────────────

  async getTopProducts(limit = 10, metric = "purchases") {
    return this.productRepository.getTopProducts(limit, metric);
  }

  async publishScheduledProducts({ now = new Date(), limit = 100, actor = null } = {}) {
    const products = await this.productRepository.findScheduledForPublish(now, limit);
    const results = [];

    for (const product of products) {
      const updatedProduct = await this.productRepository.update(product._id, {
        status: PRODUCT_STATUS.ACTIVE,
        visibility: PRODUCT_VISIBILITY.PUBLIC,
        publishedAt: product.publishedAt || now,
        scheduledAt: null,
        lastUpdatedBy: actor?.userId || "system",
        statusHistory: this.appendStatusHistory(product, {
          fromStatus: product.status,
          toStatus: PRODUCT_STATUS.ACTIVE,
          fromRevisionStatus: product.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
          toRevisionStatus: product.revisionStatus || PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
          actor: actor || { userId: "system", role: "system" },
          reason: "scheduled_publish_job",
        }),
      });
      await this._indexProduct(updatedProduct);
      results.push(updatedProduct);
    }

    if (results.length) this._invalidateProductCache();
    return { published: results.length, items: results };
  }

  toPlainObject(value = {}) {
    if (!value) return {};
    if (typeof value.toObject === "function") {
      return value.toObject({ depopulate: true, flattenMaps: true });
    }
    return { ...value };
  }

  buildStatusHistoryEntry({
    fromStatus = null,
    toStatus = null,
    fromRevisionStatus = null,
    toRevisionStatus = null,
    actor = {},
    reason = null,
    changedFields = [],
    revisionId = null,
  } = {}) {
    return {
      fromStatus,
      toStatus,
      fromRevisionStatus,
      toRevisionStatus,
      actorId: actor.userId || "system",
      actorRole: actor.role || "system",
      reason,
      changedFields: Array.isArray(changedFields) ? changedFields : [],
      revisionId: revisionId ? String(revisionId) : null,
      createdAt: new Date(),
    };
  }

  appendStatusHistory(product, entry = {}) {
    const source = this.toPlainObject(product);
    return [
      ...(Array.isArray(source.statusHistory) ? source.statusHistory : []),
      this.buildStatusHistoryEntry(entry),
    ].slice(-100);
  }

  assertCanAccessManagementProduct(product, actor = {}) {
    if (!actor.userId || actor.isSuperAdmin || ["admin", "super-admin"].includes(actor.role)) {
      return;
    }
    if (
      isSellerRole(actor) &&
      String(product.sellerId || "") === String(actor.ownerSellerId || actor.userId)
    ) {
      if (
        isScopedSellerRole(actor) &&
        String(product.createdBy || "") !== String(actor.userId || "")
      ) {
        throw new AppError("Permission denied", 403);
      }
      return;
    }
    throw new AppError("Permission denied", 403);
  }

  assertCanReviewProductStatus(actor = {}, status) {
    if (!actor.userId) {
      throw new AppError("Authentication required", 401);
    }
    if (isSellerRole(actor)) {
      throw new AppError("Seller product changes require admin review", 403);
    }
    const requiredAction =
      status === PRODUCT_STATUS.REJECTED
        ? "reject"
        : status === PRODUCT_STATUS.ACTIVE
          ? "approve"
          : "status_change";

    if (hasProductPermission(actor, requiredAction)) {
      return;
    }

    throw new AppError(`Permission denied: products:${requiredAction} is required`, 403);
  }

  assertSellerCanSetStatus(product, nextStatus) {
    const currentStatus = product.status;
    const allowedSellerStatuses = new Set([
      PRODUCT_STATUS.DRAFT,
      PRODUCT_STATUS.PENDING_APPROVAL,
      PRODUCT_STATUS.INACTIVE,
      PRODUCT_STATUS.ARCHIVED,
    ]);

    if (!allowedSellerStatuses.has(nextStatus)) {
      throw new AppError("Seller cannot directly approve or reject products", 403);
    }

    if (currentStatus === PRODUCT_STATUS.ACTIVE && nextStatus !== PRODUCT_STATUS.INACTIVE && nextStatus !== PRODUCT_STATUS.ARCHIVED) {
      throw new AppError("Active product changes must be submitted as a pending revision", 403);
    }

    if (nextStatus === PRODUCT_STATUS.INACTIVE && ![
      PRODUCT_STATUS.ACTIVE,
      PRODUCT_STATUS.INACTIVE,
    ].includes(currentStatus)) {
      throw new AppError("Only active products can be deactivated by seller", 400);
    }
  }
}

// helper
function isSeller(actor) {
  return isSellerRole(actor);
}

function isSellerRole(actor) {
  return ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);
}

function isScopedSellerRole(actor) {
  return ["seller-admin", "seller-sub-admin"].includes(actor.role);
}

function hasProductPermission(actor = {}, action) {
  if (actor.isSuperAdmin || ["admin", "super-admin"].includes(actor.role)) {
    return true;
  }

  if (isSellerRole(actor)) {
    return false;
  }

  const actionAliases = {
    approve: ["approve", "review", "approval"],
    reject: ["reject"],
    status_change: ["status_change", "status", "action", "manage"],
  };
  const actions = actionAliases[action] || [action];
  const permissions = new Set(Array.isArray(actor.permissions) ? actor.permissions : []);

  return actions.some((candidate) =>
    permissions.has(candidate) || permissions.has(`products:${candidate}`),
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitFilterValues(value) {
  const values = Array.isArray(value) ? value : String(value).split(",");
  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function buildProductSearchExactFilter(fields = [], value) {
  const values = splitFilterValues(value);
  if (!values.length) return null;

  return {
    bool: {
      should: fields.flatMap((field) => (
        values.length > 1
          ? [{ terms: { [field]: values } }]
          : [{ term: { [field]: values[0] } }]
      )),
      minimum_should_match: 1,
    },
  };
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
