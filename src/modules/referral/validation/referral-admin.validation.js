const Joi = require("joi");

const pagingQuery = {
  q: Joi.string().allow(""),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
};

const influencerStatuses = ["pending", "active", "suspended", "rejected"];
const influencerTypes = ["parent", "child"];
const codeStatuses = ["active", "inactive", "expired", "suspended"];
const referralOrderStatuses = [
  "pending",
  "completed",
  "cancelled",
  "refunded",
  "reversed",
];
const ledgerStatuses = [
  "pending",
  "locked",
  "available",
  "payout_requested",
  "paid",
  "reversed",
  "expired",
];
const commissionTypes = [
  "code_owner_base",
  "code_owner_bonus",
  "direct_parent",
  "lifetime_override",
  "performance_bonus",
  "reversal",
  "withdrawal",
  "coin_expiry",
  "manual_adjustment",
];
const payoutStatuses = [
  "pending",
  "approved",
  "rejected",
  "processing",
  "paid",
  "failed",
  "cancelled",
];
const bonusPeriods = ["monthly", "quarterly", "yearly", "custom"];
const bonusTargetTypes = ["order_value", "order_count", "customer_count", "active_children"];
const bonusTypes = ["fixed_coins", "percentage_extra_coins"];
const bonusApplyTo = ["code_owner", "parent", "child", "all_eligible_influencers"];
const bonusResetCycles = ["monthly", "quarterly", "yearly"];
const bonusReleaseRules = [
  "instantly_available",
  "locked_until_all_related_orders_fulfilled",
  "locked_until_period_ends",
];
const bonusStatuses = ["active", "inactive"];
const bonusAchievementStatuses = ["locked", "released", "reversed"];
const distributionTypes = ["fixed_amount", "percentage"];
const coinUsageModes = ["wallet", "discount", "both"];
const withdrawalApprovalModes = ["manual", "auto"];
const withdrawalMethods = ["upi", "bank", "manual"];

const newInfluencerBody = {
  userId: Joi.string(),
  email: Joi.string().email(),
  phone: Joi.string().allow("", null),
  password: Joi.string().min(8),
  firstName: Joi.string().allow("", null),
  lastName: Joi.string().allow("", null),
  profile: Joi.object({
    firstName: Joi.string().allow("", null),
    lastName: Joi.string().allow("", null),
  }),
  status: Joi.string().valid(...influencerStatuses),
  canCreateChildren: Joi.boolean(),
  onboardingStatus: Joi.string().allow("", null),
  kycStatus: Joi.string().allow("", null),
  payoutProfileStatus: Joi.string().allow("", null),
  yearlySalesAmount: Joi.number().min(0),
  code: Joi.string().trim().uppercase(),
  startsAt: Joi.date().iso().allow(null),
  expiresAt: Joi.date().iso().allow(null),
  usageLimit: Joi.number().integer().min(1).allow(null),
  metadata: Joi.object().default({}),
};

const createParentInfluencerSchema = Joi.object({
  body: Joi.object(newInfluencerBody)
    .or("userId", "email")
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const createChildInfluencerSchema = Joi.object({
  body: Joi.object(newInfluencerBody)
    .or("userId", "email")
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    parentId: Joi.string().required(),
  }).required(),
});

const listInfluencersSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ...pagingQuery,
    status: Joi.string().valid(...influencerStatuses),
    influencerType: Joi.string().valid(...influencerTypes),
    parentInfluencerId: Joi.string(),
    canCreateChildren: Joi.boolean(),
  }).required(),
  params: Joi.object({}).required(),
});

const listProductAmountsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({ ...pagingQuery, productId: Joi.string(), active: Joi.boolean() }).required(),
  params: Joi.object({}).required(),
});

const upsertProductAmountSchema = Joi.object({
  body: Joi.object({
    productId: Joi.string().required(),
    productTitle: Joi.string().trim().max(300).allow(""),
    amountType: Joi.string().valid("fixed_amount", "percentage").required(),
    amountValue: Joi.number().min(0).required(),
    maximumAmount: Joi.number().min(0),
    active: Joi.boolean(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const productAmountIdSchema = Joi.object({
  body: Joi.object({}).required(), query: Joi.object({}).required(),
  params: Joi.object({ configId: Joi.string().required() }).required(),
});

const updateInfluencerStatusSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid(...influencerStatuses).required(),
    reason: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    influencerId: Joi.string().required(),
  }).required(),
});

const promoteInfluencerSchema = Joi.object({
  body: Joi.object({
    canCreateChildren: Joi.boolean().default(true),
    promotedAt: Joi.date().iso(),
    note: Joi.string().allow("", null),
    code: Joi.string().trim().uppercase(),
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    influencerId: Joi.string().required(),
  }).required(),
});

const listCodesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ...pagingQuery,
    influencerId: Joi.string(),
    status: Joi.string().valid(...codeStatuses),
  }).required(),
  params: Joi.object({}).required(),
});

const createCodeSchema = Joi.object({
  body: Joi.object({
    influencerId: Joi.string().required(),
    code: Joi.string().trim().uppercase(),
    status: Joi.string().valid(...codeStatuses),
    startsAt: Joi.date().iso().allow(null),
    expiresAt: Joi.date().iso().allow(null),
    usageLimit: Joi.number().integer().min(1).allow(null),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateCodeSchema = Joi.object({
  body: Joi.object({
    code: Joi.string().trim().uppercase(),
    status: Joi.string().valid(...codeStatuses),
    startsAt: Joi.date().iso().allow(null),
    expiresAt: Joi.date().iso().allow(null),
    usageLimit: Joi.number().integer().min(1).allow(null),
    metadata: Joi.object(),
  })
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    codeId: Joi.string().required(),
  }).required(),
});

const listOrdersSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ...pagingQuery,
    status: Joi.string().valid(...referralOrderStatuses),
    code: Joi.string().trim().uppercase(),
    influencerId: Joi.string(),
    customerId: Joi.string(),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
  }).required(),
  params: Joi.object({}).required(),
});

const listCommissionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ...pagingQuery,
    status: Joi.string().valid(...ledgerStatuses),
    commissionType: Joi.string().valid(...commissionTypes),
    influencerId: Joi.string(),
    orderId: Joi.string(),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
  }).required(),
  params: Joi.object({}).required(),
});

const listPayoutsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ...pagingQuery,
    status: Joi.string().valid(...payoutStatuses),
    influencerId: Joi.string(),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
  }).required(),
  params: Joi.object({}).required(),
});

const payoutActionSchema = Joi.object({
  body: Joi.object({
    adminNote: Joi.string().allow("", null),
    reason: Joi.string().allow("", null),
    paidAt: Joi.date().iso(),
    transactionReference: Joi.string().trim().max(180).allow("", null),
    paymentProofUrl: Joi.string().trim().uri().allow("", null),
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    payoutId: Joi.string().required(),
  }).required(),
});

const listRulesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    active: Joi.boolean(),
  }).required(),
  params: Joi.object({}).required(),
});

const upsertRulesSchema = Joi.object({
  body: Joi.object({
    distributionType: Joi.string().valid(...distributionTypes),
    referralPoolAmount: Joi.number().min(0),
    referralPoolPercent: Joi.number().min(0).max(100),
    maximumReferralPoolAmount: Joi.number().min(0),
    coinValue: Joi.number().greater(0),
    coinExpiryDays: Joi.number().integer().min(0),
    coinUsage: Joi.string().valid(...coinUsageModes),
    customerSharePercent: Joi.number().min(0).max(100),
    childSharePercent: Joi.number().min(0).max(100),
    parentSharePercent: Joi.number().min(0).max(100),
    releaseDelayDays: Joi.number().integer().min(0),
    minimumWithdrawalCoins: Joi.number().min(0),
    maximumWithdrawalCoins: Joi.number().min(0),
    dailyWithdrawalLimitCoins: Joi.number().min(0),
    monthlyWithdrawalLimitCoins: Joi.number().min(0),
    withdrawalKycRequired: Joi.boolean(),
    withdrawalApprovalMode: Joi.string().valid(...withdrawalApprovalModes),
    withdrawalMethods: Joi.array().items(Joi.string().valid(...withdrawalMethods)).min(1),
    referralCodePrefix: Joi.string().trim().uppercase().pattern(/^[A-Z0-9]*$/).max(8).allow(""),
    referralCodeRandomLength: Joi.number().integer().min(4).max(16),
    referralCodeCharacterSet: Joi.string().valid("alphanumeric", "numeric", "alphabetic"),
    minOrderAmount: Joi.number().min(0),
    active: Joi.boolean(),
    effectiveFrom: Joi.date().iso().allow(null),
    effectiveTo: Joi.date().iso().allow(null),
    metadata: Joi.object(),
  })
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const bonusRuleBody = {
  ruleName: Joi.string().trim().min(2).max(160),
  period: Joi.string().valid(...bonusPeriods),
  customStartAt: Joi.date().iso().allow(null),
  customEndAt: Joi.date().iso().allow(null),
  targetType: Joi.string().valid(...bonusTargetTypes),
  targetValue: Joi.number().min(0),
  bonusType: Joi.string().valid(...bonusTypes),
  bonusValue: Joi.number().min(0),
  applyTo: Joi.string().valid(...bonusApplyTo),
  resetCycle: Joi.string().valid(...bonusResetCycles),
  releaseRule: Joi.string().valid(...bonusReleaseRules),
  status: Joi.string().valid(...bonusStatuses),
  metadata: Joi.object(),
};

const listBonusRulesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ...pagingQuery,
    status: Joi.string().valid(...bonusStatuses),
    period: Joi.string().valid(...bonusPeriods),
    targetType: Joi.string().valid(...bonusTargetTypes),
    applyTo: Joi.string().valid(...bonusApplyTo),
  }).required(),
  params: Joi.object({}).required(),
});

const createBonusRuleSchema = Joi.object({
  body: Joi.object({
    ...bonusRuleBody,
    ruleName: bonusRuleBody.ruleName.required(),
    targetValue: bonusRuleBody.targetValue.required(),
    bonusValue: bonusRuleBody.bonusValue.required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateBonusRuleSchema = Joi.object({
  body: Joi.object(bonusRuleBody).min(1).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    ruleId: Joi.string().required(),
  }).required(),
});

const listBonusAchievementsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    ...pagingQuery,
    ruleId: Joi.string(),
    influencerId: Joi.string(),
    status: Joi.string().valid(...bonusAchievementStatuses),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
  }).required(),
  params: Joi.object({}).required(),
});

const bonusProgressSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(500),
    ruleId: Joi.string(),
    influencerId: Joi.string(),
    referenceDate: Joi.date().iso(),
  }).required(),
  params: Joi.object({}).required(),
});

const evaluateBonusRulesSchema = Joi.object({
  body: Joi.object({
    ruleId: Joi.string(),
    influencerId: Joi.string(),
    referenceDate: Joi.date().iso(),
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const emptySchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listFraudReviewsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(500),
    status: Joi.string().valid("open", "reviewing", "resolved", "dismissed"),
    severity: Joi.string().valid("low", "medium", "high"),
    influencerId: Joi.string(),
  }).required(),
  params: Joi.object({}).required(),
});

module.exports = {
  listInfluencersSchema,
  listProductAmountsSchema,
  upsertProductAmountSchema,
  productAmountIdSchema,
  createParentInfluencerSchema,
  createChildInfluencerSchema,
  updateInfluencerStatusSchema,
  promoteInfluencerSchema,
  listCodesSchema,
  createCodeSchema,
  updateCodeSchema,
  listOrdersSchema,
  listCommissionsSchema,
  listPayoutsSchema,
  payoutActionSchema,
  listRulesSchema,
  upsertRulesSchema,
  listBonusRulesSchema,
  createBonusRuleSchema,
  updateBonusRuleSchema,
  listBonusAchievementsSchema,
  bonusProgressSchema,
  evaluateBonusRulesSchema,
  emptySchema,
  listFraudReviewsSchema,
};
