const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { payoutEarningsBreakdown } = require('../src/shared/domain/payout-earnings-breakdown');

const serviceSource = fs.readFileSync(path.join(__dirname, '../src/modules/seller/services/commission.service.js'), 'utf8');
const dealSource = fs.readFileSync(path.join(__dirname, '../src/modules/deal/services/deal.service.js'), 'utf8');
class AppError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
function methodClass(source, name, nextName, context = {}) {
  const method = source.slice(source.indexOf(`  async ${name}(`), source.indexOf(`  async ${nextName}(`));
  return vm.runInNewContext(`(class { ${method} })`, { AppError, ...context });
}

test('deal and regular earnings use the actual commission net after refunds and taxes', () => {
  const result = payoutEarningsBreakdown([
    { id: 'c1', order_item_id: 'i1', net_amount: '84.51' },
    { id: 'c2', order_item_id: 'i2', net_amount: '10.09' },
    { id: 'c3', order_item_id: 'i3', net_amount: '37.21' },
  ], [
    { id: 'i1', deal_id: 'd1', deal_snapshot: { title: 'Flash sale' } },
    { id: 'i2', deal_snapshot: JSON.stringify({ dealId: 'd1', title: 'Flash sale' }) },
    { id: 'i3', deal_snapshot: {} },
  ]);
  assert.deepEqual(result, {
    regularNetAmount: 37.21, dealNetAmount: 94.6, totalNetAmount: 131.81,
    deals: [{ dealId: 'd1', title: 'Flash sale', itemCount: 2, netAmount: 94.6 }],
  });
});

test('empty and regular-only payouts do not invent deal earnings', () => {
  assert.equal(payoutEarningsBreakdown().totalNetAmount, 0);
  const result = payoutEarningsBreakdown([{ net_amount: 5.15 }]);
  assert.equal(result.regularNetAmount, 5.15);
  assert.deepEqual(result.deals, []);
});

test('each deal retains its own earnings and returns do not increase earnings', () => {
  const result = payoutEarningsBreakdown([
    { order_item_id: 'a', net_amount: 0 },
    { order_item_id: 'b', net_amount: 50.03 },
    { order_item_id: 'c', net_amount: -10.01 },
  ], [
    { id: 'a', deal_id: 'deal-a' },
    { id: 'b', deal_id: 'deal-b' },
  ]);
  assert.equal(result.deals.length, 2);
  assert.equal(result.dealNetAmount, 50.03);
  assert.equal(result.totalNetAmount, 40.02);
});

test('retired deal actions cannot reach the independent payout repository', async () => {
  for (const [name, next, args] of [
    ['generatePayout', 'processPayout', [{}, {}]],
    ['processPayout', 'findActiveDealForItem', ['legacy-id', {}, {}]],
  ]) {
    const Service = methodClass(dealSource, name, next);
    const service = new Service();
    service.isAdmin = () => true;
    service.dealRepository = new Proxy({}, { get() { throw new Error('Repository must not be called'); } });
    await assert.rejects(service[name](...args), error => error.status === 410);
    service.isAdmin = () => false;
    await assert.rejects(service[name](...args), error => error.status === 403);
  }
});

test('historical paid deal earnings are blocked; unpaid and unrelated earnings pass', async () => {
  const knex = require('knex')({ client: 'pg' });
  const Service = methodClass(serviceSource, 'assertNoLegacyDealPayments', 'assertPayoutHasNoLegacyDealPayments');
  const service = new Service();
  for (const found of [null, { id: 'commission-1' }]) {
    let sql;
    const client = table => {
      const builder = knex(table);
      builder.then = (resolve, reject) => {
        sql = builder.toSQL();
        return Promise.resolve(found).then(resolve, reject);
      };
      return builder;
    };
    const check = service.assertNoLegacyDealPayments([{ id: 'commission-1' }], client);
    if (found) await assert.rejects(check, error => error.status === 409);
    else await check;
    assert.match(sql.sql, /"dp"\."status" = \?/);
    assert.match(sql.sql, /ds.order_id = sc.order_id AND ds.seller_id = sc.seller_id/);
    assert.match(sql.sql, /ds.order_item_id = sc.order_item_id/);
    assert.match(sql.sql, /"sc"\."order_item_id" is null/);
    assert.ok(sql.bindings.includes('paid'));
  }
  await service.assertNoLegacyDealPayments([], () => { throw new Error('Empty candidates must not query'); });
  await knex.destroy();
});

test('legacy-payment checks run before wallet credits and bank transfers; completed payouts remain idempotent', async () => {
  for (const [name, next] of [
    ['initiateRazorpayXPayout', 'handleRazorpayXPayoutWebhook'],
    ['completeSellerWalletPayout', 'startPayoutTransfer'],
  ]) {
    for (const status of ['processing', 'completed']) {
      const payout = { id: 'payout-1', status };
      const knex = () => ({ where() { return this; }, async first() { return payout; } });
      const Service = methodClass(serviceSource, name, next, { knex });
      const service = new Service();
      let checks = 0;
      service.assertPayoutHasNoLegacyDealPayments = async () => {
        checks += 1;
        throw new AppError('Previously paid through deals', 409);
      };
      service.walletService = { credit() { throw new Error('Must not credit wallet'); } };
      if (status === 'completed') {
        assert.equal(await service[name]('payout-1'), payout);
        assert.equal(checks, 0);
      } else {
        await assert.rejects(service[name]('payout-1'), error => error.status === 409);
        assert.equal(checks, 1);
      }
    }
  }
});
