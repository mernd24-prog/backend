const Joi = require("joi");

const pagingQuery = {
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
};

const dateFilterQuery = {
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso(),
};

const referralOrderStatuses = [
  "pending",
  "completed",
  "cancelled",
  "refunded",
  "reversed",
];
const coinOrderStatuses = ["locked", "available", "reversed"];
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
const transactionTypes = [
  "credit_coins",
  "debit_coins",
  "locked_coins",
  "released_coins",
  "reversed_coins",
  "withdrawal_coins",
  "expired_coins",
];
const withdrawalStatuses = [
  "pending",
  "approved",
  "rejected",
  "processing",
  "paid",
  "failed",
];

const emptyBody = Joi.object({}).required();
const emptyParams = Joi.object({}).required();

const dashboardQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...dateFilterQuery,
    code: Joi.string().trim().uppercase(),
  }).required(),
  params: emptyParams,
});

const codesQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...pagingQuery,
    ...dateFilterQuery,
    code: Joi.string().trim().uppercase(),
    status: Joi.string().valid("active", "inactive", "expired", "suspended"),
  }).required(),
  params: emptyParams,
});

const ordersQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...pagingQuery,
    ...dateFilterQuery,
    status: Joi.string().valid(...referralOrderStatuses, ...coinOrderStatuses),
    coinStatus: Joi.string().valid(...coinOrderStatuses),
    code: Joi.string().trim().uppercase(),
  }).required(),
  params: emptyParams,
});

const ledgerQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...pagingQuery,
    ...dateFilterQuery,
    status: Joi.string().valid(...ledgerStatuses, ...withdrawalStatuses),
    commissionType: Joi.string().valid(...commissionTypes),
    transactionType: Joi.string().valid(...transactionTypes),
    code: Joi.string().trim().uppercase(),
    orderId: Joi.string(),
  }).required(),
  params: emptyParams,
});

const withdrawalsQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...pagingQuery,
    ...dateFilterQuery,
    status: Joi.string().valid(...withdrawalStatuses),
  }).required(),
  params: emptyParams,
});

const createWithdrawalSchema = Joi.object({
  body: Joi.object({
    amount: Joi.number().positive().required(),
    payoutMethod: Joi.string().valid("bank", "upi", "manual").default("manual"),
    bankAccountId: Joi.string().allow("", null),
    upiId: Joi.string().allow("", null),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: emptyParams,
});

const networkQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...pagingQuery,
    ...dateFilterQuery,
    code: Joi.string().trim().uppercase(),
    status: Joi.string().valid("pending", "active", "suspended", "rejected"),
  }).required(),
  params: emptyParams,
});

const bonusProgressQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...pagingQuery,
    ruleId: Joi.string(),
    referenceDate: Joi.date().iso(),
  }).required(),
  params: emptyParams,
});

const emptySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({}).required(),
  params: emptyParams,
});

module.exports = {
  dashboardQuerySchema,
  codesQuerySchema,
  ordersQuerySchema,
  ledgerQuerySchema,
  withdrawalsQuerySchema,
  createWithdrawalSchema,
  networkQuerySchema,
  bonusProgressQuerySchema,
  emptySchema,
};
