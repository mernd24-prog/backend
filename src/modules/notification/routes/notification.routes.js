const express = require("express");
const { NotificationController } = require("../controllers/notification.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { createNotificationSchema } = require("../validation/notification.validation");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { ACTIONS } = require("../../../shared/constants/actions");

const notificationRoutes = express.Router();
const notificationController = new NotificationController();

notificationRoutes.get("/me", authenticate, catchErrors(notificationController.listMine));
notificationRoutes.get(
  "/admin",
  authenticate,
  allowActions(ACTIONS.NOTIFICATION_MANAGE),
  catchErrors(notificationController.listAdmin),
);
notificationRoutes.post(
  "/",
  authenticate,
  allowActions(ACTIONS.NOTIFICATION_MANAGE),
  checkInput(createNotificationSchema),
  catchErrors(notificationController.create),
);

module.exports = { notificationRoutes };
