const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { WhatsappSupportController } = require("../controllers/whatsapp-support.controller");
const {
  createFaqSchema,
  listFaqSchema,
} = require("../validation/whatsapp-support.validation");

const whatsappSupportRoutes = express.Router();
const controller = new WhatsappSupportController();

whatsappSupportRoutes.post(
  "/webhook",
  catchErrors(controller.webhook),
);

whatsappSupportRoutes.get(
  "/faqs",
  authenticate,
  checkInput(listFaqSchema),
  catchErrors(controller.listFaqs),
);

whatsappSupportRoutes.post(
  "/faqs",
  authenticate,
  checkInput(createFaqSchema),
  catchErrors(controller.createFaq),
);

module.exports = { whatsappSupportRoutes };
