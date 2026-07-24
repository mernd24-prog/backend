const Joi = require("joi");

const idList = Joi.alternatives().try(
  Joi.string(),
  Joi.array().items(Joi.string()).min(1),
);

const listWarehousesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().allow(""),
    keyWord: Joi.string().allow(""),
    search: Joi.string().allow(""),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    size: Joi.number().integer().min(1).max(100),
    countryId: Joi.string(),
    stateId: Joi.string(),
    cityId: Joi.string(),
    active: Joi.boolean(),
    sortBy: Joi.string().valid("createdAt", "updatedAt", "name", "code", "skuCount", "capacity", "active"),
    sortDir: Joi.string().valid("asc", "desc"),
  }).required(),
  params: Joi.object({}).required(),
});

const listInventoryTransactionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    type: Joi.string().valid("reservation", "release", "sale", "restock", "return", "adjustment", "damage"),
    status: Joi.string(),
    productId: Joi.string(),
    sellerId: Joi.string(),
    orderId: Joi.string(),
    returnId: Joi.string(),
    shipmentId: Joi.string(),
    referenceType: Joi.string(),
    referenceId: Joi.string(),
    sortBy: Joi.string().valid("createdAt", "type", "status", "quantity", "productId", "sellerId"),
    sortDir: Joi.string().valid("asc", "desc"),
    limit: Joi.number().integer().min(1).max(200),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const listVariantInventorySchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().allow(""),
    keyWord: Joi.string().allow(""),
    search: Joi.string().allow(""),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    size: Joi.number().integer().min(1).max(100),
    sellerId: Joi.string().allow(""),
    status: Joi.string().allow(""),
    variantStatus: Joi.string().valid("active", "inactive", "out_of_stock").allow(""),
    stockStatus: Joi.string().valid("in_stock", "low_stock", "out_of_stock").allow(""),
    variantSku: Joi.string().allow(""),
    sortBy: Joi.string().valid(
      "updatedAt",
      "createdAt",
      "productName",
      "title",
      "sku",
      "status",
      "currentStock",
      "reservedStock",
      "availableStock",
    ),
    sortDir: Joi.string().valid("asc", "desc"),
  }).required(),
  params: Joi.object({}).required(),
});

const productInventorySchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    variantSku: Joi.string().allow(""),
    historyLimit: Joi.number().integer().min(1).max(200),
  }).required(),
  params: Joi.object({ productId: Joi.string().required() }).required(),
});

const variantAdjustmentBodySchema = Joi.object({
  variantSku: Joi.string().trim().allow("", null),
  adjustmentType: Joi.string().valid("add", "remove", "set"),
  quantity: Joi.number().min(0),
  adjustment: Joi.number(),
  reason: Joi.string().trim().max(500).allow("", null),
  note: Joi.string().trim().max(1000).allow("", null),
  reference: Joi.string().trim().max(200).allow("", null),
  showAllHistory: Joi.boolean(),
}).or("quantity", "adjustment").required();

const adjustVariantInventorySchema = Joi.object({
  body: Joi.alternatives().try(
    variantAdjustmentBodySchema,
    Joi.array().items(variantAdjustmentBodySchema).min(1).max(500).required(),
    Joi.object({
      updates: Joi.array().items(variantAdjustmentBodySchema).min(1).max(500).required(),
      showAllHistory: Joi.boolean(),
    }).required(),
  ).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    productId: Joi.string().required(),
    variantSku: Joi.string(),
  }).required(),
});

const bulkSetVariantInventorySchema = Joi.object({
  body: Joi.object({
    updates: Joi.array().items(
      Joi.object({
        productId: Joi.string().required(),
        variantId: Joi.string().trim().allow("", null),
        variantSku: Joi.string().trim().allow("", null),
        stock: Joi.number().integer().min(0).required(),
        reason: Joi.string().trim().max(500).allow("", null),
        note: Joi.string().trim().max(1000).allow("", null),
      }).or("variantId", "variantSku").required(),
    ).min(1).max(500).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const warehouseBody = {
  name: Joi.string().trim().required(),
  code: Joi.string().trim().pattern(/^[A-Za-z0-9_-]+$/).required(),
  managerName: Joi.string().trim().allow("", null),
  managerPhone: Joi.string().trim().allow("", null),
  managerEmail: Joi.string().email().allow("", null),
  addressLine1: Joi.string().trim().required(),
  addressLine2: Joi.string().trim().allow("", null),
  countryId: Joi.string().required(),
  stateId: Joi.string().required(),
  cityId: Joi.string().required(),
  zipCodeId: Joi.string().allow("", null),
  pincode: Joi.string().trim().required(),
  capacity: Joi.number().min(0),
  skuCount: Joi.number().min(0),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
  metadata: Joi.object(),
};

const warehouseUpdateBody = {
  ...warehouseBody,
  name: Joi.string().trim(),
  code: Joi.string().trim().pattern(/^[A-Za-z0-9_-]+$/),
  addressLine1: Joi.string().trim(),
  countryId: Joi.string(),
  stateId: Joi.string(),
  cityId: Joi.string(),
  pincode: Joi.string().trim(),
};

const createWarehouseSchema = Joi.object({
  body: Joi.object(warehouseBody).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateWarehouseSchema = Joi.object({
  body: Joi.object(warehouseUpdateBody).min(1).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ warehouseId: Joi.string().required() }).required(),
});

const warehouseParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({ warehouseId: Joi.string().required() }).required(),
});

const warehouseStatusSchema = Joi.object({
  body: Joi.object({
    ids: idList,
    _id: idList,
    isDisable: Joi.boolean().required(),
  }).or("ids", "_id").required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const warehouseDeleteSchema = Joi.object({
  body: Joi.object({
    ids: idList,
    _id: idList,
  }).or("ids", "_id").required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const releaseExpiredReservationsSchema = Joi.object({
  body: Joi.object({
    limit: Joi.number().integer().min(1).max(500),
    now: Joi.date().iso(),
    reason: Joi.string().trim().max(500).allow("", null),
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

module.exports = {
  listWarehousesSchema,
  listInventoryTransactionsSchema,
  listVariantInventorySchema,
  productInventorySchema,
  adjustVariantInventorySchema,
  bulkSetVariantInventorySchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  warehouseParamSchema,
  warehouseStatusSchema,
  warehouseDeleteSchema,
  releaseExpiredReservationsSchema,
};
