const express = require("express");
const router = express.Router();

const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");

const { CommissionService } = require("../services/commission.service");
const { commissionValidation } = require("../../validation");

const financeView = allowPermissions("sellers/commissions:view");
const financeManage = allowPermissions("sellers/commissions:update");

function sendDocument(res, document) {
  res.setHeader("Content-Type", document.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`);
  res.send(document.body);
}

function sellerOrganizationQuery(req) {
  return {
    ...(req.query || {}),
    organizationId: req.query?.organizationId || req.auth?.selectedOrganizationId || undefined,
  };
}

// ==============================
// Seller: View commission breakdown
// ==============================
router.get("/my-commissions", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const commissions = await CommissionService.getSellerCommissions(userId, sellerOrganizationQuery(req));

    return res.status(200).json({
      success: true,
      data: commissions,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: Export commission breakdown
// ==============================
router.get("/my-commissions/export", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const document = await CommissionService.exportSellerCommissions({ ...sellerOrganizationQuery(req), sellerId: userId });
    return sendDocument(res, document);
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: View payout history
// ==============================
router.get("/my-payouts", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const payouts = await CommissionService.getSellerPayouts(userId, sellerOrganizationQuery(req));

    return res.status(200).json({
      success: true,
      data: payouts,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: Export payout history
// ==============================
router.get("/my-payouts/export", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const document = await CommissionService.exportSellerPayouts({ ...sellerOrganizationQuery(req), sellerId: userId });
    return sendDocument(res, document);
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: Wallet summary
// ==============================
router.get("/my-wallet", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const wallet = await CommissionService.getSellerWalletSummary(userId, sellerOrganizationQuery(req));

    return res.status(200).json({
      success: true,
      data: wallet,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: Settlement history
// ==============================
router.get("/my-settlements", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const settlements = await CommissionService.getSellerSettlements(userId, sellerOrganizationQuery(req));

    return res.status(200).json({
      success: true,
      data: settlements,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: Export settlement history
// ==============================
router.get("/my-settlements/export", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const document = await CommissionService.exportSettlements({ ...sellerOrganizationQuery(req), sellerId: userId });
    return sendDocument(res, document);
  } catch (err) {
    next(err);
  }
});

// ==============================
// Seller: Download settlement statement
// ==============================
router.get("/my-settlements/:settlementId/statement", authenticate, financeView, async (req, res, next) => {
  try {
    const document = await CommissionService.getSettlementStatement(
      req.params.settlementId,
      sellerOrganizationQuery(req),
      req.auth,
    );
    return sendDocument(res, document);
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
// Admin: Export seller commissions
// ==============================
router.get("/export", authenticate, financeView, async (req, res, next) => {
  try {
    const document = await CommissionService.exportSellerCommissions(req.query);
    return sendDocument(res, document);
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
// Admin: Export seller payouts
// ==============================
router.get("/payouts/export", authenticate, financeView, async (req, res, next) => {
  try {
    const document = await CommissionService.exportSellerPayouts(req.query);
    return sendDocument(res, document);
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Payout operations queue
// ==============================
router.get("/payout-ops/queue", authenticate, financeView, async (req, res, next) => {
  try {
    const queue = await CommissionService.getPayoutOperationsQueue(req.query);
    return res.status(200).json({
      success: true,
      data: queue,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Negative balance recovery queue
// ==============================
router.get("/negative-balances", authenticate, financeView, async (req, res, next) => {
  try {
    const balances = await CommissionService.listNegativeBalanceRecoveries(req.query);
    return res.status(200).json({
      success: true,
      data: balances,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Resolve negative balance recovery
// ==============================
router.post("/negative-balances/:settlementId/resolve", authenticate, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.resolveNegativeBalanceRecovery(
      req.params.settlementId,
      req.body || {},
      req.auth,
    );
    return res.status(200).json({
      success: true,
      message: "Negative balance recovery updated",
      data: result,
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
// Admin: Approve payout for processing
// ==============================
router.post("/payouts/:payoutId/approve", authenticate, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.approvePayout(req.params.payoutId, {
      note: req.body?.note,
      paymentMethod: req.body?.paymentMethod,
      actor: req.auth,
    });
    return res.status(200).json({
      success: true,
      message: "Payout approved",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Put payout on hold
// ==============================
router.post("/payouts/:payoutId/hold", authenticate, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.holdPayout(req.params.payoutId, req.body?.reason, req.auth);
    return res.status(200).json({
      success: true,
      message: "Payout put on hold",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Release payout hold
// ==============================
router.post("/payouts/:payoutId/release-hold", authenticate, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.releasePayoutHold(req.params.payoutId, {
      approve: req.body?.approve === true,
      note: req.body?.note,
      actor: req.auth,
    });
    return res.status(200).json({
      success: true,
      message: "Payout hold released",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Retry failed payout
// ==============================
router.post("/payouts/:payoutId/retry", authenticate, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.retryFailedPayout(req.params.payoutId, {
      paymentReference: req.body?.paymentReference,
      paymentMethod: req.body?.paymentMethod,
      autoProcess: req.body?.autoProcess === true,
      actor: req.auth,
    });
    return res.status(200).json({
      success: true,
      message: "Payout retry started",
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
        {
          actor: req.auth,
          sourceStatus: req.body?.sourceStatus,
          organizationId: req.body?.organizationId,
        },
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
          ...(value.organizationId ? { organizationId: value.organizationId } : {}),
          paymentReference: req.body?.paymentReference,
          paymentMethod: req.body?.paymentMethod,
          note: value.note,
          notes: value.note,
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

// ==============================
// Admin: Export settlements
// ==============================
router.get(
  "/settlements/export",
  authenticate,
  financeView,
  async (req, res, next) => {
    try {
      const document = await CommissionService.exportSettlements(req.query);
      return sendDocument(res, document);
    } catch (err) {
      next(err);
    }
  },
);

// ==============================
// Admin: Download settlement statement
// ==============================
router.get(
  "/settlements/:settlementId/statement",
  authenticate,
  financeView,
  async (req, res, next) => {
    try {
      const document = await CommissionService.getSettlementStatement(
        req.params.settlementId,
        req.query,
        req.auth,
      );
      return sendDocument(res, document);
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
