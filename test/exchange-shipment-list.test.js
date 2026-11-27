const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const makeKnex = require('knex');

test('one exchange booking is filtered before counting and paginating, retaining seller scope', async () => {
  const sql = [];
  const knex = makeKnex({ client: 'pg' });
  knex.client.runner = builder => ({ run: async () => {
    const query = builder.toSQL(); sql.push(query);
    return query.sql.includes('count(distinct') ? [{ count: '1' }] : [];
  } });
  const file = path.resolve(__dirname, '../src/modules/delivery/repositories/delivery.repository.js');
  const module = { exports: {} };
  const mockedRequire = name => name.includes('postgres-client') ? { knex } : name === 'uuid' ? { v4: () => 'unused' } : require(name);
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', {})(mockedRequire, module, module.exports);
  const repo = new module.exports.DeliveryRepository();
  const result = await repo.listShipments({ sellerId: 'seller-a', limit: 10, offset: 10 });
  assert.equal(result.total, 1);
  assert.equal(sql.length, 2);
  for (const query of sql) {
    assert.match(query.sql, /NOT EXISTS/);
    assert.match(query.sql, /exchange_pickup.return_id = s.return_id/);
    assert.match(query.sql, /exchange_pickup.seller_id = s.seller_id/);
    assert.match(query.sql, /exchange_pickup.tracking_number = s.tracking_number/);
    assert.match(query.sql, /"s"\."seller_id" = \?/);
    assert.match(query.sql, /newer_attempt.return_id = s.return_id/);
    assert.match(query.sql, /newer_attempt.seller_id = s.seller_id/);
    assert.match(query.sql, /newer_attempt.metadata->>'previousShipmentId' = s.id::text/);
    assert.match(query.sql, /newer_attempt.created_at > s.created_at/);
    assert.match(query.sql, /newer_attempt.created_at = s.created_at AND newer_attempt.id::text > s.id::text/);
    assert.match(query.sql, /exchange_delivery.shipment_type = 'replacement'/);
    assert.ok(query.bindings.includes('seller-a'));
  }
  assert.doesNotMatch(sql[0].sql, /limit/);
  assert.match(sql[1].sql, /limit \? offset \?/);
  await knex.destroy();
});
