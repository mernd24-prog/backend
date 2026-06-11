const Joi = require("joi");
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  ORDER_STATUS,
  PAYMENT_STATUS,
} = require("../../../shared/domain/commerce-constants");

const accountStatuses = ["active", "suspended", "pending_approval"];
const permissionActions = [
  "view",
  "create",
  "add",
  "edit",
  "update",
  "delete",
  "approve",
  "approval",
  "reject",
  "assign",
  "export",
  "import",
  "status_change",
  "status",
  "restore",
  "bulk_action",
  "action",
];
const sellerOnboardingStatuses = [
  "initiated",
  "in_progress",
  "under_review",
  "ready_for_go_live",
  "rejected",
];
const sellerKycStatuses = ["not_submitted", "submitted", "under_review", "verified", "rejected"];
const sellerBankStatuses = ["not_submitted", "submitted", "verified", "rejected"];
const sellerGoLiveStatuses = ["pending", "ready", "live", "blocked"];

const adminOverviewSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listActivityLogsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    search: Joi.string().allow(""),
    action: Joi.string().allow(""),
    module: Joi.string().allow(""),
    statusCode: Joi.number().integer().min(100).max(599),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
  }).required(),
  params: Joi.object({}).required(),
});

const listVendorsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().allow(""),
    status: Joi.string().valid(...accountStatuses),
    onboardingStatus: Joi.string().valid(...sellerOnboardingStatuses),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }).required(),
  params: Joi.object({}).required(),
});

const listUsersSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().allow(""),
    role: Joi.string().valid(
      "admin",
      "sub-admin",
      "seller",
      "seller-admin",
      "seller-sub-admin",
      "buyer",
      "super-admin",
    ),
    roles: Joi.alternatives().try(
      Joi.array().items(
        Joi.string().valid(
          "admin",
          "sub-admin",
          "seller",
          "seller-admin",
          "seller-sub-admin",
          "buyer",
          "super-admin",
        ),
      ),
      Joi.string().valid(
        "admin",
        "sub-admin",
        "seller",
        "seller-admin",
        "seller-sub-admin",
        "buyer",
        "super-admin",
      ),
    ),
    accountStatus: Joi.string().valid(...accountStatuses),
    status: Joi.string().valid(...accountStatuses),
    emailVerified: Joi.boolean(),
    ownerAdminId: Joi.string().allow(null),
    ownerSellerId: Joi.string().allow(null),
    parentAdminId: Joi.string().allow(null),
    parentSellerId: Joi.string().allow(null),
    createdBy: Joi.string().allow(null),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }).required(),
  params: Joi.object({}).required(),
});

const createManagedUserSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    phone: Joi.string().allow("", null),
    password: Joi.string().min(8).required(),
    role: Joi.string().valid("buyer", "seller").default("buyer"),
    allowedModules: Joi.array().items(Joi.string()).default([]),
    modulePermissions: Joi.array().items(
      Joi.object({
        module: Joi.string().required(),
        actions: Joi.array()
          .items(Joi.string().valid(...permissionActions))
          .min(1)
          .required(),
      }),
    ).default([]),
    accountStatus: Joi.string()
      .valid("active", "suspended", "pending_approval"),
    profile: Joi.object({
      firstName: Joi.string().required(),
      lastName: Joi.string().allow("", null),
      avatarUrl: Joi.string().uri().allow("", null),
    }).required(),
    sellerProfile: Joi.object({
      displayName: Joi.string().allow("", null),
      legalBusinessName: Joi.string().allow("", null),
      description: Joi.string().allow("", null),
      supportEmail: Joi.string().email().allow("", null),
      supportPhone: Joi.string().allow("", null),
      businessType: Joi.string().allow("", null),
      registrationNumber: Joi.string().allow("", null),
      gstNumber: Joi.string().allow("", null),
      panNumber: Joi.string().allow("", null),
    }).default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const userParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

const updateUserSchema = Joi.object({
  body: Joi.object({
    role: Joi.string().valid(
      "admin",
      "sub-admin",
      "seller",
      "seller-admin",
      "seller-sub-admin",
      "buyer",
      "super-admin",
    ),
    phone: Joi.string().allow("", null),
    accountStatus: Joi.string().valid(...accountStatuses),
    profile: Joi.object({
      firstName: Joi.string().allow("", null),
      lastName: Joi.string().allow("", null),
      avatarUrl: Joi.string().uri().allow("", null),
    }),
    sellerProfile: Joi.object({
      displayName: Joi.string().allow("", null),
      legalBusinessName: Joi.string().allow("", null),
      description: Joi.string().allow("", null),
      supportEmail: Joi.string().email().allow("", null),
      supportPhone: Joi.string().allow("", null),
      businessType: Joi.string().allow("", null),
      registrationNumber: Joi.string().allow("", null),
      gstNumber: Joi.string().allow("", null),
      panNumber: Joi.string().allow("", null),
      aadhaarNumber: Joi.string().allow("", null),
      businessWebsite: Joi.string().uri().allow("", null),
      primaryContactName: Joi.string().allow("", null),
      onboardingStatus: Joi.string().valid(...sellerOnboardingStatuses).allow("", null),
    }),
  })
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

const deactivateUserSchema = Joi.object({
  body: Joi.object({
    reason: Joi.string().allow("", null),
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

const updateVendorStatusSchema = Joi.object({
  body: Joi.object({
    accountStatus: Joi.string().valid(...accountStatuses),
    status: Joi.string().valid(...accountStatuses),
  })
    .or("accountStatus", "status")
    .custom((value, joiTools) => {
      if (
        value.accountStatus &&
        value.status &&
        value.accountStatus !== value.status
      ) {
        return joiTools.error("any.invalid");
      }

      return { accountStatus: value.accountStatus || value.status };
    })
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    sellerId: Joi.string().required(),
  }).required(),
});

const sellerParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    sellerId: Joi.string().required(),
  }).required(),
});

const updateSellerKycStatusSchema = Joi.object({
  body: Joi.object({
    kycStatus: Joi.string().valid(...sellerKycStatuses).required(),
    rejectionReason: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ sellerId: Joi.string().required() }).required(),
});

const updateSellerBankStatusSchema = Joi.object({
  body: Joi.object({
    bankVerificationStatus: Joi.string().valid(...sellerBankStatuses).required(),
    bankRejectionReason: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ sellerId: Joi.string().required() }).required(),
});

const updateSellerOnboardingStatusSchema = Joi.object({
  body: Joi.object({
    onboardingStatus: Joi.string().required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ sellerId: Joi.string().required() }).required(),
});

const updateSellerGoLiveSchema = Joi.object({
  body: Joi.object({
    goLiveStatus: Joi.string().valid(...sellerGoLiveStatuses).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ sellerId: Joi.string().required() }).required(),
});

const moderationQueueSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid(
      PRODUCT_STATUS.PENDING_APPROVAL,
      PRODUCT_STATUS.DRAFT,
      PRODUCT_STATUS.REJECTED,
      PRODUCT_STATUS.CHANGE_PENDING,
      PRODUCT_STATUS.ACTIVE,
      PRODUCT_STATUS.INACTIVE,
    ),
    category: Joi.string(),
    q: Joi.string().allow(""),
    keyWord: Joi.string().allow(""),
    search: Joi.string().allow(""),
    sellerId: Joi.string().allow("", null),
    productType: Joi.string().valid(...Object.values(PRODUCT_TYPE)),
    dateFrom: Joi.date().allow("", null),
    dateTo: Joi.date().allow("", null),
    createdFrom: Joi.date().allow("", null),
    createdTo: Joi.date().allow("", null),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid(
      "price_asc",
      "price_desc",
      "newest",
      "oldest",
      "title",
      "sku",
      "stock",
      "createdAt",
      "updatedAt",
    ),
    sortDir: Joi.string().valid("asc", "desc"),
  }).required(),
  params: Joi.object({}).required(),
});

const moderateProductSchema = Joi.object({
  body: Joi.object({
    status: Joi.string()
      .valid(
        PRODUCT_STATUS.ACTIVE,
        PRODUCT_STATUS.INACTIVE,
        PRODUCT_STATUS.REJECTED,
      )
      .required(),
    rejectionReason: Joi.string().allow("", null),
    checklist: Joi.object({
      titleVerified: Joi.boolean(),
      categoryVerified: Joi.boolean(),
      complianceVerified: Joi.boolean(),
      mediaVerified: Joi.boolean(),
    }).default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
  }).required(),
});

const listOrdersSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid(...Object.values(ORDER_STATUS)),
    paymentStatus: Joi.string().valid(...Object.values(PAYMENT_STATUS)),
    deliveryStatus: Joi.string().max(64),
    sellerId: Joi.string(),
    buyerId: Joi.string(),
    search: Joi.string().trim().max(128),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const listPaymentsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid(...Object.values(PAYMENT_STATUS)),
    provider: Joi.string(),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const createPayoutSchema = Joi.object({
  body: Joi.object({
    sellerId: Joi.string().required(),
    periodStart: Joi.date().iso().required(),
    periodEnd: Joi.date().iso().required(),
    grossAmount: Joi.number().positive().required(),
    commissionAmount: Joi.number().min(0),
    processingFeeAmount: Joi.number().min(0),
    taxWithheldAmount: Joi.number().min(0),
    netPayoutAmount: Joi.number().min(0),
    currency: Joi.string().default("INR"),
    status: Joi.string().valid("scheduled", "processing", "paid", "failed"),
    scheduledAt: Joi.date().iso(),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listPayoutsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    sellerId: Joi.string(),
    status: Joi.string().valid("scheduled", "processing", "paid", "failed"),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const taxReportSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    taxComponent: Joi.string().valid("cgst", "sgst", "igst", "tcs"),
    limit: Joi.number().integer().min(1).max(1000),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const createInvoiceSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
  }).required(),
});

const createApiKeySchema = Joi.object({
  body: Joi.object({
    ownerId: Joi.string(),
    keyName: Joi.string().min(3).max(120).required(),
    scopes: Joi.array().items(Joi.string()).default([]),
    expiresAt: Joi.date().iso().allow(null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listApiKeysSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ownerId: Joi.string(),
    status: Joi.string().valid("active", "revoked", "expired"),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const createWebhookSubscriptionSchema = Joi.object({
  body: Joi.object({
    ownerId: Joi.string(),
    endpointUrl: Joi.string().uri().required(),
    secret: Joi.string().min(8).required(),
    eventTypes: Joi.array().items(Joi.string()).min(1).required(),
    retryPolicy: Joi.object({
      maxRetries: Joi.number().integer().min(0).max(25),
      backoffMs: Joi.number().integer().min(0),
    }).default({ maxRetries: 5 }),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listWebhookSubscriptionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ownerId: Joi.string(),
    status: Joi.string().valid("active", "paused", "disabled"),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const upsertFeatureFlagSchema = Joi.object({
  body: Joi.object({
    flagKey: Joi.string().min(3).max(120).required(),
    description: Joi.string().allow("", null),
    enabled: Joi.boolean().required(),
    rolloutPercentage: Joi.number().integer().min(0).max(100).required(),
    targetRules: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listFeatureFlagsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    enabled: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const realtimeAnalyticsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    hours: Joi.number().integer().min(1).max(168).default(24),
  }).required(),
  params: Joi.object({}).required(),
});

const returnsAnalyticsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
  }).required(),
  params: Joi.object({}).required(),
});

const listChargebacksSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid(
      "pending",
      "accepted",
      "rejected",
      "won",
      "lost",
    ),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const listDeadLetterSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid("failed", "retry_scheduled", "discarded"),
    eventType: Joi.string(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const deadLetterActionSchema = Joi.object({
  body: Joi.object({
    reason: Joi.string().allow("", null),
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    eventId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const queueStatusSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const queueActionSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    queueName: Joi.string().valid("notifications").required(),
  }).required(),
});

const createSubscriptionPlanSchema = Joi.object({
  body: Joi.object({
    planCode: Joi.string().trim().uppercase().min(3).max(64).required(),
    title: Joi.string().min(3).max(180).required(),
    description: Joi.string().allow("", null),
    targetRoles: Joi.array()
      .items(Joi.string().valid("buyer", "seller", "admin"))
      .default([]),
    featureFlags: Joi.array().items(Joi.string()).default([]),
    monthlyPrice: Joi.number().min(0).required(),
    yearlyPrice: Joi.number().min(0).required(),
    currency: Joi.string().default("INR"),
    active: Joi.boolean().default(true),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listSubscriptionPlanSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    active: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const subscriptionPlanParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    planId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const updateSubscriptionPlanSchema = Joi.object({
  body: Joi.object({
    title: Joi.string().min(3).max(180),
    description: Joi.string().allow("", null),
    targetRoles: Joi.array().items(
      Joi.string().valid("buyer", "seller", "admin"),
    ),
    featureFlags: Joi.array().items(Joi.string()),
    monthlyPrice: Joi.number().min(0),
    yearlyPrice: Joi.number().min(0),
    currency: Joi.string(),
    active: Joi.boolean(),
    metadata: Joi.object(),
  })
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    planId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const listPlatformSubscriptionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid("active", "paused", "cancelled", "expired"),
    userRole: Joi.string().valid("buyer", "seller", "admin"),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const updatePlatformSubscriptionStatusSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid("active", "paused", "cancelled").required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    subscriptionId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const createPlatformFeeConfigSchema = Joi.object({
  body: Joi.object({
    category: Joi.string().trim().required(),
    commissionPercent: Joi.number().min(0).max(100).required(),
    fixedFeeAmount: Joi.number().min(0).default(0),
    closingFeeAmount: Joi.number().min(0).default(0),
    active: Joi.boolean().default(true),
    effectiveFrom: Joi.date().iso().allow(null),
    effectiveTo: Joi.date().iso().allow(null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listPlatformFeeConfigSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    active: Joi.boolean(),
    category: Joi.string(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const platformFeeConfigParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    configId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const updatePlatformFeeConfigSchema = Joi.object({
  body: Joi.object({
    category: Joi.string().trim(),
    commissionPercent: Joi.number().min(0).max(100),
    fixedFeeAmount: Joi.number().min(0),
    closingFeeAmount: Joi.number().min(0),
    active: Joi.boolean(),
    effectiveFrom: Joi.date().iso().allow(null),
    effectiveTo: Joi.date().iso().allow(null),
  })
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    configId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const listAccessModulesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    role: Joi.string()
      .valid(
        "admin",
        "sub-admin",
        "seller",
        "seller-admin",
        "seller-sub-admin",
        "buyer",
        "super-admin",
      )
      .default("sub-admin"),
    roleId: Joi.string().guid({ version: "uuidv4" }),
    roleSlug: Joi.string().trim().min(2).max(128),
    userId: Joi.string().trim(),
    active: Joi.boolean().default(true),
    includePermissions: Joi.boolean().default(true),
  })
    .oxor("roleId", "roleSlug")
    .required(),
  params: Joi.object({}).required(),
});

const createAdminSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    phone: Joi.string().allow("", null),
    password: Joi.string().min(8).required(),
    profile: Joi.object({
      firstName: Joi.string().required(),
      lastName: Joi.string().allow("", null),
    }).required(),
    allowedModules: Joi.array().items(Joi.string()).default([]),
    modulePermissions: Joi.array().items(
      Joi.object({
        module: Joi.string().required(),
        actions: Joi.array()
          .items(Joi.string().valid(...permissionActions))
          .min(1)
          .required(),
      }),
    ).default([]),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listAdminsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().allow(""),
    search: Joi.string().allow(""),
    status: Joi.string().valid(...accountStatuses),
    accountStatus: Joi.string().valid(...accountStatuses),
    role: Joi.string().valid("admin", "seller"),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }).required(),
  params: Joi.object({}).required(),
});

const createPlatformSubAdminSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    phone: Joi.string().allow("", null),
    password: Joi.string().min(8).required(),
    role: Joi.string()
      .valid("sub-admin", "seller", "seller-admin", "seller-sub-admin")
      .default("sub-admin"),
    parentSellerId: Joi.string().allow("", null),
    profile: Joi.object({
      firstName: Joi.string().required(),
      lastName: Joi.string().allow("", null),
    }).required(),
    allowedModules: Joi.array().items(Joi.string()).min(1).required(),
    modulePermissions: Joi.array().items(
      Joi.object({
        module: Joi.string().required(),
        actions: Joi.array()
          .items(Joi.string().valid(...permissionActions))
          .min(1)
          .required(),
      }),
    ),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listPlatformSubAdminsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ownerAdminId: Joi.string(),
    ownerSellerId: Joi.string(),
    q: Joi.string().allow(""),
    search: Joi.string().allow(""),
    status: Joi.string().valid(...accountStatuses),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }).required(),
  params: Joi.object({}).required(),
});

const updatePlatformSubAdminModulesSchema = Joi.object({
  body: Joi.object({
    allowedModules: Joi.array().items(Joi.string()).min(1).required(),
    modulePermissions: Joi.array().items(
      Joi.object({
        module: Joi.string().required(),
        actions: Joi.array()
          .items(Joi.string().valid(...permissionActions))
          .min(1)
          .required(),
      }),
    ),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

module.exports = {
  adminOverviewSchema,
  listActivityLogsSchema,
  listVendorsSchema,
  listUsersSchema,
  createManagedUserSchema,
  userParamSchema,
  updateUserSchema,
  deactivateUserSchema,
  updateVendorStatusSchema,
  sellerParamSchema,
  updateSellerKycStatusSchema,
  updateSellerBankStatusSchema,
  updateSellerOnboardingStatusSchema,
  updateSellerGoLiveSchema,
  moderationQueueSchema,
  moderateProductSchema,
  listOrdersSchema,
  listPaymentsSchema,
  createPayoutSchema,
  listPayoutsSchema,
  taxReportSchema,
  createInvoiceSchema,
  createApiKeySchema,
  listApiKeysSchema,
  createWebhookSubscriptionSchema,
  listWebhookSubscriptionsSchema,
  upsertFeatureFlagSchema,
  listFeatureFlagsSchema,
  realtimeAnalyticsSchema,
  returnsAnalyticsSchema,
  listChargebacksSchema,
  listDeadLetterSchema,
  deadLetterActionSchema,
  queueStatusSchema,
  queueActionSchema,
  createSubscriptionPlanSchema,
  listSubscriptionPlanSchema,
  subscriptionPlanParamSchema,
  updateSubscriptionPlanSchema,
  listPlatformSubscriptionsSchema,
  updatePlatformSubscriptionStatusSchema,
  createPlatformFeeConfigSchema,
  listPlatformFeeConfigSchema,
  platformFeeConfigParamSchema,
  updatePlatformFeeConfigSchema,
  listAccessModulesSchema,
  createAdminSchema,
  listAdminsSchema,
  createPlatformSubAdminSchema,
  listPlatformSubAdminsSchema,
  updatePlatformSubAdminModulesSchema,
};
