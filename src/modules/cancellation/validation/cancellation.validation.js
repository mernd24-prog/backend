const Joi = require("joi");

const cancellationIdParams = Joi.object({
  cancellationId: Joi.string().uuid().required(),
});

const listCancellationsSchema = Joi.object({
  body: Joi.object({}).required(),
  params: Joi.object({}).required(),
  query: Joi.object({
    orderId: Joi.string().uuid(),
    buyerId: Joi.string().max(128),
    status: Joi.string().valid("processing", "refund_pending", "manual_review", "completed", "failed"),
    refundStatus: Joi.string().valid("not_required", "pending", "provider_pending", "manual_review", "completed", "failed"),
    scope: Joi.string().valid("full", "partial"),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    search: Joi.string().trim().max(128),
    limit: Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
});

const cancellationParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: cancellationIdParams.required(),
});

const retryCancellationSchema = Joi.object({
  body: Joi.object({
    note: Joi.string().trim().max(1000).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: cancellationIdParams.required(),
});

const completeManualRefundSchema = Joi.object({
  body: Joi.object({
    referenceId: Joi.string().trim().min(3).max(180).required(),
    proofUrl: Joi.string().uri().max(1000).allow("", null),
    note: Joi.string().trim().max(1000).allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: cancellationIdParams.required(),
});

module.exports = {
  listCancellationsSchema,
  cancellationParamSchema,
  retryCancellationSchema,
  completeManualRefundSchema,
};
