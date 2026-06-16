const express = require("express");
const { AnalyticsController } = require("../controllers/analytics.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  trackEventSchema,
  sellerDashboardSchema,
  adminDashboardSchema,
} = require("../validation/analytics.validation");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { ACTIONS } = require("../../../shared/constants/actions");

const analyticsRoutes = express.Router();
const analyticsController = new AnalyticsController();

analyticsRoutes.get(
  "/seller-dashboard",
  authenticate,
  checkInput(sellerDashboardSchema),
  catchErrors(analyticsController.sellerDashboard),
);

analyticsRoutes.get(
  "/admin-dashboard",
  authenticate,
  allowActions(ACTIONS.ANALYTICS_VIEW),
  checkInput(adminDashboardSchema),
  catchErrors(analyticsController.adminDashboard),
);

analyticsRoutes.get(
  "/",
  authenticate,
  allowActions(ACTIONS.ANALYTICS_VIEW),
  catchErrors(analyticsController.list),
);
analyticsRoutes.post(
  "/events",
  authenticate,
  allowActions(ACTIONS.ANALYTICS_VIEW),
  checkInput(trackEventSchema),
  catchErrors(analyticsController.track),
);

module.exports = { analyticsRoutes };
