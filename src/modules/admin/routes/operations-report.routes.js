const express = require("express");
const { OperationsReportController } = require("../controllers/operations-report.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { reportExportSchema } = require("../validation/operations-report.validation");

const adminReportRoutes = express.Router();
const operationsReportController = new OperationsReportController();

adminReportRoutes.get(
  "/orders/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportOrders),
);
adminReportRoutes.get(
  "/products/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportProducts),
);
adminReportRoutes.get(
  "/inventory/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportInventory),
);
adminReportRoutes.get(
  "/shipments/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportShipments),
);
adminReportRoutes.get(
  "/delivery-agents/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportDeliveryAgents),
);
adminReportRoutes.get(
  "/returns/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportReturns),
);
adminReportRoutes.get(
  "/cancellations/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportCancellations),
);
adminReportRoutes.get(
  "/refunds/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportRefunds),
);
adminReportRoutes.get(
  "/seller-scorecards/export",
  checkInput(reportExportSchema),
  catchErrors(operationsReportController.exportSellerScorecards),
);

module.exports = { adminReportRoutes };
