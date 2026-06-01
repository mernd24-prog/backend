const Joi = require("joi");
const { PAYMENT_PROVIDER } = require("../../../shared/domain/commerce-constants");

const createPaymentSchema = Joi.object({
  body: Joi.object({
    orderId: Joi.string().required(),
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
    orderId: Joi.string().required(),
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
    buyerId: Joi.string(),
    orderId: Joi.string(),
    search: Joi.string().max(128),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    limit: Joi.number().integer().min(1).max(500).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
  params: Joi.object({}).required(),
});

const paymentOptionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    orderAmount: Joi.number().min(0).default(0),
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
    paymentId: Joi.string().required(),
  }).required(),
});

const manualPaymentDecisionSchema = Joi.object({
  body: Joi.object({
    referenceId: Joi.string().max(180).allow("", null),
    reason: Joi.string().max(500).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    paymentId: Joi.string().required(),
  }).required(),
});

module.exports = {
  createPaymentSchema,
  verifyPaymentSchema,
  listPaymentsSchema,
  paymentOptionsSchema,
  codConfigSchema,
  paymentParamSchema,
  manualPaymentDecisionSchema,
};
