const Joi = require("joi");

const listMyNotificationsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    fromDate: Joi.date().iso().raw(),
    toDate: Joi.date().iso().raw(),
    type: Joi.string().trim().max(40),
    channel: Joi.string().trim().max(40),
    search: Joi.string().trim().max(128),
    q: Joi.string().trim().max(128),
    keyWord: Joi.string().trim().max(128),
    raw: Joi.alternatives().try(Joi.boolean(), Joi.string().valid("0", "1", "true", "false", "yes", "no")),
  }).default({}),
  params: Joi.object({}).required(),
});

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

module.exports = { createNotificationSchema, listMyNotificationsSchema };
