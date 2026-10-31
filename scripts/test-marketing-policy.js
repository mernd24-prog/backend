const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeMarketing,
  evaluateMarketing,
} = require("../src/modules/marketing/services/marketing-policy");
const usage = (overrides = {}) => ({
  previousOrders: 0,
  customerUses: 0,
  codeUses: 0,
  monthlyUses: 0,
  customerDiscount: 0,
  monthlyDiscount: 0,
  campaignCost: 0,
  partnerCommissions: {},
  ...overrides,
});
const policy = (overrides = {}) =>
  normalizeMarketing({ enabled: true, ...overrides });
const referral = () => ({
  discountAmount: 100,
  appliedCouponCode: "PARTNER",
  referralContext: {
    referralPoolAmount: 200,
    customerDiscountAmount: 100,
    codeOwnerAmount: 60,
    parentAmount: 40,
    influencerId: "child",
    parentInfluencerId: "parent",
  },
});
const apply = (p, discount = referral(), u = usage(), extra = {}) =>
  evaluateMarketing(policy(p), discount, u, { subtotalAmount: 2000, ...extra });

test("validates settings, dates, counts and preserves safe defaults", () => {
  assert.equal(normalizeMarketing().enabled, false);
  for (const value of [-1, Infinity, NaN, "bad"])
    assert.throws(() => policy({ campaignBudget: value }));
  assert.throws(() => policy({ usesPerCustomer: 1.5 }));
  assert.throws(() => policy({ startsAt: "2026-10-31", endsAt: "2026-10-01" }));
  assert.throws(() => policy({ campaignKey: "bad key" }));
  assert.throws(() => policy({ allowWallet: "false" }));
});
test("customer cap proportionally reduces customer and both partner shares", () => {
  const d = apply(
    { customerDiscountBudget: 120 },
    referral(),
    usage({ customerDiscount: 90 }),
  );
  assert.equal(d.discountAmount, 30);
  assert.equal(d.referralContext.referralPoolAmount, 60);
  assert.equal(d.referralContext.codeOwnerAmount, 18);
  assert.equal(d.referralContext.parentAmount, 12);
});
test("splitting orders or changing code cannot exceed cumulative customer allowance", () => {
  const p = { customerDiscountBudget: 150 };
  const first = apply(p);
  const second = apply(
    p,
    { ...referral(), appliedCouponCode: "OTHER" },
    usage({ customerDiscount: first.discountAmount }),
  );
  assert.equal(first.discountAmount + second.discountAmount, 150);
  assert.throws(
    () => apply(p, referral(), usage({ customerDiscount: 150 })),
    /limit reached/,
  );
});
test("campaign budget includes all actual allocations and reserves remaining amount", () => {
  const d = apply(
    { campaignBudget: 250 },
    referral(),
    usage({ campaignCost: 200 }),
  );
  assert.equal(d.marketing.cost, 50);
  assert.equal(d.discountAmount, 25);
});
test("unallocated parent share is not charged to campaign budget", () => {
  const d = referral();
  d.referralContext.parentInfluencerId = null;
  assert.equal(apply({}, d).marketing.cost, 160);
});
test("partner cap covers each recipient across all codes", () => {
  const d = apply(
    { partnerCommissionBudget: 100 },
    referral(),
    usage({ partnerCommissions: { parent: 90 } }),
  );
  assert.equal(d.referralContext.parentAmount, 10);
  assert.equal(d.referralContext.codeOwnerAmount, 15);
});
test("order-level pool, discount and monthly customer caps combine", () => {
  const d = apply(
    {
      maxReferralPoolPerOrder: 150,
      maxDiscountPerOrder: 60,
      monthlyCustomerDiscountBudget: 80,
    },
    referral(),
    usage({ monthlyDiscount: 40 }),
  );
  assert.equal(d.discountAmount, 40);
  assert.equal(d.referralContext.referralPoolAmount, 80);
});
test("campaign, per-code and monthly usage limits reject further orders", () => {
  for (const [setting, used] of [
    ["usesPerCustomer", "customerUses"],
    ["usesPerCustomerPerCode", "codeUses"],
    ["monthlyUsesPerCustomer", "monthlyUses"],
  ]) {
    assert.throws(
      () => apply({ [setting]: 2 }, referral(), usage({ [used]: 2 })),
      /limit/,
    );
  }
});
test("eligibility rejects past campaigns, repeat buyers, deal stacking and small orders", () => {
  assert.throws(() => apply({ endsAt: "2020-01-01" }), /not active/);
  assert.throws(() => apply({ startsAt: "2099-01-01" }), /not active/);
  assert.throws(
    () =>
      apply({ firstOrderOnly: true }, referral(), usage({ previousOrders: 1 })),
    /first order/,
  );
  assert.throws(
    () =>
      apply({ allowDeals: false }, referral(), usage(), {
        items: [{ dealId: "deal" }],
      }),
    /deal products/,
  );
  assert.throws(() => apply({ minOrderAmount: 3000 }), /minimum/);
});
test("regular coupons share campaign/customer limits without allocating commissions", () => {
  const d = apply(
    { campaignBudget: 100, maxDiscountPerOrder: 50 },
    { discountAmount: 200 },
    usage({ campaignCost: 70 }),
  );
  assert.equal(d.discountAmount, 30);
  assert.equal(d.marketing.cost, 30);
  assert.deepEqual(d.marketing.commissions, []);
});
test("cent rounding never overspends a campaign or partner cap", () => {
  for (let cents = 1; cents < 2000; cents++) {
    const d = apply({ campaignBudget: cents / 100 });
    assert.ok(d.marketing.cost <= cents / 100);
    const p = apply({ partnerCommissionBudget: cents / 100 });
    assert.ok(p.referralContext.codeOwnerAmount <= cents / 100);
    assert.ok(p.referralContext.parentAmount <= cents / 100);
  }
});

// Exercise real service methods with infrastructure replaced, without connecting to databases.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function loadService(relativePath, mocks = {}) {
  const file = path.resolve(__dirname, relativePath);
  const exports = {};
  const context = {
    module: { exports },
    exports,
    console,
    Buffer,
    setTimeout,
    require: (name) => {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
      if (name.includes("app-error"))
        return require("../src/shared/errors/app-error");
      if (name.includes("marketing-policy"))
        return require("../src/modules/marketing/services/marketing-policy");
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, {
    filename: file,
  });
  return context.module.exports;
}
test("referral pool is applied once despite quantities, duplicate rows or legacy cap settings", async () => {
  const { ReferralService } = loadService(
    "../src/modules/referral/services/referral.service.js",
  );
  const service = Object.create(ReferralService.prototype);
  service.referralRepository = {
    listProductAmountsForItems: async () => [
      {
        productId: "p",
        amountType: "fixed_amount",
        amountValue: 100,
        maximumAmount: 200,
      },
    ],
  };
  const items = [
    { productId: "p", quantity: 2, lineTotal: 1000 },
    { productId: "p", quantity: 2, lineTotal: 1000 },
  ];
  assert.equal(
    await service.calculateReferralPoolWithProductAmounts(items, {}, 2000),
    100,
  );
  assert.equal(
    await service.calculateReferralPoolWithProductAmounts(
      items,
      {},
      2000,
      policy({ productCapMode: "per_item" }),
    ),
    100,
  );
  assert.equal(
    await service.calculateReferralPoolWithProductAmounts(
      [{ productId: "other", quantity: 4, lineTotal: 2000 }],
      {},
      2000,
    ),
    0,
  );
});
test("pricing skips disabled/out-of-scope policy and fails closed on unavailable usage", async () => {
  const { PricingService } = loadService(
    "../src/modules/pricing/services/pricing.service.js",
  );
  const service = Object.create(PricingService.prototype);
  let calls = 0;
  service.pricingRepository = {
    getMarketingUsage: async () => {
      calls++;
      throw new Error("database unavailable");
    },
  };
  const d = { ...referral(), discountSource: "influencer" };
  await service.applyMarketingPolicy(d, normalizeMarketing(), { userId: "u" });
  await service.applyMarketingPolicy(d, policy({ scope: "coupons" }), {
    userId: "u",
  });
  assert.equal(calls, 0);
  await assert.rejects(
    () => service.applyMarketingPolicy(d, policy(), { userId: "u" }),
    /database unavailable/,
  );
});
test("checkout requests a common budget lock for different promotional codes", async () => {
  const { OrderService } = loadService(
    "../src/modules/order/services/order.service.js",
  );
  const service = Object.create(OrderService.prototype);
  let previous = Promise.resolve();
  let active = 0;
  let peak = 0;
  const captured = [];
  service.orderRepository = {
    withCheckoutLocks: (keys, callback) => {
      captured.push(keys);
      const next = previous.then(callback);
      previous = next.catch(() => {});
      return next;
    },
  };
  service.createOrderLocked = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  };
  await Promise.all(
    ["A", "B"].map((couponCode) =>
      service.createOrder({ couponCode }, { userId: "u" }),
    ),
  );
  assert.equal(peak, 1);
  assert.ok(
    captured.every(
      (keys) =>
        keys.includes("marketing:global") && keys.includes("customer:u"),
    ),
  );
});

test("returning customer offers reject new buyers and accept repeat buyers", () => {
  assert.throws(
    () => apply({ customerEligibility: "returning" }),
    /returning customers/,
  );
  assert.equal(
    apply(
      { customerEligibility: "returning" },
      referral(),
      usage({ previousOrders: 1 }),
    ).discountAmount,
    100,
  );
});

test('coupon and referral policies save independently and preserve legacy settings', () => {
  const { CommerceSettingsService } = loadService('../src/modules/admin/services/commerce-settings.service.js', {
    '../../../config/env': { env: { commerce: { maxWalletUsagePerOrderPercent: 30 } } },
  });
  const service = new CommerceSettingsService();
  const legacy = service.normalize({ marketing: policy({ campaignBudget: 500 }) });
  assert.equal(legacy.marketing.scope, 'coupons');
  assert.equal(legacy.referralMarketing.scope, 'referrals');
  assert.equal(legacy.referralMarketing.campaignBudget, 500);
  const coupons = service.mergeSettings(legacy, { marketing: policy({ scope: 'coupons', campaignBudget: 100 }) });
  assert.equal(coupons.marketing.campaignBudget, 100);
  assert.equal(coupons.referralMarketing.campaignBudget, 500);
  const referrals = service.mergeSettings(coupons, { referralMarketing: policy({ scope: 'referrals', campaignBudget: 900 }) });
  assert.equal(referrals.marketing.campaignBudget, 100);
  assert.equal(referrals.referralMarketing.campaignBudget, 900);
});

test('legacy single-scope policies do not enable the other promotion type', () => {
  const { CommerceSettingsService } = loadService('../src/modules/admin/services/commerce-settings.service.js', {
    '../../../config/env': { env: { commerce: { maxWalletUsagePerOrderPercent: 30 } } },
  });
  const service = new CommerceSettingsService();
  const coupons = service.normalize({ marketing: policy({ scope: 'coupons' }) });
  assert.equal(coupons.referralMarketing.enabled, false);
  const referrals = service.normalize({ marketing: policy({ scope: 'referrals' }) });
  assert.equal(referrals.marketing.enabled, false);
  assert.equal(referrals.referralMarketing.enabled, true);
});

test('shared admin component renders coupon-only and referral-specific controls', () => {
  const adminModules = path.resolve(__dirname, '../../Admin/node_modules');
  const React = require(path.join(adminModules, 'react'));
  const { renderToStaticMarkup } = require(path.join(adminModules, 'react-dom/server'));
  const babel = require(path.join(adminModules, '@babel/core'));
  const file = path.resolve(__dirname, '../../Admin/src/components/Marketing/MarketingSettings.jsx');
  const transformed = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, configFile: false, babelrc: false,
    presets: [require(path.join(adminModules, '@babel/preset-react'))],
    plugins: [require(path.join(adminModules, '@babel/plugin-transform-modules-commonjs'))],
  }).code;
  const context = { module: { exports: {} }, exports: {}, require: name => {
    if (name === 'react') return React;
    if (name.includes('PermissionGuard')) return { __esModule: true, default: ({ children }) => children };
    if (name.includes('usePermission')) return { ACTIONS: { UPDATE: 'update' } };
    if (name.includes('endpoints')) return { ENDPOINTS: { commerceSettings: { detail: '/admin/commerce-settings' } } };
    return {};
  }};
  context.exports = context.module.exports;
  vm.runInNewContext(transformed, context, { filename: file });
  const Component = context.module.exports.default;
  const couponHtml = renderToStaticMarkup(React.createElement(Component, { kind: 'coupons' }));
  const referralHtml = renderToStaticMarkup(React.createElement(Component, { kind: 'referrals' }));
  assert.match(couponHtml, /Coupon Marketing Settings/);
  assert.match(couponHtml, /Minimum order subtotal/);
  assert.doesNotMatch(couponHtml, /Maximum referral pool per order|Commission limit per partner|Product maximum pool applies per/);
  assert.match(referralHtml, /Referral Marketing Settings/);
  assert.match(referralHtml, /Maximum referral pool per order/);
  assert.match(referralHtml, /Commission limit per partner/);
});

 test("lowest positive eligible product pool wins across mixed carts", async () => {
  const { ReferralService } = loadService("../src/modules/referral/services/referral.service.js");
  const service = Object.create(ReferralService.prototype);
  service.referralRepository = { listProductAmountsForItems: async () => [
    { productId: "a", amountType: "fixed_amount", amountValue: 100 },
    { productId: "c", amountType: "fixed_amount", amountValue: 60 },
    { productId: "zero", amountType: "fixed_amount", amountValue: 0 },
    { productId: "pct", amountType: "percentage", amountValue: 10 },
    { productId: "capped", amountType: "fixed_amount", amountValue: 100, maximumAmount: 40 },
  ] };
  const item = (productId, quantity = 1) => ({ productId, quantity, lineTotal: quantity * 500 });
  const calc = items => service.calculateReferralPoolWithProductAmounts(items, {}, items.reduce((sum, i) => sum + i.lineTotal, 0));
  assert.equal(await calc([item("a"), item("c")]), 60);
  assert.equal(await calc([item("a", 10), item("c", 5)]), 60);
  assert.equal(await calc([item("a", 10), item("b", 5), item("zero")]), 100);
  assert.equal(await calc([item("b"), item("zero")]), 0);
  assert.equal(await calc([item("pct", 1)]), 50);
  assert.equal(await calc([item("pct", 10)]), 50);
  assert.equal(await calc([item("a"), item("capped", 10)]), 40);
  assert.equal(await calc([]), 0);
});

test("minimum order amount uses the whole cart subtotal, not the referral pool", () => {
  const items = [{ productId: "a", lineTotal: 500 }, { productId: "b", lineTotal: 800 }];
  const discount = referral();
  discount.discountAmount = 50;
  discount.referralContext.referralPoolAmount = 100;
  discount.referralContext.customerDiscountAmount = 50;
  discount.referralContext.codeOwnerAmount = 30;
  discount.referralContext.parentAmount = 20;
  assert.equal(apply({ minOrderAmount: 1000 }, discount, usage(), { subtotalAmount: 1300, items }).discountAmount, 50);
  assert.throws(() => apply({ minOrderAmount: 1400 }, referral(), usage(), { subtotalAmount: 1300, items }), /minimum/);
});

test("backend accepts zero, blank and null for every optional marketing limit", () => {
  const { NUMERIC_FIELDS } = require("../src/modules/marketing/services/marketing-policy");
  for (const value of [0, "0", "", null]) {
    const input = Object.fromEntries(NUMERIC_FIELDS.map(key => [key, value]));
    const normalized = normalizeMarketing(input);
    for (const key of NUMERIC_FIELDS) assert.equal(normalized[key], 0, key);
    const { CommerceSettingsService } = loadService("../src/modules/admin/services/commerce-settings.service.js", {
      "../../../config/env": { env: { commerce: { maxWalletUsagePerOrderPercent: 30 } } },
    });
    const service = new CommerceSettingsService();
    const settings = service.mergeSettings(service.normalize({}), { referralMarketing: normalized });
    for (const key of NUMERIC_FIELDS) assert.equal(settings.referralMarketing[key], 0, key);
  }
});

test("referral shares follow code owner and optional parent roles for either account type", async () => {
  const { ReferralService } = loadService("../src/modules/referral/services/referral.service.js");
  for (const influencerType of ["parent", "child"]) {
    for (const parentInfluencerId of [null, "parent-id"]) {
      const service = Object.create(ReferralService.prototype);
      service.normalizeCode = value => value;
      service.getRecordId = value => value.id;
      service.toPlainObject = value => value;
      service.assertVerificationApproved = () => {};
      service.getInfluencerOrThrow = async () => ({ id: "owner", influencerType, parentInfluencerId, status: "active" });
      service.referralRepository = {
        getReferralCodeByCode: async () => ({ id: "code", code: "REF", status: "active", influencerId: "owner" }),
        getActiveCommissionRule: async () => ({ customerSharePercent: 50, childSharePercent: 30, parentSharePercent: 20 }),
      };
      service.calculateReferralPoolWithProductAmounts = async () => 100;
      const result = await service.resolveInfluencerCodeForCheckout("REF", 500, "customer", []);
      assert.equal(result.customerDiscountAmount, 50);
      assert.equal(result.codeOwnerAmount, 30);
      assert.equal(result.codeOwnerSharePercent, 30);
      assert.equal(result.parentAmount, parentInfluencerId ? 20 : 0);
    }
  }
});

function approvedPartnerFixture() {
  const { ReferralService } = loadService("../src/modules/referral/services/referral.service.js");
  const service = Object.create(ReferralService.prototype);
  const profile = {
    id: "partner", accountId: "account", status: "active", influencerType: "child",
    kycStatus: "verified", payoutProfileStatus: "verified", onboardingStatus: "approved",
    metadata: { details: {
      dateOfBirth: "1990-01-01", gender: "male", address: { city: "Indore" },
      documents: { panCardUrl: "pan", aadhaarCardUrl: "aadhaar", cancelledChequeUrl: "cheque" },
      payout: { method: "bank", accountHolderName: "Partner", bankName: "Bank", accountNumber: "1234", ifscCode: "ABCD0000001" },
    } },
  };
  const account = { id: "account", phone: "9876543210", profile: { firstName: "First", lastName: "Last", avatarUrl: "old-photo" } };
  const code = { id: "code", influencerId: "partner", code: "REFTEST", status: "active" };
  service.getMyInfluencerProfileOrThrow = async () => profile;
  service.getMyInfluencerProfile = async () => ({ profile, account, code });
  service.getInfluencerOrThrow = async () => profile;
  service.enrichInfluencer = async value => value;
  service.normalizeCode = value => value;
  service.referralRepository = {
    getInfluencerAccountById: async () => account,
    updateInfluencerAccount: async (id, update) => { Object.assign(account, update.$set || {}); return account; },
    updateInfluencerProfile: async (id, update) => {
      for (const [key, value] of Object.entries(update)) {
        if (key.startsWith("metadata.")) profile.metadata[key.slice(9)] = value;
        else profile[key] = value;
      }
      return profile;
    },
    updateReferralCodesByInfluencer: async (id, update) => Object.assign(code, update),
    getReferralCodeByCode: async () => code,
    getActiveCommissionRule: async () => ({ customerSharePercent: 50, childSharePercent: 30, parentSharePercent: 20 }),
  };
  service.calculateReferralPoolWithProductAmounts = async () => 100;
  return { service, profile, account, code };
}

test("name and photo-only edits keep verified partner codes redeemable", async () => {
  const { service, profile, account, code } = approvedPartnerFixture();
  await service.updateMyInfluencerProfile({ userId: "account" }, { firstName: "New", lastName: "Name", avatarUrl: "new-photo" });
  assert.equal(account.profile.firstName, "New");
  assert.equal(account.profile.avatarUrl, "new-photo");
  assert.equal(profile.kycStatus, "verified");
  assert.equal(profile.payoutProfileStatus, "verified");
  assert.equal(code.status, "active");
  assert.equal((await service.resolveInfluencerCodeForCheckout("REFTEST", 500, "customer", [])).customerDiscountAmount, 50);
});

test("sensitive profile edits require approval and prevent checkout redemption", async () => {
  for (const payload of [
    { documents: { panCardUrl: "new-pan" } },
    { payout: { accountNumber: "5678" } },
    { payout: { method: "upi", accountHolderName: "Partner", upiId: "partner@bank" } },
    { phone: "9999999999" },
    { dateOfBirth: "1991-01-01" },
    { gender: "other" },
    { address: { city: "Delhi" } },
  ]) {
    const { service, profile, code } = approvedPartnerFixture();
    await service.updateMyInfluencerProfile({ userId: "account" }, payload);
    assert.equal(profile.status, "pending");
    assert.equal(profile.onboardingStatus, "pending_admin_approval");
    assert.equal(code.status, "suspended");
    assert.equal(payload.payout ? profile.payoutProfileStatus : profile.kycStatus, "submitted");
    await assert.rejects(() => service.resolveInfluencerCodeForCheckout("REFTEST", 500, "customer", []), /suspended/);
    // Even if the code status is stale, the profile verification check blocks it.
    code.status = "active";
    await assert.rejects(() => service.resolveInfluencerCodeForCheckout("REFTEST", 500, "customer", []), /must be approved/);
  }
});

test("unchanged full-form resubmission does not revoke verification", async () => {
  const { service, profile, account, code } = approvedPartnerFixture();
  await service.updateMyInfluencerProfile({ userId: "account" }, {
    ...profile.metadata.details, ...account.profile, phone: account.phone,
    dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
  });
  assert.equal(profile.kycStatus, "verified");
  assert.equal(profile.payoutProfileStatus, "verified");
  assert.equal(code.status, "active");
});

test("both changed verification sections must be approved before codes resume", async () => {
  const { service, profile, code } = approvedPartnerFixture();
  await service.updateMyInfluencerProfile({ userId: "account" }, { documents: { panCardUrl: "new-pan" }, payout: { accountNumber: "5678" } });
  await service.reviewInfluencerVerification("partner", { section: "kyc", decision: "verified" }, { userId: "admin" });
  assert.equal(code.status, "suspended");
  assert.equal(profile.payoutProfileStatus, "submitted");
  await service.reviewInfluencerVerification("partner", { section: "bank", decision: "verified" }, { userId: "admin" });
  assert.equal(code.status, "active");
  assert.equal(profile.status, "active");
  assert.equal((await service.resolveInfluencerCodeForCheckout("REFTEST", 500, "customer", [])).customerDiscountAmount, 50);
});

test("rejection or incomplete documents keep codes unavailable", async () => {
  const { service, profile, code } = approvedPartnerFixture();
  await service.updateMyInfluencerProfile({ userId: "account" }, { payout: { accountNumber: "5678" } });
  await service.reviewInfluencerVerification("partner", { section: "bank", decision: "rejected", reason: "Account mismatch" }, { userId: "admin" });
  assert.equal(profile.payoutProfileStatus, "rejected");
  assert.equal(code.status, "suspended");
  await service.updateMyInfluencerProfile({ userId: "account" }, { documents: { panCardUrl: "" } });
  assert.equal(profile.kycStatus, "not_submitted");
  assert.equal(profile.onboardingStatus, "pending_kyc");
  await assert.rejects(() => service.resolveInfluencerCodeForCheckout("REFTEST", 500, "customer", []), /suspended/);
});
