const test = require("node:test");
const assert = require("node:assert/strict");

const { ReferralService } = require("../src/modules/referral/services/referral.service");

test("maximum referral pool caps percentage rules and zero disables the cap", () => {
  const service = new ReferralService({ referralRepository: {}, walletService: {} });

  assert.equal(
    service.calculateReferralPool(
      { distributionType: "percentage", referralPoolPercent: 10, maximumReferralPoolAmount: 300 },
      5000,
    ),
    300,
  );
  assert.equal(
    service.calculateReferralPool(
      { distributionType: "percentage", referralPoolPercent: 10, maximumReferralPoolAmount: 0 },
      5000,
    ),
    500,
  );
});

test("checkout resolves an active influencer code into the customer discount share", async () => {
  const repository = {
    listProductConfigsForItems: async () => [],
    getReferralCodeByCode: async () => ({
      _id: "code-1",
      code: "CREATOR10",
      influencerId: "influencer-1",
      userId: "creator-user",
      status: "active",
      usageCount: 0,
    }),
    getInfluencerProfileById: async () => ({
      _id: "influencer-1",
      userId: "creator-user",
      status: "active",
      parentInfluencerId: "parent-1",
    }),
    getActiveCommissionRule: async () => ({
      _id: "rule-1",
      active: true,
      distributionType: "percentage",
      referralPoolPercent: 10,
      maximumReferralPoolAmount: 0,
      customerSharePercent: 50,
      childSharePercent: 30,
      parentSharePercent: 20,
      minOrderAmount: 100,
      coinValue: 1,
    }),
  };
  const service = new ReferralService({ referralRepository: repository, walletService: {} });
  const result = await service.resolveInfluencerCodeForCheckout("creator10", 1000, "buyer-1");

  assert.equal(result.code, "CREATOR10");
  assert.equal(result.referralPoolAmount, 100);
  assert.equal(result.customerDiscountAmount, 50);
  assert.equal(result.influencerId, "influencer-1");
});

test("creating a referred order locks owner and parent coins and increments code usage", async () => {
  const ledgers = [];
  const walletUpdates = [];
  let usageIncrements = 0;
  const repository = {
    getReferralOrderByOrderId: async () => null,
    createReferralOrder: async (payload) => ({ _id: "ref-order-1", ...payload }),
    createCommissionLedger: async (payload) => {
      ledgers.push(payload);
      return { _id: `ledger-${ledgers.length}`, ...payload };
    },
    updateWallet: async (influencerId, update) => walletUpdates.push({ influencerId, update }),
    incrementReferralCodeUsage: async () => { usageIncrements += 1; },
  };
  const service = new ReferralService({ referralRepository: repository, walletService: {} });

  await service.recordInfluencerReferralOrder({
    orderId: "order-1",
    customerId: "buyer-1",
    referralContext: {
      codeId: "code-1",
      code: "CREATOR10",
      influencerId: "influencer-1",
      parentInfluencerId: "parent-1",
      eligibleAmount: 1000,
      referralPoolAmount: 100,
      customerDiscountAmount: 50,
      rule: {
        _id: "rule-1",
        childSharePercent: 30,
        parentSharePercent: 20,
        coinValue: 1,
        releaseDelayDays: 7,
      },
    },
  });

  assert.deepEqual(ledgers.map((entry) => entry.amount), [30, 20]);
  assert.deepEqual(ledgers.map((entry) => entry.commissionType), ["code_owner_base", "direct_parent"]);
  assert.deepEqual(walletUpdates.map((entry) => entry.update.$inc.pendingBalance), [30, 20]);
  assert.equal(usageIncrements, 1);
});
