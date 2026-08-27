const express = require("express");
const { authenticate, authenticateOptional } = require("../../../shared/middleware/authenticate");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { SupportController } = require("../controllers/support.controller");
const { SupportAiController } = require("../controllers/support-ai.controller");
const {
  createSupportQuerySchema,
  listMySupportQueriesSchema,
  replySupportQuerySchema,
  supportQueryParamSchema,
  aiSupportChatSchema,
} = require("../validation/support.validation");

const supportRoutes = express.Router();
const supportController = new SupportController();
const supportAiController = new SupportAiController();

supportRoutes.post(
  "/ai-chat",
  authenticateOptional,
  checkInput(aiSupportChatSchema),
  catchErrors(supportAiController.chat),
);

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
