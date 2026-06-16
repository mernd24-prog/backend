const express = require("express");
const router = express.Router();

const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { ReturnService } = require("../services/return.service");
const { returnValidation } = require("../../validation");
const { AppError } = require("../../../shared/errors/app-error");
const { auditService } = require("../../../shared/logger/audit.service");

function validate(schema, source) {
  const { error, value } = schema.validate(source, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) throw new AppError("Validation failed", 400, error.details);
  return value;
}

router.get(
  "/",
  authenticate,
  allowPermissions("returns:view"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const query = validate(returnValidation.listReturns, req.query);
    res.json(okResponse(await ReturnService.listReturns(query, actor)));
  }),
);

router.post(
  "/",
  authenticate,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.requestReturn, req.body);
    const returnReq = await ReturnService.requestReturn(
      value.orderId,
      actor.userId,
      value.items,
      value.reason,
      value.description,
      actor,
      { photos: value.photos || [], resolution: value.resolution },
    );
    const created = returnReq?.returns || [returnReq];
    await Promise.all(created.map((item) => auditService.create(req, {
        module: "returns",
        entityId: item._id,
        entityType: "Return",
        newData: item,
        reason: value.reason,
        description: "Return requested",
      })));
    res.status(201).json(okResponse(returnReq, "Return requested successfully"));
  }),
);

router.get(
  "/my-returns",
  authenticate,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    res.json(okResponse(await ReturnService.getReturnsByBuyer(actor.userId)));
  }),
);

router.get(
  "/order/:orderId",
  authenticate,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.getReturnByOrder, req.params);
    res.json(okResponse(await ReturnService.getReturnByOrder(value.orderId, actor)));
  }),
);

router.get(
  "/:returnId",
  authenticate,
  allowPermissions("returns:view"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.getReturnById, req.params);
    res.json(okResponse(await ReturnService.getReturnById(value.returnId, actor)));
  }),
);

router.post(
  "/:returnId/approve",
  authenticate,
  allowPermissions("returns:approve"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.approveReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.approveReturn(value.returnId, value.refundAmount, actor, value);
    await auditService.approve(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      description: "Return approved",
    });
    res.json(okResponse(updated, "Return approved"));
  }),
);

router.post(
  "/:returnId/reject",
  authenticate,
  allowPermissions("returns:reject"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.rejectReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.rejectReturn(value.returnId, value.reason, actor);
    await auditService.reject(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      reason: value.reason,
      description: "Return rejected",
    });
    res.json(okResponse(updated, "Return rejected"));
  }),
);

router.post(
  "/:returnId/schedule",
  authenticate,
  allowPermissions("returns:update"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.scheduleReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.scheduleReversePickup(value.returnId, value, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      description: "Return pickup scheduled",
    });
    res.json(okResponse(updated));
  }),
);

router.post(
  "/:returnId/ship-back",
  authenticate,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.shipReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.shipReturnBack(value.returnId, value.trackingNumber, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      description: "Return shipped back",
    });
    res.json(okResponse(updated));
  }),
);

router.post(
  "/:returnId/reverse-shipment/tracking",
  authenticate,
  allowPermissions("returns:update"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.updateReverseShipment, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.updateReverseShipment(value.returnId, value, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      reason: value.note,
      description: `Reverse shipment updated to ${value.status}`,
    });
    res.json(okResponse(updated, "Reverse shipment updated"));
  }),
);

router.post(
  "/:returnId/receive",
  authenticate,
  allowPermissions("returns:update"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.receiveReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.receiveReturn(value.returnId, value, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      description: "Return received",
    });
    res.json(okResponse(updated));
  }),
);

router.post(
  "/:returnId/refund/retry",
  authenticate,
  allowPermissions("returns:approve"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.retryRefund, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.retryRefund(value.returnId, actor, value);
    await auditService.approve(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      reason: value.note,
      description: "Return refund retried",
    });
    res.json(okResponse(updated, "Refund retry processed"));
  }),
);

router.post(
  "/:returnId/refund/sync",
  authenticate,
  allowPermissions("returns:approve"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.getReturnById, { returnId: req.params.returnId });
    const updated = await ReturnService.syncRefund(value.returnId, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      description: "Provider refund synchronized",
    });
    res.json(okResponse(updated, "Refund status synchronized"));
  }),
);

router.post(
  "/:returnId/qc",
  authenticate,
  allowPermissions("returns:update"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.qcReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.qcReturn(value.returnId, value, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      reason: value.notes,
      description: value.items ? "Return item QC recorded" : value.passed ? "Return QC passed" : "Return QC failed",
    });
    res.json(okResponse(updated));
  }),
);

router.post(
  "/:returnId/refund",
  authenticate,
  allowPermissions("returns:approve"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.processRefund, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.processRefund(value.returnId, actor, value);
    await auditService.approve(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      reason: value.note,
      description: "Return refund processed",
    });
    res.json(okResponse(updated, "Refund processed successfully"));
  }),
);

router.post(
  "/:returnId/replacement",
  authenticate,
  allowPermissions("returns:update"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.replacementReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.createReplacement(value.returnId, value, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      description: "Return replacement created",
    });
    res.json(okResponse(updated));
  }),
);

router.post(
  "/:returnId/close",
  authenticate,
  allowPermissions("returns:update"),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const value = validate(returnValidation.closeReturn, { ...req.body, returnId: req.params.returnId });
    const updated = await ReturnService.closeReturn(value.returnId, value, actor);
    await auditService.statusChange(req, {
      module: "returns",
      entityId: value.returnId,
      entityType: "Return",
      newData: updated,
      reason: value.reason || value.note,
      description: "Return closed",
    });
    res.json(okResponse(updated));
  }),
);

module.exports = router;
