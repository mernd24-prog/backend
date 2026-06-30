const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
  PRODUCT_REVISION_WORKFLOW_STATUS,
  DIGITAL_FILE_TYPE,
  SUBSCRIPTION_BILLING_CYCLE,
} = require("../../../shared/domain/commerce-constants");

// ─── Sub-schemas ────────────────────────────────────────────────────────────

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, trim: true, required: true },
    title: { type: String, trim: true },
    price: { type: Number, min: 0 },
    mrp: { type: Number, min: 0 },
    salePrice: { type: Number, min: 0 },
    gstRate: { type: Number, min: 0, max: 100, default: 18 },
    stock: { type: Number, min: 0, default: 0 },
    reservedStock: { type: Number, min: 0, default: 0 },
    barcode: { type: String, trim: true },
    weight: { type: Number, min: 0 },
    weightUnit: { type: String, default: "kg" },
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number },
      unit: { type: String, default: "cm" },
    },
    attributes: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    images: [{ type: String }],
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
    keywords: [{ type: String, trim: true }],
    canonicalUrl: { type: String, trim: true },
    ogTitle: { type: String, trim: true },
    ogDescription: { type: String, trim: true },
    ogImage: { type: String, trim: true },
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

const badgeSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true },
    label: { type: String, trim: true, required: true },
    color: { type: String, trim: true, default: "#E53E3E" },
    bgColor: { type: String, trim: true, default: "#FFF5F5" },
    validFrom: { type: Date },
    validTo: { type: Date },
  },
  { _id: true },
);

const shippingSchema = new mongoose.Schema(
  {
    freeShipping: { type: Boolean, default: false },
    freeShippingMinOrder: { type: Number, min: 0 },
    shippingClass: { type: String, trim: true },
    additionalCost: { type: Number, min: 0, default: 0 },
    shippingCharge: { type: Number, min: 0 },
    handlingCharge: { type: Number, min: 0, default: 0 },
    processingDays: { type: Number, min: 0, default: 1 },
    serviceabilityMode: {
      type: String,
      enum: ["inherit", "all_pincodes", "allowlist", "blocklist", "regions", "disabled"],
      default: "inherit",
    },
    serviceablePincodes: [{ type: String, trim: true }],
    allowPincodes: [{ type: String, trim: true }],
    blockPincodes: [{ type: String, trim: true }],
    regions: [{ type: String, trim: true }],
    states: [{ type: String, trim: true }],
    cities: [{ type: String, trim: true }],
    codAvailable: { type: Boolean },
    estimatedDaysMin: { type: Number, min: 0 },
    estimatedDaysMax: { type: Number, min: 0 },
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
    title: { type: String, required: true, trim: true, index: true },
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
    tags: [{ type: String, trim: true, index: true }],
    badges: [badgeSchema],

    // ── Pricing (root-level / simple product)
    price: { type: Number, required: true, min: 0, index: true },
    mrp: { type: Number, required: true, min: 0 },
    salePrice: { type: Number, min: 0 },
    costPrice: { type: Number, min: 0 },
    currency: { type: String, default: "INR" },
    gstRate: { type: Number, required: true, default: 18, min: 0, max: 100 },
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
    videos: [{ type: String }],
    documents: [{ type: String }],

    // ── Physical properties
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number },
      unit: { type: String, default: "cm" },
    },
    weight: { type: Number, min: 0 },
    weightUnit: { type: String, default: "kg" },

    // ── Origin & compliance
    origin: {
      country: { type: String, index: true },
      state: { type: String, index: true },
      city: { type: String, index: true },
    },
    warranty: {
      period: { type: Number, min: 0 },
      periodUnit: {
        type: String,
        enum: ["days", "weeks", "months", "years"],
        default: "months",
      },
      type: { type: String, default: "manufacturer" },
      provider: { type: String },
      terms: { type: String },
      returnPolicy: {
        eligible: { type: Boolean, default: true },
        days: { type: Number, min: 0, default: 7 },
        type: { type: String, default: "standard" },
        restockingFee: { type: Number, default: 0 },
      },
      serviceableCountries: [{ type: String }],
    },

    // ── Inventory
    stock: { type: Number, required: true, default: 0, min: 0 },
    reservedStock: { type: Number, required: true, default: 0, min: 0 },
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
productSchema.index({ organizationId: 1, status: 1 });
productSchema.index({ category: 1, status: 1, price: 1 });
productSchema.index({ productType: 1, status: 1 });
productSchema.index({ brand: 1, status: 1 });
productSchema.index({ tags: 1, status: 1 });
productSchema.index({ "seo.keywords": 1 });
productSchema.index({ scheduledAt: 1, status: 1 });

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
