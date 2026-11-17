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
notificationRoutes.post("/devices", authenticate, catchErrors(async (req, res) => {
  const { registerDevice } = require("../services/mobile-push.service");
  res.json({ success: true, data: await registerDevice(req.auth.sub, req.body) });
}));
notificationRoutes.delete("/devices", authenticate, catchErrors(async (req, res) => {
  const { unregisterDevice } = require("../services/mobile-push.service");
  res.json({ success: true, data: await unregisterDevice(req.auth.sub, req.body?.token) });
}));
notificationRoutes.patch("/:notificationId/read", authenticate, catchErrors(async (req, res) => {
  const { getCurrentUser } = require("../../../shared/auth/current-user");
  const result = await notificationController.notificationService.markRead(getCurrentUser(req), req.params.notificationId);
  res.json({ success: true, data: result });
}));

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
