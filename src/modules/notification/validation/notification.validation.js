const Joi = require("joi");

const createNotificationSchema = Joi.object({
  body: Joi.object({
    userId: Joi.string().required(),
    channel: Joi.string().valid("in_app", "email", "sms", "push").required(),
    template: Joi.string().required(),
    subject: Joi.string().allow("", null),
    payload: Joi.object().default({}),
    email: Joi.string().email(),
    idempotencyKey: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

module.exports = { createNotificationSchema };
