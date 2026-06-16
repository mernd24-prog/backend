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
}

module.exports = { CancellationController };
