const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

const upsertCartSchema = Joi.object({
  body: Joi.object({
    items: Joi.array()
      .items(
        Joi.object({
          productId: objectId.required(),
          variantId: objectId.allow("", null),
          variantSku: Joi.string().allow("", null),
          variantTitle: Joi.string().allow("", null),
          attributes: Joi.object().default({}),
          quantity: Joi.number().integer().min(1).required(),
          price: Joi.number().min(0),
        }),
      )
      .required(),
    wishlist: Joi.array().items(objectId).default([]),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listAdminCartsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().allow(""),
    keyWord: Joi.string().allow(""),
    search: Joi.string().allow(""),
    userId: Joi.string().allow(""),
    productId: Joi.string().allow(""),
    sellerId: Joi.string().allow(""),
    hasItems: Joi.boolean(),
    updatedFrom: Joi.date().iso(),
    updatedTo: Joi.date().iso(),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid("updatedAt", "createdAt", "userId"),
    sortDir: Joi.string().valid("asc", "desc"),
    sortOrder: Joi.string().valid("asc", "desc"),
  }).required(),
  params: Joi.object({}).required(),
});

const cartParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    cartId: objectId.required(),
  }).required(),
});

const clearCartSchema = Joi.object({
  body: Joi.object({
    reason: Joi.string().trim().min(3).max(500).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    cartId: objectId.required(),
  }).required(),
});

module.exports = {
  upsertCartSchema,
  listAdminCartsSchema,
  cartParamSchema,
  clearCartSchema,
};
