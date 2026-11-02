const express = require("express");
const { CancellationController } = require("../controllers/cancellation.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  listCancellationsSchema,
  cancellationParamSchema,
  retryCancellationSchema,
  approveCancellationSchema,
  rejectCancellationSchema,
  completeManualRefundSchema,
  approveCancellationRefundSchema,
} = require("../validation/cancellation.validation");

const cancellationRoutes = express.Router();
const cancellationController = new CancellationController();

cancellationRoutes.get("/", authenticate, allowPermissions("cancellations:view"), checkInput(listCancellationsSchema), catchErrors(cancellationController.list));
cancellationRoutes.get("/:cancellationId", authenticate, allowPermissions("cancellations:view"), checkInput(cancellationParamSchema), catchErrors(cancellationController.get));
cancellationRoutes.post("/:cancellationId/retry", authenticate, allowPermissions("cancellations:update"), checkInput(retryCancellationSchema), catchErrors(cancellationController.retry));
cancellationRoutes.post(
  "/:cancellationId/approve",
  authenticate,
  allowPermissions("cancellations:approve"),
  checkInput(approveCancellationSchema),
  catchErrors(cancellationController.approveCancellation),
);
cancellationRoutes.post(
  "/:cancellationId/reject",
  authenticate,
  allowPermissions("cancellations:reject"),
  checkInput(rejectCancellationSchema),
  catchErrors(cancellationController.rejectCancellation),
);
cancellationRoutes.post(
  "/:cancellationId/approve-refund",
  authenticate,
  allowPermissions("cancellations:update"),
  checkInput(approveCancellationRefundSchema),
  catchErrors(cancellationController.approveRefund),
);
cancellationRoutes.post(
  "/:cancellationId/manual-refund",
  authenticate,
  allowPermissions("cancellations:update"),
  checkInput(completeManualRefundSchema),
  catchErrors(cancellationController.completeManualRefund),
);

module.exports = { cancellationRoutes };
