const test = require("node:test");
const assert = require("node:assert/strict");

const { ReferralService } = require("../src/modules/referral/services/referral.service");

test("withdrawal reserves wallet funds before creating the payout", async () => {
  const calls = [];
  const repository = {
    getActiveCommissionRule: async () => ({
      minimumWithdrawalCoins: 0,
      withdrawalKycRequired: false,
      withdrawalMethods: ["bank"],
      coinValue: 2,
    }),
    aggregatePayoutTotalsByInfluencer: async () => ({ total: 0, count: 0 }),
    ensureWallet: async () => ({ availableBalance: 500, reservedBalance: 0 }),
    reserveAvailableWalletBalance: async (influencerId, amount) => {
      calls.push(["reserve", influencerId, amount]);
      return { availableBalance: 300, reservedBalance: 200 };
    },
    createPayoutRequest: async (payload) => {
      calls.push(["create", payload.amount]);
      return { _id: "payout-1", ...payload, status: "pending", createdAt: new Date() };
    },
  };
  const service = new ReferralService({ referralRepository: repository });
  service.getMyInfluencerProfileOrThrow = async () => ({ _id: "influencer-1" });
  service.releaseMaturedInfluencerCoins = async () => 0;
  service.getMinimumWithdrawalCoins = async () => 0;

  const payout = await service.createMyWithdrawal({}, {
    amount: 200,
    payoutMethod: "bank",
    bankAccountId: "bank-account-1",
  });
  assert.equal(payout.amount, 200);
  assert.equal(payout.currencyAmount, 400);
  assert.deepEqual(calls, [["reserve", "influencer-1", 200], ["create", 200]]);
});

test("rejecting a payout releases reserved funds", async () => {
  const calls = [];
  const repository = {
    getPayoutRequestById: async () => ({
      _id: "payout-1", influencerId: "influencer-1", amount: 200,
      status: "approved", reservationStatus: "reserved",
    }),
    transitionPayoutReservation: async (...args) => {
      calls.push(["transition", ...args]);
      return { _id: "payout-1" };
    },
    releaseReservedWalletBalance: async (...args) => {
      calls.push(["release", ...args]);
      return { reservedBalance: 0, availableBalance: 500 };
    },
    updatePayoutRequest: async (_id, payload) => payload,
  };
  const service = new ReferralService({ referralRepository: repository });
  const payout = await service.rejectPayout("payout-1", { reason: "Invalid bank details" }, { userId: "admin-1" });
  assert.equal(payout.status, "rejected");
  assert.equal(payout.rejectedBy, "admin-1");
  assert.deepEqual(calls[1], ["release", "influencer-1", 200]);
});

test("manual payout requires a transaction reference and settles reserved funds", async () => {
  const repository = {
    getPayoutRequestById: async () => ({
      _id: "payout-1", influencerId: "influencer-1", amount: 200,
      status: "approved", reservationStatus: "reserved",
    }),
    transitionPayoutReservation: async () => ({ _id: "payout-1" }),
    settleReservedWalletBalance: async () => ({ reservedBalance: 0, paidBalance: 200 }),
    updatePayoutRequest: async (_id, payload) => payload,
  };
  const service = new ReferralService({ referralRepository: repository });
  await assert.rejects(service.markPayoutPaid("payout-1", {}), /transaction reference/i);
  await assert.rejects(
    service.markPayoutPaid("payout-1", { transactionReference: "UTR-123" }),
    /payment proof/i,
  );
  const paid = await service.markPayoutPaid(
    "payout-1",
    { transactionReference: "UTR-123", paymentProofUrl: "https://example.com/proof.pdf" },
    { userId: "admin-1" },
  );
  assert.equal(paid.status, "paid");
  assert.equal(paid.transactionReference, "UTR-123");
  assert.equal(paid.paidBy, "admin-1");
});

test("saved profile payout details are snapshotted on the request", async () => {
  let createdPayload;
  const repository = {
    getActiveCommissionRule: async () => ({
      minimumWithdrawalCoins: 0,
      withdrawalKycRequired: false,
      withdrawalMethods: ["bank", "upi"],
      coinValue: 1,
    }),
    aggregatePayoutTotalsByInfluencer: async () => ({ total: 0, count: 0 }),
    ensureWallet: async () => ({}),
    reserveAvailableWalletBalance: async () => ({ availableBalance: 75, reservedBalance: 25 }),
    createPayoutRequest: async (payload) => {
      createdPayload = payload;
      return { _id: "payout-2", ...payload, status: "pending" };
    },
  };
  const service = new ReferralService({ referralRepository: repository });
  service.getMyInfluencerProfileOrThrow = async () => ({
    _id: "influencer-1",
    metadata: { details: { payout: {
      accountHolderName: "Partner Name",
      bankName: "Example Bank",
      accountNumber: "1234567890",
      ifscCode: "BANK0001234",
    } } },
  });
  service.releaseMaturedInfluencerCoins = async () => 0;

  await service.createMyWithdrawal({}, {
    amount: 25,
    payoutMethod: "bank",
    destinationSource: "saved_profile",
  });

  assert.equal(createdPayload.destinationSnapshot.accountNumber, "1234567890");
  assert.equal(createdPayload.destinationSnapshot.accountNumberLast4, "7890");
  assert.equal(createdPayload.destinationSnapshot.ifscCode, "BANK0001234");
});
