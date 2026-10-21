const express = require("express");
const multer = require("multer");
const { CaAnalyticsController } = require("../controllers/ca-analytics.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { allowPermissions } = require("../../../shared/middleware/access");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const controller = new CaAnalyticsController();

function createCaAnalyticsRoutes({ seller = false } = {}) {
  const router = express.Router();
  if (seller) router.use((req, _res, next) => { req.caSellerScope = true; next(); });
  const view = seller ? [] : [allowPermissions("ca-analytics:view")];
  const exportAccess = seller ? [] : [allowPermissions("ca-analytics:export")];
  router.get("/summary", ...view, catchErrors(controller.summary));
  router.get("/trends", ...view, catchErrors(controller.trends));
  router.get("/reconciliation", ...view, catchErrors(controller.reconciliation));
  router.get("/registers/:register", ...view, catchErrors(controller.register));
  router.get("/exports/:report", ...exportAccess, catchErrors(controller.export));
  if (!seller) router.post("/imports/provider", allowPermissions("ca-analytics:import"), upload.single("file"), catchErrors(controller.importProvider));
  return router;
}

module.exports = { createCaAnalyticsRoutes };
