const Joi = require("joi");

const createOrderInvoiceSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
  }).required(),
});

const taxReportSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    taxComponent: Joi.string().valid("cgst", "sgst", "igst", "tcs"),
    limit: Joi.number().integer().min(1).max(1000),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const listInvoicesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    sellerId: Joi.string(),
    buyerId: Joi.string(),
    state: Joi.string(),
    hsnCode: Joi.string(),
    search: Joi.string().trim().max(128),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const createCreditNoteSchema = Joi.object({
  body: Joi.object({
    orderId: Joi.string().required(),
    invoiceId: Joi.string(),
    referenceType: Joi.string().valid("cancellation", "return", "refund", "manual").default("manual"),
    referenceId: Joi.string(),
    taxableAmount: Joi.number().min(0).required(),
    taxAmount: Joi.number().min(0),
    cgstAmount: Joi.number().min(0),
    sgstAmount: Joi.number().min(0),
    igstAmount: Joi.number().min(0),
    totalAmount: Joi.number().min(0),
    reason: Joi.string().max(500).allow("", null),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listCreditNotesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    orderId: Joi.string(),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

module.exports = {
  createOrderInvoiceSchema,
  taxReportSchema,
  listInvoicesSchema,
  createCreditNoteSchema,
  listCreditNotesSchema,
};
