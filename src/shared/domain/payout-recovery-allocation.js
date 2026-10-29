"use strict";

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const allocatePayoutRecoveries = (availableAmount, recoveries = []) => {
  const available = Math.max(roundMoney(availableAmount), 0);
  let remainingAvailable = available;
  const applications = [];

  const orderedRecoveries = [...recoveries].sort((left, right) => {
    const leftTime = new Date(left.created_at || left.createdAt || 0).getTime();
    const rightTime = new Date(right.created_at || right.createdAt || 0).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  for (const recovery of orderedRecoveries) {
    if (remainingAvailable <= 0) break;
    const recoveryAmount = roundMoney(recovery.net_amount ?? recovery.amount);
    if (recoveryAmount >= 0) continue;
    const outstandingAmount = Math.abs(recoveryAmount);
    const appliedAmount = roundMoney(Math.min(outstandingAmount, remainingAvailable));
    applications.push({
      recovery,
      appliedAmount,
      remainingAmount: roundMoney(outstandingAmount - appliedAmount),
    });
    remainingAvailable = roundMoney(remainingAvailable - appliedAmount);
  }

  const appliedAmount = roundMoney(applications.reduce((sum, item) => sum + item.appliedAmount, 0));
  return {
    availableAmount: available,
    appliedAmount,
    payableAmount: roundMoney(available - appliedAmount),
    applications,
  };
};

module.exports = { allocatePayoutRecoveries };
