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
  "cancelled",
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
    scope: Joi.string().valid("all", "own", "children"),
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
    amount: Joi.number().positive().custom((value, helpers) => {
      const scaled = value * 100;
      return Math.abs(scaled - Math.round(scaled)) < 1e-8
        ? value
        : helpers.error("number.precision");
    }).required().messages({
      "number.base": "Withdrawal amount must be a number",
      "number.positive": "Withdrawal amount must be greater than zero",
      "number.precision": "Withdrawal amount can have at most 2 decimal places",
      "any.required": "Withdrawal amount is required",
    }),
    payoutMethod: Joi.string().valid("bank", "upi", "upi_qr", "manual").default("manual"),
    destinationSource: Joi.string().valid("saved_profile", "one_time", "legacy").default("legacy"),
    bankAccountId: Joi.string().allow("", null),
    upiId: Joi.string().trim().max(120).allow("", null),
    payoutQrUrl: Joi.string().trim().uri().allow("", null),
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

const createNetworkChildSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().trim().lowercase().email().required(),
    phone: Joi.string().trim().pattern(/^\+?[0-9]{7,15}$/).allow("", null),
    firstName: Joi.string().trim().min(2).max(80).required(),
    lastName: Joi.string().trim().max(80).allow("", null),
    code: Joi.string().trim().uppercase().min(3).max(30),
  }).required(),
  query: Joi.object({}).required(),
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

const analyticsQuerySchema = Joi.object({
  body: emptyBody,
  query: Joi.object({
    ...dateFilterQuery,
    code: Joi.string().trim().uppercase(),
  }).required(),
  params: emptyParams,
});

const updateProfileSchema = Joi.object({
  body: Joi.object({
    firstName: Joi.string().trim().min(2).max(80),
    lastName: Joi.string().trim().allow("").max(80),
    phone: Joi.string().trim().pattern(/^\+?[0-9]{7,15}$/),
    avatarUrl: Joi.string().trim().uri().allow("", null),
    dateOfBirth: Joi.date().iso().max("now").allow(null),
    gender: Joi.string().valid("male", "female", "other", "prefer_not_to_say").allow(null),
    address: Joi.object({
      line1: Joi.string().trim().max(200).allow(""),
      line2: Joi.string().trim().max(200).allow(""),
      country: Joi.string().trim().max(80).allow(""),
      state: Joi.string().trim().max(80).allow(""),
      city: Joi.string().trim().max(80).allow(""),
      postalCode: Joi.string().trim().max(20).allow(""),
    }),
    documents: Joi.object({
      panCardUrl: Joi.string().trim().uri().allow("", null),
      aadhaarCardUrl: Joi.string().trim().uri().allow("", null),
      cancelledChequeUrl: Joi.string().trim().uri().allow("", null),
    }),
    payout: Joi.object({
      method: Joi.string().valid("bank", "upi").allow(null),
      accountHolderName: Joi.string().trim().max(120).allow(""),
      bankName: Joi.string().trim().max(120).allow(""),
      accountNumber: Joi.string().trim().max(34).allow(""),
      ifscCode: Joi.string().trim().uppercase().max(20).allow(""),
      upiId: Joi.string().trim().max(120).allow(""),
    }),
  }).min(1).required(),
  query: Joi.object({}).required(),
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
  createNetworkChildSchema,
  bonusProgressQuerySchema,
  analyticsQuerySchema,
  updateProfileSchema,
  emptySchema,
};
