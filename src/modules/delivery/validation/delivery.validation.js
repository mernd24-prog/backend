"use strict";

const Joi = require("joi");
const {
  DELIVERY_STATUS,
  SHIPPING_MODES,
} = require("../models/delivery.model");
const uuid = Joi.string().guid({ version: ["uuidv4", "uuidv5"] });

const serviceabilitySchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    pincode: Joi.string().min(5).max(12).required(),
    productId: Joi.string().allow("", null),
  }).required(),
  params: Joi.object({}).required(),
});

const rateSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    pincode: Joi.string().min(5).max(12).required(),
    weightGrams: Joi.number().integer().min(0).default(0),
    shippingMode: Joi.string().valid(...SHIPPING_MODES).default("standard"),
    cod: Joi.boolean(),
    provider: Joi.string().default("manual"),
  }).required(),
  params: Joi.object({}).required(),
});

const listShipmentsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    orderId: uuid,
    dealId: uuid,
    returnId: Joi.string().max(64),
    shipmentType: Joi.string().valid("forward", "return"),
    direction: Joi.string().valid("forward", "reverse"),
    sellerId: Joi.string().max(64),
    status: Joi.string().valid(...Object.values(DELIVERY_STATUS)),
    courierName: Joi.string(),
    awbNumber: Joi.string(),
    search: Joi.string().trim().max(160),
    cod: Joi.boolean(),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    sortBy: Joi.string().valid(
      "createdAt", "created_at", "status", "sellerId", "seller_id",
      "courierName", "courier_name", "expectedDeliveryAt", "expected_delivery_at", "cod",
    ).default("created_at"),
    sortDir: Joi.string().valid("asc", "desc").default("desc"),
    limit: Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
  params: Joi.object({}).required(),
});

const packageSnapshotSchema = Joi.object({
  weightGrams: Joi.number().integer().min(0),
  length: Joi.number().min(0),
  width: Joi.number().min(0),
  height: Joi.number().min(0),
  unit: Joi.string().default("cm"),
  packageType: Joi.string().allow("", null),
}).unknown(true);

const createShipmentSchema = Joi.object({
  body: Joi.object({
    orderId: uuid.required(),
    dealId: uuid.allow(null),
    sellerId: Joi.string().max(64).allow("", null),
    provider: Joi.string().valid("manual").default("manual"),
    courierName: Joi.string().allow("", null),
    awbNumber: Joi.string().allow("", null),
    trackingNumber: Joi.string().allow("", null),
    trackingUrl: Joi.string().uri().max(1000).allow("", null),
    shippedAt: Joi.date().iso().allow(null),
    status: Joi.string().valid(...Object.values(DELIVERY_STATUS)).default(DELIVERY_STATUS.INITIATED),
    shippingMode: Joi.string().valid(...SHIPPING_MODES).default("standard"),
    fulfillmentModel: Joi.string().valid("seller_fulfilled", "platform_shipper_fulfilled", "hybrid").allow("", null),
    cod: Joi.boolean().default(false),
    packageSnapshot: packageSnapshotSchema.default({}),
    pickupAddressSnapshot: Joi.object().default({}),
    shipToSnapshot: Joi.object().default({}),
    rateSnapshot: Joi.object().default({}),
    labelData: Joi.object().default({}),
    deliveryProofSnapshot: Joi.object().default({}),
    expectedDeliveryAt: Joi.date().iso().allow(null),
    idempotencyKey: Joi.string().max(180).allow("", null),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const shipmentParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    shipmentId: uuid.required(),
  }).required(),
});

const trackingEventBody = {
  status: Joi.string().valid(...Object.values(DELIVERY_STATUS)).required(),
  eventTime: Joi.date().iso(),
  location: Joi.string().allow("", null),
  note: Joi.string().max(1000).allow("", null),
  deliveryException: Joi.string().allow("", null),
  courierName: Joi.string().trim().max(160).allow("", null),
  awbNumber: Joi.string().trim().max(160).allow("", null),
  trackingNumber: Joi.string().trim().max(160).allow("", null),
  trackingUrl: Joi.string().uri().max(1000).allow("", null),
  shippedAt: Joi.date().iso().allow(null),
  rawPayload: Joi.object().default({}),
  eventId: Joi.string().trim().max(180).allow("", null),
  source: Joi.string().valid("seller_panel", "admin_panel", "manual").default("manual"),
};

const trackingEventSchema = Joi.object({
  body: Joi.object(trackingEventBody).custom((value, helpers) => {
    const location = String(value.location || "").trim();
    const note = String(value.note || "").trim();
    if (location && (/^\d+$/.test(location) || location.length < 3)) {
      return helpers.message({ custom: "Location must be readable and cannot contain only numbers" });
    }
    if (["failed", "rto", "cancelled"].includes(value.status) && note.length < 3) {
      return helpers.message({ custom: "A reason of at least 3 characters is required for this shipment status" });
    }
    if (value.shippedAt && new Date(value.shippedAt).getTime() > Date.now()) {
      return helpers.message({ custom: "Shipment time cannot be in the future" });
    }
    return value;
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    shipmentId: uuid.required(),
  }).required(),
});

module.exports = {
  serviceabilitySchema,
  rateSchema,
  listShipmentsSchema,
  createShipmentSchema,
  shipmentParamSchema,
  trackingEventSchema,
};
