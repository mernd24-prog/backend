const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { AppError } = require('../src/shared/errors/app-error');
const { scheduledDealStatus } = require('../src/modules/deal/services/deal-schedule');
const models = require('../src/modules/deal/models/deal.model');
const source = fs.readFileSync(require.resolve('../src/modules/deal/services/deal.service'), 'utf8');
function method(name, next) {
  return vm.runInNewContext(`(class { ${source.slice(source.indexOf(`  async ${name}(`), source.indexOf(`  async ${next}(`))} })`, {
    AppError, ...models, scheduledDealStatus,
    resolveDealVariant: product => product.variants[0],
    variantPrices: () => ({ catalogPrice: 100, sellingPrice: 90 }),
  });
}
test('seller edit policy allows owned draft/rejected and rejects approved stages', async () => {
  const Service = method('assertDealManageable', 'normalizeDealPayload');
  const service = new Service();
  service.assertDealVisible = async () => {};
  service.isAdmin = actor => actor.role === 'admin';
  for (const status of ['draft', 'rejected']) await service.assertDealManageable({status}, {role:'seller'});
  for (const status of ['pending_approval', 'scheduled', 'active', 'paused', 'expired', 'completed', 'cancelled']) {
    await assert.rejects(service.assertDealManageable({status}, {role:'seller'}), /only draft or rejected/);
    await service.assertDealManageable({status}, {role:'admin'});
  }
});
test('editing allocation compares unsold, unreserved units with current stock', async () => {
  const Service = method('normalizeDealPayload', 'listDeals');
  const service = new Service();
  service.isAdmin = () => true;
  service.productRepository = { findById: async () => ({ sellerId:'seller', variants:[{_id:'variant',sku:'SKU',stock:8,reservedStock:2}] }) };
  const payload = { sellerId:'seller', productId:'product', allocatedQuantity:10, startAt:'2026-11-17T00:00:00Z', endAt:'2026-11-18T00:00:00Z', status:'active' };
  const result = await service.normalizeDealPayload(payload, {role:'admin'}, {soldQuantity:2,reservedQuantity:2});
  assert.equal(result.allocatedQuantity, 10);
  await assert.rejects(service.normalizeDealPayload({...payload,allocatedQuantity:11}, {}, {soldQuantity:2,reservedQuantity:2}), /Remaining deal quantity/);
  await assert.rejects(service.normalizeDealPayload({...payload,allocatedQuantity:3}, {}, {soldQuantity:2,reservedQuantity:2}), /below units already sold or reserved/);
});
