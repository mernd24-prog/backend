"use strict";

const Joi = require("joi");
const { DELIVERY_STATUS, SHIPPING_MODES } = require("../models/delivery.model");
const uuid = Joi.string().guid({ version: ["uuidv4", "uuidv5"] });

const serviceabilitySchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    pincode: Joi.string().min(5).max(12).required(),
  }).required(),
  params: Joi.object({}).required(),
});

const rateSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    pincode: Joi.string().min(5).max(12).required(),
    weightGrams: Joi.number().integer().min(0).default(0),
    shippingMode: Joi.string().valid(...SHIPPING_MODES).default("standard"),
    cod: Joi.boolean().default(false),
    provider: Joi.string().default("manual"),
  }).required(),
  params: Joi.object({}).required(),
});

const listShipmentsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    orderId: uuid,
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
    sellerId: Joi.string().max(64).allow("", null),
    provider: Joi.string().default("manual"),
    courierName: Joi.string().allow("", null),
    awbNumber: Joi.string().allow("", null),
    trackingNumber: Joi.string().allow("", null),
    status: Joi.string().valid(...Object.values(DELIVERY_STATUS)).default(DELIVERY_STATUS.INITIATED),
    shippingMode: Joi.string().valid(...SHIPPING_MODES).default("standard"),
    cod: Joi.boolean().default(false),
    packageSnapshot: packageSnapshotSchema.default({}),
    pickupAddressSnapshot: Joi.object().default({}),
    shipToSnapshot: Joi.object().default({}),
    rateSnapshot: Joi.object().default({}),
    labelData: Joi.object().default({}),
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
  rawPayload: Joi.object().default({}),
  eventId: Joi.string().trim().max(180).allow("", null),
};

const trackingEventSchema = Joi.object({
  body: Joi.object(trackingEventBody).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    shipmentId: uuid.required(),
  }).required(),
});

const trackingWebhookSchema = Joi.object({
  body: Joi.object({
    shipmentId: uuid.required(),
    provider: Joi.string().default("manual"),
    ...trackingEventBody,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const createManifestSchema = Joi.object({
  body: Joi.object({
    shipmentIds: Joi.array().items(uuid).min(1).unique().required(),
    manifestNumber: Joi.string().allow("", null),
    courierName: Joi.string().allow("", null),
    status: Joi.string().default("created"),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const orderDeliveryParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: uuid.required(),
  }).required(),
});

const createEWayBillSchema = Joi.object({
  body: Joi.object({
    invoiceId: uuid.allow("", null),
    eWayBillNumber: Joi.string().allow("", null),
    status: Joi.string().valid(...Object.values(DELIVERY_STATUS), "initiated").default("initiated"),
    validFrom: Joi.date().iso().allow(null),
    validUntil: Joi.date().iso().min(Joi.ref("validFrom")).allow(null),
    transporterName: Joi.string().allow("", null),
    vehicleNumber: Joi.string().allow("", null),
    distanceKm: Joi.number().integer().min(0).allow(null),
    payloadSnapshot: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: uuid.required(),
  }).required(),
});

const updateEWayBillStatusSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid(...Object.values(DELIVERY_STATUS), "initiated").required(),
    transporterName: Joi.string().allow("", null),
    vehicleNumber: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    ewayBillId: uuid.required(),
  }).required(),
});

module.exports = {
  serviceabilitySchema,
  rateSchema,
  listShipmentsSchema,
  createShipmentSchema,
  shipmentParamSchema,
  trackingEventSchema,
  trackingWebhookSchema,
  createManifestSchema,
  orderDeliveryParamSchema,
  createEWayBillSchema,
  updateEWayBillStatusSchema,
};
