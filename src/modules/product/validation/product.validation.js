const Joi = require("joi");
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
  PRODUCT_REVISION_STATUS,
  DIGITAL_FILE_TYPE,
  SUBSCRIPTION_BILLING_CYCLE,
} = require("../../../shared/domain/commerce-constants");

// ─── Helpers ────────────────────────────────────────────────────────────────

const optionalString = () => Joi.string().trim().allow("", null);
const optionalPositiveNumber = () => Joi.number().positive().allow(null).empty("");
const optionalNonNegativeInteger = () => Joi.number().integer().min(0).allow(null).empty("");
const optionalNonNegativeNumber = () => Joi.number().min(0).allow(null).empty("");

// ─── Reusable sub-schemas ────────────────────────────────────────────────────

const variantSchema = Joi.object({
  sku: Joi.string().trim().required(),
  title: optionalString(),
  price: optionalNonNegativeNumber(),
  mrp: optionalNonNegativeNumber(),
  salePrice: optionalNonNegativeNumber(),
  gstRate: Joi.number().min(0).max(100),
  stock: optionalNonNegativeInteger().default(0),
  barcode: optionalString(),
  weight: optionalNonNegativeNumber(),
  weightUnit: optionalString(),
  dimensions: Joi.object({
    length: optionalPositiveNumber(),
    width: optionalPositiveNumber(),
    height: optionalPositiveNumber(),
    unit: optionalString(),
  }),
  attributes: Joi.object().default({}),
  images: Joi.array().items(Joi.string().uri()).default([]),
  status: Joi.string().valid("active", "inactive", "out_of_stock").default("active"),
  isDefault: Joi.boolean().default(false),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const optionSchema = Joi.object({
  platformOptionId: optionalString(),
  name: Joi.string().trim().required(),
  slug: optionalString(),
  values: Joi.array().items(Joi.string().trim()).required(),
  valueCodes: Joi.object().pattern(Joi.string(), Joi.string().allow("", null)).default({}),
  required: Joi.boolean().default(false),
  displayType: Joi.string()
    .valid("dropdown", "button", "color_swatch", "radio", "thumbnail")
    .default("dropdown"),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const seoSchema = Joi.object({
  metaTitle: Joi.string().trim().max(70).allow("", null),
  metaDescription: Joi.string().trim().max(160).allow("", null),
  keywords: Joi.array().items(Joi.string().trim()).default([]),
  canonicalUrl: Joi.string().uri().allow("", null),
  ogTitle: optionalString(),
  ogDescription: optionalString(),
  ogImage: Joi.string().uri().allow("", null),
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

const badgeSchema = Joi.object({
  type: optionalString(),
  label: Joi.string().trim().required(),
  color: optionalString(),
  bgColor: optionalString(),
  validFrom: Joi.date().allow(null),
  validTo: Joi.date().allow(null),
});

const dimensionsSchema = Joi.object({
  length: optionalPositiveNumber(),
  width: optionalPositiveNumber(),
  height: optionalPositiveNumber(),
  unit: optionalString().default("cm"),
});

const warrantySchema = Joi.object({
  period: optionalNonNegativeInteger(),
  periodUnit: Joi.string().valid("days", "weeks", "months", "years").default("months"),
  type: optionalString().default("manufacturer"),
  provider: optionalString(),
  terms: optionalString(),
  returnPolicy: Joi.object({
    eligible: Joi.boolean().default(true),
    days: optionalNonNegativeInteger().default(7),
    type: optionalString().default("standard"),
    restockingFee: optionalNonNegativeNumber().default(0),
  }).default({}),
  serviceableCountries: Joi.array().items(Joi.string().trim()).default([]),
});

const originSchema = Joi.object({
  country: optionalString(),
  state: optionalString(),
  city: optionalString(),
});

const shippingSchema = Joi.object({
  freeShipping: Joi.boolean().default(false),
  freeShippingMinOrder: optionalNonNegativeNumber(),
  shippingClass: optionalString(),
  additionalCost: optionalNonNegativeNumber().default(0),
  processingDays: optionalNonNegativeInteger().default(1),
  dangerousGoods: Joi.boolean().default(false),
  requiresColdChain: Joi.boolean().default(false),
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
  title: Joi.string().min(3).max(200).trim(),
  shortDescription: Joi.string().max(500).trim().allow("", null),
  sellerId: optionalString(),
  description: Joi.string().min(10),
  productType: Joi.string().valid(...Object.values(PRODUCT_TYPE)),
  visibility: Joi.string().valid(...Object.values(PRODUCT_VISIBILITY)),
  publishedAt: Joi.date().allow(null),
  scheduledAt: Joi.date().allow(null),

  // Pricing
  price: Joi.number().min(0),
  mrp: Joi.number().min(0),
  salePrice: optionalNonNegativeNumber(),
  costPrice: optionalNonNegativeNumber(),
  gstRate: Joi.number().min(0).max(100),
  gstInclusive: Joi.boolean(),
  hsnCode: optionalString(),
  currency: optionalString(),

  // Categorization
  category: Joi.string(),
  categoryId: optionalString(),
  brand: optionalString(),
  productFamilyCode: optionalString(),
  tags: Joi.array().items(Joi.string().trim()).default([]),
  badges: Joi.array().items(badgeSchema).default([]),

  // Identifiers
  sku: optionalString(),
  barcode: optionalString(),
  color: optionalString(),

  // Attributes & variants
  attributes: Joi.object().default({}),
  variantAxes: Joi.array().items(Joi.string().trim()).default([]),
  hasVariants: Joi.boolean(),
  defaultVariantId: optionalString(),
  variants: Joi.array().items(variantSchema).default([]),
  options: Joi.array().items(optionSchema).default([]),

  // Type-specific
  digital: digitalSchema,
  subscription: subscriptionSchema,
  bundleItems: Joi.array().items(bundleItemSchema).default([]),
  bundleDiscount: optionalNonNegativeNumber(),

  // Specifications (free-form)
  specifications: Joi.object().default({}),

  // Media
  images: Joi.array().items(Joi.string().uri()).default([]),
  videos: Joi.array().items(Joi.string().uri()).default([]),
  documents: Joi.array().items(Joi.string().uri()).default([]),

  // Physical
  dimensions: dimensionsSchema.default({}),
  weight: optionalNonNegativeNumber(),
  weightUnit: optionalString(),
  origin: originSchema.default({}),
  warranty: warrantySchema.default({}),

  // Inventory
  stock: Joi.number().integer().min(0),
  inventorySettings: inventorySettingsSchema.default({}),

  // Shipping
  shipping: shippingSchema.default({}),

  // SEO
  seo: seoSchema.default({}),

  // Relationships
  relatedProducts: Joi.array().items(Joi.string()).default([]),
  crossSellProducts: Joi.array().items(Joi.string()).default([]),
  upSellProducts: Joi.array().items(Joi.string()).default([]),

  // Meta
  metadata: Joi.object().default({}),
  status: Joi.string().valid(...Object.values(PRODUCT_STATUS)),
};

// ─── Exported schemas ────────────────────────────────────────────────────────

const createProductSchema = Joi.object({
  body: Joi.object({
    ...productBodyBase,
    title: Joi.string().min(3).max(200).trim().required(),
    description: Joi.string().min(10).required(),
    price: Joi.number().min(0).required(),
    mrp: Joi.number().min(0).required(),
    category: Joi.string().required(),
    stock: Joi.number().integer().min(0).required(),
    productType: Joi.string().valid(...Object.values(PRODUCT_TYPE)).default(PRODUCT_TYPE.SIMPLE),
    status: Joi.string().valid(...Object.values(PRODUCT_STATUS)).default(PRODUCT_STATUS.DRAFT),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateProductSchema = Joi.object({
  body: Joi.object(productBodyBase).required(),
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
    status: Joi.string(),
    stockStatus: Joi.string().valid("in_stock", "low_stock", "out_of_stock", "all", ""),
    productType: Joi.string().valid(...Object.values(PRODUCT_TYPE)),
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
    brand: Joi.string(),
    tags: Joi.string(),
    sellerId: Joi.string(),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    inStock: Joi.boolean(),
    rating: Joi.number().min(0).max(5),
    includeAllStatuses: Joi.boolean(),
    sort: Joi.string().valid("price_asc", "price_desc", "newest", "oldest", "rating", "popular", ""),
    sortBy: Joi.string().valid(
      "price_asc",
      "price_desc",
      "newest",
      "oldest",
      "rating",
      "popular",
      "title",
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
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateInventorySchema = Joi.object({
  body: Joi.object({
    adjustment: Joi.number().required(),
    reason: Joi.string().trim().max(200).allow("", null),
    reference: Joi.string().trim().allow("", null),
    variantSku: optionalString(),
  }).required(),
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

module.exports = {
  createProductSchema,
  updateProductSchema,
  listProductSchema,
  searchProductSchema,
  reviewProductSchema,
  rejectProductSchema,
  listProductRevisionsSchema,
  reviewProductRevisionSchema,
  bulkProductSchema,
  updateInventorySchema,
  productParamSchema,
};
