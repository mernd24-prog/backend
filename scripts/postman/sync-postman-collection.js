#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const API_PREFIX = '/api/v1';
const COLLECTION_PATH = path.resolve('postman_collection.json');
const ROUTE_REGISTRY_PATH = path.resolve('src/api/register-routes.js');

const GROUP_NAMES = {
  '/auth': 'Auth',
  '/global': 'Global',
  '/users': 'Users',
  '/products': 'Products',
  '/carts': 'Cart',
  '/orders': 'Orders',
  '/cancellations': 'Cancellations',
  '/payments': 'Payments',
  '/platform': 'Platform',
  '/cms': 'CMS',
  '/sellers': 'Sellers',
  '/notifications': 'Notifications',
  '/analytics': 'Analytics',
  '/pricing': 'Pricing',
  '/coupons': 'Coupons',
  '/wallets': 'Wallet',
  '/admin/commerce-settings': 'Commerce Settings',
  '/admin': 'Admin',
  '/tax': 'Tax',
  '/subscriptions': 'Subscriptions',
  '/rbac': 'RBAC',
  '/warranty': 'Warranty',
  '/loyalty': 'Loyalty',
  '/recommendations': 'Recommendations',
  '/returns': 'Returns',
  '/fraud': 'Fraud',
  '/dynamic-pricing': 'Dynamic Pricing',
  '/sellers/commissions': 'Seller Commissions',
  '/admin/finance': 'Admin Finance',
  '/delivery': 'Delivery',
  '/deals': 'Deals',
  '/file-uploader': 'File Uploader',
  '/meta': 'Health & Meta',
  '/search': 'Search',
};

const PUBLIC_ENDPOINTS = new Set([
  'GET /health',
  'GET /api/v1/meta/routes',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/register-otp',
  'POST /api/v1/auth/verify-registration',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/social',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/send-otp',
  'POST /api/v1/auth/verify-otp',
  'POST /api/v1/auth/resend-otp',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/payments/webhooks/razorpay',
  'GET /api/v1/products',
  'GET /api/v1/products/search',
  'GET /api/v1/products/:productId',
  'GET /api/v1/platform/categories',
  'GET /api/v1/cms',
  'GET /api/v1/cms/:slug',
  'GET /api/v1/recommendations/trending',
  'GET /api/v1/delivery/serviceability',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toRequirePath(fromFile, requirePath) {
  const withExtension = requirePath.endsWith('.js') ? requirePath : `${requirePath}.js`;
  return path.normalize(path.resolve(path.dirname(fromFile), withExtension));
}

function parseImports(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const imports = new Map();
  const importRegex = /const\s+(?:\{\s*(\w+)\s*,?\s*\}|(\w+))\s*=\s*require\(["']([^"']+)["']\)/g;

  for (const match of source.matchAll(importRegex)) {
    imports.set(match[1] || match[2], toRequirePath(filePath, match[3]));
  }

  return { source, imports };
}

function parseRouteRegistry() {
  const { source, imports } = parseImports(ROUTE_REGISTRY_PATH);

  const mounts = [];
  const mountRegex = /app\.use\(\s*`\$\{env\.apiPrefix\}([^`]+)`\s*,\s*([A-Za-z_$][\w$]*)/;
  for (const line of source.split('\n')) {
    const match = line.match(mountRegex);
    if (match) {
      mounts.push({
        basePath: match[1],
        exportName: match[2],
        filePath: imports.get(match[2]),
      });
    }
  }
  if (!mounts.length) {
    throw new Error(`No route mounts discovered from ${ROUTE_REGISTRY_PATH}`);
  }
  return mounts;
}

function parseRouteFile(filePath, basePath = '', visited = new Set()) {
  const visitKey = `${filePath}:${basePath}`;
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);

  const { source, imports } = parseImports(filePath);
  const routeRegex = /\b\w+(?:Routes|Router)?\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/gi;
  const useRegex = /\b\w+(?:Routes|Router)?\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([A-Za-z_$][\w$]*)/gi;
  const routes = [];
  for (const match of source.matchAll(routeRegex)) {
    routes.push({ method: match[1].toUpperCase(), path: joinPaths(basePath, match[3]) });
  }
  for (const match of source.matchAll(useRegex)) {
    const childPath = imports.get(match[3]);
    if (!childPath || !fs.existsSync(childPath)) continue;
    routes.push(...parseRouteFile(childPath, joinPaths(basePath, match[2]), visited));
  }
  return routes;
}

function discoverRoutes() {
  const routes = [{ group: 'Health & Meta', method: 'GET', path: '/health' }];
  for (const mount of parseRouteRegistry()) {
    if (!mount.filePath || !fs.existsSync(mount.filePath)) {
      process.stderr.write(`Skipping route mount without readable file: ${mount.exportName}\n`);
      continue;
    }
    for (const route of parseRouteFile(mount.filePath)) {
      routes.push({
        group: GROUP_NAMES[mount.basePath] || titleFromBasePath(mount.basePath),
        method: route.method,
        path: `${API_PREFIX}${joinPaths(mount.basePath, route.path)}`,
      });
    }
  }
  return dedupe(routes);
}

function joinPaths(...parts) {
  const joined = parts
    .filter((part) => part !== undefined && part !== null && String(part) !== '')
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return joined ? `/${joined}` : '';
}

function dedupe(routes) {
  const seen = new Set();
  return routes.filter((route) => {
    const key = routeKey(route);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

function requestKey(item) {
  if (!item.request) return null;
  const rawUrl = typeof item.request.url === 'string' ? item.request.url : item.request.url.raw;
  return `${item.request.method} ${String(rawUrl).replace('{{baseUrl}}', '')}`;
}

function collectRequestKeys(collection) {
  const keys = new Set();
  const visit = (items = []) => {
    for (const item of items) {
      const key = requestKey(item);
      if (key) keys.add(key);
      if (item.item) visit(item.item);
    }
  };
  visit(collection.item);
  return keys;
}

function findOrCreateFolder(collection, name) {
  let folder = collection.item.find((item) => item.name === name && Array.isArray(item.item));
  if (!folder) {
    folder = { name, item: [] };
    collection.item.push(folder);
  }
  return folder;
}

function createRequestItem(route) {
  const key = routeKey(route);
  const item = {
    name: key,
    request: {
      method: route.method,
      header: [],
      url: `{{baseUrl}}${route.path}`,
    },
    response: [],
  };

  if (!PUBLIC_ENDPOINTS.has(key)) {
    item.request.auth = {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    };
  }

  if (['POST', 'PUT', 'PATCH'].includes(route.method) && !route.path.includes('/webhooks/')) {
    item.request.header.push({ key: 'Content-Type', value: 'application/json' });
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(route.method === 'PATCH' ? { status: 'active' } : { example: true }, null, 2),
    };
  }

  return item;
}

function titleFromBasePath(basePath) {
  return basePath
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/-/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function main() {
  const collection = readJson(COLLECTION_PATH);
  const discovered = discoverRoutes();
  const existingKeys = collectRequestKeys(collection);
  const routeKeys = new Set(discovered.map(routeKey));
  const added = [];

  for (const route of discovered) {
    const key = routeKey(route);
    if (existingKeys.has(key)) continue;
    findOrCreateFolder(collection, route.group).item.push(createRequestItem(route));
    existingKeys.add(key);
    added.push(key);
  }

  fs.writeFileSync(COLLECTION_PATH, `${JSON.stringify(collection, null, 2)}\n`);
  process.stdout.write(`Discovered ${discovered.length} API requests.\n`);
  process.stdout.write(`Added ${added.length} missing Postman request${added.length === 1 ? '' : 's'}.\n`);

  const extra = [...existingKeys].filter((key) => !routeKeys.has(key)).sort();
  if (extra.length) {
    process.stdout.write(`Collection requests not found in registered routes: ${extra.length}\n`);
  }
}

main();
