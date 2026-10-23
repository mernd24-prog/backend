const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const {
  PRODUCT_STATUS,
  PRODUCT_APPROVAL_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
  PRODUCT_REVISION_WORKFLOW_STATUS,
  DIGITAL_FILE_TYPE,
  SUBSCRIPTION_BILLING_CYCLE,
} = require("../../../shared/domain/commerce-constants");

const countDecimalPlaces = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/.test(text)) {
    return Number.POSITIVE_INFINITY;
  }
  const [coefficient, exponentText = "0"] = text.split("e");
  const fractionalDigits = coefficient.split(".")[1]?.length || 0;
  return Math.max(0, fractionalDigits - Number(exponentText));
};
const hasAtMostTwoDecimals = (value) =>
  value === undefined || value === null || countDecimalPlaces(value) <= 2;
const isHttpUrl = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(String(value || "")).protocol);
  } catch {
    return false;
  }
};
const hasValidUniqueHttpUrls = (values, max, min = 0) => {
  if (!Array.isArray(values) || values.length < min || values.length > max) {
    return false;
  }
  const seen = new Set();
  for (const value of values) {
    if (!isHttpUrl(value)) return false;
    const normalized = new URL(String(value).trim()).href;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
  }
  return true;
};

// ─── Sub-schemas ────────────────────────────────────────────────────────────

const variantSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      trim: true,
      required: true,
      minlength: 3,
      maxlength: 64,
      match: /^[A-Za-z0-9][A-Za-z0-9._/-]{1,62}[A-Za-z0-9]$/,
    },
    skuNormalized: { type: String, lowercase: true, trim: true, select: false },
    title: { type: String, trim: true, maxlength: 100 },
    description: { type: String, maxlength: 5000 },
    shortDescription: { type: String, trim: true, maxlength: 500 },
    price: { type: Number, min: 0.01, max: 999999999.99, validate: hasAtMostTwoDecimals },
    mrp: { type: Number, min: 0.01, max: 999999999.99, validate: hasAtMostTwoDecimals },
    salePrice: { type: Number, min: 0.01, max: 999999999.99, validate: hasAtMostTwoDecimals },
    gstRate: { type: Number, min: 0, max: 100, default: 18, validate: hasAtMostTwoDecimals },
    stock: {
      type: Number,
      min: 0,
      max: 1000000000,
      default: 0,
      validate: { validator: Number.isInteger, message: "Stock must be a whole number" },
    },
    reservedStock: {
      type: Number,
      min: 0,
      max: 1000000000,
      default: 0,
      validate: {
        validator(value) {
          return Number.isInteger(value) && Number(value || 0) <= Number(this.stock || 0);
        },
        message: "Reserved stock must be a whole number no greater than stock",
      },
    },
    barcode: {
      type: String,
      trim: true,
      validate: {
        validator: (value) => !value || /^\d{8,14}$/.test(value),
        message: "Barcode must contain 8–14 digits",
      },
    },
    weight: { type: Number, min: 0.000001, max: 1000000 },
    weightUnit: { type: String, default: "kg" },
    dimensions: {
      length: { type: Number, min: 0.000001, max: 1000000 },
      width: { type: Number, min: 0.000001, max: 1000000 },
      height: { type: Number, min: 0.000001, max: 1000000 },
      weight: { type: Number, min: 0.000001, max: 1000000 },
      weightUnit: { type: String },
      unit: { type: String, default: "cm" },
    },
    attributes: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    specifications: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    images: {
      type: [String],
      default: [],
      validate: {
        validator(images) {
          return (
            hasValidUniqueHttpUrls(images, 5, 1)
          );
        },
        message: "Every variant must have 1–5 valid HTTP or HTTPS images",
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive", "out_of_stock"],
      default: "active",
    },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true },
);

variantSchema.virtual("availableStock").get(function () {
  return Math.max(0, Number(this.stock || 0) - Number(this.reservedStock || 0));
});

variantSchema.virtual("isInStock").get(function () {
  return this.status === "active" && this.availableStock > 0;
});

variantSchema.set("toJSON", { virtuals: true });
variantSchema.set("toObject", { virtuals: true });

const productOptionSchema = new mongoose.Schema(
  {
    platformOptionId: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true },
    values: [{ type: String, trim: true }],
    valueCodes: { type: Map, of: String, default: {} },
    required: { type: Boolean, default: false },
    displayType: {
      type: String,
      enum: ["dropdown", "button", "color_swatch", "radio", "thumbnail"],
      default: "dropdown",
    },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true },
);

const seoSchema = new mongoose.Schema(
  {
    metaTitle: { type: String, trim: true, maxlength: 70 },
    metaDescription: { type: String, trim: true, maxlength: 160 },
    keywords: {
      type: [{ type: String, trim: true, minlength: 2, maxlength: 60 }],
      validate: [
        {
          validator: (keywords) => keywords.length <= 20,
          message: "SEO keywords may contain at most 20 items",
        },
        {
          validator: (keywords) => new Set(keywords.map((keyword) => String(keyword).toLowerCase())).size === keywords.length,
          message: "SEO keywords must be unique",
        },
      ],
    },
    canonicalUrl: {
      type: String,
      trim: true,
      validate: {
        validator: (value) => !value || isHttpUrl(value),
        message: "Canonical URL must use HTTP or HTTPS",
      },
    },
    ogTitle: { type: String, trim: true, maxlength: 70 },
    ogDescription: { type: String, trim: true, maxlength: 160 },
    ogImage: {
      type: String,
      trim: true,
      validate: {
        validator: (value) => !value || isHttpUrl(value),
        message: "Pasted image URLs must be valid HTTP/HTTPS URLs.",
      },
    },
    structuredData: { type: Object },
  },
  { _id: false },
);

const digitalSchema = new mongoose.Schema(
  {
    fileUrl: { type: String, trim: true },
    previewUrl: { type: String, trim: true },
    fileSize: { type: Number },
    fileType: {
      type: String,
      enum: Object.values(DIGITAL_FILE_TYPE),
      default: DIGITAL_FILE_TYPE.OTHER,
    },
    licenseType: {
      type: String,
      enum: ["single_use", "multi_use", "unlimited", "subscription"],
      default: "single_use",
    },
    downloadLimit: { type: Number, min: 0 },
    expiryDays: { type: Number, min: 0 },
    accessControl: {
      loginRequired: { type: Boolean, default: true },
      purchaseRequired: { type: Boolean, default: true },
    },
    version: { type: String, trim: true },
    platforms: [{ type: String, trim: true }],
  },
  { _id: false },
);

const subscriptionSchema = new mongoose.Schema(
  {
    billingCycle: {
      type: String,
      enum: Object.values(SUBSCRIPTION_BILLING_CYCLE),
      default: SUBSCRIPTION_BILLING_CYCLE.MONTHLY,
    },
    trialDays: { type: Number, min: 0, default: 0 },
    recurringPrice: { type: Number, min: 0 },
    setupFee: { type: Number, min: 0, default: 0 },
    maxRenewalCount: { type: Number },
    features: [{ type: String, trim: true }],
    gracePeriodDays: { type: Number, min: 0, default: 3 },
    autoRenew: { type: Boolean, default: true },
    cancellationPolicy: { type: String, trim: true },
  },
  { _id: false },
);

const bundleItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    variantId: { type: String },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    price: { type: Number, min: 0 },
    isRequired: { type: Boolean, default: true },
    title: { type: String, trim: true },
  },
  { _id: true },
);

const shippingSchema = new mongoose.Schema(
  {
    freeShipping: { type: Boolean, default: false },
    freeShippingMinOrder: { type: Number, min: 0, max: 999999999.99, validate: hasAtMostTwoDecimals },
    shippingClass: { type: String, trim: true },
    additionalCost: { type: Number, min: 0, max: 999999999.99, default: 0, validate: hasAtMostTwoDecimals },
    shippingCharge: { type: Number, min: 0, max: 999999999.99, validate: hasAtMostTwoDecimals },
    handlingCharge: { type: Number, min: 0, max: 999999999.99, default: 0, validate: hasAtMostTwoDecimals },
    processingDays: {
      type: Number,
      min: 0,
      max: 1000000000,
      default: 1,
      validate: { validator: Number.isInteger, message: "Processing days must be a whole number" },
    },
    serviceabilityMode: {
      type: String,
      enum: ["inherit", "all_pincodes", "allowlist", "regions", "disabled"],
      default: "inherit",
    },
    serviceablePincodes: [{ type: String, trim: true }],
    allowPincodes: [{ type: String, trim: true }],
    regions: [{ type: String, trim: true }],
    states: [{ type: String, trim: true }],
    cities: [{ type: String, trim: true }],
    codAvailable: { type: Boolean },
    estimatedDaysMin: {
      type: Number,
      min: 0,
      max: 1000000000,
      validate: { validator: Number.isInteger, message: "Minimum delivery ETA must be a whole number" },
    },
    estimatedDaysMax: {
      type: Number,
      min: 0,
      max: 1000000000,
      validate: { validator: Number.isInteger, message: "Maximum delivery ETA must be a whole number" },
    },
    shippingPartner: { type: String, trim: true },
    shippingMethod: { type: String, trim: true, default: "standard" },
    dangerousGoods: { type: Boolean, default: false },
    requiresColdChain: { type: Boolean, default: false },
    // References a ShippingProfile (PostgreSQL UUID). When set, the profile
    // rules override the inline fields for serviceability, charges, and ETA.
    shippingProfileId: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const inventorySettingsSchema = new mongoose.Schema(
  {
    trackInventory: { type: Boolean, default: true },
    allowBackorder: { type: Boolean, default: false },
    backorderLimit: { type: Number, min: 0 },
    lowStockThreshold: { type: Number, min: 0, default: 5 },
    outOfStockMessage: { type: String, trim: true },
    manageVariantInventory: { type: Boolean, default: false },
  },
  { _id: false },
);

const analyticsSchema = new mongoose.Schema(
  {
    views: { type: Number, default: 0 },
    uniqueViews: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    cartAdds: { type: Number, default: 0 },
    wishlistAdds: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 },
    lastViewedAt: { type: Date },
  },
  { _id: false },
);

const statusHistorySchema = new mongoose.Schema(
  {
    fromStatus: { type: String },
    toStatus: { type: String },
    fromRevisionStatus: { type: String },
    toRevisionStatus: { type: String },
    reason: { type: String },
    actorId: { type: String },
    actorRole: { type: String },
    changedFields: [{ type: String }],
    revisionId: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const complianceSnapshotSchema = new mongoose.Schema(
  {
    hsnCode: { type: String },
    gstRate: { type: Number },
    cessRate: { type: Number, default: 0 },
    taxType: { type: String },
    exempt: { type: Boolean, default: false },
    source: { type: String, default: "hsn_master" },
    validatedAt: { type: Date },
    validatedBy: { type: String },
  },
  { _id: false },
);

// ─── Main Product Schema ─────────────────────────────────────────────────────

const productSchema = new mongoose.Schema(
  {
    // ── Identity
    sellerId: { type: String, required: true, index: true },
    organizationId: { type: String, required: true, index: true },
    storeId: { type: String, index: true },
    warehouseId: { type: String, index: true },
    organizationSnapshot: { type: Object, default: {} },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
      validate: {
        validator(value) {
          return /\p{L}/u.test(value) && !/[\u0000-\u001F\u007F-\u009F]/u.test(value) && !/\s{2,}/u.test(value);
        },
        message: "Product title must contain a letter and use valid spacing",
      },
    },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, required: true },
    shortDescription: { type: String, trim: true, maxlength: 500 },

    // ── Product type & visibility
    productType: {
      type: String,
      enum: Object.values(PRODUCT_TYPE),
      default: PRODUCT_TYPE.SIMPLE,
      index: true,
    },
    visibility: {
      type: String,
      enum: Object.values(PRODUCT_VISIBILITY),
      default: PRODUCT_VISIBILITY.PUBLIC,
      index: true,
    },
    publishedAt: { type: Date },
    scheduledAt: { type: Date },

    // ── Categorization
    categoryId: { type: String, index: true },
    category: { type: String, required: true, index: true },
    brand: { type: String, trim: true, index: true },
    productFamilyCode: { type: String, index: true },
    tags: {
      type: [{ type: String, trim: true, minlength: 2, maxlength: 40, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }],
      index: true,
      validate: [
        {
          validator: (tags) => tags.length <= 20,
          message: "A product can have at most 20 tags",
        },
        {
          validator: (tags) => new Set(tags.map((tag) => String(tag).toLowerCase())).size === tags.length,
          message: "Product tags must be unique",
        },
      ],
    },

    // ── Pricing (root-level / simple product)
    price: { type: Number, required: true, min: 0.01, max: 999999999.99, index: true, validate: hasAtMostTwoDecimals },
    mrp: { type: Number, required: true, min: 0.01, max: 999999999.99, validate: hasAtMostTwoDecimals },
    salePrice: { type: Number, min: 0.01, max: 999999999.99, validate: hasAtMostTwoDecimals },
    costPrice: { type: Number, min: 0, max: 999999999.99, validate: hasAtMostTwoDecimals },
    currency: { type: String, default: "INR" },
    gstRate: { type: Number, required: true, default: 18, min: 0, max: 100, validate: hasAtMostTwoDecimals },
    gstInclusive: { type: Boolean, default: true },
    hsnCode: { type: String, index: true },
    complianceSnapshot: { type: complianceSnapshotSchema, default: null },

    // ── Identifiers
    sku: { type: String, index: true },
    barcode: { type: String, trim: true, index: true },
    color: { type: String, index: true },

    // ── Dynamic attributes (category-defined)
    attributes: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

    // ── Variable product: axes + variants
    variantAxes: [{ type: String, trim: true }],
    hasVariants: { type: Boolean, default: false },
    defaultVariantId: { type: String },
    variants: [variantSchema],
    options: [productOptionSchema],

    // ── Type-specific extensions
    digital: digitalSchema,
    subscription: subscriptionSchema,
    bundleItems: [bundleItemSchema],
    bundleDiscount: { type: Number, min: 0 },

    // ── Specifications (free-form sections, e.g. { "General": { "Brand": "Apple" } })
    specifications: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

    // ── Media
    images: [{ type: String }],
    commonImages: {
      type: [{ type: String, trim: true }],
      default: [],
      validate: {
        validator: (images) => hasValidUniqueHttpUrls(images, 8),
        message: "Product images must be unique valid HTTP or HTTPS URLs (maximum 8)",
      },
    },
    videos: {
      type: [{ type: String, trim: true }],
      default: [],
      validate: {
        validator: (videos) => hasValidUniqueHttpUrls(videos, 1),
        message: "Use at most one valid HTTP or HTTPS product video URL",
      },
    },
    documents: [{ type: String }],

    // ── Physical properties
    dimensions: {
      length: { type: Number, min: 0.000001, max: 1000000 },
      width: { type: Number, min: 0.000001, max: 1000000 },
      height: { type: Number, min: 0.000001, max: 1000000 },
      weight: { type: Number, min: 0.000001, max: 1000000 },
      weightUnit: { type: String },
      unit: { type: String, default: "cm" },
    },
    weight: { type: Number, min: 0.000001, max: 1000000 },
    weightUnit: { type: String, default: "kg" },

    // ── Origin & compliance
    origin: {
      country: { type: String, index: true },
      state: { type: String, index: true },
      city: { type: String, index: true },
    },
    warranty: {
      // No default keeps legacy products with complete warranty details valid.
      enabled: { type: Boolean },
      period: {
        type: Number,
        min: 0,
        max: 365,
        validate: { validator: Number.isInteger, message: "Warranty period must be a whole number" },
      },
      periodUnit: {
        type: String,
        enum: ["days", "weeks", "months", "years"],
        default: "months",
      },
      type: { type: String, maxlength: 100, default: "manufacturer" },
      provider: { type: String, maxlength: 100 },
      terms: { type: String, maxlength: 1000 },
      returnPolicy: {
        eligible: { type: Boolean, default: true },
        returnable: { type: Boolean, default: true },
        days: {
          type: Number,
          min: 0,
          max: 365,
          default: 0,
          validate: { validator: Number.isInteger, message: "Return window must be a whole number" },
        },
        returnWindowDays: {
          type: Number,
          min: 0,
          max: 365,
          default: 0,
          validate: { validator: Number.isInteger, message: "Return window must be a whole number" },
        },
        type: { type: String, enum: ["standard", "replacement_only", "non_returnable"], default: "standard" },
        resolution: { type: String, enum: ["refund", "replacement", "refund_or_replacement"], default: "refund_or_replacement" },
        requiresImages: { type: Boolean, default: false },
        inspectionRequired: { type: Boolean, default: true },
        shippingPaidBy: { type: String, enum: ["platform", "seller", "customer"], default: "seller" },
        restockingFee: {
          type: Number,
          min: 0,
          max: 999999999.99,
          default: 0,
          validate: hasAtMostTwoDecimals,
        },
      },
      serviceableCountries: [{ type: String }],
    },

    // ── Inventory
    stock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: "Stock must be a whole number" },
    },
    reservedStock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return Number.isInteger(value) && Number(value || 0) <= Number(this.stock || 0);
        },
        message: "Reserved stock must be a whole number no greater than stock",
      },
    },
    inventorySettings: { type: inventorySettingsSchema, default: () => ({}) },

    // ── Shipping
    shipping: { type: shippingSchema, default: () => ({}) },

    // ── SEO
    seo: { type: seoSchema, default: () => ({}) },

    // ── Product relationships
    relatedProducts: [{ type: String }],
    crossSellProducts: [{ type: String }],
    upSellProducts: [{ type: String }],
    frequentlyBoughtTogether: [{ type: String }],
    featuredProducts: [{ type: String }],
    trendingProducts: [{ type: String }],
    bestSellerProducts: [{ type: String }],
    collectionIds: [{ type: String }],

    // ── Analytics
    analytics: { type: analyticsSchema, default: () => ({}) },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },

    // ── Meta
    metadata: { type: Object, default: {} },

    // ── Status & moderation
    status: {
      type: String,
      enum: Object.values(PRODUCT_STATUS),
      default: PRODUCT_STATUS.DRAFT,
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: Object.values(PRODUCT_APPROVAL_STATUS),
      default: PRODUCT_APPROVAL_STATUS.PENDING,
      index: true,
    },
    moderation: {
      submittedAt: { type: Date },
      reviewedAt: { type: Date },
      reviewedBy: { type: String },
      rejectionReason: { type: String },
      checklist: {
        titleVerified: { type: Boolean, default: false },
        categoryVerified: { type: Boolean, default: false },
        complianceVerified: { type: Boolean, default: false },
        mediaVerified: { type: Boolean, default: false },
        pricingVerified: { type: Boolean, default: false },
        inventoryVerified: { type: Boolean, default: false },
      },
      notes: { type: String },
      revisionCount: { type: Number, default: 0 },
    },
    approvedBy: { type: String },
    approvedAt: { type: Date },
    rejectionReason: { type: String },

    // ── Revision workflow
    revisionStatus: {
      type: String,
      enum: Object.values(PRODUCT_REVISION_WORKFLOW_STATUS),
      default: PRODUCT_REVISION_WORKFLOW_STATUS.NONE,
      index: true,
    },
    pendingRevisionId: { type: String, index: true },
    statusHistory: [statusHistorySchema],

    // ── Audit
    createdBy: { type: String },
    lastUpdatedBy: { type: String },
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

productSchema.index({ title: "text", description: "text", category: 1 });
productSchema.index({ sellerId: 1, status: 1 });
productSchema.index({ sellerId: 1, organizationId: 1, status: 1 });
productSchema.index(
  { sellerId: 1, "variants.skuNormalized": 1 },
  {
    unique: true,
    name: "unique_seller_variant_sku_normalized",
    partialFilterExpression: { "variants.skuNormalized": { $type: "string" } },
  },
);
productSchema.index({ organizationId: 1, status: 1 });
productSchema.index({ category: 1, status: 1, price: 1 });
productSchema.index({ productType: 1, status: 1 });
productSchema.index({ brand: 1, status: 1 });
productSchema.index({ tags: 1, status: 1 });
productSchema.index({ status: 1, visibility: 1, publishedAt: 1, scheduledAt: 1 });
productSchema.index({ status: 1, visibility: 1, category: 1, brand: 1 });
productSchema.index({ status: 1, visibility: 1, price: 1, rating: 1 });
productSchema.index({ status: 1, approvalStatus: 1, visibility: 1, category: 1, "analytics.purchases": -1 });
productSchema.index({ status: 1, approvalStatus: 1, visibility: 1, createdAt: -1 });
productSchema.index({ status: 1, approvalStatus: 1, visibility: 1, "analytics.purchases": -1 });
productSchema.index({ status: 1, approvalStatus: 1, visibility: 1, categoryKey: 1, "analytics.purchases": -1 });
productSchema.index({ status: 1, approvalStatus: 1, visibility: 1, categoryKey: 1, createdAt: -1 });
productSchema.index({ status: 1, approvalStatus: 1, visibility: 1, categorySlug: 1, "analytics.purchases": -1 });
productSchema.index({ status: 1, approvalStatus: 1, visibility: 1, categoryId: 1, "analytics.purchases": -1 });
productSchema.index({ "seo.keywords": 1 });
productSchema.index({ scheduledAt: 1, status: 1 });
// Variant SKUs are marketplace-wide identifiers, not seller-scoped values.
// The service normalizes new values to uppercase; the collation also protects
// against concurrent case-only duplicates across different sellers.
productSchema.index(
  { "variants.sku": 1 },
  {
    unique: true,
    sparse: true,
    name: "uniq_global_variant_sku",
    collation: { locale: "en", strength: 2 },
  },
);

productSchema.pre("validate", function validateVariantContract(next) {
  const variants = this.variants || [];
  const etaMin = this.shipping?.estimatedDaysMin;
  const etaMax = this.shipping?.estimatedDaysMax;
  if (etaMin !== undefined && etaMax !== undefined && etaMin > etaMax) {
    this.invalidate("shipping.estimatedDaysMin", "Minimum delivery ETA cannot exceed maximum ETA");
  }
  if (variants.length) {
    const defaults = variants.filter((variant) => variant.isDefault === true);
    if (defaults.length !== 1) {
      this.invalidate("variants", "Exactly one variant must be marked as the default");
    }
    if (
      this.status === PRODUCT_STATUS.ACTIVE &&
      !variants.some((variant) => variant.status === "active")
    ) {
      this.invalidate("variants", "At least one variant must be active before activating the product");
    }
  }
  next();
});

// ─── Virtual: available stock ────────────────────────────────────────────────

productSchema.virtual("availableStock").get(function () {
  return Math.max(0, this.stock - this.reservedStock);
});

productSchema.virtual("isInStock").get(function () {
  return this.availableStock > 0 || this.inventorySettings?.allowBackorder === true;
});

productSchema.virtual("discountPercent").get(function () {
  if (!this.mrp || !this.price || this.mrp <= this.price) return 0;
  return Math.round(((this.mrp - this.price) / this.mrp) * 100);
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

const ProductModel = mongoose.model("Product", productSchema);

module.exports = { ProductModel };
