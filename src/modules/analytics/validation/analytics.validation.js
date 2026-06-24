const Joi = require("joi");

const dashboardQuerySchema = Joi.object({
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso(),
  sellerId: Joi.string().max(64),
  organizationId: Joi.string().guid({ version: "uuidv4" }),
  limit: Joi.number().integer().min(1).max(100).default(10),
  walletLimit: Joi.number().integer().min(1).max(50).default(5),
});

const trackEventSchema = Joi.object({
  body: Joi.object({
    eventName: Joi.string().required(),
    actorId: Joi.string().allow("", null),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const sellerDashboardSchema = Joi.object({
  body: Joi.object({}).required(),
  query: dashboardQuerySchema.required(),
  params: Joi.object({}).required(),
});

const adminDashboardSchema = Joi.object({
  body: Joi.object({}).required(),
  query: dashboardQuerySchema.fork(["sellerId", "walletLimit"], (schema) => schema.optional()).required(),
  params: Joi.object({}).required(),
});

module.exports = {
  trackEventSchema,
  sellerDashboardSchema,
  adminDashboardSchema,
};
