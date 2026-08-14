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
    category: Joi.string().allow("", null).optional(),
    period: Joi.string().valid("today", "week", "month").default("week"),
    limit: Joi.number().integer().min(1).default(10).max(50),
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
          orderItemId: Joi.string().allow("", null),
          productId: Joi.string().required(),
          variantId: Joi.string().allow("", null),
          variantSku: Joi.string().allow("", null),
          quantity: Joi.number().integer().positive().required(),
          unitPrice: Joi.number().positive(),
          taxAmount: Joi.number().min(0),
          refundAmount: Joi.number().min(0),
          photos: Joi.array().items(Joi.string()),
        }),
      )
      .required(),
    reason: Joi.string().valid(
      "defective",
      "damaged_in_transit",
      "wrong_item",
      "missing_parts",
      "size_issue",
      "quality_issue",
      "not_as_described",
      "changed_mind",
      "other",
    ).required(),
    resolution: Joi.string().valid("refund", "replacement", "exchange", "store_credit").default("refund"),
    description: Joi.string().max(1000),
    photos: Joi.array().items(Joi.string()),
  }),

  approveReturn: Joi.object({
    returnId: Joi.string().required(),
    refundAmount: Joi.number().positive().required(),
    note: Joi.string().allow("", null),
    items: Joi.array().items(Joi.object({
      orderItemId: Joi.string().allow("", null),
      productId: Joi.string().allow("", null),
      variantSku: Joi.string().allow("", null),
      approvedQuantity: Joi.number().integer().min(0).required(),
    })),
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
    mode: Joi.string().valid("reverse_pickup", "manual_ship_back").default("reverse_pickup"),
    manualShipBack: Joi.boolean(),
    provider: Joi.string().default("manual"),
    courierName: Joi.string().allow("", null),
    awbNumber: Joi.string().allow("", null),
    trackingNumber: Joi.string().allow("", null),
    shippingMode: Joi.string().valid("standard", "express", "same_day", "hyperlocal").default("standard"),
    pickupScheduledAt: Joi.date().iso(),
    expectedDeliveryAt: Joi.date().iso(),
    labelData: Joi.object(),
    packageSnapshot: Joi.object(),
    pickupAddressSnapshot: Joi.object(),
    warehouseAddressSnapshot: Joi.object(),
    shipToSnapshot: Joi.object(),
    rateSnapshot: Joi.object(),
    cost: Joi.number().min(0),
    idempotencyKey: Joi.string().max(180),
    metadata: Joi.object(),
    note: Joi.string().allow("", null),
  }),
  updateReverseShipment: Joi.object({
    returnId: Joi.string().required(),
    shipmentId: Joi.string().allow("", null),
    status: Joi.string().valid(
      "initiated",
      "manifested",
      "pickup_scheduled",
      "pickup_failed",
      "failed",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "received",
    ).required(),
    eventTime: Joi.date().iso(),
    location: Joi.string().allow("", null),
    note: Joi.string().allow("", null),
    source: Joi.string().allow("", null),
    deliveryException: Joi.string().allow("", null),
    rawPayload: Joi.object(),
  }),
  receiveReturn: Joi.object({
    returnId: Joi.string().required(),
    notes: Joi.string().allow("", null),
    items: Joi.array().items(Joi.object({
      orderItemId: Joi.string().allow("", null),
      productId: Joi.string().allow("", null),
      variantSku: Joi.string().allow("", null),
      receivedQuantity: Joi.number().integer().min(0).required(),
    })),
  }),
  qcReturn: Joi.object({
    returnId: Joi.string().required(),
    passed: Joi.boolean(),
    condition: Joi.string().allow("", null),
    notes: Joi.string().allow("", null),
    items: Joi.array().items(Joi.object({
      orderItemId: Joi.string().allow("", null),
      productId: Joi.string().allow("", null),
      variantSku: Joi.string().allow("", null),
      quantity: Joi.number().integer().min(0).required(),
      result: Joi.string().valid("sellable", "damaged", "missing", "rejected").required(),
      condition: Joi.string().allow("", null),
      notes: Joi.string().allow("", null),
      photos: Joi.array().items(Joi.string()),
    })).min(1),
  }).or("passed", "items"),
  qcEvidence: Joi.object({
    returnId: Joi.string().required(),
    note: Joi.string().trim().min(3).max(2000).required(),
    items: Joi.array().items(Joi.object({
      orderItemId: Joi.string().allow("", null),
      productId: Joi.string().allow("", null),
      variantSku: Joi.string().allow("", null),
      notes: Joi.string().trim().min(3).max(1000).required(),
      photos: Joi.array().items(Joi.string().trim().required()).min(1).required(),
    })).min(1).required(),
  }),
  qcDispute: Joi.object({
    returnId: Joi.string().required(),
    reason: Joi.string().trim().min(10).max(2000).required(),
    evidence: Joi.array().items(Joi.string().trim().required()).max(10).default([]),
  }),
  qcDecision: Joi.object({
    returnId: Joi.string().required(),
    decision: Joi.string().valid("uphold", "override", "partial", "request_evidence").required(),
    reason: Joi.string().trim().min(3).max(2000).required(),
    returnToCustomerRequired: Joi.boolean().default(true),
    items: Joi.array().items(Joi.object({
      orderItemId: Joi.string().allow("", null),
      productId: Joi.string().allow("", null),
      variantSku: Joi.string().allow("", null),
      approvedQuantity: Joi.number().integer().min(0).required(),
      disposition: Joi.string().valid("damaged", "sellable").default("damaged"),
    })).default([]),
  }),
  returnToCustomerShipment: Joi.object({
    returnId: Joi.string().required(),
    courierName: Joi.string().trim().min(2).max(120).required(),
    trackingNumber: Joi.string().trim().min(3).max(200).required(),
    trackingUrl: Joi.string().uri().allow("", null),
    note: Joi.string().allow("", null).max(1000),
  }),
  returnToCustomerTracking: Joi.object({
    returnId: Joi.string().required(),
    status: Joi.string().valid("shipped", "in_transit", "delivered", "failed").required(),
    location: Joi.string().allow("", null).max(300),
    note: Joi.string().allow("", null).max(1000),
  }),
  replacementReturn: Joi.object({
    returnId: Joi.string().required(),
    action: Joi.string().valid("request", "approve", "ship", "deliver", "complete").default("request"),
    provider: Joi.string().allow("", null),
    courierName: Joi.string().allow("", null),
    awbNumber: Joi.string().allow("", null),
    trackingNumber: Joi.string().allow("", null),
    shippingMode: Joi.string().valid("standard", "express", "same_day", "hyperlocal").default("standard"),
    packageSnapshot: Joi.object(),
    pickupAddressSnapshot: Joi.object(),
    metadata: Joi.object(),
    note: Joi.string().allow("", null),
  }),
  closeReturn: Joi.object({
    returnId: Joi.string().required(),
    reason: Joi.string().allow("", null),
    note: Joi.string().allow("", null),
  }),
  listReturns: Joi.object({
    status: Joi.string().valid(
      "requested",
      "approved",
      "rejected",
      "reverse_pickup_scheduled",
      "pickup_failed",
      "manual_ship_back",
      "shipped_back",
      "in_reverse_transit",
      "received",
      "qc_passed",
      "qc_failed",
      "qc_completed",
      "qc_failure_upheld",
      "refund_pending",
      "refund_failed",
      "partially_refunded",
      "refunded",
      "replacement_requested",
      "replacement_pending",
      "replacement_created",
      "replacement_shipped",
      "replacement_delivered",
      "replaced",
      "closed",
    ),
    orderId: Joi.string(),
    buyerId: Joi.string(),
    sellerId: Joi.string(),
    organizationId: Joi.string().guid({ version: "uuidv4" }),
    reason: Joi.string().valid(
      "defective",
      "damaged_in_transit",
      "wrong_item",
      "missing_parts",
      "size_issue",
      "quality_issue",
      "not_as_described",
      "changed_mind",
      "other",
    ),
    refundStatus: Joi.string().valid("not_started", "pending", "provider_pending", "completed", "failed", "manual_review"),
    shipmentStatus: Joi.string(),
    search: Joi.string().allow("", null),
    fromDate: Joi.date(),
    toDate: Joi.date(),
    sortBy: Joi.string()
      .valid("createdAt", "requestedAt", "refundAmount", "status", "reason", "orderId", "buyerId", "returnNumber")
      .default("createdAt"),
    sortDir: Joi.string().valid("asc", "desc").default("desc"),
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
    method: Joi.string().valid("auto", "wallet", "store_credit", "original_payment", "split", "manual"),
    walletAmount: Joi.number().min(0),
    providerAmount: Joi.number().min(0),
    idempotencyKey: Joi.string().max(180),
    note: Joi.string().allow("", null),
  }),
  retryRefund: Joi.object({
    returnId: Joi.string().required(),
    refundAmount: Joi.number().positive(),
    referenceId: Joi.string().allow("", null),
    method: Joi.string().valid("auto", "wallet", "store_credit", "original_payment", "split", "manual"),
    walletAmount: Joi.number().min(0),
    providerAmount: Joi.number().min(0),
    note: Joi.string().allow("", null),
  }),
};

const dynamicPricingValidation = {
  getPriceForProduct: Joi.object({
    productId: Joi.string().required(),
    variantId: Joi.string().allow("", null).optional(),
    sku: Joi.string().allow("", null).optional(),
    userTier: Joi.string().valid("bronze", "silver", "gold", "platinum"),
    quantity: Joi.number().integer().default(1).min(1),
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
    organizationId: Joi.string().guid({ version: "uuidv4" }).allow(null),
    commissionIds: Joi.array().items(Joi.string().guid({ version: "uuidv4" })).min(1).max(100),
    periodStart: Joi.date(),
    periodEnd: Joi.date(),
    paymentReference: Joi.string().trim().max(160),
    paymentMethod: Joi.string().trim().max(64),
    autoProcess: Joi.boolean(),
    note: Joi.string().trim().max(1000).allow("", null),
  }),
  requestPayout: Joi.object({
    organizationId: Joi.string().guid({ version: "uuidv4" }).allow(null),
    commissionIds: Joi.array().items(Joi.string().guid({ version: "uuidv4" })).min(1).max(100),
    periodStart: Joi.date(),
    periodEnd: Joi.date(),
    note: Joi.string().trim().max(1000).allow("", null),
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
