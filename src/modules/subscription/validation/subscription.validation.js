const Joi = require("joi");

const listPlansSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const purchasePlanSchema = Joi.object({
  body: Joi.object({
    planId: Joi.string().guid({ version: "uuidv4" }).required(),
    billingCycle: Joi.string().valid("monthly", "yearly").default("monthly"),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const subscriptionIdParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    subscriptionId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const createPlanSchema = Joi.object({
  body: Joi.object({
    planCode: Joi.string().trim().uppercase().min(3).max(64).required(),
    title: Joi.string().min(3).max(180).required(),
    description: Joi.string().allow("", null),
    targetRoles: Joi.array().items(Joi.string().valid("buyer", "seller", "admin")).default([]),
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

const listPlansAdminSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    active: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const planIdParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    planId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const updatePlanSchema = Joi.object({
  body: Joi.object({
    title: Joi.string().min(3).max(180),
    description: Joi.string().allow("", null),
    targetRoles: Joi.array().items(Joi.string().valid("buyer", "seller", "admin")),
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

const listSubscriptionsAdminSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid("active", "paused", "cancelled", "expired"),
    userRole: Joi.string().valid("buyer", "seller", "admin"),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const updateSubscriptionStatusAdminSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid("active", "paused", "cancelled").required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    subscriptionId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

module.exports = {
  listPlansSchema,
  purchasePlanSchema,
  subscriptionIdParamSchema,
  createPlanSchema,
  listPlansAdminSchema,
  planIdParamSchema,
  updatePlanSchema,
  listSubscriptionsAdminSchema,
  updateSubscriptionStatusAdminSchema,
};
