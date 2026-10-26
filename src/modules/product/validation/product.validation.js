const Joi = require("joi");
const {
  PRODUCT_STATUS,
  PRODUCT_APPROVAL_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
  PRODUCT_REVISION_STATUS,
  PRODUCT_REVISION_WORKFLOW_STATUS,
  DIGITAL_FILE_TYPE,
  SUBSCRIPTION_BILLING_CYCLE,
} = require("../../../shared/domain/commerce-constants");

// ─── Helpers ────────────────────────────────────────────────────────────────

const optionalString = () => Joi.string().trim().allow("", null);
const productTitle = () => Joi.string().trim().min(3).max(200)
  .pattern(/ {2,}/u, { invert: true, name: "repeated spaces" })
  .messages({
    "string.pattern.name": "Start with a letter or number. Only letters, numbers, spaces and & - / ( ) % : are allowed.",
    "string.pattern.invert.name": "Product name cannot contain repeated spaces."
  });
const optionalPositiveNumber = () => Joi.number().positive().allow(null).empty("");
const optionalNonNegativeInteger = () => Joi.number().integer().min(0).allow(null).empty("");
const optionalNonNegativeNumber = () => Joi.number().min(0).allow(null).empty("");
const deprecatedRootVariantField = () => Joi.any().strip();
const MAX_MONEY = 999999999.99;
const MAX_INVENTORY = 1000000000;
const MAX_MEASUREMENT = 1000000;
const gstRateSchema = () =>
  Joi.number()
    .min(0)
    .max(100)
    .precision(2)
    .messages({
      "number.base": "Enter a valid GST rate.",
      "number.min": "GST rate must be between 0 and 100.",
      "number.max": "GST rate must be between 0 and 100.",
      "number.precision": "GST rate can have no more than two decimal places.",
    });
const httpUrl = () => Joi.string().uri({ scheme: ["http", "https"] });
const optionalHttpUrl = () => httpUrl().allow("", null);
const money = () => Joi.number().positive().max(MAX_MONEY).precision(2);
const skuSchema = Joi.string()
  .trim()
  .min(3)
  .max(64)
  .pattern(/^[A-Za-z0-9][A-Za-z0-9._/-]{1,62}[A-Za-z0-9]$/)
  .required();
const productTitleSchema = productTitle();
const productDescriptionSchema = Joi.string().custom((value, helpers) => {
  const visibleText = value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:amp|lt|gt|quot|#39);/gi, "x")
    .trim();
  if (visibleText.length < 10) {
    return helpers.message({ custom: "Product description must contain at least 10 visible characters" });
  }
  if (visibleText.length > 5000) {
    return helpers.message({ custom: "Product description must be 5000 visible characters or fewer" });
  }
  return value;
});
const uniqueTrimmedStrings = (items = []) => {
  const seen = new Set();
  for (const item of items) {
    const normalized = String(item || "").trim().toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
  }
  return true;
};
const uniqueHttpUrls = (items = []) => {
  const seen = new Set();
  for (const item of items) {
    let normalized;
    try {
      normalized = new URL(String(item).trim()).href;
    } catch {
      normalized = String(item).trim();
    }
    if (seen.has(normalized)) return false;
    seen.add(normalized);
  }
  return true;
};
const optionArray = Joi.array()
  .items(
    Joi.object({
      platformOptionId: optionalString(),
      name: Joi.string().trim().min(2).max(50).required(),
      slug: optionalString(),
      values: Joi.array()
        .items(Joi.string().trim().min(1).max(80).required())
        .min(1)
        .required()
        .custom((values, helpers) =>
          uniqueTrimmedStrings(values)
            ? values
            : helpers.message({ custom: "Option values must be unique" }),
        ),
      valueCodes: Joi.object().pattern(Joi.string(), Joi.string().allow("", null)).default({}),
      required: Joi.boolean().default(false),
      displayType: Joi.string()
        .valid("dropdown", "button", "color_swatch", "radio", "thumbnail")
        .default("dropdown"),
      sortOrder: Joi.number().integer().min(0).default(0),
    }),
  )
  .custom((options, helpers) =>
    uniqueTrimmedStrings(options.map((option) => option.name))
      ? options
      : helpers.message({ custom: "Option names must be unique" }),
  );

// ─── Reusable sub-schemas ────────────────────────────────────────────────────

const variantSchema = Joi.object({
  sku: skuSchema,
  skuNormalized: Joi.string().strip(),
  title: Joi.string().trim().max(100).allow("", null),
  description: Joi.string().trim().min(10).max(5000).allow("", null),
  shortDescription: Joi.string().trim().max(500).allow("", null),
  price: money().required(),
  mrp: money().required(),
  salePrice: money().required(),
  gstRate: gstRateSchema(),
  stock: optionalNonNegativeInteger().max(MAX_INVENTORY).default(0),
  reservedStock: optionalNonNegativeInteger().max(MAX_INVENTORY).default(0),
  barcode: Joi.string().trim().pattern(/^\d{8,14}$/).allow("", null),
  weight: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
  weightUnit: optionalString(),
  dimensions: Joi.object({
    length: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
    width: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
    height: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
    unit: optionalString(),
  }),
  attributes: Joi.object()
    .pattern(
      Joi.string().trim().min(2).max(50),
      Joi.string().trim().min(1).max(80),
    )
    .default({}),
  specifications: Joi.object().default({}),
  images: Joi.array().items(httpUrl()).min(1).max(5).required().custom((images, helpers) =>
    uniqueHttpUrls(images)
      ? images
      : helpers.message({ custom: "Variant images must not contain duplicates" }),
  ),
  status: Joi.string().valid("active", "inactive", "out_of_stock").default("active"),
  isDefault: Joi.boolean().default(false),
  sortOrder: Joi.number().integer().min(0).default(0),
}).custom((variant, helpers) => {
  if (variant.reservedStock > variant.stock) {
    return helpers.message({ custom: "Reserved stock cannot exceed stock" });
  }
  if (variant.weight !== undefined && !variant.weightUnit) {
    return helpers.message({ custom: "Weight unit is required when weight is entered" });
  }
  const dimensions = variant.dimensions || {};
  const hasDimension = [dimensions.length, dimensions.width, dimensions.height]
    .some((value) => value !== undefined && value !== null && value !== "");
  if (hasDimension && !dimensions.unit) {
    return helpers.message({ custom: "Dimension unit is required when dimensions are entered" });
  }
  return variant;
});

const seoSchema = Joi.object({
  metaTitle: Joi.string().trim().max(70).allow("", null),
  metaDescription: Joi.string().trim().max(160).allow("", null),
  keywords: Joi.array()
    .items(Joi.string().trim().min(2).max(60))
    .min(1)
    .message("Add at least one SEO keyword.")
    .max(20)
    .required()
    .custom((keywords, helpers) =>
      uniqueTrimmedStrings(keywords)
        ? keywords
        : helpers.message({ custom: "SEO keywords must be unique" }),
    )
    .messages({
      "array.min": "Add at least one SEO keyword.",
      "any.required": "Add at least one SEO keyword.",
    }),
  canonicalUrl: optionalHttpUrl(),
  ogTitle: Joi.string().trim().max(70).allow("", null),
  ogDescription: Joi.string().trim().max(160).allow("", null),
  ogImage: Joi.string()
    .trim()
    .uri({ scheme: ["http", "https"] })
    .allow("", null)
    .messages({
      "string.uri": "Pasted image URLs must be valid HTTP/HTTPS URLs.",
    }),
  structuredData: Joi.object(),
});

const digitalSchema = Joi.object({
  fileUrl: Joi.string().uri().allow("", null),
  previewUrl: Joi.string().uri().allow("", null),
  fileSize: optionalNonNegativeNumber(),
  fileType: Joi.string().valid(...Object.values(DIGITAL_FILE_TYPE)),
  licenseType: Joi.string().valid("single_use", "multi_use", "unlimited", "subscription"),
  downloadLimit: optionalNonNegativeInteger(),
  expiryDays: optionalNonNegativeInteger(),
  accessControl: Joi.object({
    loginRequired: Joi.boolean().default(true),
    purchaseRequired: Joi.boolean().default(true),
  }),
  version: optionalString(),
  platforms: Joi.array().items(Joi.string().trim()).default([]),
});

const subscriptionSchema = Joi.object({
  billingCycle: Joi.string().valid(...Object.values(SUBSCRIPTION_BILLING_CYCLE)).default("monthly"),
  trialDays: optionalNonNegativeInteger().default(0),
  recurringPrice: Joi.number().min(0).required(),
  setupFee: optionalNonNegativeNumber().default(0),
  maxRenewalCount: optionalNonNegativeInteger(),
  features: Joi.array().items(Joi.string().trim()).default([]),
  gracePeriodDays: optionalNonNegativeInteger().default(3),
  autoRenew: Joi.boolean().default(true),
  cancellationPolicy: optionalString(),
});

const bundleItemSchema = Joi.object({
  productId: Joi.string().required(),
  variantId: optionalString(),
  quantity: Joi.number().integer().min(1).required(),
  price: optionalNonNegativeNumber(),
  isRequired: Joi.boolean().default(true),
  title: optionalString(),
});

const dimensionsSchema = Joi.object({
  length: optionalPositiveNumber(),
  width: optionalPositiveNumber(),
  height: optionalPositiveNumber(),
  weight: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
  weightUnit: optionalString(),
  unit: optionalString().default("cm"),
}).custom((dimensions, helpers) => {
  if (dimensions.weight !== undefined && !dimensions.weightUnit) {
    return helpers.message({ custom: "Weight unit is required when weight is entered" });
  }
  return dimensions;
});

const warrantySchema = Joi.object({
  enabled: Joi.boolean(),
  period: Joi.number().integer().min(1).max(365).allow(null).empty(""),
  periodUnit: Joi.string().valid("days", "weeks", "months", "years").allow("", null),
  type: Joi.string().trim().max(100).allow("", null),
  provider: Joi.string().trim().max(100).allow("", null),
  terms: Joi.string().trim().max(1000).allow("", null),
  returnPolicy: Joi.object({
    eligible: Joi.boolean(),
    returnable: Joi.boolean(),
    days: optionalNonNegativeInteger(),
    returnWindowDays: optionalNonNegativeInteger(),
    type: Joi.string().valid("standard", "replacement_only", "non_returnable").default("standard"),
    resolution: Joi.string().valid("refund", "replacement", "refund_or_replacement").default("refund_or_replacement"),
    requiresImages: Joi.boolean().default(false),
    inspectionRequired: Joi.boolean().default(true),
    shippingPaidBy: Joi.string().valid("platform", "seller", "customer").default("seller"),
    restockingFee: optionalNonNegativeNumber().max(MAX_MONEY).precision(2).default(0),
  }).default({}),
  serviceableCountries: Joi.array().items(Joi.string().trim()).default([]),
}).custom((value, helpers) => {
  const hasDetails = [value.period, value.periodUnit, value.type, value.provider]
    .some((item) => item !== undefined && item !== null && String(item).trim() !== "");
  const enabled = value.enabled === true || (value.enabled === undefined && hasDetails);

  const returnPolicy = value.returnPolicy || {};
  const returnable =
    returnPolicy.type !== "non_returnable" &&
    returnPolicy.returnable !== false &&
    returnPolicy.eligible !== false;
  const returnWindowDays =
    returnPolicy.returnWindowDays ?? returnPolicy.days;
  if (
    returnable &&
    (!Number.isInteger(Number(returnWindowDays)) ||
      Number(returnWindowDays) < 1 ||
      Number(returnWindowDays) > 365)
  ) {
    return helpers.message({ custom: "Return window must be a whole number between 1 and 365 days" });
  }

  if (!enabled) {
    if (hasDetails) return helpers.message({ custom: "Warranty details must be cleared when warranty is disabled" });
    return { ...value, enabled: false };
  }

  if (!value.period) return helpers.message({ custom: "Warranty period is required" });
  if (!value.periodUnit) return helpers.message({ custom: "Warranty unit is required" });
  if (!value.provider) return helpers.message({ custom: "Warranty provider is required" });
  if (!value.type) return helpers.message({ custom: "Warranty type is required" });
  if (String(value.provider).trim().length > 100 || String(value.type).trim().length > 100) {
    return helpers.message({ custom: "Warranty provider and type must be 100 characters or fewer" });
  }
  if (String(value.terms || "").length > 1000) {
    return helpers.message({ custom: "Warranty terms must be 1000 characters or fewer" });
  }
  return { ...value, enabled: true };
}, "warranty coverage validation");

const originSchema = Joi.object({
  country: optionalString(),
  state: optionalString(),
  city: optionalString(),
});

const shippingSchema = Joi.object({
  freeShipping: Joi.boolean().default(false),
  freeShippingMinOrder: optionalNonNegativeNumber().max(MAX_MONEY).precision(2),
  shippingClass: optionalString(),
  additionalCost: optionalNonNegativeNumber().max(MAX_MONEY).precision(2).default(0),
  shippingCharge: optionalNonNegativeNumber().max(MAX_MONEY).precision(2),
  handlingCharge: optionalNonNegativeNumber().max(MAX_MONEY).precision(2).default(0),
  processingDays: optionalNonNegativeInteger().default(1),
  serviceabilityMode: Joi.string()
    .valid("inherit", "all_pincodes", "allowlist", "regions", "disabled")
    .default("inherit"),
  serviceablePincodes: Joi.array().items(Joi.string().trim()).default([]),
  allowPincodes: Joi.array().items(Joi.string().trim()).default([]),
  regions: Joi.array().items(Joi.string().trim()).default([]),
  states: Joi.array().items(Joi.string().trim()).default([]),
  cities: Joi.array().items(Joi.string().trim()).default([]),
  codAvailable: Joi.boolean(),
  estimatedDaysMin: optionalNonNegativeInteger(),
  estimatedDaysMax: optionalNonNegativeInteger(),
  shippingPartner: optionalString(),
  shippingMethod: optionalString().default("standard"),
  dangerousGoods: Joi.boolean().default(false),
  requiresColdChain: Joi.boolean().default(false),
  shippingProfileId: Joi.string().uuid().allow("", null).optional(),
}).custom((value, helpers) => {
  if (
    value.estimatedDaysMin !== undefined &&
    value.estimatedDaysMax !== undefined &&
    value.estimatedDaysMin > value.estimatedDaysMax
  ) {
    return helpers.message({ custom: "Minimum delivery ETA cannot exceed maximum ETA" });
  }
  return value;
});

const inventorySettingsSchema = Joi.object({
  trackInventory: Joi.boolean().default(true),
  allowBackorder: Joi.boolean().default(false),
  backorderLimit: optionalNonNegativeInteger(),
  lowStockThreshold: optionalNonNegativeInteger().default(5),
  outOfStockMessage: optionalString(),
  manageVariantInventory: Joi.boolean().default(false),
});

const moderationChecklistSchema = Joi.object({
  titleVerified: Joi.boolean(),
  categoryVerified: Joi.boolean(),
  complianceVerified: Joi.boolean(),
  mediaVerified: Joi.boolean(),
  pricingVerified: Joi.boolean(),
  inventoryVerified: Joi.boolean(),
}).default({});

// ─── Product body (shared between create/update) ─────────────────────────────

const productBodyBase = {
  title: productTitleSchema,
  shortDescription: Joi.string().max(500).trim().allow("", null),
  sellerId: optionalString(),
  organizationId: optionalString(),
  storeId: optionalString(),
  warehouseId: optionalString(),
  description: productDescriptionSchema,
  productType: Joi.string().valid(...Object.values(PRODUCT_TYPE)),
  visibility: Joi.string().valid(...Object.values(PRODUCT_VISIBILITY)),
  publishedAt: Joi.date().allow(null),
  scheduledAt: Joi.date().allow(null),

  // Pricing
  price: deprecatedRootVariantField(),
  mrp: deprecatedRootVariantField(),
  salePrice: deprecatedRootVariantField(),
  costPrice: optionalNonNegativeNumber().max(MAX_MONEY).precision(2),
  gstRate: gstRateSchema(),
  gstInclusive: Joi.boolean(),
  hsnCode: optionalString(),
  currency: optionalString(),

  // Categorization
  category: Joi.string(),
  categoryId: optionalString(),
  brand: optionalString(),
  productFamilyCode: optionalString(),
  tags: Joi.array()
    .items(Joi.string().trim().min(2).max(40).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required())
    .max(20)
    .default([])
    .custom((tags, helpers) =>
      uniqueTrimmedStrings(tags)
        ? tags
        : helpers.message({ custom: "Tags must be unique" }),
    ),

  // Identifiers
  sku: deprecatedRootVariantField(),
  barcode: optionalString(),
  color: deprecatedRootVariantField(),

  // Attributes & variants
  attributes: Joi.object().default({}),
  variantAxes: Joi.array().items(Joi.string().trim()).default([]),
  hasVariants: Joi.boolean(),
  defaultVariantId: optionalString(),
  variants: Joi.array().items(variantSchema).default([]),
  options: optionArray.default([]),

  // Type-specific
  digital: digitalSchema,
  subscription: subscriptionSchema,
  bundleItems: Joi.array().items(bundleItemSchema).default([]),
  bundleDiscount: optionalNonNegativeNumber(),

  // Specifications (free-form)
  specifications: Joi.object().default({}),

  // Media
  images: deprecatedRootVariantField(),
  commonImages: Joi.array().items(httpUrl()).max(8).default([]).custom((images, helpers) =>
    uniqueHttpUrls(images)
      ? images
      : helpers.message({ custom: "Product images must not contain duplicates" }),
  ),
  videos: Joi.array().items(httpUrl()).max(1).default([]),
  video: optionalHttpUrl(),
  documents: deprecatedRootVariantField(),

  // Physical
  dimensions: dimensionsSchema.keys({
    length: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
    width: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
    height: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
    weight: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
    weightUnit: optionalString(),
    unit: optionalString().default("cm"),
  }).default({}),
  weight: Joi.number().positive().max(MAX_MEASUREMENT).allow(null).empty(""),
  weightUnit: optionalString(),
  origin: originSchema.default({}),
  warranty: warrantySchema,

  // Inventory
  stock: deprecatedRootVariantField(),
  inventorySettings: inventorySettingsSchema.default({}),

  // Shipping
  shipping: shippingSchema.default({}),

  // SEO
  seo: seoSchema.default({}),

  // Relationships
  relatedProducts: Joi.array().items(Joi.string()).default([]),
  crossSellProducts: Joi.array().items(Joi.string()).default([]),
  upSellProducts: Joi.array().items(Joi.string()).default([]),
  frequentlyBoughtTogether: Joi.array().items(Joi.string()).default([]),
  featuredProducts: Joi.array().items(Joi.string()).default([]),
  trendingProducts: Joi.array().items(Joi.string()).default([]),
  bestSellerProducts: Joi.array().items(Joi.string()).default([]),
  collectionIds: Joi.array().items(Joi.string()).default([]),

  // Meta
  metadata: Joi.object().default({}),
  status: Joi.string().valid(...Object.values(PRODUCT_STATUS)),
  approvalStatus: Joi.string().valid(...Object.values(PRODUCT_APPROVAL_STATUS)),
};

const productBodyCrossCheck = (value, helpers) => {
  if (value.weight !== undefined && value.weight !== null && !value.weightUnit) {
    return helpers.message({ custom: "Weight unit is required when weight is entered" });
  }
  if (
    value.dimensions?.weight !== undefined &&
    value.dimensions?.weight !== null &&
    !value.dimensions?.weightUnit
  ) {
    return helpers.message({ custom: "Weight unit is required when weight is entered" });
  }
  if (
    value.status === PRODUCT_STATUS.ACTIVE &&
    Array.isArray(value.variants) &&
    value.variants.length &&
    !value.variants.some((variant) => variant.status === "active")
  ) {
    return helpers.message({ custom: "At least one variant must be active before activating the product" });
  }
  return value;
};

// ─── Exported schemas ────────────────────────────────────────────────────────

const createProductSchema = Joi.object({
  body: Joi.object({
    ...productBodyBase,
    title: productTitleSchema.required(),
    description: productDescriptionSchema.required(),
    category: Joi.string().required(),
    variants: Joi.array().items(variantSchema).min(1).required(),
    organizationId: Joi.string().required(),
    gstInclusive: Joi.boolean().default(true),
    productType: Joi.string().valid(...Object.values(PRODUCT_TYPE)).default(PRODUCT_TYPE.SIMPLE),
    status: Joi.string().valid(...Object.values(PRODUCT_STATUS)).default(PRODUCT_STATUS.DRAFT),
  }).custom(productBodyCrossCheck).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateProductSchema = Joi.object({
  body: Joi.object(productBodyBase).custom(productBodyCrossCheck).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const listProductSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(200),
    q: Joi.string().allow(""),
    keyWord: Joi.string().allow(""),
    search: Joi.string().allow(""),
    category: Joi.string(),
    category_id: Joi.string(),
    status: Joi.string(),
    approvalStatus: Joi.string().valid(...Object.values(PRODUCT_APPROVAL_STATUS)),
    revisionStatus: Joi.alternatives().try(
      Joi.string().valid(...Object.values(PRODUCT_REVISION_WORKFLOW_STATUS)),
      Joi.string().pattern(/^workflow:(none|change_pending)$/i),
    ),
    revisionReviewStatus: Joi.string().valid(
      ...Object.values(PRODUCT_REVISION_STATUS),
    ),
    stockStatus: Joi.string().valid("in_stock", "low_stock", "out_of_stock", "all", ""),
    productType: Joi.string().valid(...Object.values(PRODUCT_TYPE)),
    hasVariants: Joi.boolean(),
    includeVariants: Joi.boolean(),
    view: Joi.string().valid("full", "cards", "facets"),
    visibility: Joi.string(),
    hsnCode: Joi.string(),
    color: Joi.string(),
    country: Joi.string(),
    state: Joi.string(),
    city: Joi.string(),
    productFamilyCode: Joi.string(),
    family: Joi.string(),
    familyCode: Joi.string(),
    sku: Joi.string(),
    brand: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())),
    tags: Joi.string(),
    sellerId: Joi.string(),
    organizationId: Joi.string(),
    storeId: Joi.string(),
    warehouseId: Joi.string(),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    min_price: Joi.number().min(0),
    max_price: Joi.number().min(0),
    rating: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())),
    minRating: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())),
    min_rating: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())),
    inStock: Joi.string().valid("true", "false"),
    in_stock: Joi.string().valid("true", "false"),
    outOfStock: Joi.string().valid("true", "false"),
    out_of_stock: Joi.string().valid("true", "false"),
    expressDelivery: Joi.string().valid("true", "false"),
    express_delivery: Joi.string().valid("true", "false"),
    freeDelivery: Joi.string().valid("true", "false"),
    free_delivery: Joi.string().valid("true", "false"),
    dateFrom: Joi.date().allow("", null),
    dateTo: Joi.date().allow("", null),
    createdFrom: Joi.date().allow("", null),
    createdTo: Joi.date().allow("", null),
    includeAllStatuses: Joi.boolean(),
    includeArchived: Joi.boolean(),
    sort: Joi.string().valid("price_asc", "price_desc", "newest", "oldest", "rating", "popular", ""),
    sortBy: Joi.string().valid(
      "price_asc",
      "price_desc",
      "newest",
      "oldest",
      "rating",
      "popular",
      "title",
      "productTitle",
      "sku",
      "stock",
      "reservedStock",
      "createdAt",
      "updatedAt",
    ),
    sortDir: Joi.string().valid("asc", "desc"),
  })
    .pattern(/^attr_[A-Za-z0-9_-]+$/, Joi.string().allow(""))
    .pattern(/^attribute\.[A-Za-z0-9_-]+$/, Joi.string().allow(""))
    .unknown(true)
    .required(),
  params: Joi.object({}).required(),
});

const searchProductSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().min(2).required(),
    category: Joi.string(),
    categoryId: Joi.string(),
    categorySlug: Joi.string(),
    brand: Joi.string(),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    minRating: Joi.number().min(0).max(5),
    rating: Joi.number().min(0).max(5),
    inStock: Joi.boolean(),
    productType: Joi.string(),
    productFamilyCode: Joi.string().allow("", null),
    family: Joi.string().allow("", null),
    familyCode: Joi.string().allow("", null),
    hsnCode: Joi.string().allow("", null),
    tags: Joi.string().allow("", null),
    color: Joi.string().allow("", null),
    size: Joi.string().allow("", null),
    material: Joi.string().allow("", null),
    fit: Joi.string().allow("", null),
    storage: Joi.string().allow("", null),
    skinType: Joi.string().allow("", null),
    shade: Joi.string().allow("", null),
    finish: Joi.string().allow("", null),
    room: Joi.string().allow("", null),
    sport: Joi.string().allow("", null),
    concern: Joi.string().allow("", null),
    sort: Joi.string().valid("price_asc", "price_desc", "rating", "newest", "_score", "popular", ""),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  })
    .pattern(/^attr_[A-Za-z0-9_-]+$/, Joi.string().allow("", null))
    .pattern(/^attribute\.[A-Za-z0-9_-]+$/, Joi.string().allow("", null))
    .required(),
  params: Joi.object({}).required(),
});

const reviewProductSchema = Joi.object({
  body: Joi.object({
    status: Joi.string()
      .valid(PRODUCT_STATUS.ACTIVE, PRODUCT_STATUS.INACTIVE, PRODUCT_STATUS.REJECTED)
      .required(),
    rejectionReason: Joi.string().max(1000).allow("", null),
    notes: Joi.string().max(500).allow("", null),
    checklist: moderationChecklistSchema,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const rejectProductSchema = Joi.object({
  body: Joi.object({
    rejectionReason: Joi.string().trim().max(1000).required(),
    notes: Joi.string().max(500).allow("", null),
    checklist: moderationChecklistSchema,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const listProductRevisionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    status: Joi.string().valid(...Object.values(PRODUCT_REVISION_STATUS)),
  }).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const reviewProductRevisionSchema = Joi.object({
  body: Joi.object({
    status: Joi.string()
      .valid(PRODUCT_STATUS.ACTIVE, PRODUCT_STATUS.REJECTED)
      .required(),
    rejectionReason: Joi.string().trim().max(1000).allow("", null),
    notes: Joi.string().max(500).allow("", null),
    checklist: moderationChecklistSchema,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
    revisionId: Joi.string().required(),
  }).required(),
});

const bulkProductSchema = Joi.object({
  body: Joi.object({
    productIds: Joi.array().items(Joi.string()).min(1).max(100).required(),
    status: Joi.string().valid(...Object.values(PRODUCT_STATUS)),
    visibility: Joi.string().valid(...Object.values(PRODUCT_VISIBILITY)),
    action: Joi.string().valid("permanent_delete"),
  }).or("status", "visibility", "action").required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const specialPriceVariantUpdateSchema = Joi.object({
  variantId: optionalString(),
  variantSku: optionalString(),
  salePrice: optionalNonNegativeNumber().required(),
}).or("variantId", "variantSku").required();

const specialPriceProductUpdateSchema = Joi.object({
  productId: Joi.string().required(),
  salePrice: optionalNonNegativeNumber(),
  variantId: optionalString(),
  variantSku: optionalString(),
  variants: Joi.array().items(specialPriceVariantUpdateSchema).default([]),
}).or("salePrice", "variantId", "variantSku", "variants");

const specialPriceBulkUpdateSchema = Joi.object({
  body: Joi.alternatives().try(
    Joi.array().items(specialPriceProductUpdateSchema).min(1).required(),
    Joi.object({
      updates: Joi.array().items(specialPriceProductUpdateSchema).min(1).required(),
    }).required(),
  ).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const productPrefillSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    includeInactive: Joi.boolean(),
    includeProducts: Joi.boolean(),
    includeOptionValues: Joi.boolean(),
    includeCategoryAttributes: Joi.boolean(),
    includeStates: Joi.boolean(),
    includeCities: Joi.boolean(),
    sellerId: Joi.string().allow("", null),
    organizationId: Joi.string().allow("", null),
    limit: Joi.number().integer().min(1).max(200),
    productLimit: Joi.number().integer().min(1).max(200),
  }).required(),
  params: Joi.object({}).required(),
});

const productStatusSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid(...Object.values(PRODUCT_STATUS)).required(),
    reason: Joi.string().trim().max(1000).allow("", null),
    rejectionReason: Joi.string().trim().max(1000).allow("", null),
    notes: Joi.string().trim().max(500).allow("", null),
    scheduledAt: Joi.date().allow(null),
    visibility: Joi.string().valid(...Object.values(PRODUCT_VISIBILITY)),
    checklist: moderationChecklistSchema,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const productLifecycleSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid(...Object.values(PRODUCT_STATUS)),
    visibility: Joi.string().valid(...Object.values(PRODUCT_VISIBILITY)),
    title: productTitle(),
    sku: Joi.string().trim().allow("", null),
    reason: Joi.string().trim().max(1000).allow("", null),
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const updateInventorySchema = Joi.object({
  body: Joi.object({
    adjustment: Joi.number(),
    adjustmentType: Joi.string().valid("add", "remove", "set").allow("", null),
    quantity: Joi.number().integer().min(0),
    reason: Joi.string().trim().max(200).allow("", null),
    note: Joi.string().trim().max(1000).allow("", null),
    reference: Joi.string().trim().allow("", null),
    variantSku: Joi.string().trim().required(),
  }).or("adjustment", "quantity").required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const productParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

// ─── Customer review schemas ─────────────────────────────────────────────────

const submitReviewSchema = Joi.object({
  body: Joi.object({
    orderId:    Joi.string().trim().required(),
    orderItemId:Joi.string().trim().allow("", null),
    rating:     Joi.number().integer().min(1).max(5).required(),
    title:      Joi.string().trim().max(200).allow("", null),
    reviewText: Joi.string().trim().max(2000).allow("", null),
    media:      Joi.array().items(Joi.string().uri()).max(5).default([]),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const listReviewsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page:   Joi.number().integer().min(1),
    limit:  Joi.number().integer().min(1).max(50),
    rating: Joi.number().integer().min(1).max(5),
    sort:   Joi.string().valid("newest", "oldest", "highest", "lowest", "helpful"),
  }).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const reviewParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
    reviewId:  Joi.string().required(),
  }).required(),
});

const myReviewSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    orderId: Joi.string().trim().allow("", null),
    orderItemId: Joi.string().trim().allow("", null),
  }).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  listProductSchema,
  searchProductSchema,
  productPrefillSchema,
  reviewProductSchema,
  rejectProductSchema,
  listProductRevisionsSchema,
  reviewProductRevisionSchema,
  productStatusSchema,
  productLifecycleSchema,
  bulkProductSchema,
  specialPriceBulkUpdateSchema,
  updateInventorySchema,
  productParamSchema,
  submitReviewSchema,
  listReviewsSchema,
  myReviewSchema,
  reviewParamSchema,
};
