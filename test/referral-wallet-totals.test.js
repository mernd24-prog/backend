const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeWalletActivity } = require('../src/modules/referral/utils/wallet-totals');
const ledger = (status, amount, influencerId = 'a') => ({ _id: { influencerId, status }, amount });
const payout = (status, amount, reservationStatus = 'reserved', influencerId = 'a') => ({ _id: { influencerId, status, reservationStatus }, amount });
test('current ledger states and payouts partition coins without double counting withdrawals', () => {
  assert.deepEqual(summarizeWalletActivity([
    ledger('pending', 50), ledger('locked', 25), ledger('available', 200),
    ledger('reversed', 60), ledger('expired', 5),
  ], [payout('pending', 15), payout('paid', 40, 'settled'), payout('rejected', 10, 'released')]), {
    pendingBalance: 75, availableBalance: 145, reservedBalance: 15,
    paidBalance: 40, reversedBalance: 60, expiredBalance: 5,
  });
});
test('releasing, reserving, paying and reversing earnings use current records', () => {
  assert.equal(summarizeWalletActivity([ledger('available', 100)], []).availableBalance, 100);
  assert.equal(summarizeWalletActivity([ledger('available', 100)], [payout('approved', 30)]).availableBalance, 70);
  const paid = summarizeWalletActivity([ledger('available', 100)], [payout('paid', 30, 'settled')]);
  assert.equal(paid.availableBalance, 70);
  assert.equal(paid.reservedBalance, 0);
  const reversed = summarizeWalletActivity([ledger('reversed', 100)], [payout('paid', 30, 'settled')]);
  assert.equal(reversed.availableBalance, -30);
  assert.equal(reversed.reversedBalance, 100);
});
test('legacy paid ledger and current paid requests are counted once per partner', () => {
  const totals = summarizeWalletActivity([
    ledger('paid', 20), ledger('available', 50), ledger('paid', 10, 'b'),
  ], [payout('paid', 20, 'settled')]);
  assert.equal(totals.paidBalance, 30);
  assert.equal(totals.availableBalance, 50);
});
test('empty activity returns zero balances', () => {
  assert.ok(Object.values(summarizeWalletActivity()).every(value => value === 0));
});
