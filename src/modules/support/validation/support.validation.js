const Joi = require("joi");

const CUSTOMER_QUERY_CATEGORIES = [
  "DELIVERY_ISSUE",
  "ORDER_ISSUE",
  "PAYMENT_ISSUE",
  "REFUND_RETURN_ISSUE",
  "PRODUCT_ISSUE",
  "ACCOUNT_ISSUE",
  "OTHER",
];

const SELLER_QUERY_CATEGORIES = [
  "ORDER_ISSUE",
  "PRODUCT_LISTING_ISSUE",
  "PAYMENT_SETTLEMENT_ISSUE",
  "COMMISSION_FEE_ISSUE",
  "STORE_KYC_ISSUE",
  "DELIVERY_SHIPPING_ISSUE",
  "OTHER",
];

const SUPPORT_QUERY_STATUSES = [
  "pending",
  "in_progress",
  "resolved",
  "closed",
];

const allCategories = Array.from(
  new Set([...CUSTOMER_QUERY_CATEGORIES, ...SELLER_QUERY_CATEGORIES]),
);

const queryIdParam = Joi.object({
  queryId: Joi.string().trim().min(4).max(60).required(),
});

const createSupportQuerySchema = Joi.object({
  body: Joi.object({
    category: Joi.string().trim().uppercase().valid(...allCategories).required(),
    subject: Joi.string().trim().min(5).max(220).required(),
    message: Joi.string().trim().min(10).max(5000).required(),
    attachmentUrls: Joi.array().items(Joi.string().uri().max(1000)).max(10).default([]),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listMySupportQueriesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid(...SUPPORT_QUERY_STATUSES),
    category: Joi.string().trim().uppercase().valid(...allCategories),
    search: Joi.string().trim().max(128),
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
  }).default({}),
  params: Joi.object({}).required(),
});

const supportQueryParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: queryIdParam.required(),
});

const adminListSupportQueriesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    user_type: Joi.string().valid("customer", "seller").required(),
    status: Joi.string().valid(...SUPPORT_QUERY_STATUSES),
    category: Joi.string().trim().uppercase().valid(...allCategories),
    search: Joi.string().trim().max(128),
    limit: Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
  params: Joi.object({}).required(),
});

const adminSupportQueryParamSchema = supportQueryParamSchema;

const updateSupportQueryStatusSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid(...SUPPORT_QUERY_STATUSES).required(),
    adminNotes: Joi.string().trim().max(2000).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: queryIdParam.required(),
});

module.exports = {
  CUSTOMER_QUERY_CATEGORIES,
  SELLER_QUERY_CATEGORIES,
  SUPPORT_QUERY_STATUSES,
  createSupportQuerySchema,
  listMySupportQueriesSchema,
  supportQueryParamSchema,
  adminListSupportQueriesSchema,
  adminSupportQueryParamSchema,
  updateSupportQueryStatusSchema,
};
