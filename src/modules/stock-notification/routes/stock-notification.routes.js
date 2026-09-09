const express = require("express");
const { authenticate, authenticateOptional } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { StockNotificationController } = require("../controllers/stock-notification.controller");
const {
  createStockNotificationSchema,
  bulkNotifyStockRequestSchema,
  listStockNotificationsSchema,
  notifyStockRequestSchema,
} = require("../validation/stock-notification.validation");

const stockNotificationRoutes = express.Router();
const stockNotificationController = new StockNotificationController();

stockNotificationRoutes.post(
  "/",
  authenticateOptional,
  checkInput(createStockNotificationSchema),
  catchErrors(stockNotificationController.create),
);

stockNotificationRoutes.get(
  "/",
  authenticate,
  allowPermissions("inventory:view"),
  checkInput(listStockNotificationsSchema),
  catchErrors(stockNotificationController.list),
);

stockNotificationRoutes.post(
  "/notify/bulk",
  authenticate,
  allowPermissions("inventory:adjust"),
  checkInput(bulkNotifyStockRequestSchema),
  catchErrors(stockNotificationController.notifyBulk),
);

stockNotificationRoutes.post(
  "/notify",
  authenticate,
  allowPermissions("inventory:adjust"),
  checkInput(notifyStockRequestSchema),
  catchErrors(stockNotificationController.notify),
);

module.exports = { stockNotificationRoutes };
