const Joi = require("joi");
const uuid = Joi.string().guid({ version: ["uuidv4", "uuidv5"] });

const createOrderInvoiceSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: uuid.required(),
  }).required(),
});

const marketplaceInvoiceBundleSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: uuid.required(),
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
    invoiceType: Joi.string().valid("order_customer", "seller_customer", "platform_commission"),
    referenceType: Joi.string().max(64),
    referenceId: Joi.string().max(128),
    state: Joi.string(),
    hsnCode: Joi.string(),
    search: Joi.string().trim().max(128),
    sortBy: Joi.string().valid("issuedAt", "issued_at", "invoiceNumber", "invoice_number", "taxableAmount", "taxable_amount", "taxAmount", "tax_amount", "totalAmount", "total_amount", "invoiceType", "invoice_type").default("issued_at"),
    sortDir: Joi.string().valid("asc", "desc").default("desc"),
    limit: Joi.number().integer().min(1).max(500).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
  params: Joi.object({}).required(),
});

const createCreditNoteSchema = Joi.object({
  body: Joi.object({
    orderId: uuid.required(),
    invoiceId: uuid,
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
    orderId: uuid,
    buyerId: Joi.string().max(64),
    referenceType: Joi.string().valid("cancellation", "return", "refund", "manual"),
    search: Joi.string().trim().max(128),
    sortBy: Joi.string().valid("issuedAt", "issued_at", "creditNoteNumber", "credit_note_number", "taxableAmount", "taxable_amount", "taxAmount", "tax_amount", "totalAmount", "total_amount").default("issued_at"),
    sortDir: Joi.string().valid("asc", "desc").default("desc"),
    limit: Joi.number().integer().min(1).max(500).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
  params: Joi.object({}).required(),
});

module.exports = {
  createOrderInvoiceSchema,
  marketplaceInvoiceBundleSchema,
  taxReportSchema,
  listInvoicesSchema,
  createCreditNoteSchema,
  listCreditNotesSchema,
};
