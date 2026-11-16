const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture(rows = []) {
  const queries = [];
  const module = { exports: {} };
  const knex = table => ({ whereIn: (key, ids) => ({ select: async (...columns) => {
    queries.push({ table, key, ids: Array.from(ids), columns }); return rows;
  } }) });
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(path.resolve(__dirname, '../src/modules/referral/services/referral.service.js'), 'utf8') + '\n})', {})(name => name.endsWith('/postgres-client') ? { knex } : {}, module, module.exports);
  return { api: Object.create(module.exports.ReferralService.prototype), queries };
}
test('order numbers come from commerce orders, retaining order IDs for links', async () => {
  const { api, queries } = fixture([{ id: 'id-a', order_number: 'ORD-123' }]);
  const rows = await api.enrichOrderNumbers([{ orderId: 'id-a', orderNumber: 'old' }, { orderId: 'id-a' }, { orderId: 'missing', metadata: { orderNumber: 'ORD-OLD' } }]);
  assert.equal(rows[0].orderNumber, 'ORD-123');
  assert.equal(rows[0].orderId, 'id-a');
  assert.equal(rows[1].orderNumber, 'ORD-123');
  assert.equal(rows[2].orderNumber, 'ORD-OLD');
  assert.deepEqual(queries[0].ids, ['id-a', 'missing']);
});
test('bonus-only and empty lists do not query commerce orders', async () => {
  const { api, queries } = fixture();
  await api.enrichOrderNumbers([]);
  await api.enrichOrderNumbers([{ orderId: 'bonus:month' }]);
  assert.equal(queries.length, 0);
});
