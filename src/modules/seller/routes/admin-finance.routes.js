const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { ACTIONS } = require("../../../shared/constants/actions");
const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { auditService } = require("../../../shared/logger/audit.service");
const { CommissionRuleModel } = require("../models/commission-rule.model");
const { PlatformFeeRuleModel } = require("../models/platform-fee-rule.model");

const adminFinanceRoutes = express.Router();

const canViewFinance = [authenticate, allowActions(ACTIONS.COMMISSION_VIEW)];
const canManageCommission = [authenticate, allowActions(ACTIONS.COMMISSION_MANAGE)];
const canManagePlatformFee = [authenticate, allowActions(ACTIONS.PLATFORM_FEE_MANAGE)];

// ──────────────────────────────────────────────
// Commission Rules
// ──────────────────────────────────────────────

adminFinanceRoutes.get(
  "/commission-rules",
  canViewFinance,
  catchErrors(async (req, res) => {
    const { sellerTier, isActive, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (sellerTier) filter.sellerTier = sellerTier;
    if (isActive !== undefined) filter.isActive = isActive === "true";

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      CommissionRuleModel.find(filter).sort({ priority: -1, createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      CommissionRuleModel.countDocuments(filter),
    ]);
    res.json(okResponse(items, { total, page: Number(page), limit: Number(limit) }));
  }),
);

adminFinanceRoutes.get(
  "/commission-rules/:id",
  canViewFinance,
  catchErrors(async (req, res) => {
    const rule = await CommissionRuleModel.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Commission rule not found" });
    res.json(okResponse(rule));
  }),
);

adminFinanceRoutes.post(
  "/commission-rules",
  canManageCommission,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const rule = await CommissionRuleModel.create({ ...req.body, createdBy: actor?.id });
    await auditService.create(req, {
      module: "commission",
      entityId: rule._id,
      entityType: "CommissionRule",
      newData: rule,
    });
    res.status(201).json(okResponse(rule));
  }),
);

adminFinanceRoutes.patch(
  "/commission-rules/:id",
  canManageCommission,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const rule = await CommissionRuleModel.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: actor?.id },
      { new: true, runValidators: true },
    ).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Commission rule not found" });
    await auditService.update(req, {
      module: "commission",
      entityId: req.params.id,
      entityType: "CommissionRule",
      newData: rule,
    });
    res.json(okResponse(rule));
  }),
);

adminFinanceRoutes.delete(
  "/commission-rules/:id",
  canManageCommission,
  catchErrors(async (req, res) => {
    const rule = await CommissionRuleModel.findByIdAndDelete(req.params.id).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Commission rule not found" });
    await auditService.remove(req, {
      module: "commission",
      entityId: req.params.id,
      entityType: "CommissionRule",
      reason: "admin_deleted",
    });
    res.json(okResponse({ deleted: true }));
  }),
);

// ──────────────────────────────────────────────
// Platform Fee Rules
// ──────────────────────────────────────────────

adminFinanceRoutes.get(
  "/platform-fee-rules",
  canViewFinance,
  catchErrors(async (req, res) => {
    const { feeType, isActive, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (feeType) filter.feeType = feeType;
    if (isActive !== undefined) filter.isActive = isActive === "true";

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      PlatformFeeRuleModel.find(filter).sort({ priority: -1, createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      PlatformFeeRuleModel.countDocuments(filter),
    ]);
    res.json(okResponse(items, { total, page: Number(page), limit: Number(limit) }));
  }),
);

adminFinanceRoutes.get(
  "/platform-fee-rules/:id",
  canViewFinance,
  catchErrors(async (req, res) => {
    const rule = await PlatformFeeRuleModel.findById(req.params.id).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Platform fee rule not found" });
    res.json(okResponse(rule));
  }),
);

adminFinanceRoutes.post(
  "/platform-fee-rules",
  canManagePlatformFee,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const rule = await PlatformFeeRuleModel.create({ ...req.body, createdBy: actor?.id });
    await auditService.create(req, {
      module: "platform-fee",
      entityId: rule._id,
      entityType: "PlatformFeeRule",
      newData: rule,
    });
    res.status(201).json(okResponse(rule));
  }),
);

adminFinanceRoutes.patch(
  "/platform-fee-rules/:id",
  canManagePlatformFee,
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const rule = await PlatformFeeRuleModel.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: actor?.id },
      { new: true, runValidators: true },
    ).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Platform fee rule not found" });
    await auditService.update(req, {
      module: "platform-fee",
      entityId: req.params.id,
      entityType: "PlatformFeeRule",
      newData: rule,
    });
    res.json(okResponse(rule));
  }),
);

adminFinanceRoutes.delete(
  "/platform-fee-rules/:id",
  canManagePlatformFee,
  catchErrors(async (req, res) => {
    const rule = await PlatformFeeRuleModel.findByIdAndDelete(req.params.id).lean();
    if (!rule) return res.status(404).json({ success: false, message: "Platform fee rule not found" });
    await auditService.remove(req, {
      module: "platform-fee",
      entityId: req.params.id,
      entityType: "PlatformFeeRule",
      reason: "admin_deleted",
    });
    res.json(okResponse({ deleted: true }));
  }),
);

module.exports = { adminFinanceRoutes };
