const express = require("express");
const { PaymentController } = require("../controllers/payment.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  createPaymentSchema,
  verifyPaymentSchema,
  listPaymentsSchema,
  paymentOptionsSchema,
  codConfigSchema,
  paymentParamSchema,
  manualPaymentApprovalSchema,
  manualPaymentRejectionSchema,
} = require("../validation/payment.validation");

const paymentRoutes = express.Router();
const paymentController = new PaymentController();

paymentRoutes.post(
  "/webhooks/razorpay",
  catchErrors(paymentController.webhook),
);
paymentRoutes.get("/options", checkInput(paymentOptionsSchema), catchErrors(paymentController.options));
paymentRoutes.get("/me", authenticate, catchErrors(paymentController.listMine));
paymentRoutes.get(
  "/admin",
  authenticate,
  allowPermissions("payments:view"),
  checkInput(listPaymentsSchema),
  catchErrors(paymentController.listAdmin),
);
paymentRoutes.get(
  "/admin/cod-config",
  authenticate,
  allowPermissions("cod-config:view"),
  catchErrors(paymentController.getCodConfig),
);
paymentRoutes.put(
  "/admin/cod-config",
  authenticate,
  allowPermissions("cod-config:update"),
  checkInput(codConfigSchema),
  catchErrors(paymentController.updateCodConfig),
);
paymentRoutes.get(
  "/admin/:paymentId",
  authenticate,
  allowPermissions("payments:view"),
  checkInput(paymentParamSchema),
  catchErrors(paymentController.getAdminPayment),
);
paymentRoutes.post(
  "/initiate",
  authenticate,
  checkInput(createPaymentSchema),
  catchErrors(paymentController.initiate),
);
paymentRoutes.post(
  "/verify",
  authenticate,
  checkInput(verifyPaymentSchema),
  catchErrors(paymentController.verify),
);
paymentRoutes.post(
  "/:paymentId/approve",
  authenticate,
  allowPermissions("payments:approve"),
  checkInput(manualPaymentApprovalSchema),
  catchErrors(paymentController.approveManual),
);
paymentRoutes.post(
  "/:paymentId/reject",
  authenticate,
  allowPermissions("payments:approve"),
  checkInput(manualPaymentRejectionSchema),
  catchErrors(paymentController.rejectManual),
);

module.exports = { paymentRoutes };
