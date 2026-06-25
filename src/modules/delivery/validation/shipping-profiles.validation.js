"use strict";

const Joi = require("joi");

const SERVICEABILITY_MODES = ["all_india", "selected_states", "selected_cities", "selected_pincodes", "block_pincodes"];
const SHIPPING_METHODS = ["standard", "express", "same_day", "hyperlocal"];

const profileBody = Joi.object({
  sellerId: Joi.string().trim().allow("", null).optional(),
  name: Joi.string().trim().min(2).max(128).required(),
  description: Joi.string().trim().max(500).allow("", null).optional(),
  shippingMethod: Joi.string().valid(...SHIPPING_METHODS).default("standard"),
  serviceabilityMode: Joi.string().valid(...SERVICEABILITY_MODES).default("all_india"),
  allowedStates: Joi.array().items(Joi.string().trim()).default([]),
  allowedCities: Joi.array().items(Joi.string().trim()).default([]),
  allowedPincodes: Joi.array().items(Joi.string().trim().pattern(/^\d{4,10}$/)).default([]),
  blockedPincodes: Joi.array().items(Joi.string().trim().pattern(/^\d{4,10}$/)).default([]),
  codAvailable: Joi.boolean().default(true),
  shippingCharge: Joi.number().min(0).default(0),
  freeShippingThreshold: Joi.number().min(0).allow(null).optional(),
  etaMin: Joi.number().integer().min(0).allow(null).optional(),
  etaMax: Joi.number().integer().min(0).allow(null).optional(),
  isDefault: Joi.boolean().default(false),
  active: Joi.boolean().default(true),
  organizationId: Joi.string().uuid().allow(null).optional(),
});

const updateProfileBody = profileBody.fork(["name"], (s) => s.optional());

const listProfilesSchema = Joi.object({
  sellerId: Joi.string().optional(),
  organizationId: Joi.string().uuid().allow(null).optional(),
  active: Joi.boolean().optional(),
  search: Joi.string().trim().optional(),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const profileParamSchema = Joi.object({
  profileId: Joi.string().uuid().required(),
});

module.exports = {
  profileBody,
  updateProfileBody,
  listProfilesSchema,
  profileParamSchema,
  SERVICEABILITY_MODES,
  SHIPPING_METHODS,
};
