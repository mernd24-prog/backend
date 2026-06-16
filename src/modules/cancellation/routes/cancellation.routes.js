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
  completeManualRefundSchema,
} = require("../validation/cancellation.validation");

const cancellationRoutes = express.Router();
const cancellationController = new CancellationController();

cancellationRoutes.get("/", authenticate, checkInput(listCancellationsSchema), catchErrors(cancellationController.list));
cancellationRoutes.get("/:cancellationId", authenticate, checkInput(cancellationParamSchema), catchErrors(cancellationController.get));
cancellationRoutes.post("/:cancellationId/retry", authenticate, checkInput(retryCancellationSchema), catchErrors(cancellationController.retry));
cancellationRoutes.post(
  "/:cancellationId/manual-refund",
  authenticate,
  allowPermissions("orders:update"),
  checkInput(completeManualRefundSchema),
  catchErrors(cancellationController.completeManualRefund),
);

module.exports = { cancellationRoutes };
