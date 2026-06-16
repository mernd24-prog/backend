"use strict";

const Joi = require("joi");
const {
  DEAL_STATUS,
  DEAL_TYPE,
  DEAL_FULFILLMENT_MODEL,
  DEAL_VERIFICATION_METHODS,
  DEAL_PAYOUT_STATUS,
} = require("../models/deal.model");

const uuid = Joi.string().guid({ version: ["uuidv4", "uuidv5"] });
const id = Joi.string().min(1).max(128);
const money = Joi.number().precision(2).min(0);
const actorReason = Joi.object({
  reason: Joi.string().trim().min(2).max(500).optional(),
  note: Joi.string().trim().allow("").max(1000).optional(),
}).default({});

const commissionRuleSchema = Joi.object({
  ruleType: Joi.string().valid("percentage", "fixed", "tiered", "performance").default("percentage"),
  commissionPercent: Joi.number().precision(4).min(0).max(100).default(0),
  fixedFee: money.default(0),
  capAmount: money.allow(null).default(null),
  tiers: Joi.array().items(Joi.object().unknown(true)).default([]),
  appliesOn: Joi.string().valid("sale", "campaign_total").default("sale"),
  metadata: Joi.object().unknown(true).default({}),
});

const sponsorshipSchema = Joi.object({
  placement: Joi.string().trim().min(2).max(80).required(),
  title: Joi.string().trim().allow("").max(180).optional(),
  ctaText: Joi.string().trim().allow("").max(80).optional(),
  assetUrl: Joi.string().trim().allow("").max(600).optional(),
  targetUrl: Joi.string().trim().allow("").max(600).optional(),
  priority: Joi.number().integer().min(0).max(9999).default(100),
  startAt: Joi.date().iso().optional(),
  endAt: Joi.date().iso().optional(),
  status: Joi.string().valid("active", "inactive", "scheduled").default("active"),
  regionScope: Joi.object().unknown(true).default({}),
  audienceScope: Joi.object().unknown(true).default({}),
  metadata: Joi.object().unknown(true).default({}),
});

const dealBodySchema = Joi.object({
  title: Joi.string().trim().min(3).max(180).required(),
  description: Joi.string().trim().allow("").max(4000).optional(),
  sellerId: id.optional(),
  productId: id.required(),
  variantId: id.allow("", null).optional(),
  variantSku: Joi.string().trim().allow("", null).max(128).optional(),
  category: Joi.string().trim().allow("", null).max(180).optional(),
  dealType: Joi.string().valid(...Object.values(DEAL_TYPE)).default(DEAL_TYPE.FIXED_PRICE),
  status: Joi.string().valid(...Object.values(DEAL_STATUS)).optional(),
  originalPrice: money.required(),
  dealPrice: money.allow(null).optional(),
  discountPercent: Joi.number().precision(4).min(0).max(100).allow(null).optional(),
  allocatedQuantity: Joi.number().integer().min(0).default(0),
  maxQuantityPerOrder: Joi.number().integer().min(1).allow(null).default(null),
  startAt: Joi.date().iso().required(),
  endAt: Joi.date().iso().greater(Joi.ref("startAt")).required(),
  fulfillmentModel: Joi.string().valid(...Object.values(DEAL_FULFILLMENT_MODEL)).default(DEAL_FULFILLMENT_MODEL.SELLER_FULFILLED),
  deliveryVerificationRequired: Joi.boolean().default(false),
  deliveryVerificationMethods: Joi.array().items(Joi.string().valid(...DEAL_VERIFICATION_METHODS)).default(["otp"]),
  inventoryPolicy: Joi.object().unknown(true).default({}),
  financePolicy: Joi.object().unknown(true).default({}),
  sponsorshipPolicy: Joi.object().unknown(true).default({}),
  termsSnapshot: Joi.object().unknown(true).default({}),
  metadata: Joi.object().unknown(true).default({}),
  commissionRule: commissionRuleSchema.optional(),
  sponsorship: sponsorshipSchema.optional(),
});

const updateDealBodySchema = dealBodySchema.fork(["title", "productId", "originalPrice", "startAt", "endAt"], (schema) => schema.optional());

const listDealsSchema = {
  query: Joi.object({
    status: Joi.string().valid(...Object.values(DEAL_STATUS)).optional(),
    sellerId: id.optional(),
    productId: id.optional(),
    dealType: Joi.string().valid(...Object.values(DEAL_TYPE)).optional(),
    placement: Joi.string().trim().max(80).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    search: Joi.string().trim().allow("").max(180).optional(),
    sortBy: Joi.string().valid("created_at", "updated_at", "start_at", "end_at", "status", "title", "sold_quantity").default("created_at"),
    sortDir: Joi.string().valid("asc", "desc").default("desc"),
    limit: Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),
};

const createDealSchema = { body: dealBodySchema };
const updateDealSchema = { params: Joi.object({ dealId: uuid.required() }), body: updateDealBodySchema };
const dealParamSchema = { params: Joi.object({ dealId: uuid.required() }) };
const dealActionSchema = { params: Joi.object({ dealId: uuid.required() }), body: actorReason };
const rejectDealSchema = {
  params: Joi.object({ dealId: uuid.required() }),
  body: Joi.object({
    reason: Joi.string().trim().min(2).max(500).required(),
    note: Joi.string().trim().allow("").max(1000).optional(),
  }),
};
const commissionRuleUpdateSchema = {
  params: Joi.object({ dealId: uuid.required() }),
  body: commissionRuleSchema.required(),
};
const sponsorshipUpdateSchema = {
  params: Joi.object({ dealId: uuid.required() }),
  body: sponsorshipSchema.required(),
};
const sponsorshipParamSchema = {
  params: Joi.object({ sponsorshipId: uuid.required() }),
};
const placementSchema = {
  query: Joi.object({
    placement: Joi.string().trim().min(2).max(80).required(),
    region: Joi.string().trim().allow("").max(80).optional(),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};
const analyticsSchema = {
  query: Joi.object({
    sellerId: id.optional(),
    dealId: uuid.optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};
const payoutGenerateSchema = {
  body: Joi.object({
    sellerId: id.optional(),
    dealId: uuid.optional(),
    periodStart: Joi.date().iso().required(),
    periodEnd: Joi.date().iso().min(Joi.ref("periodStart")).required(),
    requireDeliveryVerified: Joi.boolean().optional(),
    note: Joi.string().trim().allow("").max(1000).optional(),
  }),
};
const payoutListSchema = {
  query: Joi.object({
    sellerId: id.optional(),
    dealId: uuid.optional(),
    status: Joi.string().valid(...Object.values(DEAL_PAYOUT_STATUS)).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    limit: Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),
};
const payoutParamSchema = { params: Joi.object({ payoutId: uuid.required() }) };
const processPayoutSchema = {
  params: Joi.object({ payoutId: uuid.required() }),
  body: Joi.object({
    status: Joi.string().valid(DEAL_PAYOUT_STATUS.PAID, DEAL_PAYOUT_STATUS.FAILED, DEAL_PAYOUT_STATUS.CANCELLED).required(),
    paymentReference: Joi.string().trim().allow("").max(180).optional(),
    note: Joi.string().trim().allow("").max(1000).optional(),
  }),
};

module.exports = {
  listDealsSchema,
  createDealSchema,
  updateDealSchema,
  dealParamSchema,
  dealActionSchema,
  rejectDealSchema,
  commissionRuleUpdateSchema,
  sponsorshipUpdateSchema,
  sponsorshipParamSchema,
  placementSchema,
  analyticsSchema,
  payoutGenerateSchema,
  payoutListSchema,
  payoutParamSchema,
  processPayoutSchema,
};
