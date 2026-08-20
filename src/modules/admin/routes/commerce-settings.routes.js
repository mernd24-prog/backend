const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { okResponse } = require("../../../shared/http/reply");
const { ACTIONS } = require("../../../shared/constants/actions");
const { auditService } = require("../../../shared/logger/audit.service");
const { commerceSettingsService } = require("../services/commerce-settings.service");

const commerceSettingsRoutes = express.Router();

commerceSettingsRoutes.get(
  "/",
  authenticate,
  catchErrors(async (req, res) => {
    const summary = await commerceSettingsService.getRuntimeSummary();
    res.json(okResponse(summary));
  }),
);

commerceSettingsRoutes.put(
  "/",
  authenticate,
  allowActions(ACTIONS.ADMIN_CONTROL),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const settings = await commerceSettingsService.updateSettings(req.body, actor);
    await auditService.update(req, {
      module: "commerce-settings",
      entityId: "commerce_policy",
      entityType: "AdminSetting",
      newData: settings,
      description: "Updated commerce checkout and seller payout settings",
    });
    res.json(okResponse(settings, { message: "Commerce settings updated" }));
  }),
);

module.exports = { commerceSettingsRoutes };
