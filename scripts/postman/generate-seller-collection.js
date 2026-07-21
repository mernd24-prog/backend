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
flattenRequests(filteredTree).forEach((item) => buckets.get(sidebarModule(item)).push(item));
const folders = MODULE_ORDER
  .map((name) => ({ name, description: `Seller sidebar module: ${name.replace(/^\d+ - /, '')}`, item: buckets.get(name) }))
  .filter((folder) => folder.item.length);
const count = requestCount(folders);
const collection = {
  ...source,
  info: {
    ...source.info,
    name: 'Ecommerce Seller Panel API',
    description: `Seller-panel-only API collection organized in the canonical seller sidebar order: Dashboard, My Finance & Payouts, My Reports, Catalog, Inventory, Invoices, Marketing, Orders, and Shipping. Authentication, onboarding, profile, organizations, and access APIs are grouped separately because they sit outside sidebar navigation. Includes ${count} requests. Regenerate with: npm run postman:seller`,
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
  ].map(([key, value]) => ({ key, value, enabled: true, type: 'string' })),
  _postman_variable_scope: 'environment',
  _postman_exported_at: new Date().toISOString(),
  _postman_exported_using: 'Codex seller collection generator',
};
fs.writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`);
process.stdout.write(`Seller Postman collection generated: ${outputPath} (${count} requests)\nSeller environment generated: ${environmentPath}\n`);
