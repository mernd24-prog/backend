const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { SupportController } = require("../controllers/support.controller");
const {
  createSupportQuerySchema,
  listMySupportQueriesSchema,
  replySupportQuerySchema,
  supportQueryParamSchema,
} = require("../validation/support.validation");

const supportRoutes = express.Router();
const supportController = new SupportController();

supportRoutes.get(
  "/queries",
  authenticate,
  checkInput(listMySupportQueriesSchema),
  catchErrors(supportController.listMine),
);

supportRoutes.post(
  "/queries",
  authenticate,
  checkInput(createSupportQuerySchema),
  catchErrors(supportController.createQuery),
);

supportRoutes.get(
  "/queries/:queryId",
  authenticate,
  checkInput(supportQueryParamSchema),
  catchErrors(supportController.getMine),
);

supportRoutes.post(
  "/queries/:queryId/replies",
  authenticate,
  checkInput(replySupportQuerySchema),
  catchErrors(supportController.replyMine),
);

module.exports = { supportRoutes };
