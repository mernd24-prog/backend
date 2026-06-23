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

const toNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeActiveState = (payload = {}, { forUpdate = false } = {}) => {
  const next = { ...payload };
  if (next.status === undefined && typeof next.isActive === "boolean") {
    next.status = next.isActive ? "active" : "inactive";
  }
  if (next.isActive === undefined && next.status) {
    next.isActive = next.status === "active";
  }
  if (!forUpdate) {
    if (next.status === undefined) next.status = "active";
    if (next.isActive === undefined) next.isActive = true;
  }
  return next;
};

const normalizePercentFields = (payload = {}, options = {}) => {
  const next = normalizeActiveState(payload, options);
  const percentage = next.percentage !== undefined
    ? toNumber(next.percentage, 0)
    : next.rate !== undefined
      ? toNumber(next.rate, 0) * 100
      : undefined;
  if (percentage !== undefined) {
    next.percentage = Math.min(Math.max(percentage, 0), 100);
    next.rate = Number((next.percentage / 100).toFixed(6));
  }
  if (next.fixedFeeAmount === undefined && next.amount !== undefined) {
    next.fixedFeeAmount = toNumber(next.amount, 0);
  }
  if (next.ruleScope === undefined && !options.forUpdate) {
    if (next.productId || next.productSku) next.ruleScope = "product";
    else if (next.categoryId || next.categoryName) next.ruleScope = "category";
    else if (next.sellerId) next.ruleScope = "seller";
    else if (next.organizationId) next.ruleScope = "organization";
    else next.ruleScope = "global";
  }
  return next;
};

const normalizeCommissionPayload = (payload = {}, options = {}) => {
  const next = normalizePercentFields(payload, options);
  const hasFeeFields = next.percentage !== undefined || next.rate !== undefined || next.fixedFeeAmount !== undefined;
  if (!next.commissionType && (!options.forUpdate || hasFeeFields)) {
    next.commissionType = Number(next.fixedFeeAmount || 0) > 0 && Number(next.percentage || 0) > 0
      ? "mixed"
      : Number(next.fixedFeeAmount || 0) > 0
        ? "fixed"
        : "percentage";
  }
  return next;
};

const normalizePlatformFeePayload = (payload = {}, options = {}) => {
  const next = normalizePercentFields(payload, options);
  if (next.feeType === "mixed") {
    next.amount = toNumber(next.fixedFeeAmount ?? next.amount, 0);
    next.rate = Number((toNumber(next.percentage, 0) / 100).toFixed(6));
  }
  return next;
};

// ──────────────────────────────────────────────
// Commission Rules
// ──────────────────────────────────────────────

adminFinanceRoutes.get(
  "/commission-rules",
  canViewFinance,
  catchErrors(async (req, res) => {
    const { sellerTier, isActive, status, ruleScope, q, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (sellerTier) filter.sellerTier = sellerTier;
    if (ruleScope) filter.ruleScope = ruleScope;
    if (status) filter.status = status;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    const term = String(q || search || "").trim();
    if (term) {
      filter.$or = [
        { name: { $regex: term, $options: "i" } },
        { categoryName: { $regex: term, $options: "i" } },
        { productId: { $regex: term, $options: "i" } },
        { productSku: { $regex: term, $options: "i" } },
        { sellerId: { $regex: term, $options: "i" } },
        { organizationId: { $regex: term, $options: "i" } },
      ];
    }

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
    const rule = await CommissionRuleModel.create({ ...normalizeCommissionPayload(req.body), createdBy: actor?.id });
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
      { ...normalizeCommissionPayload(req.body, { forUpdate: true }), updatedBy: actor?.id },
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
    const { feeType, isActive, status, ruleScope, q, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (feeType) filter.feeType = feeType;
    if (ruleScope) filter.ruleScope = ruleScope;
    if (status) filter.status = status;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    const term = String(q || search || "").trim();
    if (term) {
      filter.$or = [
        { name: { $regex: term, $options: "i" } },
        { categoryName: { $regex: term, $options: "i" } },
        { productId: { $regex: term, $options: "i" } },
        { productSku: { $regex: term, $options: "i" } },
        { sellerId: { $regex: term, $options: "i" } },
        { organizationId: { $regex: term, $options: "i" } },
      ];
    }

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
    const rule = await PlatformFeeRuleModel.create({ ...normalizePlatformFeePayload(req.body), createdBy: actor?.id });
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
      { ...normalizePlatformFeePayload(req.body, { forUpdate: true }), updatedBy: actor?.id },
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
