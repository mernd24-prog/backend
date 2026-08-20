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
  paymentParamSchema,
  manualPaymentApprovalSchema,
  manualPaymentRejectionSchema,
  codCollectionListSchema,
  codCollectionSubmitSchema,
  codCollectionVerifySchema,
} = require("../validation/payment.validation");
const { settlementLifecycleService } = require("../../seller/services/settlement-lifecycle.service");

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
  "/admin/:paymentId",
  authenticate,
  allowPermissions("payments:view"),
  checkInput(paymentParamSchema),
  catchErrors(paymentController.getAdminPayment),
);
paymentRoutes.get(
  "/cod-collections",
  authenticate,
  allowPermissions("payments:view"),
  checkInput(codCollectionListSchema),
  catchErrors(async (req, res) => {
    const collections = await settlementLifecycleService.listCodCollections(req.query, req.auth);
    res.json({ success: true, data: { items: collections, total: collections.length } });
  }),
);
paymentRoutes.get(
  "/cod-collections/mine",
  authenticate,
  allowPermissions("sellers/commissions:view"),
  checkInput(codCollectionListSchema),
  catchErrors(async (req, res) => {
    const collections = await settlementLifecycleService.listCodCollections({
      ...req.query,
      sellerActionableOnly: true,
    }, req.auth);
    res.json({ success: true, data: { items: collections, total: collections.length } });
  }),
);
paymentRoutes.post(
  "/cod-collections/shipments/:shipmentId/submit",
  authenticate,
  allowPermissions("sellers/commissions:update"),
  checkInput(codCollectionSubmitSchema),
  catchErrors(async (req, res) => {
    const collection = await settlementLifecycleService.submitSellerCodCollection(req.params.shipmentId, req.body, req.auth);
    res.json({ success: true, message: "COD collection submitted for verification", data: collection });
  }),
);
paymentRoutes.post(
  "/cod-collections/:collectionId/verify",
  authenticate,
  allowPermissions("payments:approve"),
  checkInput(codCollectionVerifySchema),
  catchErrors(async (req, res) => {
    const collection = await settlementLifecycleService.verifyCodCollection(req.params.collectionId, req.body, req.auth);
    res.json({ success: true, message: "COD collection verified", data: collection });
  }),
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
