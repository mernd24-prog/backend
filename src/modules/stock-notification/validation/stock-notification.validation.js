const Joi = require("joi");

const STOCK_NOTIFICATION_STATUSES = ["pending", "queued", "notified", "cancelled", "failed"];

const createStockNotificationSchema = Joi.object({
  body: Joi.object({
    userId: Joi.string().trim().max(128).allow("", null),
    name: Joi.string().trim().min(2).max(180).required(),
    email: Joi.string().trim().email().max(255).required(),
    productId: Joi.string().trim().max(128).required(),
    variantId: Joi.string().trim().max(128).allow("", null),
    price: Joi.number().min(0).allow(null),
    sku: Joi.string().trim().max(160).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listStockNotificationsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid(...STOCK_NOTIFICATION_STATUSES),
    productId: Joi.string().trim().max(128),
    variantId: Joi.string().trim().max(128),
    search: Joi.string().trim().max(128),
    limit: Joi.number().integer().min(1).max(200).default(20),
    offset: Joi.number().integer().min(0).default(0),
  }).default({}),
  params: Joi.object({}).required(),
});

const notifyStockRequestSchema = Joi.object({
  body: Joi.object({
    productId: Joi.string().trim().max(128).required(),
    variantId: Joi.string().trim().max(128).allow("", null),
    message: Joi.string().trim().max(1000).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const bulkNotifyStockRequestSchema = Joi.object({
  body: Joi.object({
    items: Joi.array().items(
      Joi.object({
        productId: Joi.string().trim().max(128).required(),
        variantId: Joi.string().trim().max(128).allow("", null),
      }).required(),
    ).min(1).max(100).required(),
    message: Joi.string().trim().max(1000).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

module.exports = {
  STOCK_NOTIFICATION_STATUSES,
  createStockNotificationSchema,
  listStockNotificationsSchema,
  notifyStockRequestSchema,
  bulkNotifyStockRequestSchema,
};
