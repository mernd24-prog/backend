const Joi = require("joi");

const createNotificationSchema = Joi.object({
  body: Joi.alternatives().try(
    Joi.object({
      userId: Joi.string().required(),
      channel: Joi.string().valid("in_app", "email", "sms", "push").required(),
      template: Joi.string().required(),
      subject: Joi.string().allow("", null),
      payload: Joi.object().default({}),
      email: Joi.string().email(),
      idempotencyKey: Joi.string().allow("", null),
    }),
    Joi.object({
      title: Joi.string().trim().min(1).max(180).required(),
      body: Joi.string().trim().min(1).max(5000).required(),
      channel: Joi.string().valid("in_app", "email", "sms", "push").default("in_app"),
      audience: Joi.string().valid("all", "buyers", "sellers", "admins", "specific_users").default("all"),
      userIds: Joi.array().items(Joi.string().trim().min(1)).default([]),
      data: Joi.object().default({}),
    }),
  ).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

module.exports = { createNotificationSchema };
