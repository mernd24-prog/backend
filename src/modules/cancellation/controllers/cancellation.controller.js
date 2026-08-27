const { CancellationService } = require("../services/cancellation.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { okResponse } = require("../../../shared/http/reply");
const { auditService } = require("../../../shared/logger/audit.service");

class CancellationController {
  constructor({ cancellationService = new CancellationService() } = {}) {
    this.cancellationService = cancellationService;
  }

  list = async (req, res) => {
    const result = await this.cancellationService.list(req.query, getCurrentUser(req));
    res.json(okResponse(result, "Cancellations fetched successfully"));
  };

  get = async (req, res) => {
    const result = await this.cancellationService.get(req.params.cancellationId, getCurrentUser(req));
    res.json(okResponse(result, "Cancellation fetched successfully"));
  };

  retry = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.cancellationService.retry(req.params.cancellationId, actor);
    await auditService.statusChange(req, {
      module: "orders",
      entityId: result.order_id,
      entityType: "OrderCancellation",
      newData: result,
      reason: req.body.note || "cancellation_retry",
      description: "Cancellation recovery retried",
    });
    res.json(okResponse(result, "Cancellation recovery processed"));
  };

  approveCancellation = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.cancellationService.approveCancellation(req.params.cancellationId, req.body, actor);
    await auditService.approve(req, {
      module: "orders",
      entityId: result.order_id,
      entityType: "OrderCancellation",
      newData: result,
      reason: req.body.note || "cancellation_approved",
      description: "Product cancellation approved",
    });
    res.json(okResponse(result, "Cancellation approved; refund processing is now awaiting admin action where required"));
  };

  rejectCancellation = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.cancellationService.rejectCancellation(req.params.cancellationId, req.body, actor);
    await auditService.statusChange(req, {
      module: "orders",
      entityId: result.order_id,
      entityType: "OrderCancellation",
      newData: result,
      reason: req.body.reason,
      description: "Product cancellation rejected",
    });
    res.json(okResponse(result, "Cancellation request rejected"));
  };

  completeManualRefund = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.cancellationService.completeManualRefund(req.params.cancellationId, req.body, actor);
    await auditService.approve(req, {
      module: "orders",
      entityId: result.order_id,
      entityType: "OrderCancellation",
      newData: result,
      reason: req.body.note || req.body.referenceId,
      description: "Manual cancellation refund confirmed",
    });
    res.json(okResponse(result, "Manual refund confirmed"));
  };

  approveRefund = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.cancellationService.approveRefund(req.params.cancellationId, req.body, actor);
    await auditService.approve(req, {
      module: "orders",
      entityId: result.order_id,
      entityType: "OrderCancellation",
      newData: result,
      reason: req.body.note || "cancellation_refund_approved",
      description: "Cancellation refund approved for Razorpay processing",
    });
    res.json(okResponse(result, result.refund_status === "completed"
      ? "Cancellation refund completed"
      : "Cancellation refund approved and submitted to Razorpay"));
  };
}

module.exports = { CancellationController };
