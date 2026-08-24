const express = require("express");
const router = express.Router();

const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");

const { CommissionService } = require("../services/commission.service");
const { settlementLifecycleService } = require("../services/settlement-lifecycle.service");
const { commissionValidation } = require("../../validation");

const financeView = allowPermissions("sellers/commissions:view");
const financeManage = allowPermissions("sellers/commissions:update");
const SELLER_ROLES = new Set(["seller", "seller-admin", "seller-sub-admin"]);

function platformFinanceOnly(req, res, next) {
  if (SELLER_ROLES.has(req.auth?.role)) {
    return res.status(403).json({
      success: false,
      message: "Seller finance operations are managed by the platform.",
      error: {
        code: "FORBIDDEN",
        message: "Seller finance operations are managed by the platform.",
      },
      code: "FORBIDDEN",
    });
  }
  return next();
}

function sendDocument(res, document) {
  res.setHeader("Content-Type", document.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`);
  res.send(document.body);
}

function defaultPayoutMethod(paymentMethod) {
  return paymentMethod || undefined;
}

function shouldAutoProcessWithRazorpayX(paymentMethod, autoProcess) {
  const selectedMethod = defaultPayoutMethod(paymentMethod);
  return autoProcess === true ||
    ["razorpayx", "razorpay_x", "bank_transfer_auto"].includes(String(selectedMethod || "").toLowerCase());
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

// Seller requests payout; admin approval and transfer remain separate actions.
router.post("/my-payouts/request", authenticate, financeView, async (req, res, next) => {
  try {
    const sellerId = req.auth?.ownerSellerId || req.auth?.sub;
    if (!sellerId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { error, value } = commissionValidation.requestPayout.validate(req.body || {});
    if (error) return res.status(400).json({ success: false, message: "Validation error", details: error.details });
    const result = await CommissionService.requestSellerPayout(sellerId, {
      ...value,
      organizationId: value.organizationId || req.auth?.selectedOrganizationId || undefined,
      actor: req.auth,
    });
    return res.status(201).json({ success: true, message: result.message, data: result });
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

router.patch("/my-payout-preference", authenticate, financeView, async (req, res, next) => {
  try {
    const userId = req.auth?.ownerSellerId || req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await CommissionService.updateSellerPayoutPreference(userId, {
      organizationId: req.body?.organizationId || req.auth?.selectedOrganizationId || undefined,
      payoutDestination: req.body?.payoutDestination || req.body?.destination,
    }, req.auth);

    return res.status(200).json({
      success: true,
      message: "Payout preference updated",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// Seller: complete deduction/payable summary, scoped to the signed-in seller.
router.get("/my-summary", authenticate, financeView, async (req, res, next) => {
  try {
    const sellerId = req.auth?.ownerSellerId || req.auth?.sub;
    if (!sellerId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const summary = await CommissionService.getFinanceSummary({
      ...sellerOrganizationQuery(req),
      sellerId,
    });
    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    return next(err);
  }
});

router.get("/my-promotion-ledger", authenticate, financeView, async (req, res, next) => {
  try {
    const sellerId = req.auth?.ownerSellerId || req.auth?.sub;
    if (!sellerId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const ledger = await CommissionService.listPromotionFundingLedger({
      ...sellerOrganizationQuery(req),
      sellerId,
    });
    return res.status(200).json({ success: true, data: ledger });
  } catch (err) {
    return next(err);
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
router.get("/summary", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
router.get("/wallet/:sellerId", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
router.get("/promotion-ledger", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
  try {
    const ledger = await CommissionService.listPromotionFundingLedger(req.query);
    return res.status(200).json({ success: true, data: ledger });
  } catch (err) {
    return next(err);
  }
});

router.get("/", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
router.get("/export", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
router.get("/payouts", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
router.get("/payouts/export", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
router.get("/payout-ops/queue", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
// Admin: Refresh payout eligibility
// ==============================
router.post("/payout-ops/refresh-eligibility", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
  try {
    const refreshedOrders = await settlementLifecycleService.refreshDeliveredOrderEligibility(
      Math.min(Math.max(Number(req.body?.limit || 500), 1), 1000),
    );
    const eligibleItems = await settlementLifecycleService.markEligibleOrderItems(
      Math.min(Math.max(Number(req.body?.limit || 500), 1), 1000),
    );
    const fulfilledOrders = await settlementLifecycleService.finalizeEligibleOrders();
    const scheduledPayouts = await CommissionService.processScheduledPayouts({
      force: true,
      actor: req.auth,
    });

    return res.status(200).json({
      success: true,
      message: "Payout eligibility refreshed",
      data: {
        refreshedOrders,
        eligibleItems,
        fulfilledOrders,
        scheduledPayouts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Negative balance recovery queue
// ==============================
router.get("/negative-balances", authenticate, platformFinanceOnly, financeView, async (req, res, next) => {
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
router.post("/negative-balances/:settlementId/resolve", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
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
router.post("/payouts/:payoutId/process", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
  try {
    const paymentMethod = defaultPayoutMethod(req.body?.paymentMethod);
    const result = ["razorpayx", "razorpay_x", "bank_transfer_auto", "seller_wallet", "wallet"].includes(String(paymentMethod || "").toLowerCase()) || !paymentMethod
      ? await CommissionService.startPayoutTransfer(req.params.payoutId, { actor: req.auth, paymentMethod })
      : await CommissionService.processPayout(
        req.params.payoutId,
        req.body?.paymentReference || `manual_${Date.now()}`,
        {
          paymentMethod,
          notes: req.body?.notes,
          actor: req.auth,
        },
      );
    const status = String(result?.status || "").toLowerCase();
    return res.status(200).json({
      success: true,
      message: status === "completed"
        ? "Payout completed"
        : status === "processing"
          ? "Payout transfer started"
          : "Payout updated",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Mark payout failed and release commissions
// ==============================
router.post("/payouts/:payoutId/fail", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
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

router.post("/payouts/:payoutId/cancel", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.cancelPayout(req.params.payoutId, req.body?.reason, req.auth);
    return res.status(200).json({ success: true, message: "Payout cancelled", data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/payouts/:payoutId/sync-razorpayx", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.syncRazorpayXPayoutStatus(req.params.payoutId, req.auth);
    return res.status(200).json({
      success: true,
      message: result?.status === "completed" ? "RazorpayX payout completed" : "RazorpayX payout status synced",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Approve payout for processing
// ==============================
router.post("/payouts/:payoutId/approve", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
  try {
    const approvalNote = req.body?.note ?? req.body?.notes;
    const result = await CommissionService.approvePayout(req.params.payoutId, {
      note: approvalNote,
      paymentMethod: defaultPayoutMethod(req.body?.paymentMethod),
      autoProcess: shouldAutoProcessWithRazorpayX(req.body?.paymentMethod, req.body?.autoProcess),
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
router.post("/payouts/:payoutId/hold", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
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
router.post("/payouts/:payoutId/release-hold", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.releasePayoutHold(req.params.payoutId, {
      approve: req.body?.approve === true,
      note: req.body?.note,
      paymentMethod: defaultPayoutMethod(req.body?.paymentMethod),
      autoProcess: shouldAutoProcessWithRazorpayX(req.body?.paymentMethod, req.body?.autoProcess),
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
router.post("/payouts/:payoutId/retry", authenticate, platformFinanceOnly, financeManage, async (req, res, next) => {
  try {
    const result = await CommissionService.retryFailedPayout(req.params.payoutId, {
      paymentReference: req.body?.paymentReference,
      paymentMethod: defaultPayoutMethod(req.body?.paymentMethod),
      autoProcess: shouldAutoProcessWithRazorpayX(req.body?.paymentMethod, req.body?.autoProcess),
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
  platformFinanceOnly,
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
  platformFinanceOnly,
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
          commissionIds: value.commissionIds,
          paymentReference: req.body?.paymentReference,
          paymentMethod: defaultPayoutMethod(req.body?.paymentMethod),
          note: value.note,
          notes: value.note,
          autoProcess: shouldAutoProcessWithRazorpayX(req.body?.paymentMethod, value.autoProcess),
          actor: req.auth,
        },
      );
      const shouldAutoPayout = shouldAutoProcessWithRazorpayX(req.body?.paymentMethod, value.autoProcess);
      let finalResult = result;
      if (shouldAutoPayout) {
        const resolveCreatedPayoutId = (entry) => {
          if (!entry) return null;
          if (typeof entry === "string") return entry;
          const metadata = typeof entry.metadata === "string"
            ? (() => { try { return JSON.parse(entry.metadata); } catch { return {}; } })()
            : (entry.metadata || {});
          if (metadata.razorpayX?.payoutId || entry.payment_method === "razorpayx") return null;
          if (["completed", "processing"].includes(String(entry.status || "").toLowerCase()) && entry.payment_reference) return null;
          return entry.payout?.id || entry.id || entry.payoutId || null;
        };
        if (result?.organizationWise && Array.isArray(result.results)) {
          finalResult = {
            ...result,
            results: await Promise.all(result.results.map(async (entry) => {
              const createdPayoutId = resolveCreatedPayoutId(entry);
              if (!createdPayoutId) return entry;
              return CommissionService.initiateRazorpayXPayout(createdPayoutId, { actor: req.auth });
            })),
          };
        } else {
          const createdPayoutId = resolveCreatedPayoutId(result);
          finalResult = createdPayoutId
            ? await CommissionService.initiateRazorpayXPayout(createdPayoutId, { actor: req.auth })
            : result;
        }
      }

      return res.status(200).json({
        success: true,
        message: "Payouts processed successfully",
        data: finalResult,
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
  platformFinanceOnly,
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
  platformFinanceOnly,
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
  platformFinanceOnly,
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
