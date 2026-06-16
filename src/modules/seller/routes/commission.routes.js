const express = require("express");
const router = express.Router();

const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");

const { CommissionService } = require("../services/commission.service");
const { commissionValidation } = require("../../validation");

const financeView = allowPermissions("sellers/commissions:view");
const financeManage = allowPermissions("sellers/commissions:update");

// ==============================
// Seller: View commission breakdown
// ==============================
router.get("/my-commissions", authenticate, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const commissions = await CommissionService.getSellerCommissions(userId, req.query);

    return res.status(200).json({
      success: true,
      data: commissions,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: View payout history
// ==============================
router.get("/my-payouts", authenticate, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const payouts = await CommissionService.getSellerPayouts(userId, req.query);

    return res.status(200).json({
      success: true,
      data: payouts,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: Wallet summary
// ==============================
router.get("/my-wallet", authenticate, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const wallet = await CommissionService.getSellerWalletSummary(userId, req.query);

    return res.status(200).json({
      success: true,
      data: wallet,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Finance summary
// ==============================
router.get("/summary", authenticate, financeView, async (req, res, next) => {
  try {
    const summary = await CommissionService.getFinanceSummary(req.query);
    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Seller wallet summary
// ==============================
router.get("/wallet/:sellerId", authenticate, financeView, async (req, res, next) => {
  try {
    const wallet = await CommissionService.getSellerWalletSummary(req.params.sellerId, req.query);
    return res.status(200).json({
      success: true,
      data: wallet,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: List seller commissions
// ==============================
router.get("/", authenticate, financeView, async (req, res, next) => {
  try {
    const commissions = await CommissionService.listSellerCommissions(req.query);
    return res.status(200).json({
      success: true,
      data: commissions,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: List seller payouts
// ==============================
router.get("/payouts", authenticate, financeView, async (req, res, next) => {
  try {
    const payouts = await CommissionService.listSellerPayouts(req.query);
    return res.status(200).json({
      success: true,
      data: payouts,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Complete payout
// ==============================
router.post("/payouts/:payoutId/process", authenticate, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.processPayout(
      req.params.payoutId,
      req.body?.paymentReference || `manual_${Date.now()}`,
      {
        paymentMethod: req.body?.paymentMethod,
        notes: req.body?.notes,
        actor: req.auth,
      },
    );
    return res.status(200).json({
      success: true,
      message: "Payout completed",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Mark payout failed and release commissions
// ==============================
router.post("/payouts/:payoutId/fail", authenticate, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.failPayout(req.params.payoutId, req.body?.reason, req.auth);
    return res.status(200).json({
      success: true,
      message: "Payout marked failed",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Calculate commission for order
// ==============================
router.post(
  "/calculate/:orderId",
  authenticate,
  financeManage,
  async (req, res, next) => {
    try {
      const { error, value } =
        commissionValidation.calculateCommission.validate(req.params);

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          details: error.details,
        });
      }

      const commission = await CommissionService.calculateCommission(
        value.orderId,
        { actor: req.auth, sourceStatus: req.body?.sourceStatus },
      );

      return res.status(200).json({
        success: true,
        message: "Commission calculated",
        data: commission,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ==============================
// Admin: Process batch payouts
// ==============================
router.post(
  "/process-payouts",
  authenticate,
  financeManage,
  async (req, res, next) => {
    try {
      const { error, value } =
        commissionValidation.processPayouts.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          details: error.details,
        });
      }

      const result = await CommissionService.processBatchPayouts(
        value.sellerId,
        {
          periodStart: value.periodStart || req.body?.periodStart,
          periodEnd: value.periodEnd || req.body?.periodEnd,
          paymentReference: req.body?.paymentReference,
          paymentMethod: req.body?.paymentMethod,
          autoProcess: value.autoProcess,
          actor: req.auth,
        },
      );

      return res.status(200).json({
        success: true,
        message: "Payouts processed successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ==============================
// Admin: View settlements
// ==============================
router.get(
  "/settlements",
  authenticate,
  financeView,
  async (req, res, next) => {
    try {
      const settlements = await CommissionService.getSettlements(req.query);

      return res.status(200).json({
        success: true,
        data: settlements,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
