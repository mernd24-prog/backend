const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function lifecycle(overrides = {}) {
  const module = { exports: {} };
  const stub = new Proxy({}, { get: () => class {} });
  const file = path.resolve(__dirname, '../src/modules/seller/services/settlement-lifecycle.service.js');
  vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, {})((name) => overrides[name] || stub, module, module.exports);
  return Object.create(module.exports.SettlementLifecycleService.prototype);
}

test('delivery deadlines preserve minutes, hours, mixed durations and legacy days', () => {
  const service = lifecycle();
  const delivered = '2026-11-19T10:00:00.000Z';
  for (const minutes of [0, 1, 30, 90, 1440, 7 * 1440, 2 * 1440 + 3 * 60 + 15]) {
    const days = service.resolveReturnWindowDays({ returnable: true, returnWindowDays: minutes / 1440 });
    assert.equal(service.addDays(delivered, days).getTime(), Date.parse(delivered) + minutes * 60000);
  }
});

test('non-returnable items have no window and purchased snapshots override fallbacks', () => {
  const service = lifecycle();
  assert.equal(service.resolveReturnWindowDays({ returnable: false, returnWindowDays: 7 }), 0);
  assert.equal(service.resolveReturnWindowDays({ returnable: true, returnWindowDays: 1 / 1440 }, { return_window_days: 7 }, 14), 1 / 1440);
  assert.equal(service.resolveReturnWindowDays({}, { return_window_days: 7 }, 14), 7);
});

test('payout worker processes minute deadlines only after expiry and keeps open returns blocked', async () => {
  const now = Date.now();
  const rows = [
    { id: 'expired', order_id: 'order', payout_status: 'pending', payout_eligible_at: new Date(now - 60000) },
    { id: 'future', order_id: 'order', payout_status: 'pending', payout_eligible_at: new Date(now + 60000) },
    { id: 'return-open', order_id: 'order', payout_status: 'pending', payout_eligible_at: new Date(now - 60000) },
  ];
  const updated = [];
  const knex = (table) => {
    let filters = [];
    let id;
    const query = {
      where(field, operator, value) {
        if (typeof field === 'object') { id = field.id; return query; }
        if (value !== undefined) filters.push((row) => new Date(row[field]) <= value);
        else filters.push((row) => row[field] === operator);
        return query;
      },
      whereNotNull(field) { filters.push((row) => row[field] != null); return query; },
      orderBy() { return query; }, limit() { return query; }, forUpdate() { return query; },
      skipLocked() { return Promise.resolve(rows.filter((row) => filters.every((filter) => filter(row)))); },
      update() { if (table === 'order_items') updated.push(id); return Promise.resolve(1); },
      whereIn() { return query; }, insert() { return Promise.resolve(); },
    };
    return query;
  };
  knex.transaction = async (callback) => callback(knex);
  knex.fn = { now: () => new Date() };
  const service = lifecycle({
    '../../../infrastructure/postgres/postgres-client': { knex },
    uuid: { v4: () => 'history-id' },
    '../../returns/models/return.model': { ReturnModel: { exists: async (filter) => filter.items.$elemMatch.orderItemId === 'return-open' } },
  });
  const results = await service.markEligibleOrderItems();
  assert.deepEqual(updated, ['expired']);
  assert.equal(results.find((row) => row.orderItemId === 'return-open').reason, 'open_return');
  assert.equal(results.some((row) => row.orderItemId === 'future'), false);
});
