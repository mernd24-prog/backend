const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(configs = []) {
  const module = { exports: {} };
  const file = path.resolve(__dirname, '../src/modules/referral/services/referral.service.js');
  vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, {})(() => ({}), module, module.exports);
  const service = Object.create(module.exports.ReferralService.prototype);
  service.referralRepository = { listProductAmountsForItems: async () => configs };
  return service;
}
const config = (productId, amountValue, extra = {}) => ({ productId, amountType: 'fixed', amountValue, active: true, ...extra });
const item = (productId, lineTotal = 500, quantity = 1) => ({ productId, lineTotal, quantity });
const calculate = (service, items, eligible = 2000) => service.calculateReferralPoolWithProductAmounts(items, {}, eligible);

test('adds both product pools instead of selecting the lowest', async () => {
  const service = fixture([config('a', 100), config('b', 60)]);
  assert.equal(await calculate(service, [item('a'), item('b')]), 160);
});
test('single-product pools and quantities retain their existing behavior', async () => {
  const service = fixture([config('a', 100)]);
  assert.equal(await calculate(service, [item('a')]), 100);
  assert.equal(await calculate(service, [item('a', 1500, 3)]), 100);
});
test('duplicates and variants contribute once per product, independent of row order', async () => {
  const service = fixture([config('a', 10, { amountType: 'percentage' }), config('b', 60)]);
  const rows = [item('a', 100), item('a', 300), item('a', 300), item('b')];
  assert.equal(await calculate(service, rows), 90);
  assert.equal(await calculate(service, rows.slice().reverse()), 90);
});
test('percentage pools use unit prices and product caps before summing', async () => {
  const service = fixture([config('a', 10, { amountType: 'percentage', maximumAmount: 40 }), config('b', 60)]);
  assert.equal(await calculate(service, [item('a', 1000, 2), item('b')]), 100);
});
test('product pools cannot exceed unit prices and combined pools respect eligible amount', async () => {
  const service = fixture([config('a', 100), config('b', 60)]);
  assert.equal(await calculate(service, [item('a', 50), item('b')]), 110);
  assert.equal(await calculate(service, [item('a'), item('b')], 120), 120);
  assert.equal(await calculate(service, [item('a'), item('b')], 0), 0);
});
test('inactive, missing and zero-pool products do not reduce eligible pools', async () => {
  const service = fixture([config('a', 100), config('inactive', 60, { active: false }), config('zero', 0)]);
  assert.equal(await calculate(service, [item('a'), item('inactive'), item('zero'), item('missing')]), 100);
  assert.equal(await calculate(service, [item('missing')]), 0);
  assert.equal(await calculate(service, []), 0);
});
test('combined pool rounds to paise', async () => {
  const service = fixture([config('a', 10.12), config('b', 20.23)]);
  assert.equal(await calculate(service, [item('a'), item('b')]), 30.35);
});
test('checkout customer discount and partner allocations use the combined product pool', async () => {
  const service = fixture([config('a', 100), config('b', 60)]);
  service.referralRepository.getReferralCodeByCode = async () => ({ id: 'code', code: 'REF123', status: 'active', influencerId: 'partner' });
  service.referralRepository.getActiveCommissionRule = async () => ({ customerSharePercent: 50, childSharePercent: 30, parentSharePercent: 20 });
  service.getInfluencerOrThrow = async () => ({ id: 'partner', status: 'active', parentInfluencerId: 'parent' });
  service.assertVerificationApproved = () => {};
  const context = await service.resolveInfluencerCodeForCheckout('REF123', 1000, 'buyer', [item('a'), item('b')]);
  assert.equal(context.referralPoolAmount, 160);
  assert.equal(context.customerDiscountAmount, 80);
  assert.equal(context.codeOwnerAmount, 48);
  assert.equal(context.parentAmount, 32);
});
