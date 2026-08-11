const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const referralSchema = new mongoose.Schema(
  {
    referrerUserId: { type: String, required: true, index: true },
    refereeUserId: { type: String, required: true, unique: true, index: true },
    referralCode: { type: String, required: true, index: true },
    referrerRewardAmount: { type: Number, required: true },
    refereeRewardAmount: { type: Number, required: true },
    status: { type: String, default: "rewarded", index: true },
  },
  { timestamps: true },
);

const ReferralModel = mongoose.model("Referral", referralSchema);

const influencerRefreshSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    provider: { type: String, default: "password" },
    ipAddress: String,
    userAgent: String,
    platform: String,
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const influencerAccountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    phone: { type: String, default: null, index: true },
    passwordHash: { type: String },
    profile: {
      firstName: String,
      lastName: String,
      avatarUrl: String,
    },
    accountStatus: { type: String, default: "active", index: true },
    emailVerified: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    sessionVersion: { type: Number, default: 0 },
    permissionVersion: { type: Number, default: 0 },
    passwordChangedAt: Date,
    refreshSessions: [influencerRefreshSessionSchema],
    lastLoginAt: Date,
    createdBy: { type: String, default: null, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const InfluencerAccountModel = mongoose.model("InfluencerAccount", influencerAccountSchema);

const influencerProfileSchema = new mongoose.Schema(
  {
    // Omit unused identity fields entirely. A sparse unique index still indexes
    // an explicit null, which would allow only one standalone/legacy profile.
    accountId: { type: String, default: undefined, unique: true, sparse: true, index: true },
    userId: { type: String, default: undefined, unique: true, sparse: true, index: true },
    influencerType: {
      type: String,
      enum: ["parent", "child"],
      default: "child",
      index: true,
    },
    parentInfluencerId: { type: String, default: null, index: true },
    rootInfluencerId: { type: String, default: null, index: true },
    originalParentInfluencerId: { type: String, default: null, index: true },
    level: { type: Number, default: 1, min: 1 },
    path: [{ type: String }],
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "rejected"],
      default: "active",
      index: true,
    },
    canCreateChildren: { type: Boolean, default: false, index: true },
    promotedAt: { type: Date, default: null },
    onboardingStatus: { type: String, default: "approved", index: true },
    kycStatus: { type: String, default: "pending", index: true },
    payoutProfileStatus: { type: String, default: "pending", index: true },
    yearlySalesAmount: { type: Number, default: 0, min: 0 },
    createdBy: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

influencerProfileSchema.index({ parentInfluencerId: 1, status: 1 });
influencerProfileSchema.index({ rootInfluencerId: 1, level: 1 });

const influencerCodeSchema = new mongoose.Schema(
  {
    influencerId: { type: String, required: true, index: true },
    accountId: { type: String, default: null, index: true },
    userId: { type: String, default: null, index: true },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "expired", "suspended"],
      default: "active",
      index: true,
    },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    usageLimit: { type: Number, default: null, min: 1 },
    usageCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

influencerCodeSchema.index({ influencerId: 1, status: 1 });

const referralOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    customerId: { type: String, required: true, index: true },
    influencerCodeId: { type: String, required: true, index: true },
    referralCodeId: { type: String, default: null, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, index: true },
    codeOwnerInfluencerId: { type: String, required: true, index: true },
    directParentInfluencerId: { type: String, default: null, index: true },
    overrideInfluencerId: { type: String, default: null, index: true },
    eligibleAmount: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["pending", "completed", "cancelled", "refunded", "reversed"],
      default: "pending",
      index: true,
    },
    orderStatus: { type: String, default: null, index: true },
    paymentStatus: { type: String, default: null, index: true },
    completedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

referralOrderSchema.index({ codeOwnerInfluencerId: 1, createdAt: -1 });

const referralCommissionLedgerSchema = new mongoose.Schema(
  {
    referralOrderId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    influencerId: { type: String, required: true, index: true },
    commissionType: {
      type: String,
      enum: [
        "code_owner_base",
        "code_owner_bonus",
        "direct_parent",
        "lifetime_override",
        "performance_bonus",
        "reversal",
        "withdrawal",
        "coin_expiry",
        "manual_adjustment",
      ],
      required: true,
      index: true,
    },
    basisAmount: { type: Number, default: 0, min: 0 },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: [
        "pending",
        "locked",
        "available",
        "payout_requested",
        "paid",
        "reversed",
        "expired",
      ],
      default: "pending",
      index: true,
    },
    releaseAt: { type: Date, default: null, index: true },
    paidAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

referralCommissionLedgerSchema.index({ influencerId: 1, status: 1 });

const influencerWalletSchema = new mongoose.Schema(
  {
    influencerId: { type: String, required: true, unique: true, index: true },
    pendingBalance: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    reservedBalance: { type: Number, default: 0 },
    paidBalance: { type: Number, default: 0 },
    reversedBalance: { type: Number, default: 0 },
    expiredBalance: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const influencerPayoutRequestSchema = new mongoose.Schema(
  {
    influencerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "processing", "paid", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    payoutMethod: {
      type: String,
      enum: ["bank", "upi", "manual"],
      default: "manual",
    },
    bankAccountId: { type: String, default: null },
    upiId: { type: String, default: null },
    adminNote: { type: String, default: null },
    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    paidAt: { type: Date, default: null },
    paidBy: { type: String, default: null },
    reservationStatus: {
      type: String,
      enum: ["reserved", "released", "settled"],
      default: "reserved",
      index: true,
    },
    paidAmount: { type: Number, default: null, min: 0 },
    transactionReference: { type: String, default: null, trim: true },
    paymentProofUrl: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

influencerPayoutRequestSchema.index({ influencerId: 1, status: 1 });

const referralCommissionRuleSchema = new mongoose.Schema(
  {
    distributionType: {
      type: String,
      enum: ["fixed_amount", "percentage"],
      default: "percentage",
      index: true,
    },
    referralPoolAmount: { type: Number, default: 0, min: 0 },
    referralPoolPercent: { type: Number, default: 10, min: 0, max: 100 },
    maximumReferralPoolAmount: { type: Number, default: 0, min: 0 },
    coinValue: { type: Number, default: 1, min: 0.000001 },
    coinExpiryDays: { type: Number, default: 365, min: 0 },
    coinUsage: {
      type: String,
      enum: ["wallet", "discount", "both"],
      default: "wallet",
    },
    customerSharePercent: { type: Number, default: 50, min: 0, max: 100 },
    childSharePercent: { type: Number, default: 30, min: 0, max: 100 },
    parentSharePercent: { type: Number, default: 20, min: 0, max: 100 },
    releaseDelayDays: { type: Number, default: 7, min: 0 },
    minimumWithdrawalCoins: { type: Number, default: 0, min: 0 },
    maximumWithdrawalCoins: { type: Number, default: 0, min: 0 },
    dailyWithdrawalLimitCoins: { type: Number, default: 0, min: 0 },
    monthlyWithdrawalLimitCoins: { type: Number, default: 0, min: 0 },
    withdrawalKycRequired: { type: Boolean, default: true },
    withdrawalApprovalMode: {
      type: String,
      enum: ["manual", "auto"],
      default: "manual",
    },
    withdrawalMethods: {
      type: [String],
      enum: ["upi", "bank", "manual"],
      default: ["upi", "bank", "manual"],
    },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const referralProductConfigSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, index: true },
    variantId: { type: String, default: null, index: true },
    active: { type: Boolean, default: true, index: true },
    poolType: {
      type: String,
      enum: ["fixed_amount", "percentage"],
      default: "fixed_amount",
    },
    poolValue: { type: Number, required: true, min: 0 },
    maximumPoolAmount: { type: Number, default: 0, min: 0 },
    customerSharePercent: { type: Number, default: null, min: 0, max: 100 },
    codeOwnerSharePercent: { type: Number, default: null, min: 0, max: 100 },
    parentSharePercent: { type: Number, default: null, min: 0, max: 100 },
    fundedBy: {
      type: String,
      enum: ["platform", "seller", "shared"],
      default: "platform",
    },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

referralProductConfigSchema.index(
  { productId: 1, variantId: 1 },
  { unique: true },
);

const referralFraudReviewSchema = new mongoose.Schema(
  {
    influencerId: { type: String, default: null, index: true },
    referralOrderId: { type: String, default: null, index: true },
    code: { type: String, default: null, uppercase: true, trim: true },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "reviewing", "resolved", "dismissed"],
      default: "open",
      index: true,
    },
    reason: { type: String, required: true },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const influencerBonusRuleSchema = new mongoose.Schema(
  {
    ruleName: { type: String, required: true, trim: true },
    period: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", "custom"],
      default: "monthly",
      index: true,
    },
    customStartAt: { type: Date, default: null },
    customEndAt: { type: Date, default: null },
    targetType: {
      type: String,
      enum: ["order_value", "order_count", "customer_count", "active_children"],
      default: "order_value",
      index: true,
    },
    targetValue: { type: Number, required: true, min: 0 },
    bonusType: {
      type: String,
      enum: ["fixed_coins", "percentage_extra_coins"],
      default: "fixed_coins",
    },
    bonusValue: { type: Number, required: true, min: 0 },
    applyTo: {
      type: String,
      enum: ["code_owner", "parent", "child", "all_eligible_influencers"],
      default: "code_owner",
      index: true,
    },
    resetCycle: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly",
    },
    releaseRule: {
      type: String,
      enum: [
        "instantly_available",
        "locked_until_all_related_orders_fulfilled",
        "locked_until_period_ends",
      ],
      default: "instantly_available",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    createdBy: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

influencerBonusRuleSchema.index({ status: 1, period: 1, resetCycle: 1 });

const influencerBonusAchievementSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true, index: true },
    ruleName: { type: String, required: true },
    influencerId: { type: String, required: true, index: true },
    cycleKey: { type: String, required: true, index: true },
    periodStart: { type: Date, required: true, index: true },
    periodEnd: { type: Date, required: true, index: true },
    targetType: {
      type: String,
      enum: ["order_value", "order_count", "customer_count", "active_children"],
      required: true,
    },
    targetValue: { type: Number, required: true, min: 0 },
    achievedValue: { type: Number, default: 0, min: 0 },
    bonusType: {
      type: String,
      enum: ["fixed_coins", "percentage_extra_coins"],
      required: true,
    },
    bonusValue: { type: Number, required: true, min: 0 },
    bonusCoins: { type: Number, required: true, min: 0 },
    applyTo: {
      type: String,
      enum: ["code_owner", "parent", "child", "all_eligible_influencers"],
      required: true,
    },
    releaseRule: {
      type: String,
      enum: [
        "instantly_available",
        "locked_until_all_related_orders_fulfilled",
        "locked_until_period_ends",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["locked", "released", "reversed"],
      default: "locked",
      index: true,
    },
    ledgerEntryId: { type: String, default: null, index: true },
    achievedAt: { type: Date, default: Date.now },
    releasedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

influencerBonusAchievementSchema.index(
  { ruleId: 1, influencerId: 1, cycleKey: 1 },
  { unique: true },
);
influencerBonusAchievementSchema.index({ influencerId: 1, periodStart: -1 });

const InfluencerProfileModel = mongoose.model(
  "InfluencerProfile",
  influencerProfileSchema,
);
const InfluencerCodeModel = mongoose.model("InfluencerCode", influencerCodeSchema);
const ReferralCodeModel = InfluencerCodeModel;
const ReferralOrderModel = mongoose.model("ReferralOrder", referralOrderSchema);
const ReferralCommissionLedgerModel = mongoose.model(
  "ReferralCommissionLedger",
  referralCommissionLedgerSchema,
);
const InfluencerWalletModel = mongoose.model(
  "InfluencerWallet",
  influencerWalletSchema,
);
const InfluencerPayoutRequestModel = mongoose.model(
  "InfluencerPayoutRequest",
  influencerPayoutRequestSchema,
);
const ReferralCommissionRuleModel = mongoose.model(
  "ReferralCommissionRule",
  referralCommissionRuleSchema,
);
const ReferralProductConfigModel = mongoose.model(
  "ReferralProductConfig",
  referralProductConfigSchema,
);
const ReferralFraudReviewModel = mongoose.model(
  "ReferralFraudReview",
  referralFraudReviewSchema,
);
const InfluencerBonusRuleModel = mongoose.model(
  "InfluencerBonusRule",
  influencerBonusRuleSchema,
);
const InfluencerBonusAchievementModel = mongoose.model(
  "InfluencerBonusAchievement",
  influencerBonusAchievementSchema,
);

module.exports = {
  ReferralModel,
  InfluencerAccountModel,
  InfluencerProfileModel,
  InfluencerCodeModel,
  ReferralCodeModel,
  ReferralOrderModel,
  ReferralCommissionLedgerModel,
  InfluencerWalletModel,
  InfluencerPayoutRequestModel,
  ReferralCommissionRuleModel,
  ReferralProductConfigModel,
  ReferralFraudReviewModel,
  InfluencerBonusRuleModel,
  InfluencerBonusAchievementModel,
};
