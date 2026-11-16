const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const { ORDER_STATUS } = require('../src/shared/domain/commerce-constants');
const { DELIVERY_STATUS } = require('../src/modules/delivery/models/delivery.model');
const { orderPresentation } = require('../src/shared/domain/order-presentation');
const stub = new Proxy({}, { get: () => class Stub {} });
function load(fileName, overrides = {}) {
  const file = path.join(root, fileName);
  const localRequire = createRequire(file);
  const module = { exports: {} };
  const requireMock = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.includes('/shared/domain/') || name.includes('/shared/errors/') || name.endsWith('/shared/http/reply') || name.endsWith('/shared/auth/current-user')) return localRequire(name);
    if (name.endsWith('/delivery.model')) return { DELIVERY_STATUS };
    return stub;
  };
  vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, { Date, setTimeout })(requireMock, module, module.exports);
  return module.exports;
}
const item = (id, seller = 'seller-a', org = seller, extra = {}) => ({ id, order_id: 'order-a', seller_id: seller, organization_id: org, quantity: 1, line_total: 100, ...extra });
const shipment = (id, status, seller = 'seller-a', org = seller, extra = {}) => ({ id, order_id: 'order-a', seller_id: seller, organization_id: org, status, direction: 'forward', shipment_type: 'forward', ...extra });
function fixture(status = 'confirmed', items = [item('item-a')], shipments = [], failShipments = false, returns = [], cancellations = []) {
  const order = { id: 'order-a', order_number: 'ORD-261116-DE8N1J82', buyer_id: 'buyer-a', status, payment_status: 'captured', payment_provider: 'razorpay', total_amount: 100, payable_amount: 100, created_at: '2026-11-16T11:39:00Z' };
  const tables = { orders: [order], order_items: items, shipments, order_cancellations: cancellations };
  const queries = [];
  const knex = table => {
    const rows = tables[table] || [];
    const query = { where: () => query, whereIn: () => query, select: () => query, limit: () => query, orderBy: () => query,
      then: (resolve, reject) => {
        if (table === 'shipments' && failShipments) return Promise.reject(Object.assign(new Error('Shipment query failed'), { code: typeof failShipments === 'string' ? failShipments : '42703' })).then(resolve, reject);
        return Promise.resolve(rows).then(resolve, reject);
      } };
    return query;
  };
  const postgresPool = { query: async sql => {
    queries.push(sql);
    // The removed legacy query must never silently lose shipments again.
    if (/FROM shipments/i.test(sql) && /delivery_status/.test(sql)) throw Object.assign(new Error('column delivery_status does not exist'), { code: '42703' });
    return { rows: /COUNT\(/i.test(sql) ? [{ total: 1 }] : [order] };
  } };
  const { OrderRepository } = load('src/modules/order/repositories/order.repository.js', { '../../../infrastructure/postgres/postgres-client': { knex, postgresPool }, '../../returns/models/return.model': { ReturnModel: { find: () => ({ select: () => ({ sort: () => ({ lean: async () => returns }) }) }) } } });
  const repository = Object.create(OrderRepository.prototype);
  repository.findOrderUsers = async () => new Map();
  // Finance calculation is outside this read-response contract; real hydration,
  // group derivation, presentation and SQL/list/detail methods execute unchanged.
  repository.buildSellerSettlements = () => [];
  const { AdminRepository } = load('src/modules/admin/repositories/admin.repository.js', { '../../../infrastructure/postgres/postgres-client': { postgresPool } });
  const adminRepository = Object.create(AdminRepository.prototype);
  adminRepository.orderRepository = repository;
  const { AdminService } = load('src/modules/admin/services/admin.service.js');
  const adminService = Object.create(AdminService.prototype);
  adminService.adminRepository = adminRepository;
  const { OrderService } = load('src/modules/order/services/order.service.js', { '../../admin/services/commerce-settings.service': { commerceSettingsService: { getSettings: async () => ({}) } } });
  const orderService = Object.create(OrderService.prototype);
  orderService.orderRepository = repository;
  const { AdminController } = load('src/modules/admin/controllers/admin.controller.js');
  const { OrderController } = load('src/modules/order/controllers/order.controller.js');
  const adminController = new AdminController({ adminService });
  const orderController = new OrderController({ orderService, cancellationService: {} });
  const request = { auth: { role: 'admin', sub: 'admin-a' }, query: { limit: 10, offset: 0 }, params: { orderId: order.id } };
  const call = async (controller, req = request) => { let body; await controller(req, { json: value => { body = value; } }); return body; };
  return { order, repository, adminRepository, queries,
    list: async () => (await call(adminController.listOrders)).data.list[0],
    detail: async () => (await call(orderController.getOne)).data,
    canonicalList: async () => (await call(orderController.listAdminOrders)).data.items[0],
    detailAs: async auth => (await call(orderController.getOne, { ...request, auth })).data,
  };
}
const plain = value => JSON.parse(JSON.stringify(value));
async function assertParity(setup) {
  const [list, detail, canonical] = await Promise.all([setup.list(), setup.detail(), setup.canonicalList()]);
  for (const row of [list, canonical]) {
    assert.equal(row.id, detail.id);
    assert.equal(row.status, detail.status);
    assert.equal(row.display_status, detail.display_status);
    assert.equal(row.shipment_status, detail.shipment_status);
    assert.deepEqual(plain(row.items), plain(detail.items));
    assert.deepEqual(plain(row.relations.shipments), plain(detail.relations.shipments));
    assert.deepEqual(plain(row.relations.sellerFulfillmentGroups), plain(detail.relations.sellerFulfillmentGroups));
  }
  return { list, detail };
}
test('screenshot regression: confirmed order with an automatic initiated package stays confirmed on both routes', async () => {
  const setup = fixture('confirmed', [item('item-a')], [shipment('package-a', 'initiated', 'seller-a', 'seller-a', { metadata: { source: 'order_auto_shipment', orderItemIds: ['item-a'] } })]);
  const { list, detail } = await assertParity(setup);
  assert.equal(list.display_status, 'confirmed');
  assert.equal(detail.items[0].effective_status, 'confirmed');
  assert.equal(list.shipment_status, 'initiated');
  assert.equal(list.relations.shipments.length, 1);
  assert.ok(!setup.queries.some(sql => /FROM shipments/i.test(sql) && /delivery_status/.test(sql)));
});
test('explicitly packed orders remain packed and missing packages remain not created', async () => {
  assert.equal((await assertParity(fixture('packed', [item('item-a')], [shipment('package-a', 'initiated')]))).list.display_status, 'packed');
  assert.equal((await assertParity(fixture())).list.shipment_status, 'not_created');
});
test('every aggregate order state and single-package shipment state has identical list/detail responses', async () => {
  for (const status of Object.values(ORDER_STATUS)) for (const delivery of Object.values(DELIVERY_STATUS)) {
    await assertParity(fixture(status, [item('item-a')], [shipment('package-a', delivery)]));
  }
});
test('all two-seller package combinations have identical list/detail responses', async () => {
  for (const a of Object.values(DELIVERY_STATUS)) for (const b of Object.values(DELIVERY_STATUS)) {
    await assertParity(fixture('shipped', [item('a'), item('b', 'seller-b')], [shipment('package-a', a), shipment('package-b', b, 'seller-b')]));
  }
});
test('same-seller stores and explicit split-package combinations retain identical scopes and quantities', async () => {
  for (const a of Object.values(DELIVERY_STATUS)) for (const b of Object.values(DELIVERY_STATUS)) {
    for (const org of ['seller-a', 'store-b']) {
      await assertParity(fixture('shipped', [item('a'), item('b', 'seller-a', org)], [
        shipment('package-a', a, 'seller-a', 'seller-a', { package_snapshot: { items: [{ orderItemId: 'a', quantity: 1 }] } }),
        shipment('package-b', b, 'seller-a', org, { package_snapshot: { items: [{ orderItemId: 'b', quantity: 1 }] } }),
      ]));
    }
  }
});
test('reverse-only packages cannot become the forward shipment status', async () => {
  const { list } = await assertParity(fixture('confirmed', [item('item-a')], [shipment('reverse', 'delivered', 'seller-a', 'seller-a', { direction: 'reverse', shipment_type: 'return' })]));
  assert.equal(list.display_status, 'confirmed');
  assert.equal(list.shipment_status, 'not_created');
});
test('shipment query errors reject both endpoints instead of claiming no shipment exists', async () => {
  const setup = fixture('confirmed', [item('item-a')], [shipment('package-a', 'initiated')], true);
  await assert.rejects(setup.list(), /Shipment query failed/);
  await assert.rejects(setup.detail(), /Shipment query failed/);
});
test('mixed explicit packing does not promote an automatically created package for another seller', () => {
  const order = { status: 'packed', items: [item('a'), item('b', 'seller-b')], relations: { shipments: [
    shipment('package-a', 'initiated', 'seller-a', 'seller-a', { metadata: { orderStatus: 'packed' } }),
    shipment('package-b', 'initiated', 'seller-b', 'seller-b', { metadata: { source: 'order_auto_shipment' } }),
  ] } };
  const result = orderPresentation(order);
  assert.equal(result.items[0].effective_status, 'packed');
  assert.equal(result.items[1].effective_status, 'confirmed');
  assert.equal(result.display_status, 'confirmed');
});

test('return and cancellation states stay attached to the same item on both routes', async () => {
  for (const [state, refund, expected] of [
    ['requested', 'not_started', 'return_requested'], ['approved', 'not_started', 'return_approved'],
    ['refund_pending', 'pending', 'refund_pending'], ['refund_failed', 'failed', 'refund_failed'],
    ['refunded', 'completed', 'refunded'], ['rejected', 'not_started', 'delivered'],
    ['qc_failure_upheld', 'not_started', 'delivered'], ['replaced', 'not_started', 'delivered'],
  ]) {
    const request = { _id: 'return-a', orderId: 'order-a', status: state, refund: { status: refund }, items: [{ orderItemId: 'a', quantity: 1 }] };
    const { list } = await assertParity(fixture('return_requested', [item('a'), item('b', 'seller-b')], [shipment('package-a', 'delivered'), shipment('package-b', 'in_transit', 'seller-b')], false, [request]));
    assert.equal(list.items[0].effective_status, expected);
    assert.equal(list.items[1].effective_status, 'shipped');
  }
  const cancellation = { id: 'cancel-a', order_id: 'order-a', status: 'requested', items: [{ orderItemId: 'a', quantity: 1 }] };
  const { list } = await assertParity(fixture('confirmed', [item('a'), item('b', 'seller-b')], [], false, [], [cancellation]));
  assert.equal(list.items[0].effective_status, 'cancellation_requested');
  assert.equal(list.items[1].effective_status, 'confirmed');
});

test('missing shipment tables also reject both routes instead of returning not-created', async () => {
  const setup = fixture('confirmed', [item('item-a')], [], '42P01');
  await assert.rejects(setup.list(), /Shipment query failed/);
  await assert.rejects(setup.detail(), /Shipment query failed/);
});
test('an active return cannot be hidden by a stale fulfilled parent status', async () => {
  const request = { _id: 'return-a', orderId: 'order-a', status: 'requested', items: [{ orderItemId: 'item-a', quantity: 1 }] };
  const { list } = await assertParity(fixture('fulfilled', [item('item-a')], [shipment('package-a', 'delivered')], false, [request]));
  assert.equal(list.display_status, 'return_requested');
  assert.equal(list.items[0].effective_status, 'return_requested');
});

test('buyer and each seller retain the same parent status while item views remain scoped', async () => {
  const setup = fixture('shipped', [item('a'), item('b', 'seller-b')], [shipment('package-a', 'delivered'), shipment('package-b', 'in_transit', 'seller-b')]);
  const [admin, buyer, sellerA, sellerB] = await Promise.all([
    setup.detail(), setup.detailAs({ role: 'customer', sub: 'buyer-a' }),
    setup.detailAs({ role: 'seller', sub: 'seller-a' }), setup.detailAs({ role: 'seller', sub: 'seller-b' }),
  ]);
  for (const row of [admin, buyer, sellerA, sellerB]) assert.equal(row.display_status, 'partially_delivered');
  assert.equal(sellerA.items.length, 1);
  assert.equal(sellerA.items[0].effective_status, 'delivered');
  assert.equal(sellerB.items.length, 1);
  assert.equal(sellerB.items[0].effective_status, 'shipped');
});
test('one seller viewing a single store cannot turn a partially delivered parent into delivered', async () => {
  const setup = fixture('shipped', [item('a', 'seller-a', 'store-a'), item('b', 'seller-a', 'store-b')], [shipment('package-a', 'delivered', 'seller-a', 'store-a'), shipment('package-b', 'in_transit', 'seller-a', 'store-b')]);
  const store = await setup.detailAs({ role: 'seller', sub: 'seller-a', selectedOrganizationId: 'store-a' });
  assert.equal(store.display_status, 'partially_delivered');
  assert.deepEqual(plain(store.items.map(row => row.id)), ['a']);
  assert.deepEqual(plain(store.relations.shipments.map(row => row.id)), ['package-a']);
});

test('buyer and admin item stages agree for cancellation and return outcomes', async () => {
  for (const state of ['requested', 'approved', 'refunded', 'rejected', 'qc_failure_upheld', 'replaced']) {
    const request = { _id: 'return-a', orderId: 'order-a', status: state, refund: { status: state === 'refunded' ? 'completed' : 'not_started' }, items: [{ orderItemId: 'item-a', quantity: 1 }] };
    const setup = fixture('return_requested', [item('item-a')], [shipment('package-a', 'delivered')], false, [request]);
    const [admin, buyer] = await Promise.all([setup.detail(), setup.detailAs({ role: 'customer', sub: 'buyer-a' })]);
    assert.equal(buyer.items[0].effective_status, admin.items[0].effective_status);
  }
  for (const state of ['requested', 'rejected', 'failed']) {
    const request = { id: 'cancel-a', order_id: 'order-a', status: state, items: [{ orderItemId: 'item-a', quantity: 1 }] };
    const setup = fixture('confirmed', [item('item-a')], [], false, [], [request]);
    const [admin, buyer] = await Promise.all([setup.detail(), setup.detailAs({ role: 'customer', sub: 'buyer-a' })]);
    assert.equal(buyer.items[0].effective_status, admin.items[0].effective_status);
  }
});
