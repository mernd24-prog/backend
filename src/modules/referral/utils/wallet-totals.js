// Read current earning and withdrawal records without rewriting wallet balances.
const summarizeWalletActivity = (ledgerGroups = [], payoutGroups = []) => {
  const wallets = new Map();
  const walletFor = (id) => {
    if (!wallets.has(id)) wallets.set(id, {
      pendingBalance: 0, earned: 0, ledgerPaid: 0, reservedBalance: 0,
      paidBalance: 0, reversedBalance: 0, expiredBalance: 0,
    });
    return wallets.get(id);
  };
  for (const group of ledgerGroups) {
    const wallet = walletFor(String(group._id.influencerId));
    const amount = Number(group.amount || 0);
    const status = group._id.status;
    if (["pending", "locked"].includes(status)) wallet.pendingBalance += amount;
    if (["available", "payout_requested", "paid"].includes(status)) wallet.earned += amount;
    if (status === "paid") wallet.ledgerPaid += amount;
    if (status === "reversed") wallet.reversedBalance += amount;
    if (status === "expired") wallet.expiredBalance += amount;
  }
  for (const group of payoutGroups) {
    const wallet = walletFor(String(group._id.influencerId));
    const status = group._id.status;
    const amount = Number(group.amount || 0);
    if (["pending", "approved", "processing"].includes(status) && group._id.reservationStatus === "reserved") {
      wallet.reservedBalance += amount;
    }
    if (status === "paid") wallet.paidBalance += amount;
  }
  const totals = { pendingBalance: 0, availableBalance: 0, reservedBalance: 0,
    paidBalance: 0, reversedBalance: 0, expiredBalance: 0 };
  for (const wallet of wallets.values()) {
    // Legacy ledgers can record payment directly, without a payout request.
    const paid = Math.max(wallet.paidBalance, wallet.ledgerPaid);
    totals.pendingBalance += wallet.pendingBalance;
    totals.availableBalance += wallet.earned - wallet.reservedBalance - paid;
    totals.reservedBalance += wallet.reservedBalance;
    totals.paidBalance += paid;
    totals.reversedBalance += wallet.reversedBalance;
    totals.expiredBalance += wallet.expiredBalance;
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(2))]));
};
module.exports = { summarizeWalletActivity };
