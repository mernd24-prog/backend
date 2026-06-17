const express = require("express");
const { TaxController } = require("../controllers/tax.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  createOrderInvoiceSchema,
  marketplaceInvoiceBundleSchema,
  taxReportSchema,
  listInvoicesSchema,
  createCreditNoteSchema,
  listCreditNotesSchema,
  taxDocumentDownloadSchema,
  taxExportSchema,
  taxDocumentDispatchSchema,
  listTaxDocumentDispatchesSchema,
  retryTaxDocumentDispatchSchema,
} = require("../validation/tax.validation");

const taxRoutes = express.Router();
const taxController = new TaxController();

taxRoutes.get(
  "/orders/:orderId/invoice",
  authenticate,
  checkInput(createOrderInvoiceSchema),
  catchErrors(taxController.getOrderInvoice),
);

taxRoutes.get(
  "/orders/:orderId/marketplace-invoices",
  authenticate,
  checkInput(marketplaceInvoiceBundleSchema),
  catchErrors(taxController.getMarketplaceInvoices),
);

taxRoutes.post(
  "/orders/:orderId/invoice",
  authenticate,
  allowPermissions("tax:update"),
  checkInput(createOrderInvoiceSchema),
  catchErrors(taxController.createOrderInvoice),
);

taxRoutes.post(
  "/orders/:orderId/marketplace-invoices",
  authenticate,
  checkInput(marketplaceInvoiceBundleSchema),
  catchErrors(taxController.createMarketplaceInvoices),
);

taxRoutes.get(
  "/invoices",
  authenticate,
  allowPermissions("tax:view"),
  checkInput(listInvoicesSchema),
  catchErrors(taxController.listInvoices),
);

taxRoutes.get(
  "/invoices/export",
  authenticate,
  allowPermissions("tax:export"),
  checkInput(taxExportSchema("invoices")),
  catchErrors(taxController.exportInvoices),
);

taxRoutes.get(
  "/invoices/:invoiceId/download",
  authenticate,
  checkInput(taxDocumentDownloadSchema("invoiceId")),
  catchErrors(taxController.downloadInvoice),
);

taxRoutes.post(
  "/invoices/:invoiceId/dispatch",
  authenticate,
  allowPermissions("tax:update"),
  checkInput(taxDocumentDispatchSchema("invoiceId")),
  catchErrors(taxController.dispatchInvoice),
);

taxRoutes.post(
  "/credit-notes",
  authenticate,
  allowPermissions("tax:update"),
  checkInput(createCreditNoteSchema),
  catchErrors(taxController.createCreditNote),
);

taxRoutes.get(
  "/credit-notes",
  authenticate,
  allowPermissions("tax:view"),
  checkInput(listCreditNotesSchema),
  catchErrors(taxController.listCreditNotes),
);

taxRoutes.get(
  "/credit-notes/export",
  authenticate,
  allowPermissions("tax:export"),
  checkInput(taxExportSchema("creditNotes")),
  catchErrors(taxController.exportCreditNotes),
);

taxRoutes.get(
  "/credit-notes/:creditNoteId/download",
  authenticate,
  checkInput(taxDocumentDownloadSchema("creditNoteId")),
  catchErrors(taxController.downloadCreditNote),
);

taxRoutes.post(
  "/credit-notes/:creditNoteId/dispatch",
  authenticate,
  allowPermissions("tax:update"),
  checkInput(taxDocumentDispatchSchema("creditNoteId")),
  catchErrors(taxController.dispatchCreditNote),
);

taxRoutes.get(
  "/reports",
  authenticate,
  allowPermissions("tax:export"),
  checkInput(taxReportSchema),
  catchErrors(taxController.getReport),
);

taxRoutes.get(
  "/reports/export",
  authenticate,
  allowPermissions("tax:export"),
  checkInput(taxExportSchema("reports")),
  catchErrors(taxController.exportReport),
);

taxRoutes.get(
  "/document-dispatches",
  authenticate,
  allowPermissions("tax:view"),
  checkInput(listTaxDocumentDispatchesSchema),
  catchErrors(taxController.listDocumentDispatches),
);

taxRoutes.post(
  "/document-dispatches/:dispatchId/retry",
  authenticate,
  allowPermissions("tax:update"),
  checkInput(retryTaxDocumentDispatchSchema),
  catchErrors(taxController.retryDocumentDispatch),
);

module.exports = { taxRoutes };
