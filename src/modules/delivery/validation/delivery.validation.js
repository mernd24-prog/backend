"use strict";

const Joi = require("joi");
const { DELIVERY_STATUS, SHIPPING_MODES } = require("../models/delivery.model");

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
    orderId: Joi.string(),
    sellerId: Joi.string(),
    status: Joi.string().valid(...Object.values(DELIVERY_STATUS)),
    courierName: Joi.string(),
    awbNumber: Joi.string(),
    cod: Joi.boolean(),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
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
    orderId: Joi.string().required(),
    sellerId: Joi.string().allow("", null),
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
    shipmentId: Joi.string().required(),
  }).required(),
});

const trackingEventBody = {
  status: Joi.string().valid(...Object.values(DELIVERY_STATUS)).required(),
  eventTime: Joi.date().iso(),
  location: Joi.string().allow("", null),
  note: Joi.string().max(1000).allow("", null),
  deliveryException: Joi.string().allow("", null),
  rawPayload: Joi.object().default({}),
};

const trackingEventSchema = Joi.object({
  body: Joi.object(trackingEventBody).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    shipmentId: Joi.string().required(),
  }).required(),
});

const trackingWebhookSchema = Joi.object({
  body: Joi.object({
    shipmentId: Joi.string().required(),
    provider: Joi.string().default("manual"),
    ...trackingEventBody,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const createManifestSchema = Joi.object({
  body: Joi.object({
    shipmentIds: Joi.array().items(Joi.string()).min(1).required(),
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
    orderId: Joi.string().required(),
  }).required(),
});

const createEWayBillSchema = Joi.object({
  body: Joi.object({
    invoiceId: Joi.string().allow("", null),
    eWayBillNumber: Joi.string().allow("", null),
    status: Joi.string().valid(...Object.values(DELIVERY_STATUS), "initiated").default("initiated"),
    validFrom: Joi.date().iso().allow(null),
    validUntil: Joi.date().iso().allow(null),
    transporterName: Joi.string().allow("", null),
    vehicleNumber: Joi.string().allow("", null),
    distanceKm: Joi.number().integer().min(0).allow(null),
    payloadSnapshot: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
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
    ewayBillId: Joi.string().required(),
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
