const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { okResponse } = require("../../../shared/http/reply");
const { ACTIONS } = require("../../../shared/constants/actions");
const { auditService } = require("../../../shared/logger/audit.service");
const { commerceSettingsService } = require("../services/commerce-settings.service");
const { sellerChargeSettingsService } = require("../../seller/services/seller-charge-settings.service");

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

commerceSettingsRoutes.get(
  "/seller-charge-settings",
  authenticate,
  allowActions(ACTIONS.ADMIN_CONTROL),
  catchErrors(async (req, res) => {
    const settings = await sellerChargeSettingsService.listSettings(req.query);
    res.json(okResponse(settings));
  }),
);

commerceSettingsRoutes.get(
  "/seller-charge-settings/:sellerId",
  authenticate,
  allowActions(ACTIONS.ADMIN_CONTROL),
  catchErrors(async (req, res) => {
    const settings = await sellerChargeSettingsService.getSettings(
      req.params.sellerId,
      req.query?.organizationId || req.query?.organization_id || null,
    );
    res.json(okResponse(settings));
  }),
);

commerceSettingsRoutes.put(
  "/seller-charge-settings/:sellerId",
  authenticate,
  allowActions(ACTIONS.ADMIN_CONTROL),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const settings = await sellerChargeSettingsService.updateSettings(
      req.params.sellerId,
      req.body,
      actor,
      req.body?.organizationId || req.body?.organization_id || req.query?.organizationId || req.query?.organization_id || null,
    );
    await auditService.update(req, {
      module: "commerce-settings",
      entityId: req.params.sellerId,
      entityType: "SellerChargeSettings",
      newData: settings,
      description: "Updated seller COD and delivery charge settings",
    });
    res.json(okResponse(settings, { message: "Seller charge settings updated" }));
  }),
);

module.exports = { commerceSettingsRoutes };
