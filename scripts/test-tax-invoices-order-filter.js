const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calls = [];
const context = {
  module: { exports: {} },
  require: name => {
    if (name.includes('postgres-client')) return { postgresPool: { query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: sql.includes('COUNT(*)') ? [{ total: 0 }] : [] };
    } } };
    if (name === 'uuid') return { v4: () => 'unused' };
    throw new Error(name);
  },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/modules/tax/repositories/tax.repository.js'), 'utf8'), context);
(async () => {
  const repository = new context.module.exports.TaxRepository();
  await repository.listInvoices({ orderId: 'order-a', sellerId: 'seller-a', limit: 10, offset: 20 });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.sql, /ti\.order_id = \$1/);
    assert.equal(call.values[0], 'order-a');
    assert.ok(call.values.includes('seller-a'), 'seller scope is preserved');
  }
  assert.deepEqual(Array.from(calls[0].values.slice(-2)), [10, 20]);
  assert.match(calls[0].sql, /o\.order_number AS "orderNumber"/);
  calls.length = 0;
  await repository.listInvoices({ search: 'ORD-261105-6WIWHFFX' });
  for (const call of calls) {
    assert.match(call.sql, /LEFT JOIN orders o ON o\.id = ti\.order_id/);
    assert.match(call.sql, /o\.order_number ILIKE/);
    assert.equal(call.values[0], '%ORD-261105-6WIWHFFX%');
  }
  calls.length = 0;
  await repository.listInvoices();
  for (const call of calls) assert.doesNotMatch(call.sql, /ti\.order_id =/);
  console.log('PASS: order filter applies to invoice rows and totals, preserves seller scope/pagination, and supports unfiltered listing.');
})().catch(error => { console.error(error); process.exitCode = 1; });
