const Joi = require("joi");
const { COUPON_TYPE } = require("../../../shared/domain/commerce-constants");

const couponType = Joi.string()
  .custom((value) => (value === "flat" ? "fixed" : value))
  .valid(...Object.values(COUPON_TYPE));

const couponBodySchema = {
  code: Joi.string().trim().uppercase().min(3).max(30),
  title: Joi.string().trim().allow("").max(120),
  description: Joi.string().trim().allow("").max(500),
  type: couponType,
  value: Joi.number().positive(),
  minOrderAmount: Joi.number().min(0),
  maxDiscountAmount: Joi.number().min(0).allow(null),
  fundingType: Joi.string().valid("marketplace", "seller", "shared", "payment_partner"),
  sellerFundingPercent: Joi.number().min(0).max(100),
  usageLimit: Joi.number().integer().min(1).allow(null),
  usesPerCustomer: Joi.number().integer().min(1).allow(null),
  startsAt: Joi.date().iso().allow(null),
  expiresAt: Joi.date().iso().allow(null),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const withCouponAliases = (schema) =>
  schema
    .rename("couponCode", "code", { ignoreUndefined: true, override: false })
    .rename("couponTitle", "title", { ignoreUndefined: true, override: false })
    .rename("couponDescription", "description", { ignoreUndefined: true, override: false })
    .rename("discountType", "type", { ignoreUndefined: true, override: false })
    .rename("discountValue", "value", { ignoreUndefined: true, override: false })
    .rename("min_order_value", "minOrderAmount", { ignoreUndefined: true, override: false })
    .rename("minOrderValue", "minOrderAmount", { ignoreUndefined: true, override: false })
    .rename("max_discount_value", "maxDiscountAmount", { ignoreUndefined: true, override: false })
    .rename("maxDiscountValue", "maxDiscountAmount", { ignoreUndefined: true, override: false })
    .rename("funding_type", "fundingType", { ignoreUndefined: true, override: false })
    .rename("seller_funding_percent", "sellerFundingPercent", { ignoreUndefined: true, override: false })
    .rename("uses_per_coupon", "usageLimit", { ignoreUndefined: true, override: false })
    .rename("usesPerCoupon", "usageLimit", { ignoreUndefined: true, override: false })
    .rename("uses_per_customer", "usesPerCustomer", { ignoreUndefined: true, override: false })
    .rename("valid_from", "startsAt", { ignoreUndefined: true, override: false })
    .rename("dateFrom", "startsAt", { ignoreUndefined: true, override: false })
    .rename("valid_to", "expiresAt", { ignoreUndefined: true, override: false })
    .rename("dateTo", "expiresAt", { ignoreUndefined: true, override: false });

const createCouponSchema = Joi.object({
  body: withCouponAliases(Joi.object({
    ...couponBodySchema,
    code: couponBodySchema.code.required(),
    type: couponBodySchema.type.required(),
    value: couponBodySchema.value.required(),
    minOrderAmount: couponBodySchema.minOrderAmount.default(0),
    fundingType: couponBodySchema.fundingType.default("marketplace"),
    sellerFundingPercent: couponBodySchema.sellerFundingPercent.default(0),
    active: couponBodySchema.active.default(true),
  })).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateCouponSchema = Joi.object({
  body: withCouponAliases(Joi.object(couponBodySchema))
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    couponId: Joi.string().required(),
  }).required(),
});

const couponParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    couponId: Joi.string().required(),
  }).required(),
});

module.exports = { createCouponSchema, updateCouponSchema, couponParamSchema };
