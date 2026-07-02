"use strict";

const Joi = require("joi");

const SERVICEABILITY_MODES = ["all_india", "selected_states", "selected_cities", "selected_pincodes", "block_pincodes"];
const SHIPPING_METHODS = ["standard", "express", "same_day", "hyperlocal"];
const PROFILE_FIELDS = [
  "name",
  "description",
  "shippingMethod",
  "serviceabilityMode",
  "allowedStates",
  "allowedCities",
  "allowedPincodes",
  "blockedPincodes",
  "codAvailable",
  "shippingCharge",
  "freeShippingThreshold",
  "etaMin",
  "etaMax",
  "isDefault",
  "active",
];

const etaRange = (value, helpers) => {
  if (
    value?.etaMin !== undefined &&
    value?.etaMin !== null &&
    value?.etaMax !== undefined &&
    value?.etaMax !== null &&
    Number(value.etaMin) > Number(value.etaMax)
  ) {
    return helpers.error("any.invalid", { message: "etaMin cannot be greater than etaMax" });
  }
  return value;
};

const profileBody = Joi.object({
  sellerId: Joi.string().trim().allow("", null).optional(),
  name: Joi.string().trim().min(2).max(128).required(),
  description: Joi.string().trim().max(500).allow("", null).optional(),
  shippingMethod: Joi.string().valid(...SHIPPING_METHODS).default("standard"),
  serviceabilityMode: Joi.string().valid(...SERVICEABILITY_MODES).default("all_india"),
  allowedStates: Joi.array().items(Joi.string().trim()).default([]),
  allowedCities: Joi.array().items(Joi.string().trim()).default([]),
  allowedPincodes: Joi.array().items(Joi.string().trim().pattern(/^\d{6}$/)).default([]),
  blockedPincodes: Joi.array().items(Joi.string().trim().pattern(/^\d{6}$/)).default([]),
  codAvailable: Joi.boolean().default(true),
  shippingCharge: Joi.number().min(0).default(0),
  freeShippingThreshold: Joi.number().min(0).allow(null).optional(),
  etaMin: Joi.number().integer().min(0).allow(null).optional(),
  etaMax: Joi.number().integer().min(0).allow(null).optional(),
  isDefault: Joi.boolean().default(false),
  active: Joi.boolean().default(true),
  organizationId: Joi.string().uuid().allow(null).optional(),
}).custom(etaRange);

const updateProfileBody = profileBody.fork(["name"], (s) => s.optional()).prefs({ noDefaults: true });

const templateBody = profileBody
  .fork(["sellerId", "organizationId", "isDefault"], (schema) => schema.optional().strip())
  .keys({
    allowedOverrides: Joi.array().items(Joi.string().valid(...PROFILE_FIELDS)).default(PROFILE_FIELDS),
    version: Joi.number().integer().min(1).optional(),
    status: Joi.string().valid("draft", "published", "archived").default("published"),
    active: Joi.boolean().default(true),
    metadata: Joi.object().unknown(true).default({}),
  });

const updateTemplateBody = templateBody.fork(["name"], (s) => s.optional()).prefs({ noDefaults: true });

const cloneTemplateBody = Joi.object({
  sellerId: Joi.string().trim().allow("", null).optional(),
  organizationId: Joi.string().uuid().allow(null).optional(),
  name: Joi.string().trim().min(2).max(128).optional(),
  description: Joi.string().trim().max(500).allow("", null).optional(),
  isDefault: Joi.boolean().default(false),
  active: Joi.boolean().default(true),
});

const listProfilesSchema = Joi.object({
  sellerId: Joi.string().optional(),
  organizationId: Joi.string().uuid().allow(null).optional(),
  active: Joi.boolean().optional(),
  includeArchived: Joi.boolean().optional(),
  search: Joi.string().trim().optional(),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const listTemplatesSchema = Joi.object({
  status: Joi.string().valid("draft", "published", "archived").optional(),
  active: Joi.boolean().optional(),
  search: Joi.string().trim().optional(),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const profileParamSchema = Joi.object({
  profileId: Joi.string().uuid().required(),
});

const templateParamSchema = Joi.object({
  templateId: Joi.string().uuid().required(),
});

module.exports = {
  profileBody,
  updateProfileBody,
  templateBody,
  updateTemplateBody,
  cloneTemplateBody,
  listProfilesSchema,
  listTemplatesSchema,
  profileParamSchema,
  templateParamSchema,
  SERVICEABILITY_MODES,
  SHIPPING_METHODS,
  PROFILE_FIELDS,
};
