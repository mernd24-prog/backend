const Joi = require("joi");

const listFaqSchema = {
  query: Joi.object({
    status: Joi.string().valid("active", "inactive", "draft").optional(),
    category: Joi.string().trim().max(120).optional(),
    search: Joi.string().trim().max(200).optional(),
    limit: Joi.number().integer().min(1).max(200).optional(),
    offset: Joi.number().integer().min(0).optional(),
  }),
};

const createFaqSchema = {
  body: Joi.object({
    question: Joi.string().trim().min(3).max(2000).required(),
    answer: Joi.string().trim().min(3).max(6000).required(),
    category: Joi.string().trim().max(120).default("general"),
    tags: Joi.array().items(Joi.string().trim().max(80)).default([]),
    status: Joi.string().valid("active", "inactive", "draft").default("active"),
    metadata: Joi.object().unknown(true).default({}),
  }),
};

module.exports = {
  listFaqSchema,
  createFaqSchema,
};
