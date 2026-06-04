const Joi = require("joi");

const loyaltyValidation = {
  addPoints: Joi.object({
    points: Joi.number().positive().required(),
    reason: Joi.string().valid("purchase", "referral", "birthday", "tier_upgrade").required(),
    expiresAt: Joi.date().iso().optional(),
    transactionId: Joi.string().optional(),
  }),

  redeemPoints: Joi.object({
    points: Joi.number().positive().required(),
  }),

  getPointsHistory: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),
};

const recommendationValidation = {
  getRecommendations: Joi.object({
    limit: Joi.number().default(10).max(50),
  }),
  recordInteraction: Joi.object({
    productId: Joi.string().required(),
    interactionType: Joi.string().valid("clicked", "purchased", "viewed").required(),
  }),
  getTrending: Joi.object({
    category: Joi.string().optional(),
    period: Joi.string().valid("today", "week", "month").default("week"),
    limit: Joi.number().integer().min(1).max(50).default(10),
  }),

  addRecommendation: Joi.object({
    productId: Joi.string().required(),
    reason: Joi.string().required(),
    score: Joi.number().min(0).max(100),
  }),
};

const returnValidation = {
  requestReturn: Joi.object({
    orderId: Joi.string().required(),
    items: Joi.array()
      .items(
        Joi.object({
          productId: Joi.string().required(),
          variantId: Joi.string().allow("", null),
          variantSku: Joi.string().allow("", null),
          quantity: Joi.number().positive().required(),
          unitPrice: Joi.number().positive(),
          taxAmount: Joi.number().min(0),
          refundAmount: Joi.number().min(0),
          photos: Joi.array().items(Joi.string()),
        }),
      )
      .required(),
    reason: Joi.string().valid("defective", "not_as_described", "changed_mind", "other").required(),
    description: Joi.string().max(500),
    photos: Joi.array().items(Joi.string()),
  }),

  approveReturn: Joi.object({
    returnId: Joi.string().required(),
    refundAmount: Joi.number().positive().required(),
    note: Joi.string().allow("", null),
  }),

  shipReturn: Joi.object({
    returnId: Joi.string().required(),
    trackingNumber: Joi.string().required(),
  }),
  rejectReturn: Joi.object({
    returnId: Joi.string().required(),
    reason: Joi.string().required(),
  }),
  scheduleReturn: Joi.object({
    returnId: Joi.string().required(),
    trackingNumber: Joi.string().allow("", null),
    note: Joi.string().allow("", null),
  }),
  receiveReturn: Joi.object({
    returnId: Joi.string().required(),
    notes: Joi.string().allow("", null),
  }),
  qcReturn: Joi.object({
    returnId: Joi.string().required(),
    passed: Joi.boolean().required(),
    condition: Joi.string().allow("", null),
    notes: Joi.string().allow("", null),
  }),
  replacementReturn: Joi.object({
    returnId: Joi.string().required(),
    replacementOrderId: Joi.string().allow("", null),
    replacementShipmentId: Joi.string().allow("", null),
    note: Joi.string().allow("", null),
  }),
  closeReturn: Joi.object({
    returnId: Joi.string().required(),
    reason: Joi.string().allow("", null),
    note: Joi.string().allow("", null),
  }),
  listReturns: Joi.object({
    status: Joi.string(),
    orderId: Joi.string(),
    buyerId: Joi.string(),
    sellerId: Joi.string(),
    reason: Joi.string(),
    search: Joi.string().allow("", null),
    fromDate: Joi.date(),
    toDate: Joi.date(),
    limit: Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),
  getReturnById: Joi.object({
    returnId: Joi.string().required(),
  }),
  getReturnByOrder: Joi.object({
    orderId: Joi.string().required(),
  }),
  processRefund: Joi.object({
    returnId: Joi.string().required(),
    refundAmount: Joi.number().positive(),
    referenceId: Joi.string().allow("", null),
    method: Joi.string().allow("", null),
    note: Joi.string().allow("", null),
  }),
};

const dynamicPricingValidation = {
  getPriceForProduct: Joi.object({
    productId: Joi.string().required(),
    userTier: Joi.string().valid("bronze", "silver", "gold", "platinum"),
    quantity: Joi.number().default(1).min(1),
  }),

  adjustPrice: Joi.object({
    productId: Joi.string().required(),
    newPrice: Joi.number().positive().required(),
    reason: Joi.string().required(),
  }),

  applyRule: Joi.object({
    productId: Joi.string().required(),
    type: Joi.string().valid("time_based", "volume_based", "demand_based", "seasonal").required(),
    condition: Joi.object().required(),
    priceModifier: Joi.number().positive().required(),
    priority: Joi.number().required(),
  }),
};

const notificationValidation = {
  updatePreferences: Joi.object({
    channels: Joi.object({
      email: Joi.boolean(),
      sms: Joi.boolean(),
      push: Joi.boolean(),
      inApp: Joi.boolean(),
    }),
    eventTypes: Joi.object({
      order: Joi.boolean(),
      payment: Joi.boolean(),
      shipping: Joi.boolean(),
      promo: Joi.boolean(),
      referral: Joi.boolean(),
      newProduct: Joi.boolean(),
    }),
    frequency: Joi.string().valid("real_time", "daily", "weekly", "never"),
    doNotDisturbStart: Joi.string().pattern(/^\d{2}:\d{2}$/),
    doNotDisturbEnd: Joi.string().pattern(/^\d{2}:\d{2}$/),
    timezone: Joi.string(),
  }),
};

const fraudValidation = {
  analyzeOrder: Joi.object({
    order: Joi.object().required(),
    paymentInfo: Joi.object().required(),
    userProfile: Joi.object(),
    orderHistory: Joi.array(),
  }),

  reviewOrder: Joi.object({
    decision: Joi.string().valid("approved", "rejected").required(),
    notes: Joi.string().max(500),
  }),
};

const commissionValidation = {
  calculateCommission: Joi.object({
    orderId: Joi.string().required(),
  }),
  processPayouts: Joi.object({
    sellerId: Joi.string().required(),
    periodStart: Joi.date(),
    periodEnd: Joi.date(),
    paymentReference: Joi.string().trim().max(160),
    paymentMethod: Joi.string().trim().max(64),
  }),
};

const searchValidation = {
  search: Joi.object({
    q: Joi.string().trim().min(1).allow("").default(""),
    category: Joi.string().trim().allow("", null),
    categoryId: Joi.string().trim().allow("", null),
    categorySlug: Joi.string().trim().allow("", null),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    minRating: Joi.number().min(0).max(5),
    rating: Joi.number().min(0).max(5),
    seller: Joi.string().trim().allow("", null),
    brand: Joi.string().trim().allow("", null),
    productType: Joi.string().trim().allow("", null),
    productFamilyCode: Joi.string().trim().allow("", null),
    family: Joi.string().trim().allow("", null),
    familyCode: Joi.string().trim().allow("", null),
    hsnCode: Joi.string().trim().allow("", null),
    tags: Joi.string().trim().allow("", null),
    color: Joi.string().trim().allow("", null),
    size: Joi.string().trim().allow("", null),
    material: Joi.string().trim().allow("", null),
    fit: Joi.string().trim().allow("", null),
    storage: Joi.string().trim().allow("", null),
    skinType: Joi.string().trim().allow("", null),
    shade: Joi.string().trim().allow("", null),
    finish: Joi.string().trim().allow("", null),
    room: Joi.string().trim().allow("", null),
    sport: Joi.string().trim().allow("", null),
    concern: Joi.string().trim().allow("", null),
    inStock: Joi.boolean(),
    sort: Joi.string().valid("price_asc", "price_desc", "rating", "newest", "_score", "popular", "").default("_score"),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
  })
    .pattern(/^attr_[A-Za-z0-9_-]+$/, Joi.string().trim().allow("", null))
    .pattern(/^attribute\.[A-Za-z0-9_-]+$/, Joi.string().trim().allow("", null)),
  autocomplete: Joi.object({
    q: Joi.string().trim().min(1).required(),
    limit: Joi.number().integer().min(1).max(20).default(10),
  }),
};

module.exports = {
  loyaltyValidation,
  recommendationValidation,
  returnValidation,
  dynamicPricingValidation,
  notificationValidation,
  fraudValidation,
  commissionValidation,
  searchValidation,
};
