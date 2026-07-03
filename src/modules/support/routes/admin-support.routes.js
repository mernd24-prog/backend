const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { AdminSupportController } = require("../controllers/admin-support.controller");
const {
  adminListSupportQueriesSchema,
  adminSupportQueryParamSchema,
  updateSupportQueryStatusSchema,
} = require("../validation/support.validation");

const adminSupportRoutes = express.Router();
const adminSupportController = new AdminSupportController();

adminSupportRoutes.get(
  "/queries",
  authenticate,
  allowPermissions("queries:view"),
  checkInput(adminListSupportQueriesSchema),
  catchErrors(adminSupportController.listQueries),
);

adminSupportRoutes.get(
  "/queries/:queryId",
  authenticate,
  allowPermissions("queries:view"),
  checkInput(adminSupportQueryParamSchema),
  catchErrors(adminSupportController.getQuery),
);

adminSupportRoutes.patch(
  "/queries/:queryId/status",
  authenticate,
  allowPermissions("queries:status_change"),
  checkInput(updateSupportQueryStatusSchema),
  catchErrors(adminSupportController.updateStatus),
);

module.exports = { adminSupportRoutes };
