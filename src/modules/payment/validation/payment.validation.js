const Joi = require("joi");
const { PAYMENT_PROVIDER } = require("../../../shared/domain/commerce-constants");

const uuid = Joi.string().guid({ version: ["uuidv4", "uuidv5"] });

const createPaymentSchema = Joi.object({
  body: Joi.object({
    orderId: uuid.required(),
    provider: Joi.string()
      .valid(...Object.values(PAYMENT_PROVIDER))
      .required(),
    amount: Joi.number().positive(),
    currency: Joi.string().default("INR"),
    referenceId: Joi.string().max(180).allow("", null),
    screenshotUrl: Joi.string().uri().allow("", null),
    idempotencyKey: Joi.string().max(180).allow("", null),
    notes: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const verifyPaymentSchema = Joi.object({
  body: Joi.object({
    provider: Joi.string()
      .valid(PAYMENT_PROVIDER.RAZORPAY)
      .required(),
    orderId: uuid.required(),
    razorpayOrderId: Joi.string().required(),
    razorpayPaymentId: Joi.string().required(),
    razorpaySignature: Joi.string().required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listPaymentsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string(),
    provider: Joi.string().valid(...Object.values(PAYMENT_PROVIDER)),
    buyerId: Joi.string().max(64),
    orderId: uuid,
    search: Joi.string().max(128),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    sortBy: Joi.string().valid(
      "createdAt",
      "created_at",
      "amount",
      "status",
      "provider",
      "buyerId",
      "buyer_id",
      "orderId",
      "order_id",
      "transactionReference",
      "transaction_reference",
    ).default("created_at"),
    sortDir: Joi.string().valid("asc", "desc").default("desc"),
    limit: Joi.number().integer().min(1).max(500).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
  params: Joi.object({}).required(),
});

const paymentOptionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    orderAmount: Joi.number().min(0).default(0),
    postalCode: Joi.string().trim().allow("", null),
    pincode: Joi.string().trim().allow("", null),
    zip: Joi.string().trim().allow("", null),
    country: Joi.string().trim().allow("", null),
    sellerIds: Joi.alternatives().try(
      Joi.array().items(Joi.string().trim()),
      Joi.string().trim().allow("", null),
    ),
    sellerOrderAmounts: Joi.alternatives().try(
      Joi.object().pattern(Joi.string(), Joi.number().min(0)),
      Joi.string().trim().allow("", null),
    ),
    productCodDisabled: Joi.boolean().default(false),
  }).required(),
  params: Joi.object({}).required(),
});

const codConfigSchema = Joi.object({
  body: Joi.object({
    enabled: Joi.boolean().required(),
    chargeAmount: Joi.number().min(0).required(),
    minOrderAmount: Joi.number().min(0).allow(null),
    maxOrderAmount: Joi.number().min(0).allow(null),
    currency: Joi.string().default("INR"),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const paymentParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    paymentId: uuid.required(),
  }).required(),
});

const manualPaymentApprovalSchema = Joi.object({
  body: Joi.object({
    referenceId: Joi.string().trim().min(3).max(180).required(),
    reason: Joi.string().max(500).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    paymentId: uuid.required(),
  }).required(),
});

const manualPaymentRejectionSchema = Joi.object({
  body: Joi.object({
    referenceId: Joi.string().max(180).allow("", null),
    reason: Joi.string().trim().min(3).max(500).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    paymentId: uuid.required(),
  }).required(),
});

module.exports = {
  createPaymentSchema,
  verifyPaymentSchema,
  listPaymentsSchema,
  paymentOptionsSchema,
  codConfigSchema,
  paymentParamSchema,
  manualPaymentApprovalSchema,
  manualPaymentRejectionSchema,
};
