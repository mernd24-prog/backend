"use strict";

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

function recoverySnapshot({ metadata = {}, netAmount = 0, fallbackOriginal = 0 } = {}) {
  const originalLiabilityAmount = Math.abs(roundMoney(
    metadata.originalLiabilityAmount ?? fallbackOriginal ?? Math.abs(Number(netAmount || 0)),
  ));
  const remainingAmount = clamp(
    Math.abs(roundMoney(metadata.remainingAmount ?? Math.abs(Number(netAmount || 0)))),
    0,
    originalLiabilityAmount,
  );
  const recoveredAmount = clamp(
    roundMoney(metadata.recoveredAmount ?? (originalLiabilityAmount - remainingAmount)),
    0,
    originalLiabilityAmount,
  );
  const reservedAmount = clamp(
    roundMoney(metadata.reservedRecoveryAmount || 0),
    0,
    Math.max(originalLiabilityAmount - recoveredAmount, 0),
  );
  return {
    originalLiabilityAmount,
    recoveredAmount,
    reservedAmount,
    remainingAmount,
    recoveryStatus: reservedAmount > 0
      ? "recovery_in_process"
      : remainingAmount <= 0
      ? "recovered"
      : recoveredAmount > 0
        ? "partially_recovered"
        : "pending",
  };
}

function restoreRecoveryAllocation({ remainingAmount = 0, recoveredAmount = 0, reservedAmount = 0, appliedAmount = 0 } = {}) {
  const applied = Math.max(roundMoney(appliedAmount), 0);
  return {
    remainingAmount: roundMoney(Math.max(Number(remainingAmount || 0), 0) + applied),
    recoveredAmount: roundMoney(Math.max(Number(recoveredAmount || 0), 0)),
    reservedAmount: roundMoney(Math.max(Number(reservedAmount || 0) - applied, 0)),
  };
}

function resolveCollectionAmount({ calculatedAmount, paymentAmount, allocatedAmount, isFinalCollection } = {}) {
  if (!isFinalCollection) return Math.max(roundMoney(calculatedAmount), 0);
  return Math.max(roundMoney(Number(paymentAmount || 0) - Number(allocatedAmount || 0)), 0);
}

module.exports = { recoverySnapshot, restoreRecoveryAllocation, resolveCollectionAmount, roundMoney };
