const express = require("express");
const { TaxController } = require("../controllers/tax.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  createOrderInvoiceSchema,
  taxReportSchema,
  listInvoicesSchema,
  createCreditNoteSchema,
  listCreditNotesSchema,
} = require("../validation/tax.validation");

const taxRoutes = express.Router();
const taxController = new TaxController();

taxRoutes.get(
  "/orders/:orderId/invoice",
  authenticate,
  checkInput(createOrderInvoiceSchema),
  catchErrors(taxController.getOrderInvoice),
);

taxRoutes.post(
  "/orders/:orderId/invoice",
  authenticate,
  allowPermissions("tax:update"),
  checkInput(createOrderInvoiceSchema),
  catchErrors(taxController.createOrderInvoice),
);

taxRoutes.get(
  "/invoices",
  authenticate,
  allowPermissions("tax:view"),
  checkInput(listInvoicesSchema),
  catchErrors(taxController.listInvoices),
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
  "/reports",
  authenticate,
  allowPermissions("tax:export"),
  checkInput(taxReportSchema),
  catchErrors(taxController.getReport),
);

module.exports = { taxRoutes };
