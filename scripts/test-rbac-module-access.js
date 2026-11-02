const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getRequestModule, cleanModuleName } = require('../src/shared/auth/module-access');
const { allowActions, allowPermissions } = require('../src/shared/middleware/access');

function authorize(path, permissions, method = 'GET', middleware = allowActions('catalog_manage')) {
  let outcome;
  middleware({
    originalUrl: `/api/v1${path}`, method,
    auth: { role: 'admin', allowedModules: permissions.map(slug => slug.split(':')[0]), permissions },
  }, {}, error => { outcome = error || null; });
  return outcome;
}

const routes = [
  ['/admin/cancellations', 'cancellations'],
  ['/admin/wallets', 'wallets'],
  ['/admin/deals', 'deals'],
  ['/admin/notifications', 'notifications'],
  ['/admin/ca-analytics/summary', 'ca-analytics'],
  ['/admin/platform/subscription-plans', 'subscriptions'],
  ['/platform/subscription-plans', 'subscriptions'],
  ['/admin/platform/api-keys', 'admin'],
  ['/admin/platform/webhooks', 'admin'],
  ['/sellers/me/dashboard', 'seller-dashboard'],
  ['/sellers/me/ca-analytics/summary', 'sellers/commissions'],
  ['/admin/referral/influencers', 'influencer-management'],
  ['/admin/referral/reports/hierarchy', 'referral-hierarchy'],
  ['/admin/referral/codes', 'referral-codes'],
  ['/admin/referral/commissions', 'referral-ledger'],
  ['/admin/referral/reports/bonus-progress', 'referral-bonus-progress'],
  ['/admin/referral/bonus-achievements', 'referral-bonus-history'],
];
for (const [path, module] of routes) {
  test(`${path} uses ${module} and accepts its view permission`, () => {
    assert.equal(getRequestModule({ originalUrl: `/api/v1${path}` }), module);
    assert.equal(authorize(path, [`${module}:view`]), null);
    assert.equal(authorize(path, ['products:view'])?.statusCode, 403);
  });
}

test('Referral Partner Management keeps its own catalog identity', () => {
  assert.equal(cleanModuleName('influencer-management'), 'influencer-management');
  assert.equal(cleanModuleName('influencer_management'), 'influencer-management');
  assert.equal(authorize('/admin/referral/influencers', ['referral:view'])?.statusCode, 403);
});

test('GET approval and recovery screens require view, mutations keep their actions', () => {
  for (const action of ['approval', 'approve', 'reject', 'restore', 'recover']) {
    const path = `/admin/orders/${action}`;
    assert.equal(authorize(path, ['orders:view']), null);
    assert.equal(authorize(path, ['orders:view'], 'POST')?.statusCode, 403);
  }
  assert.equal(authorize('/admin/orders/123/approve', ['orders:approve'], 'POST'), null);
});

test('query text cannot change the required action', () => {
  assert.equal(authorize('/admin/orders?q=/approve/export', ['orders:view']), null);
});

test('export access is separate from view', () => {
  assert.equal(authorize('/admin/ca-analytics/exports/sales', ['ca-analytics:view'])?.statusCode, 403);
  assert.equal(authorize('/admin/ca-analytics/exports/sales', ['ca-analytics:export']), null);
});

test('explicit route permissions and inferred module scope agree', () => {
  assert.equal(authorize('/admin/ca-analytics/summary', ['ca-analytics:view'], 'GET', allowPermissions('ca-analytics:view')), null);
});

test('assigning a module alone does not grant action permissions', () => {
  let outcome;
  allowActions('catalog_manage')({ originalUrl: '/api/v1/admin/referral/codes', method: 'GET', auth: {
    role: 'admin', allowedModules: ['referral-codes'], permissions: [],
  } }, {}, error => { outcome = error; });
  assert.equal(outcome?.statusCode, 403);
});


test('referral marketing settings use Rules & Coins permissions', () => {
  const path = '/admin/commerce-settings/marketing-policy/referrals';
  assert.equal(getRequestModule({ originalUrl: `/api/v1${path}` }), 'referral-rules');
  assert.equal(authorize(path, ['referral-rules:view']), null);
  assert.equal(authorize(path, ['referral-rules:update'], 'PUT'), null);
  assert.equal(authorize(path, ['referral-rules:view'], 'PUT')?.statusCode, 403);
  assert.equal(authorize(path, ['referral-overview:view'])?.statusCode, 403);
});

test('referral rules do not grant access to other commerce settings', () => {
  for (const path of ['/admin/commerce-settings', '/admin/commerce-settings/marketing-policy/coupons']) {
    assert.equal(authorize(path, ['referral-rules:view'])?.statusCode, 403);
    assert.equal(authorize(path, ['referral-rules:update'], 'PUT')?.statusCode, 403);
    assert.equal(authorize(path, ['admin:view']), null);
    assert.equal(authorize(path, ['admin:update'], 'PUT'), null);
  }
});
