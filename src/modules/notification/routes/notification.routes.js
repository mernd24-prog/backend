const express = require("express");
const { NotificationController } = require("../controllers/notification.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  createNotificationSchema,
  listMyNotificationsSchema,
} = require("../validation/notification.validation");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { ACTIONS } = require("../../../shared/constants/actions");

const notificationRoutes = express.Router();
const notificationController = new NotificationController();

notificationRoutes.get(
  "/me",
  authenticate,
  checkInput(listMyNotificationsSchema),
  catchErrors(notificationController.listMine),
);
notificationRoutes.get(
  "/admin",
  authenticate,
  allowActions(ACTIONS.NOTIFICATION_MANAGE),
  catchErrors(notificationController.listAdmin),
);
// Campaign routes share the same management permission as broadcast creation.
notificationRoutes.get("/campaigns/:campaignId", authenticate,
  allowActions(ACTIONS.NOTIFICATION_MANAGE), catchErrors(async (req, res) => {
    const { campaignService } = require("../services/notification-campaign.service");
    res.json({ success: true, data: await campaignService.inspect(req.params.campaignId) });
  }));
notificationRoutes.post("/campaigns/:campaignId/retry", authenticate,
  allowActions(ACTIONS.NOTIFICATION_MANAGE), catchErrors(async (req, res) => {
    const { campaignService } = require("../services/notification-campaign.service");
    res.status(202).json({ success: true, data: await campaignService.retry(req.params.campaignId) });
  }));
notificationRoutes.post(
  "/",
  authenticate,
  allowActions(ACTIONS.NOTIFICATION_MANAGE),
  checkInput(createNotificationSchema),
  catchErrors(notificationController.create),
);

module.exports = { notificationRoutes };
