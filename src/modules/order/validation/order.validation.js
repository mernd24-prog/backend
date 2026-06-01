const Joi = require("joi");
const { PAYMENT_PROVIDER } = require("../../../shared/domain/commerce-constants");

const orderFilterQuerySchema = Joi.object({
  status: Joi.string().valid(
    "pending_payment",
    "payment_failed",
    "confirmed",
    "packed",
    "shipped",
    "delivered",
    "fulfilled",
    "return_requested",
    "returned",
    "cancelled",
  ),
  paymentStatus: Joi.string().valid("initiated", "authorized", "captured", "failed", "refunded", "cancelled"),
  deliveryStatus: Joi.string().max(64),
  sellerId: Joi.string().max(128),
  buyerId: Joi.string().max(128),
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso(),
  search: Joi.string().trim().max(128),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
}).default({});

const listOrdersSchema = Joi.object({
  body: Joi.object({}).required(),
  query: orderFilterQuerySchema.required(),
  params: Joi.object({}).required(),
});

const createOrderSchema = Joi.object({
  body: Joi.object({
    currency: Joi.string().default("INR"),
    paymentProvider: Joi.string()
      .valid(PAYMENT_PROVIDER.RAZORPAY, PAYMENT_PROVIDER.COD, PAYMENT_PROVIDER.MANUAL_BANK_TRANSFER, PAYMENT_PROVIDER.MANUAL_UPI, PAYMENT_PROVIDER.WALLET_ONLY)
      .default(PAYMENT_PROVIDER.RAZORPAY),
    idempotencyKey: Joi.string().trim().max(128).allow("", null),
    couponCode: Joi.string().trim().uppercase().allow("", null),
    walletAmount: Joi.number().min(0).default(0),
    shippingAddress: Joi.object({
      line1: Joi.string().required(),
      line2: Joi.string().allow("", null),
      city: Joi.string().required(),
      state: Joi.string().required(),
      postalCode: Joi.string().required(),
      country: Joi.string().required(),
    }).required(),
    items: Joi.array()
      .items(
        Joi.object({
          productId: Joi.string().required(),
          variantId: Joi.string().allow("", null),
          variantSku: Joi.string().allow("", null),
          variantTitle: Joi.string().allow("", null),
          attributes: Joi.object().default({}),
          quantity: Joi.number().integer().min(1).required(),
        }),
      )
      .min(1)
      .required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const quoteOrderSchema = createOrderSchema;

const updateOrderStatusSchema = Joi.object({
  body: Joi.object({
    status: Joi.string()
      .valid(
        "pending_payment",
        "payment_failed",
        "confirmed",
        "cancelled",
        "packed",
        "shipped",
        "delivered",
        "fulfilled",
        "return_requested",
        "returned",
      )
      .required(),
    reason: Joi.string().max(500).allow("", null),
    note: Joi.string().max(1000).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
  }).required(),
});

const orderParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
  }).required(),
});

const cancelOrderSchema = Joi.object({
  body: Joi.object({
    reason: Joi.string().max(500).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
  }).required(),
});

const addOrderNoteSchema = Joi.object({
  body: Joi.object({
    note: Joi.string().trim().max(2000).required(),
    visibility: Joi.string().valid("internal", "seller", "buyer").default("internal"),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
  }).required(),
});

module.exports = {
  createOrderSchema,
  quoteOrderSchema,
  updateOrderStatusSchema,
  orderParamSchema,
  cancelOrderSchema,
  listOrdersSchema,
  addOrderNoteSchema,
};
