const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { okResponse } = require("../../../shared/http/reply");
const { ACTIONS } = require("../../../shared/constants/actions");
const { auditService } = require("../../../shared/logger/audit.service");
const { commerceSettingsService } = require("../services/commerce-settings.service");

const { PricingRepository } = require("../../pricing/repositories/pricing.repository");
const commerceSettingsRoutes = express.Router();

const { normalizeMarketing } = require("../../marketing/services/marketing-policy");
const { AppError } = require("../../../shared/errors/app-error");
const policyKey = (kind) => {
  if (!["coupons", "referrals"].includes(kind)) throw new AppError("Unknown marketing policy", 400);
  return kind === "coupons" ? "marketing" : "referralMarketing";
};
commerceSettingsRoutes.get(
  "/marketing-policy/:kind",
  authenticate,
  allowActions(ACTIONS.ADMIN_CONTROL),
  catchErrors(async (req, res) => {
    const settings = await commerceSettingsService.getSettings();
    const policy = settings[policyKey(req.params.kind)];
    const usage = await new PricingRepository().getMarketingUsage({ campaignKey: policy.campaignKey, policyType: req.params.kind, userId: null, code: null });
    res.json(okResponse({ policy, usage: { campaignKey: policy.campaignKey, spent: usage.campaignCost, orders: Number(usage.campaignUses), remaining: policy.campaignBudget > 0 ? Math.max(0, Number((policy.campaignBudget - usage.campaignCost).toFixed(2))) : null } }));
  }),
);
commerceSettingsRoutes.put(
  "/marketing-policy/:kind",
  authenticate,
  allowActions(ACTIONS.ADMIN_CONTROL),
  catchErrors(async (req, res) => {
    const key = policyKey(req.params.kind);
    const policy = normalizeMarketing({ ...req.body, scope: req.params.kind });
    const settings = await commerceSettingsService.updateSettings({ [key]: policy }, getCurrentUser(req));
    await auditService.update(req, { module: "commerce-settings", entityId: key, entityType: "AdminSetting", newData: settings[key], description: `Updated ${req.params.kind} marketing settings` });
    res.json(okResponse({ policy: settings[key] }));
  }),
);

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
