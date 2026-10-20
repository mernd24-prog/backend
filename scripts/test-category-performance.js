const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

function method(file, name) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const start = source.indexOf(`  async ${name}(`);
  const stop = source.indexOf('\n  async ', start + 10);
  return source.slice(start, stop);
}

(async () => {
  const context = {
    remember: async (key, ttl, loader) => loader(),
    CategoryTreeModel: { find: () => ({ select() { return this; }, lean: async () => [
      { categoryKey: 'fashion', _id: 'root' },
      { categoryKey: 'shirts', parentKey: 'fashion', _id: 'leaf' },
      { categoryKey: 'other', _id: 'other-id' },
    ] }) },
    applyPublicProductFilter: () => ({ status: 'active' }),
    ProductModel: { aggregate: async (pipeline) => {
      assert.equal(pipeline[1].$group.count.$sum, 1);
      assert.equal(pipeline[0].$match.status, 'active');
      return [
        { categoryId: 'leaf', category: 'other', count: 7 },
        { categoryId: 'unknown', category: 'shirts', count: 3 },
        { category: 'other', count: 2 },
      ];
    } },
  };
  vm.createContext(context);
  vm.runInContext(`class Probe {${method('../src/modules/platform/repositories/platform.repository.js', 'getProductCountsByCategories')}} globalThis.repo = new Probe();`, context);
  const counts = await context.repo.getProductCountsByCategories([{ categoryKey: 'fashion', _id: 'root' }]);
  assert.equal(counts.get('fashion'), 10);
  assert.equal(counts.get('shirts'), 10);
  assert.equal(counts.get('other'), 2, 'categoryId wins without double counting');

  const cacheContext = {};
  vm.createContext(cacheContext);
  vm.runInContext(`class Probe { constructor() { this.categoryTreeCache = new Map(); } ${method('../src/modules/platform/services/platform.service.js', 'loadCategoryCache')}} globalThis.service = new Probe();`, cacheContext);
  const service = cacheContext.service;
  let calls = 0;
  let resolve;
  const loader = () => { calls++; return new Promise(r => { resolve = r; }); };
  const requests = Array.from({ length: 10 }, () => service.loadCategoryCache('tree', loader));
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ items: ['fashion'] });
  const results = await Promise.all(requests);
  assert.ok(results.every(value => value === results[0]));
  assert.equal(await service.loadCategoryCache('tree', loader), results[0]);
  assert.equal(calls, 1);
  await assert.rejects(service.loadCategoryCache('failed', () => { throw new Error('DB failure'); }), /DB failure/);
  assert.equal(await service.loadCategoryCache('failed', async () => 'recovered'), 'recovered');
  service.categoryTreeCache.get('tree').expiresAt = 0;
  assert.equal(await service.loadCategoryCache('tree', async () => 'fresh'), 'fresh');
  console.log('PASS: grouped counts, ancestor totals, concurrent cache loads, expiry, and failure recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
