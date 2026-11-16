/* Read-only audit: executes production status methods with isolated repository fixtures.
 * Run from any directory: node backend/scripts/qa/audit-order-status.js
 * Exit 1 means an expected status/guard disagrees with production code.
 * No database, network, payment provider, event publisher, or application bootstrap is loaded.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const backend = path.resolve(__dirname, '../..');
const workspace = path.dirname(backend);
const constants = require(path.join(backend, 'src/shared/domain/commerce-constants'));
const { DELIVERY_STATUS } = require(path.join(backend, 'src/modules/delivery/models/delivery.model'));
const cases = [];
const emptyModule = new Proxy({}, { get: () => class Stub {} });
function service(relative, overrides = {}) {
  const file = path.join(backend, relative);
  const localRequire = createRequire(file);
  const module = { exports: {} };
  const mockRequire = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.includes('/shared/domain/') || name.endsWith('/errors/app-error')) return localRequire(name);
    if (name.endsWith('/delivery.model')) return { DELIVERY_STATUS };
    return emptyModule;
  };
  vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, { console, Date, setTimeout })(mockRequire, module, module.exports);
  return module.exports;
}
const babel = require(path.join(workspace, 'Admin/node_modules/@babel/core'));
const cjs = require(path.join(workspace, 'Admin/node_modules/@babel/plugin-transform-modules-commonjs'));
function frontend(relative) {
  const file = path.join(workspace, relative);
  const module = { exports: {} };
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), { configFile: false, babelrc: false, plugins: [cjs] }).code;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})(name => {
    if (name.endsWith('/orderHelpers')) return frontend('customer/src/utils/orderHelpers.js');
    // Image/product-link helpers are not executed by the status functions.
    return {};
  }, module, module.exports);
  return module.exports;
}
const admin = frontend('Admin/src/utils/orderDisplayStatus.js');
const customer = frontend('customer/src/utils/pages/orderUtils.js');
const { OrderService } = service('src/modules/order/services/order.service.js');
function orderService(items = [], shipments = []) {
  const api = Object.create(OrderService.prototype);
  api.orderRepository = {
    isSellerInOrder: async (_id, seller) => items.some(item => item.seller_id === seller),
    findItemsByOrderId: async () => items,
    hasNonCancellableShipment: async () => shipments.some(s => ['in_transit', 'picked_up', 'delivered', 'out_for_delivery'].includes(s.status)),
    findByIdWithItems: async () => ({ items, relations: { shipments } }),
  };
  return api;
}
const item = (id, seller = 'a', org = seller, extra = {}) => ({ id, seller_id: seller, organization_id: org, quantity: 1, product_id: `product-${id}`, ...extra });
const shipment = (seller = 'a', status = 'in_transit', org = seller, extra = {}) => ({ id: `shipment-${seller}-${status}`, order_id: 'order', seller_id: seller, organization_id: org, direction: 'forward', shipment_type: 'forward', status, ...extra });
const actor = { role: 'admin', userId: 'admin' };
const buyer = { role: 'customer', userId: 'buyer' };
const seller = { role: 'seller', userId: 'a', organizationId: 'a' };
async function check(category, name, expected, run) {
  try {
    const actual = await run();
    cases.push({ category, name, expected, actual, pass: JSON.stringify(actual) === JSON.stringify(expected) });
  } catch (error) {
    cases.push({ category, name, expected, actual: `ERROR: ${error.message}`, pass: false });
  }
}
const allowed = async fn => { try { await fn(); return true; } catch (e) { if (!e.statusCode) throw e; return false; } };
function deliveryFixture(items, shipments, cancellations = [], returns = [], order = { status: 'shipped' }) {
  const writes = [];
  const { DeliveryService } = service('src/modules/delivery/services/delivery.service.js', {
    '../../../infrastructure/postgres/postgres-client': { knex: () => ({ where: () => ({ whereNotIn: async () => cancellations }) }) },
    '../../returns/models/return.model': { ReturnModel: { find: () => ({ select: () => ({ lean: async () => returns }) }) } },
    '../../seller/services/settlement-lifecycle.service': { settlementLifecycleService: { ensureOrderDeliveryLifecycle: async () => {} } },
  });
  const api = Object.create(DeliveryService.prototype);
  api.deliveryRepository = { findOrderDeliveryProgress: async () => ({ order, items, shipments }) };
  api.orderRepository = {
    findById: async () => order,
    updateStatus: async (id, status, options) => { const result = { status, deliveryStatus: options.deliveryStatus }; writes.push(result); return result; },
  };
  api.syncSellerFinanceForDeliveredOrder = async () => {};
  return { api, writes };
}
function returnFixture(order, returns) {
  const { ReturnServiceClass } = service('src/modules/returns/services/return.service.js', {
    '../models/return.model': { ReturnModel: { find: () => ({ lean: async () => returns.filter(r => r.status !== 'rejected') }) } },
  });
  const api = Object.create(ReturnServiceClass.prototype);
  api.orderRepository = { findByIdWithItems: async () => order };
  return api;
}
async function main() {
  // Independent contract for every distinct pair of all aggregate order states.
  const graph = {
    pending_payment: ['confirmed', 'cancelled', 'payment_failed', 'on_hold'],
    payment_failed: ['pending_payment', 'cancelled', 'on_hold'],
    on_hold: ['pending_payment', 'confirmed', 'processing', 'cancelled'],
    confirmed: ['processing', 'packed', 'cancelled', 'on_hold'],
    processing: ['packed', 'cancelled', 'on_hold'],
    packed: ['ready_to_ship', 'cancelled', 'on_hold'],
    ready_to_ship: ['shipped', 'cancelled', 'on_hold'],
    shipped: ['out_for_delivery', 'delivered', 'failed_delivery', 'return_requested'],
    out_for_delivery: ['delivered', 'failed_delivery', 'return_requested'],
    failed_delivery: ['out_for_delivery', 'returned', 'cancelled'],
    delivered: ['fulfilled', 'return_requested'],
    return_requested: ['return_approved', 'partially_returned', 'returned'],
    return_approved: ['partially_returned', 'returned', 'refunded'],
    partially_returned: ['return_requested', 'fulfilled', 'refunded'],
    returned: ['fulfilled', 'refunded'], refunded: ['fulfilled'], fulfilled: ['return_requested'], cancelled: [],
  };
  const allItems = [item('a')];
  const api = orderService(allItems, [shipment('a', 'delivered')]);
  for (const from of Object.values(constants.ORDER_STATUS)) for (const to of Object.values(constants.ORDER_STATUS)) {
    if (from === to) continue; // updateOrderStatus handles idempotent requests before the guard.
    const expected = (graph[from] || []).includes(to);
    await check('order transition contract', `${from} -> ${to}`, expected,
      () => allowed(() => orderService(allItems, to === 'delivered' ? [shipment('a', 'delivered')] : []).assertOrderTransitionAllowed('order', { status: from, buyer_id: 'buyer' }, to, actor)));
  }
  for (const [role, user] of [['customer', 'buyer'], ['customer', 'stranger'], ['seller', 'a'], ['seller', 'outsider']]) {
    const who = { role, userId: user };
    for (const [from, to, expected] of [
      ['confirmed', 'processing', role === 'seller' && user === 'a'],
      ['confirmed', 'cancelled', role === 'customer' && user === 'buyer'],
      ['pending_payment', 'confirmed', false],
      ['payment_failed', 'pending_payment', role === 'customer' && user === 'buyer'],
    ]) await check('role permissions', `${role}/${user}: ${from} -> ${to}`, expected,
      () => allowed(() => api.assertOrderTransitionAllowed('order', { status: from, buyer_id: 'buyer' }, to, who)));
  }
  const topologies = [
    ['single seller', [item('a')]],
    ['two sellers', [item('a'), item('b', 'b')]],
    ['one seller two stores', [item('a'), item('b', 'a', 'store-b')]],
  ];
  for (const [name, items] of topologies) {
    await check('fulfillment scope', `${name}: seller cannot advance unrelated packages`, name === 'single seller',
      () => allowed(() => orderService(items).assertOrderTransitionAllowed('order', { status: 'confirmed', buyer_id: 'buyer' }, 'packed', seller)));
    const delivered = [shipment('a', 'delivered')];
    await check('fulfillment scope', `${name}: admin delivered requires every store`, name === 'single seller',
      () => allowed(() => orderService(items, delivered).assertOrderTransitionAllowed('order', { status: 'shipped' }, 'delivered', actor)));
  }
  for (const status of ['initiated', 'manifested', 'in_transit', 'picked_up', 'delivered']) {
    await check('cancellation guard', `packed / ${status}`, ['initiated', 'manifested'].includes(status),
      () => allowed(() => orderService(allItems, [shipment('a', status)]).assertOrderTransitionAllowed('order', { status: 'packed', buyer_id: 'buyer', delivery_status: status }, 'cancelled', buyer)));
  }
  // All single-package states, and all 121 two-seller shipment-state pairs.
  const shipmentStates = Object.values(DELIVERY_STATUS);
  for (const a of shipmentStates) {
    await check('delivery completion matrix', `single seller / ${a}`, a === 'delivered', async () =>
      (await deliveryFixture(allItems, [shipment('a', a)]).api.getForwardDeliveryProgress('order')).allDelivered);
    for (const b of shipmentStates) {
      await check('delivery completion matrix', `two sellers / ${a} + ${b}`, a === 'delivered' && b === 'delivered', async () =>
        (await deliveryFixture([item('a'), item('b', 'b')], [shipment('a', a), shipment('b', b)]).api.getForwardDeliveryProgress('order')).allDelivered);
    }
  }
  // Store isolation and package isolation: repeat the full two-package state matrix.
  for (const a of shipmentStates) for (const b of shipmentStates) {
    for (const splitStore of [false, true]) {
      const org = splitStore ? 'store-b' : 'a';
      const items = [item('a'), item('b', 'a', org)];
      const shipments = [shipment('a', a, 'a', { package_snapshot: { items: [{ orderItemId: 'a', quantity: 1 }] } }),
        shipment('a', b, org, { package_snapshot: { items: [{ orderItemId: 'b', quantity: 1 }] } })];
      await check(splitStore ? 'two-store completion matrix' : 'split-package completion matrix', `${a} + ${b}`, a === 'delivered' && b === 'delivered',
        async () => (await deliveryFixture(items, shipments).api.getForwardDeliveryProgress('order')).allDelivered);
    }
  }
  for (const a of shipmentStates) for (const b of shipmentStates) for (const c of shipmentStates) {
    await check('three-seller completion matrix', `${a} + ${b} + ${c}`, [a, b, c].every(status => status === 'delivered'),
      async () => (await deliveryFixture([item('a'), item('b', 'b'), item('c', 'c')], [shipment('a', a), shipment('b', b), shipment('c', c)]).api.getForwardDeliveryProgress('order')).allDelivered);
  }
  const completionCases = [
    ['missing second shipment', [item('a'), item('b', 'b')], [shipment('a', 'delivered')], false],
    ['same seller split packages', [item('a'), item('b')], [shipment('a', 'delivered', 'a', { package_snapshot: { items: [{ orderItemId: 'a', quantity: 1 }] } }), shipment('a', 'in_transit', 'a', { package_snapshot: { items: [{ orderItemId: 'b', quantity: 1 }] } })], false],
    ['same store split quantity', [item('a', 'a', 'a', { quantity: 2 })], [shipment('a', 'delivered', 'a', { package_snapshot: { items: [{ orderItemId: 'a', quantity: 1 }] } })], false],
    ['cancelled seller excluded', [item('a'), item('b', 'b', 'b', { cancelled_quantity: 1 })], [shipment('a', 'delivered')], true],
    ['all items cancelled', [item('a', 'a', 'a', { cancelled_quantity: 1 })], [], false],
    ['store ownership respected', [item('a'), item('b', 'a', 'store-b')], [shipment('a', 'delivered')], false],
    ['both stores delivered', [item('a'), item('b', 'a', 'store-b')], [shipment('a', 'delivered'), shipment('a', 'delivered', 'store-b')], true],
  ];
  for (const [name, items, shipments, expected] of completionCases) await check('delivery edge cases', name, expected,
    async () => (await deliveryFixture(items, shipments).api.getForwardDeliveryProgress('order')).allDelivered);
  for (const request of ['requested', 'approved', 'processing', 'completed', 'failed', 'rejected']) {
    await check('pending cancellation', `delivered with cancellation ${request}`, ['completed', 'failed', 'rejected'].includes(request), async () => {
      // Reflect the repository query's whereNotIn filter.
      const pending = ['completed', 'failed', 'rejected'].includes(request) ? [] : [{ status: request }];
      return (await deliveryFixture(allItems, [shipment('a', 'delivered')], pending).api.getForwardDeliveryProgress('order')).allDelivered;
    });
  }
  const { api: tracking } = deliveryFixture(allItems, []);
  for (const [from, to, expected] of [
    ['initiated', 'in_transit', true], ['in_transit', 'delivered', true],
    ['in_transit', 'out_for_delivery', true], ['initiated', 'manifested', true],
    ['manifested', 'picked_up', true], ['picked_up', 'out_for_delivery', true],
    ['failed', 'in_transit', true], ['in_transit', 'failed', true],
    ['in_transit', 'rto', true], ['in_transit', 'lost', true], ['in_transit', 'damaged', true],
    ['delivered', 'in_transit', false], ['cancelled', 'in_transit', false],
  ]) await check('shipment transitions', `${from} -> ${to}`, expected,
    () => allowed(() => tracking.assertTrackingTransition(from, to, { note: 'Audit exception' })));
  for (const status of ['confirmed', 'shipped', 'cancelled', 'returned', 'refunded', 'return_requested', 'fulfilled']) {
    const { api: sync, writes } = deliveryFixture(allItems, [shipment('a', 'delivered')], [], [], { status });
    await sync.syncOrderForTracking(shipment('a', 'delivered'), actor);
    await check('terminal state protection', `delivered event when order ${status}`, ['cancelled', 'returned', 'refunded', 'return_requested', 'fulfilled'].includes(status) ? status : 'delivered',
      () => writes.at(-1)?.status || status);
  }
  for (const status of ['in_transit', 'initiated', 'failed']) {
    const { api: sync, writes } = deliveryFixture([item('a'), item('b', 'b')], [shipment('a', 'delivered'), shipment('b', status)], [], [], { status: 'shipped', delivery_status: 'partially_delivered' });
    await sync.syncOrderForTracking(shipment('b', status), actor);
    await check('aggregate event ordering', `delivered seller A, seller B sends ${status}`, 'partially_delivered', () => writes.at(-1)?.deliveryStatus);
  }
  // Payment authorization/capture guards for every configured provider and payment state.
  for (const provider of Object.values(constants.PAYMENT_PROVIDER)) for (const payment of Object.values(constants.PAYMENT_STATUS)) {
    const order = { status: 'shipped', payment_provider: provider, payment_status: payment };
    const { api: paymentApi } = deliveryFixture(allItems, [], [], [], order);
    const current = shipment('a', 'in_transit');
    paymentApi.deliveryRepository.findShipmentById = async () => current;
    paymentApi.deliveryRepository.addTrackingEvent = async (_id, payload) => ({ shipment: { ...current, status: payload.status } });
    // Isolate the payment precondition in the real public tracking method.
    paymentApi.assertCanManageShipment = async () => {};
    for (const name of ['syncOrderForTracking', 'syncReplacementReturnForTracking', 'syncDealDeliveryForShipment', 'publishShipmentTrackingEvent']) paymentApi[name] = async () => {};
    const expected = payment === 'captured' || (provider === 'cod' && payment === 'authorized');
    await check('shipment payment guards', `${provider} / ${payment}`, expected,
      () => allowed(() => paymentApi.addTrackingEvent(current.id, { status: 'delivered' }, actor)));
  }
  for (const state of Object.values(constants.ORDER_STATUS)) {
    const repeat = orderService(allItems);
    let writes = 0;
    repeat.orderRepository.findById = async () => ({ id: 'order', status: state });
    repeat.orderRepository.updateStatus = async () => { writes++; };
    await check('order idempotency', `repeat ${state}`, 0, async () => {
      await repeat.updateOrderStatus('order', state, actor); return writes;
    });
  }
  for (const [direction, type] of [['reverse', 'return'], ['forward', 'return'], ['reverse', 'forward']]) {
    await check('reverse shipment identification', `${direction}/${type}`, false, () => tracking.isForwardShipment(shipment('a', 'delivered', 'a', { direction, shipment_type: type })));
  }
  // Buyer projection + both frontend status resolvers, using the same API fixture.
  const presentationCases = [
    ['basic transit', { status: 'shipped', items: allItems, relations: { shipments: [shipment()] } }, 'shipped', ['shipped']],
    ['delivered one seller', { status: 'delivered', items: allItems, relations: { shipments: [shipment('a', 'delivered')] } }, 'delivered', ['delivered']],
    ['partial delivery', { status: 'shipped', delivery_status: 'partially_delivered', items: [item('a'), item('b', 'b')], relations: { shipments: [shipment('a', 'delivered'), shipment('b', 'in_transit')] } }, 'partially_delivered', ['delivered', 'shipped']],
    ['cancelled remaining seller', { status: 'shipped', items: [item('a'), item('b', 'b', 'b', { cancelled_quantity: 1 })], relations: { shipments: [shipment('a', 'delivered')] } }, 'delivered', ['delivered', 'cancelled']],
    ['package references', { status: 'shipped', items: [item('a'), item('b')], relations: { shipments: [shipment('a', 'delivered', 'a', { package_snapshot: { items: [{ orderItemId: 'a', quantity: 1 }] } }), shipment('a', 'in_transit', 'a', { package_snapshot: { items: [{ orderItemId: 'b', quantity: 1 }] } })] } }, 'partially_delivered', ['delivered', 'shipped']],
    ['replacement after cancelled package', { status: 'shipped', items: allItems, relations: { shipments: [shipment('a', 'cancelled'), shipment('a', 'in_transit')] } }, 'shipped', ['shipped']],
    ['reverse shipment excluded', { status: 'shipped', items: allItems, relations: { shipments: [shipment('a', 'delivered', 'a', { direction: 'reverse', shipment_type: 'return' }), shipment('a', 'in_transit')] } }, 'shipped', ['shipped']],
    ['delivery failure', { status: 'shipped', items: allItems, relations: { shipments: [shipment('a', 'failed')] } }, 'failed', ['failed']],
    ['returned to origin', { status: 'shipped', items: allItems, relations: { shipments: [shipment('a', 'rto')] } }, 'rto', ['rto']],
    ['pending payment', { status: 'pending_payment', items: allItems }, 'pending_payment', ['pending_payment']],
    ['payment failed', { status: 'payment_failed', items: allItems }, 'payment_failed', ['payment_failed']],
  ];
  const normalize = value => ({ in_transit: 'shipped', picked_up: 'shipped' }[value] || value);
  for (const [name, order, expectedOrder, expectedItems] of presentationCases) {
    const projected = api.filterOrderForBuyer(order);
    await check('admin display', name, expectedOrder, () => admin.orderDisplayStatus(order));
    await check('customer item display', name, expectedItems, () => projected.items.map(row => normalize(customer.resolveOrderItemDisplayStatus(row, customer.getProgressStatus(projected), projected.relations.shipments, projected.relations.sellerFulfillmentGroups, projected.relations.cancellations, projected.relations.returns))));
  }
  for (const state of ['return_requested', 'return_approved', 'returned', 'refunded', 'partially_returned']) {
    await check('post-delivery display', `admin preserves ${state}`, state, () => admin.orderDisplayStatus({ status: state, items: [item('a', 'a', 'a', { delivered_at: '2026-11-01' })] }));
    await check('post-delivery display', `customer progress preserves ${state}`, state, () => customer.getProgressStatus({ status: state, delivery_status: 'delivered' }));
  }
  const returnOrder = { id: 'order', status: 'delivered', payment_status: 'captured', payable_amount: 200, total_amount: 200, items: [item('a'), item('b', 'b')] };
  const ret = (status, ids = ['a'], extra = {}) => ({ id: `return-${status}`, status, items: ids.map(orderItemId => ({ orderItemId, quantity: 1 })), ...extra });
  for (const [name, returns, expected] of [
    ['no returns', [], ['delivered', 'captured', 0]],
    ['one item requested', [ret('requested')], ['return_requested', 'captured', 0]],
    ['one item refunded', [ret('refunded', ['a'], { refund: { status: 'completed', refundedAmount: 100 } })], ['partially_returned', 'partially_refunded', 1]],
    ['all items refunded', [ret('refunded', ['a', 'b'], { refund: { status: 'completed', refundedAmount: 200 } })], ['returned', 'refunded', 2]],
    ['request rejected', [ret('rejected')], ['delivered', 'captured', 0]],
    ['QC failure upheld', [ret('qc_failure_upheld')], ['delivered', 'captured', 0]],
    ['QC failed awaiting review', [ret('qc_failed')], ['return_requested', 'captured', 0]],
    ['replacement completed', [ret('replaced', ['a', 'b'], { refund: { status: 'not_required', refundedAmount: 0 } })], ['delivered', 'captured', 0]],
  ]) await check('return lifecycle', name, expected, async () => {
    const { lifecycle } = await returnFixture(returnOrder, returns).buildOrderReturnLifecycle('order');
    return [lifecycle.status, lifecycle.paymentStatus, lifecycle.returnedQuantity];
  });
  // Exercise the real finalization worker with fixtures already past their release deadline.
  // Only query/storage adapters are mocked; the worker's open-return filter runs unchanged.
  const returnStates = ['requested', 'approved', 'reverse_pickup_scheduled', 'pickup_failed', 'manual_ship_back',
    'shipped_back', 'in_reverse_transit', 'received', 'qc_passed', 'qc_completed', 'qc_failed', 'qc_failure_upheld',
    'refund_pending', 'refund_failed', 'partially_refunded', 'replacement_requested', 'replacement_pending',
    'replacement_created', 'replacement_shipped', 'replacement_delivered', 'refunded', 'replaced', 'rejected', 'closed', 'unknown_future_state'];
  for (const state of [...returnStates, 'return_db_error']) {
    let finalized = false;
    const order = { id: 'order', status: 'delivered', payment_status: 'captured', fulfillment_eligible_at: '2020-01-01' };
    const knex = table => {
      const query = {
        where: () => query, whereNotNull: () => query, limit: async () => [order],
        update: async () => { finalized = true; return 1; }, insert: async () => {},
      };
      return query;
    };
    knex.raw = () => ({}); knex.fn = { now: () => new Date() };
    const { SettlementLifecycleService } = service('src/modules/seller/services/settlement-lifecycle.service.js', {
      '../../../infrastructure/postgres/postgres-client': { knex },
      '../../returns/models/return.model': { ReturnModel: { exists: async filter => {
        if (state === 'return_db_error') throw new Error('Return database unavailable');
        const matches = filter.status.$in ? filter.status.$in.includes(state) : !filter.status.$nin.includes(state);
        return matches ? { _id: 'return' } : null;
      } } },
      uuid: { v4: () => 'audit-history' },
    });
    const finalize = Object.create(SettlementLifecycleService.prototype);
    finalize.referralService = { syncInfluencerReferralOrderStatus: async () => {} };
    const closed = ['qc_failure_upheld', 'refunded', 'replaced', 'rejected', 'closed'].includes(state);
    await check('fulfillment finalization worker', state, closed, async () => {
      try { await finalize.finalizeEligibleOrders(); } catch (error) {
        if (state !== 'return_db_error') throw error;
      }
      return finalized;
    });
  }
  // Same seller, distinct store: the API response must remain scoped to the requested organization.
  const scopedOrder = { id: 'order', status: 'shipped', items: [item('a'), item('b', 'a', 'store-b')], relations: { shipments: [shipment('a'), shipment('a', 'delivered', 'store-b')], sellerFulfillmentGroups: [{ sellerId: 'a', organizationId: 'a' }, { sellerId: 'a', organizationId: 'store-b' }] } };
  const scoped = api.filterOrderForSeller(scopedOrder, 'a', 'a');
  await check('seller organization scope', 'items', ['a'], () => scoped.items.map(row => row.id));
  await check('seller organization scope', 'shipments', ['a'], () => scoped.relations.shipments.map(row => row.organization_id));
  await check('seller organization scope', 'fulfillment groups', ['a'], () => scoped.relations.sellerFulfillmentGroups.map(row => row.organizationId));

  // Regression checks for quantity accounting, API projections and database write guards.
  const { forwardDeliveryProgress } = require(path.join(backend, 'src/shared/domain/order-fulfillment'));
  const packageFor = (id, quantity, status = 'delivered') => shipment('a', status, 'a', {
    package_snapshot: { items: [{ orderItemId: id, quantity }] },
  });
  for (const [name, row, packages, expected] of [
    ['one of two units delivered', item('a', 'a', 'a', { quantity: 2 }), [packageFor('a', 1)], false],
    ['two split units delivered', item('a', 'a', 'a', { quantity: 2 }), [packageFor('a', 1), packageFor('a', 1)], true],
    ['cancelled quantity excluded', item('a', 'a', 'a', { quantity: 2, cancelled_quantity: 1 }), [packageFor('a', 1)], true],
    ['other store cannot deliver item', item('a'), [shipment('a', 'delivered', 'store-b', { package_snapshot: { items: [{ orderItemId: 'a', quantity: 1 }] } })], false],
    ['replacement of cancelled package', item('a'), [packageFor('a', 1, 'cancelled'), packageFor('a', 1)], true],
    ['empty metadata manifest uses snapshot', item('a'), [{ ...packageFor('b', 1), metadata: { fulfillmentItems: [] } }], false],
  ]) {
    await check('quantity regression', name, expected, () => forwardDeliveryProgress([row], packages).allDelivered);
    const display = { status: 'shipped', items: [row], relations: { shipments: packages } };
    await check('admin quantity regression', name, expected, () => admin.orderDisplayStatus(display) === 'delivered');
    const projection = api.filterOrderForBuyer(display);
    await check('customer quantity regression', name, expected, () => customer.resolveOrderItemDisplayStatus(projection.items[0], 'shipped', projection.relations.shipments) === 'delivered');
  }
  for (const [name, items, shipments, currentShipment, expected] of [
    ['same-store manifest only timestamps matching item', [item('a'), item('b')], [packageFor('a', 1)], packageFor('a', 1), ['a']],
    ['partial unit does not start a return window', [item('a', 'a', 'a', { quantity: 2 })], [packageFor('a', 1)], packageFor('a', 1), []],
    ['last split unit starts the return window', [item('a', 'a', 'a', { quantity: 2 })], [packageFor('a', 1), packageFor('a', 1)], packageFor('a', 1), ['a']],
    ['eligibility refresh does not deliver remaining items', [item('a', 'a', 'a', { delivered_at: '2026-11-01' }), item('b')], [], null, ['a']],
  ]) {
    const writes = [];
    const data = { orders: { id: 'order', status: 'shipped', payment_provider: 'razorpay' }, order_items: items, shipments };
    const knex = table => {
      let selection;
      const query = {
        where: (key, value) => { selection = typeof key === 'object' ? key : { [key]: value }; return query; },
        first: async () => data[table],
        then: (resolve, reject) => Promise.resolve(data[table]).then(resolve, reject),
        update: async payload => { if (table === 'order_items') writes.push({ id: selection.id, payload }); return 1; },
      };
      return query;
    };
    knex.raw = () => ({}); knex.fn = { now: () => new Date() }; knex.transaction = async fn => fn(knex);
    const { SettlementLifecycleService } = service('src/modules/seller/services/settlement-lifecycle.service.js', {
      '../../../infrastructure/postgres/postgres-client': { knex },
    });
    const lifecycle = Object.create(SettlementLifecycleService.prototype);
    lifecycle.getPolicy = async () => ({ returnWindowDays: 7 });
    await check('delivery timestamp regression', name, expected, async () => {
      await lifecycle.ensureOrderDeliveryLifecycle('order', new Date('2026-11-15'), currentShipment);
      return writes.map(write => write.id);
    });
  }
  for (const status of ['cancelled', 'returned', 'refunded', 'return_requested', 'fulfilled', 'shipped']) {
    let writes = 0, histories = 0;
    const current = { id: 'order', status };
    const trx = () => {
      const query = { where: () => query, limit: () => query, forUpdate: async () => [current],
        update: () => { writes++; return query; }, returning: async () => [{ ...current, status: 'delivered' }] };
      return query;
    };
    trx.commit = async () => {}; trx.rollback = async () => {};
    const knex = { transaction: async () => trx, fn: { now: () => new Date() } };
    const { OrderRepository } = service('src/modules/order/repositories/order.repository.js', {
      '../../../infrastructure/postgres/postgres-client': { knex },
    });
    const repository = Object.create(OrderRepository.prototype);
    repository.insertStatusHistory = async () => { histories++; };
    await check('locked status write guard', status, status === 'shipped' ? [1, 1] : [0, 0], async () => {
      await repository.updateStatus('order', 'delivered', { expectedStatuses: ['shipped'] });
      return [writes, histories];
    });
  }
  await check('customer summary regression', 'partial delivery remains explicit', 'partially_delivered',
    () => customer.getProgressStatus({ status: 'shipped', delivery_status: 'partially_delivered' }));
  await check('return approval permissions', 'buyer cannot approve own aggregate return', false,
    () => allowed(() => api.assertOrderTransitionAllowed('order', { status: 'return_requested', buyer_id: 'buyer' }, 'return_approved', buyer)));
  const { OrderRepository: Repository } = service('src/modules/order/repositories/order.repository.js');
  const groupRepository = Object.create(Repository.prototype);
  for (const [name, items, packages, expected] of [
    ['group does not complete a partial quantity', [item('a', 'a', 'a', { quantity: 2 })], [packageFor('a', 1)], false],
    ['group completes all split quantities', [item('a', 'a', 'a', { quantity: 2 })], [packageFor('a', 1), packageFor('a', 1)], true],
    ['cancelled package replaced', [item('a')], [packageFor('a', 1, 'cancelled'), packageFor('a', 1)], true],
    ['reverse package not delivery evidence', [item('a')], [{ ...packageFor('a', 1), direction: 'reverse' }], false],
  ]) await check('seller group regression', name, expected, () =>
    groupRepository.buildSellerFulfillmentGroups({}, items, [], [], packages)[0].isFullyDelivered);
  for (const state of ['requested', 'replacement_shipped', 'unknown_future_state', 'return_db_error']) {
    let writes = 0;
    const trx = () => {
      const query = { where: () => query, whereNotNull: () => query, orderBy: () => query, limit: () => query,
        forUpdate: () => query, skipLocked: async () => [{ id: 'a', order_id: 'order', payout_status: 'pending' }],
        update: async () => { writes++; return 1; }, insert: async () => { writes++; } };
      return query;
    };
    const knex = { transaction: async fn => fn(trx) };
    const { SettlementLifecycleService } = service('src/modules/seller/services/settlement-lifecycle.service.js', {
      '../../../infrastructure/postgres/postgres-client': { knex },
      '../../returns/models/return.model': { ReturnModel: { exists: async filter => {
        if (state === 'return_db_error') throw new Error('Return database unavailable');
        return !filter.status.$nin.includes(state) ? { _id: 'return' } : null;
      } } },
    });
    const worker = Object.create(SettlementLifecycleService.prototype);
    await check('payout eligibility regression', state, 0, async () => { await worker.markEligibleOrderItems(); return writes; });
  }
  for (const [name, rows, who] of [
    ['cancelled seller cannot advance another seller', [item('a', 'a', 'a', { cancelled_quantity: 1 }), item('b', 'b')], { role: 'seller', userId: 'a' }],
    ['cancelled store cannot advance remaining store', [item('a', 'a', 'a', { cancelled_quantity: 1 }), item('b', 'a', 'store-b')], seller],
  ]) await check('active fulfillment ownership', name, false, () => allowed(() => orderService(rows).assertOrderTransitionAllowed('order', { status: 'confirmed' }, 'packed', who)));
  for (const [name, order, returns, expected] of [
    ['rejected return during partial delivery restores shipped', { ...returnOrder, status: 'return_requested', delivery_status: 'partially_delivered', items: [item('a', 'a', 'a', { delivered_at: '2026-11-01' }), item('b', 'b')], relations: { shipments: [shipment('a', 'delivered'), shipment('b', 'in_transit')] } }, [ret('rejected')], 'shipped'],
    ['completed replacement restores delivered', { ...returnOrder, status: 'return_requested', delivery_status: 'delivered' }, [ret('replaced', ['a', 'b'])], 'delivered'],
    ['closed claim restores previous fulfilled state', { ...returnOrder, status: 'return_requested', delivery_status: 'delivered', metadata: { returnLifecycle: { previousOrderStatus: 'fulfilled' } } }, [ret('rejected')], 'fulfilled'],
  ]) await check('return resolution regression', name, expected, async () => (await returnFixture(order, returns).buildOrderReturnLifecycle('order')).lifecycle.status);
  for (const status of ['picked_up', 'in_transit', 'out_for_delivery']) {
    const { api: handover } = deliveryFixture([item('a')], [], [], [], { status: 'packed', payment_status: 'captured' });
    let saved = false;
    handover.deliveryRepository.findShipmentById = async () => shipment('a', status === 'out_for_delivery' ? 'picked_up' : 'initiated');
    handover.deliveryRepository.addTrackingEvent = async () => { saved = true; };
    handover.assertCanManageShipment = async () => {};
    handover.orderRepository.findByIdWithItems = async () => ({ items: [item('a')] });
    handover.getForwardFulfillmentItems = async () => [];
    await check('handover quantity protection', status, [false, false], async () => {
      const result = await allowed(() => handover.addTrackingEvent('shipment', { status }, actor));
      return [result, saved];
    });
  }
  for (const status of ['picked_up', 'in_transit', 'out_for_delivery']) {
    const { api: invalid } = deliveryFixture([item('a')], [], [], [], { status: 'shipped', payment_status: 'captured' });
    let mutations = 0;
    invalid.deliveryRepository.findShipmentById = async () => shipment('a', 'delivered', 'a', { courier_name: 'Test Courier', awb_number: 'AWB-1', shipped_at: '2026-11-01', expected_delivery_at: '2026-11-05' });
    invalid.deliveryRepository.updateShipmentFulfillmentSnapshot = async () => { mutations++; };
    invalid.deliveryRepository.addTrackingEvent = async () => { mutations++; };
    invalid.assertCanManageShipment = async () => {};
    invalid.orderRepository.findByIdWithItems = async () => ({ items: [item('a')] });
    invalid.getForwardFulfillmentItems = async () => [{ orderItemId: 'a', quantity: 1 }];
    await check('invalid tracking has no side effects', `delivered -> ${status}`, [false, 0], async () => {
      const result = await allowed(() => invalid.addTrackingEvent('shipment', { status }, actor));
      return [result, mutations];
    });
  }
  await check('admin terminal status regression', 'fulfilled remains fulfilled with stale package data', 'fulfilled',
    () => admin.orderDisplayStatus({ status: 'fulfilled', items: [item('a')], relations: { shipments: [shipment('a', 'in_transit')] } }));
  const referenced = { status: 'shipped', items: [item('a'), item('b')], relations: { shipments: [
    shipment('a', 'delivered', 'a', { orderItemIds: [], metadata: { orderItemIds: ['a'] } }),
    shipment('a', 'in_transit', 'a', { metadata: { orderItemIds: ['b'] } }),
  ] } };
  await check('admin item reference regression', 'legacy metadata item references stay isolated', ['delivered', 'shipped'],
    () => referenced.items.map(row => admin.itemDisplayStatus(row, referenced)));
  const referencedBuyer = api.filterOrderForBuyer(referenced);
  await check('buyer item reference regression', 'legacy metadata item references stay isolated', ['delivered', 'shipped'],
    () => referencedBuyer.items.map(row => customer.resolveOrderItemDisplayStatus(row, 'shipped', referencedBuyer.relations.shipments)));
  const summary = {};
  for (const entry of cases) {
    summary[entry.category] ||= { passed: 0, failed: 0 };
    summary[entry.category][entry.pass ? 'passed' : 'failed']++;
  }
  const failures = cases.filter(entry => !entry.pass);
  const report = { generatedAt: new Date().toISOString(), scope: 'Production methods with isolated repositories; no live DB, HTTP, UI browser, provider, concurrency or worker execution.', assumptions: ['Order transitions follow the shared domain graph with role and package guards.', 'Shipment milestone and exception transitions use statuses advertised by delivery validation.', 'Completed replacements resolve claims without contributing final returned quantity.'], total: cases.length, passed: cases.length - failures.length, failed: failures.length, summary, cases };
  const reportDir = path.join(workspace, 'docs/testing');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'order-status-audit-results.json'), JSON.stringify(report, null, 2) + '\n');
  const cell = value => String(JSON.stringify(value)).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const markdown = [
    '# Order status audit and fixes', '',
    `Current result: **${report.total} checks, ${report.passed} passed, ${report.failed} failed expectations.** These are scenario assertions, not end-to-end orders.`, '',
    'Baseline before fixes: 2,205 checks, 2,128 passed and 77 failed expectations (multiple assertions shared root causes). The original expectations remain in the suite; repository fixtures now support both inclusion and exclusion queries, and no-op tracking checks read the retained state when no write is needed.', '',
    '## Changes verified', '',
    '1. Delivery completion now counts each item’s remaining quantity and explicit package manifests. Cancelled quantities and reverse shipments do not count toward delivery. Shared rules drive delivery synchronization, buyer item projection, direct delivered guards and seller fulfillment groups.',
    '2. Every tracking event recalculates aggregate delivery progress. One seller’s later event cannot erase another seller’s partial delivery. Payment, hold, cancellation, return/refund and fulfilled states are preserved. Tracking writes recheck allowed parent states under the existing row lock.',
    '3. Seller actions and responses respect seller/store boundaries. Multi-store aggregate fulfillment is managed through the shipment workflow. A seller/store’s item references cannot match another store’s packages.',
    '4. Buyer item matching respects manifests and excludes reverse packages. Admin/customer display retains return/refund states and delivery exceptions; partial delivery remains explicit in customer progress. Delivery timestamps cannot override newer package evidence.',
    '5. Finalization and item payout eligibility block every return state except explicitly closed outcomes. Unknown future states and failed return lookups also block release. Finalization emits history/referral updates only if the conditional order update succeeds.',
    '6. Return windows start only after the item’s full active quantity arrives. Eligibility refreshes operate on already delivered items instead of marking remaining items delivered. COD collection remains independent of whether the last split quantity has arrived.',
    '7. QC failure awaiting review remains open; QC failure upheld is closed. A completed replacement resolves the claim without contributing final returned quantity. Actual refunded amounts continue to drive payment refund status.', '',
    '## Transition rules aligned', '',
    '- The four return_approved transitions follow the existing shared domain graph. Aggregate return approval is admin-only; buyers continue to use the item return-request workflow.',
    '- Shipment tracking supports manifested, picked-up, out-for-delivery and lost/damaged transitions already exposed by validation. Terminal shipment statuses cannot restart.',
    '- Manifested packages are cancellable before handover; picked-up/in-transit packages remain blocked.', '',
    '## Executable coverage', '',
    '- Every distinct pair of the 18 aggregate order states; single-seller shipment states; all 121 two-seller, 121 two-store, 121 split-package and 1,331 three-seller status combinations.',
    '- All six configured payment-provider enum values crossed with all seven payment states. This tests shipment guards, not provider integrations or checkout availability.',
    '- Quantity splits, cancellations, missing packages, reverse shipments, ownership, organization scope, delivery failures/RTO, late events, post-delivery returns/refunds, QC and replacements.',
    '- Fulfillment and payout workers, return database errors and unknown return states; same-state order idempotency; status writes rejected under the row lock; return-window timestamps and eligibility refreshes.',
    '- Existing admin status tests are run separately with react-scripts/Jest.', '',
    '| Category | Passed | Failed |', '| --- | ---: | ---: |',
    ...Object.entries(summary).map(([category, value]) => `| ${category} | ${value.passed} | ${value.failed} |`), '',
    '## Remaining failed expectations', '',
    ...(failures.length ? ['| Category | Scenario | Expected | Actual |', '| --- | --- | --- | --- |',
      ...failures.map(entry => `| ${entry.category} | ${entry.name} | ${cell(entry.expected)} | ${cell(entry.actual)} |`)] : ['None in the executable audit.']), '',
    '## Cross-screen regression', '',
    'The screenshot exposed a separate admin list path that the original audit did not exercise. Its SQL selected shipments.delivery_status (not a shipment column), then swallowed the error and returned an empty shipment list. The detail utility also promoted initiated labels to packed. Both defects are corrected.', '',
    '- GET /admin/orders now delegates to the same OrderRepository.listOrdersForAdmin and relation hydrator as the management list/detail paths. The legacy list response shape is retained.',
    '- A shared server presentation produces display_status, shipment_status and per-item effective_status. List, detail and customer progress use these fields; an automatically created initiated package does not imply packing.',
    '- Returns and cancellations are hydrated on both routes; closed/rejected claims cannot hide current fulfillment. Missing columns/tables or shipment-query errors reject the read instead of claiming Not Created.',
    '- New controller/service/repository contract tests compare all 18 order states crossed with all 11 shipment states, all 121 two-seller combinations, and all 242 same-store/split-store package combinations: 561 generated combinations, plus the screenshot, no-package, return/cancellation and error scenarios.',
    '- Order list/detail reads reject stale responses. The detail view also ignores older local responses, and the screens refresh when the window becomes visible again.', '',
    'Run the response suite with node backend/test/order-response-consistency.test.js. Its fixtures execute the real controller/service/repository methods and validate query-error propagation; they do not connect to a live database or exercise HTTP middleware.', '',
    '## Re-run', '',
    'From the workspace root, with existing Admin dependencies installed:', '', '```sh',
    'node backend/scripts/qa/audit-order-status.js', 'node backend/test/order-response-consistency.test.js', 'cd Admin',
    'CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/utils/orderDisplayStatus.test.js src/_helpers/ApiThunk.orderFreshness.test.js src/hooks/__tests__/useRealtimeRefresh.test.jsx', '```', '',
    'Exit 1 means a scenario failed; exit 2 means the audit could not complete. The audit regenerates this report and order-status-audit-results.json without accessing the database or payment providers.', '',
    '## Verification limits', '',
    'The tests execute production methods and frontend utilities with isolated repository fixtures. HTTP/RBAC middleware, browser flows, real database transactions, courier/payment callbacks, actual scheduler execution, deployed historical data and real concurrent requests remain unverified. The lock-guard tests exercise the repository method with transaction fixtures, not simultaneous database connections.', '',
    'No historical orders, payments, wallets or payouts were rewritten. Incorrect stored states already present in deployed data require a separate reconciliation review. Use the existing [manual order-to-invoice matrix](ORDER_TO_INVOICE_MANUAL_TEST_CASES.md) in a configured test environment before release.', '',
  ].join('\n');
  fs.writeFileSync(path.join(reportDir, 'ORDER_STATUS_AUDIT.md'), markdown);
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, summary, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 2; });
