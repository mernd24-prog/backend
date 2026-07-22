#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve('postman_collection.json');
const outputPath = path.resolve('seller_postman_collection.json');
const environmentPath = path.resolve('seller_postman_environment.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const EXACT = new Set([
  'GET /health', 'GET /api/v1/meta/routes',
  'POST /api/v1/auth/login', 'POST /api/v1/auth/refresh', 'GET /api/v1/auth/status',
  'POST /api/v1/auth/send-otp', 'POST /api/v1/auth/verify-otp', 'POST /api/v1/auth/resend-otp',
  'POST /api/v1/auth/register-otp', 'POST /api/v1/auth/verify-registration',
  'POST /api/v1/auth/forgot-password', 'POST /api/v1/auth/reset-password', 'POST /api/v1/auth/change-password',
  'GET /api/v1/users/me',
  'GET /api/v1/orders/seller/me',
  'GET /api/v1/payments/cod-collections/mine',
  'GET /api/v1/analytics', 'GET /api/v1/analytics/seller-dashboard',
  'GET /api/v1/notifications/me', 'GET /api/v1/notifications/preferences', 'PUT /api/v1/notifications/preferences',
  'GET /api/v1/sellers/me/sidebar/modules',
  'GET /api/v1/platform/brands/submissions/mine', 'POST /api/v1/platform/brands/submissions',
  'GET /api/v1/sellers/me/product-reviews',
]);

const PREFIXES = [
  '/api/v1/sellers/onboarding/', '/api/v1/sellers/me/',
  '/api/v1/products/seller/', '/api/v1/products/manage/', '/api/v1/products/prefill',
  '/api/v1/products/bulk/', '/api/v1/products/special-prices/', '/api/v1/products/inventory/',
  '/api/v1/orders/', '/api/v1/cancellations', '/api/v1/returns',
  '/api/v1/delivery/', '/api/v1/shipping-profiles',
  '/api/v1/sellers/commissions/my-', '/api/v1/sellers/commissions/summary',
  '/api/v1/tax/orders/', '/api/v1/tax/invoices', '/api/v1/tax/credit-notes',
  '/api/v1/file-uploader',
  '/api/v1/meta/dropdowns/', '/api/v1/payments/cod-collections/shipments/',
];

const BLOCK = [
  '/admin/', '/process-payouts', '/payout-ops/', '/negative-balances',
  '/refund/retry', '/refund/sync', '/document-dispatches', '/dispatch',
];

function routeOf(item) {
  const method = String(item.request?.method || 'GET').toUpperCase();
  const raw = typeof item.request?.url === 'string'
    ? item.request.url
    : item.request?.url?.raw || '';
  const pathname = raw
    .replace(/^\{\{baseUrl\}\}/, '')
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]
    .replace(/\{\{([^}]+)\}\}/g, ':$1');
  return { method, pathname, key: `${method} ${pathname}` };
}

function allowed(item) {
  const route = routeOf(item);
  if (EXACT.has(route.key)) return true;
  if (BLOCK.some((part) => route.pathname.includes(part))) return false;
  if (!PREFIXES.some((prefix) => route.pathname.startsWith(prefix))) return false;
  // Shared order routes are seller-panel routes only when operating on an
  // existing seller-visible order. Never include buyer checkout creation.
  if (route.pathname === '/api/v1/orders' || route.pathname.includes('/checkout/')) return false;
  // Buyer-only order/return commands must never appear in the seller mobile
  // collection even though they share the same route prefix.
  if (route.key === 'POST /api/v1/orders/quote' || /\/payment\/retry$/.test(route.pathname)) return false;
  if (route.key === 'GET /api/v1/orders/me') return false;
  if (route.key === 'POST /api/v1/returns' || route.key === 'GET /api/v1/returns/my-returns') return false;
  if (/\/returns\/[^/]+\/ship-back$/.test(route.pathname)) return false;
  if (/\/returns\/[^/]+\/qc\/(dispute|decision)$/.test(route.pathname)) return false;
  if (/\/cancellations\/[^/]+\/(retry|manual-refund)$/.test(route.pathname)) return false;
  // Refund execution is Admin-only; sellers can approve replacement requests.
  if (/\/returns\/[^/]+\/refund$/.test(route.pathname)) return false;
  return true;
}

function filterNode(node) {
  if (!Array.isArray(node.item)) return allowed(node) ? node : null;
  const items = node.item.map(filterNode).filter(Boolean);
  return items.length ? { ...node, item: items } : null;
}

const requestCount = (nodes) => nodes.reduce(
  (sum, node) => sum + (Array.isArray(node.item) ? requestCount(node.item) : 1),
  0,
);
const filteredTree = source.item.map(filterNode).filter(Boolean);
const flattenRequests = (nodes) => nodes.flatMap((node) =>
  Array.isArray(node.item) ? flattenRequests(node.item) : [node],
);

const REQUEST_NAMES = {
  'GET /health': 'Check API availability',
  'POST /api/v1/auth/login': 'Log in as seller (run first)',
  'POST /api/v1/auth/refresh': 'Refresh expired access token',
  'GET /api/v1/users/me': 'Load signed-in seller account',
  'GET /api/v1/sellers/me/sidebar/modules': 'Load mobile navigation permissions',
  'GET /api/v1/sellers/me/dashboard': 'Load seller dashboard',
  'GET /api/v1/products/seller/me': 'List seller products',
  'GET /api/v1/orders/seller/me': 'List seller order items',
  'GET /api/v1/orders/:orderId': 'Get order details',
  'PATCH /api/v1/orders/:orderId/status': 'Update fulfilment status',
  'GET /api/v1/returns': 'List returns requiring seller action',
  'GET /api/v1/returns/:returnId': 'Get return and item details',
  'POST /api/v1/returns/:returnId/approve': 'Approve return request',
  'POST /api/v1/returns/:returnId/reject': 'Reject return request',
  'POST /api/v1/returns/:returnId/schedule': 'Schedule reverse pickup',
  'POST /api/v1/returns/:returnId/reverse-shipment/tracking': 'Update reverse pickup tracking',
  'POST /api/v1/returns/:returnId/receive': 'Confirm returned item received',
  'POST /api/v1/returns/:returnId/qc': 'Record returned item quality check',
  'POST /api/v1/returns/:returnId/qc/evidence': 'Submit extra QC evidence requested by admin',
  'POST /api/v1/returns/:returnId/replacement': 'Approve replacement after QC',
  'POST /api/v1/returns/:returnId/close': 'Close resolved return',
  'POST /api/v1/returns/:returnId/return-to-customer': 'Ship QC-rejected item back to customer',
  'POST /api/v1/returns/:returnId/return-to-customer/tracking': 'Update rejected-item shipment tracking',
  'GET /api/v1/sellers/commissions/my-payouts': 'List seller payouts',
  'GET /api/v1/sellers/commissions/my-summary': 'Get complete seller deduction summary',
  'GET /api/v1/sellers/commissions/my-settlements': 'List seller settlements',
  'GET /api/v1/tax/orders/:orderId/invoice': 'Get customer product tax invoice',
  'GET /api/v1/tax/orders/:orderId/marketplace-invoices': 'Get platform commission invoices',
};

const REQUEST_GUIDES = {
  'POST /api/v1/auth/login': 'Use seller credentials. A successful response automatically saves accessToken and refreshToken to the selected environment.',
  'GET /api/v1/orders/seller/me': 'Primary mobile order list. Results are seller-scoped; a multi-seller order exposes only this seller\'s items and amounts.',
  'GET /api/v1/returns': 'Seller operations queue. Open a return to obtain returnId before running a transition request.',
  'POST /api/v1/returns/:returnId/approve': 'Seller decision only. Approval does not refund money and does not mean the item has been received.',
  'POST /api/v1/returns/:returnId/schedule': 'Run only after approval. Creates the reverse-pickup plan; do not expose Receive until tracking shows delivery to the seller.',
  'POST /api/v1/returns/:returnId/receive': 'Run after the reverse shipment reaches the seller. This unlocks quality inspection; it must not be called at pickup time.',
  'POST /api/v1/returns/:returnId/qc': 'Run after Receive. Pass/fail applies only to the returned order item. Refund release remains an admin/payment operation.',
  'POST /api/v1/returns/:returnId/qc/evidence': 'Use only when an admin requests more evidence after failed QC.',
  'POST /api/v1/returns/:returnId/return-to-customer': 'Use only after admin upholds failed QC and the API says return-to-customer is required.',
  'GET /api/v1/tax/orders/:orderId/invoice': 'Customer-facing product invoice issued by the seller for the seller-owned items in this order.',
  'GET /api/v1/tax/orders/:orderId/marketplace-invoices': 'Seller-facing service/commission invoice issued by the marketplace. This is not a customer product invoice.',
};

function readableFallback(item) {
  const { method, pathname } = routeOf(item);
  const words = pathname.split('/').filter(Boolean).slice(2).map((part) =>
    part.startsWith(':') ? `by ${part.slice(1)}` : part.replace(/-/g, ' '));
  return `${method} — ${words.join(' / ')}`;
}

function decorateRequest(item) {
  const route = routeOf(item);
  const copy = JSON.parse(JSON.stringify(item).replace(/\{\{userEmail\}\}/g, '{{sellerEmail}}').replace(/\{\{userPassword\}\}/g, '{{sellerPassword}}'));
  copy.name = REQUEST_NAMES[route.key] || readableFallback(item);
  copy.request.description = [
    REQUEST_GUIDES[route.key] || 'Seller-scoped endpoint. See the saved success and error examples before implementing the mobile state.',
    `Endpoint: ${route.method} ${route.pathname}`,
  ].join('\n\n');
  if (route.key === 'POST /api/v1/auth/login') {
    copy.event = [{
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'const json = pm.response.json();',
          'const data = json.data || json;',
          'const tokens = data.tokens || data;',
          'if (tokens.accessToken) pm.environment.set("accessToken", tokens.accessToken);',
          'if (tokens.refreshToken) pm.environment.set("refreshToken", tokens.refreshToken);',
          'if (data.user?.id) pm.environment.set("sellerId", data.user.id);',
        ],
      },
    }];
  }
  return copy;
}

const MODULE_ORDER = [
  '00 - Authentication & Seller Onboarding',
  '01 - Dashboard',
  '02 - My Finance & Payouts',
  '03 - My Reports',
  '04 - Catalog',
  '05 - Inventory',
  '06 - Invoices',
  '07 - Marketing',
  '08 - Orders',
  '09 - Shipping',
];

function sidebarModule(item) {
  const { pathname } = routeOf(item);
  if (pathname.includes('/sellers/me/dashboard')) return '01 - Dashboard';
  if (pathname.includes('/sellers/commissions') || pathname.includes('/payments/cod-collections')) return '02 - My Finance & Payouts';
  if (pathname.includes('/analytics')) return '03 - My Reports';
  if (pathname.includes('/products/inventory')) return '05 - Inventory';
  if (pathname.includes('/tax/')) return '06 - Invoices';
  if (pathname.includes('/notifications/')) return '07 - Marketing';
  if (pathname.includes('/orders/') || pathname.includes('/returns') || pathname.includes('/cancellations')) return '08 - Orders';
  if (pathname.includes('/delivery/') || pathname.includes('/shipping-profiles') || pathname.includes('/sellers/me/tracking')) return '09 - Shipping';
  if (pathname.includes('/products') || pathname.includes('/platform/brands') || pathname.includes('/product-reviews') || pathname.includes('/file-uploader') || pathname.includes('/meta/dropdowns')) return '04 - Catalog';
  return '00 - Authentication & Seller Onboarding';
}

const buckets = new Map(MODULE_ORDER.map((name) => [name, []]));
flattenRequests(filteredTree).forEach((item) => buckets.get(sidebarModule(item)).push(decorateRequest(item)));

function subgroup(moduleName, item) {
  const { pathname } = routeOf(item);
  if (moduleName.startsWith('00')) {
    if (pathname.includes('/auth/')) return '01 - Sign in & account recovery';
    if (pathname.includes('/onboarding/') || pathname.includes('/kyc')) return '02 - Seller registration & KYC';
    if (pathname.includes('/sub-admins') || pathname.includes('/access/') || pathname.includes('/sidebar/')) return '04 - Team access & permissions';
    if (pathname.includes('/organizations')) return '05 - Organizations';
    return '03 - Seller profile & settings';
  }
  if (moduleName.startsWith('08')) {
    if (pathname.includes('/returns')) return pathname === '/api/v1/returns' || pathname.includes('/my-returns') || /\/returns\/(order\/|:returnId$)/.test(pathname)
      ? '02 - Returns: find & review' : '03 - Returns: seller actions (run in status order)';
    if (pathname.includes('/cancellations')) return '04 - Cancellations';
    return '01 - Orders & fulfilment';
  }
  if (moduleName.startsWith('09')) {
    if (pathname.includes('/shipping-profiles')) return '03 - Shipping profile setup';
    if (pathname.includes('/tracking')) return '02 - Shipment tracking';
    return '01 - Create & price shipments';
  }
  return null;
}

function nestModule(name, items) {
  const groups = new Map();
  items.forEach((item) => {
    const groupName = subgroup(name, item);
    if (!groupName) return;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(item);
  });
  if (!groups.size) return items;
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([groupName, groupItems]) => ({
    name: groupName,
    description: groupName.includes('seller actions')
      ? 'Use the return detail status to enable exactly one valid next action. Typical path: Approve → Schedule pickup → Track → Receive → QC → Replacement/close. Refund execution is not a seller action.'
      : `Mobile workflow group: ${groupName.replace(/^\d+ - /, '')}`,
    item: groupItems,
  }));
}
const folders = MODULE_ORDER
  .map((name) => ({ name, description: `Seller mobile module: ${name.replace(/^\d+ - /, '')}`, item: nestModule(name, buckets.get(name)) }))
  .filter((folder) => folder.item.length);
const count = requestCount(folders);
const collection = {
  ...source,
  info: {
    ...source.info,
    name: 'Ecommerce Seller Panel API',
    description: `SELLER MOBILE API — START HERE\n\nSetup\n1. Import seller_postman_environment.json and select it.\n2. Set baseUrl, sellerEmail, and sellerPassword.\n3. Run “Log in as seller (run first)”; tokens are saved automatically.\n4. Load account, navigation permissions, then dashboard.\n5. Open only the workflow module being implemented.\n\nRules\n- Every order, amount, invoice, return, and payout is seller-scoped.\n- In a multi-seller order, display only the current seller's items and allocated discount/fees.\n- Return actions must follow server status; pickup and receive are different events.\n- Sellers approve/reject and inspect returns. Admin/payment services release refunds.\n- Product invoices are seller → customer. Commission invoices are marketplace → seller.\n\nIncludes ${count} requests. Human-readable names show intent; the exact method/path remains in each request description. Regenerate with: npm run postman:seller`,
  },
  item: folders,
  variable: [
    ...(source.variable || []),
    { key: 'sellerEmail', value: 'seller@example.com', type: 'string' },
    { key: 'sellerPassword', value: 'Seller@123', type: 'string' },
    { key: 'organizationId', value: '', type: 'string' },
    { key: 'invoiceId', value: '', type: 'string' },
    { key: 'creditNoteId', value: '', type: 'string' },
    { key: 'settlementId', value: '', type: 'string' },
    { key: 'shippingProfileId', value: '', type: 'string' },
  ],
};

fs.writeFileSync(outputPath, `${JSON.stringify(collection, null, 2)}\n`);
const environment = {
  id: 'ecommerce-seller-env',
  name: 'Ecommerce Seller API - Development',
  values: [
    ['baseUrl', 'http://localhost:4000'], ['accessToken', ''], ['refreshToken', ''],
    ['sellerEmail', 'seller@example.com'], ['sellerPassword', 'Seller@123'],
    ['sellerId', ''], ['organizationId', ''], ['sellerSubAdminUserId', ''],
    ['productId', ''], ['orderId', ''], ['shipmentId', ''], ['returnId', ''],
    ['cancellationId', ''], ['invoiceId', ''], ['creditNoteId', ''],
    ['settlementId', ''], ['shippingProfileId', ''], ['dealId', ''],
  ].map(([key, value], index) => ({
    key, value, enabled: true, type: index >= 1 && index <= 4 ? 'secret' : 'string',
    description: index < 5 ? 'Required for initial setup/login.' : 'Filled from a list/detail response and reused by action requests.',
  })),
  _postman_variable_scope: 'environment',
  _postman_exported_at: new Date().toISOString(),
  _postman_exported_using: 'Codex seller collection generator',
};
fs.writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`);
process.stdout.write(`Seller Postman collection generated: ${outputPath} (${count} requests)\nSeller environment generated: ${environmentPath}\n`);
