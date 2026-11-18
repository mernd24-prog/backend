"use strict";

// Presentation-only projection. It does not recalculate or mutate ledger values.
const number = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};
const json = (value) => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return {}; }
};

function buildFinancePresentation(row = {}) {
  const metadata = json(row.metadata);
  const breakdown = json(metadata.financialBreakdown || row.financialBreakdown);
  return {
    currency: row.currency || "INR",
    transaction: {
      grossAmount: number(row.amount ?? row.gross_amount ?? row.grossAmount),
      gstAmount: number(row.gst_amount ?? row.gstAmount ?? breakdown.gstAmount),
      gstInclusive: row.gstInclusive !== false,
      shippingAmount: number(breakdown.shippingReimbursementAmount ?? row.shippingAmount),
      shippingDeduction: number(breakdown.shippingDeductionAmount ?? row.shippingDeductionAmount),
      customerPaidAmount: number(row.customerPaidAmount ?? row.customer_paid_amount),
    },
    earnings: {
      promotionFundedAmount: number(breakdown.platformFundedPromotionAmount ?? breakdown.marketplacePromotionAmount ?? row.promotionFundedAmount),
      commissionAmount: number(row.commission_amount ?? row.commissionAmount),
      commissionGstAmount: number(breakdown.commissionGstAmount ?? row.commissionGstAmount),
      tcsAmount: number(breakdown.gstTcsAmount ?? row.gstTcsAmount),
      tdsAmount: number(breakdown.incomeTaxTdsAmount ?? row.incomeTaxTdsAmount),
      refundAdjustment: number(row.refund_amount ?? row.refundAmount ?? breakdown.refundAdjustment),
      otherAdjustment: number(row.adjustment_amount ?? row.otherAdjustment ?? breakdown.adjustmentAmount),
      sellerEarning: number(row.net_amount ?? row.netAmount),
    },
    recovery: {
      codOwed: number(row.codOwed ?? row.codLiability ?? row.codOutstandingAmount),
      otherBalanceOwed: number(row.otherBalanceOwed),
      recoveryApplied: number(row.recoveryApplied ?? row.codRecoveryApplied ?? row.recoveredAmount),
      remainingBalance: number(row.remainingBalance ?? row.codRemainingAmount),
    },
    payout: {
      status: row.lifecycleStatus || row.releaseStatus || row.status || "pending",
      eligibleAmount: number(row.eligibleAmount ?? row.eligible_amount),
      payableNow: Math.max(number(row.payableNow ?? row.payable_now), 0),
      availableAt: row.eligibleAt || row.eligible_at || row.payout_eligible_at || null,
      reason: row.releaseReason || row.reason || null,
    },
  };
}

module.exports = { buildFinancePresentation };
