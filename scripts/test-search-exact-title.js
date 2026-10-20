const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { resolveCategorySearchScope } = require('../src/shared/search/category-search-scope');
const source = fs.readFileSync(path.join(__dirname, '../src/modules/product/services/product.service.js'), 'utf8');
const start = source.indexOf('  async searchProducts(query)');
const end = source.indexOf('\n  // ─── Review', start);
const title = "Men's Burgundy Cotton Drawstring Jogger Pants";
const categories = [{ categoryKey: 'joggers', title: 'Men Joggers', _id: 'j' }, { categoryKey: 'pants', title: 'Pants', _id: 'p' }];
let captured;
let lookup;
const context = {
  ...require("../src/shared/search/search-light-facets"),
  splitFilterValues: value => String(value).split(','),
  remember: async (key, ttl, loader) => loader(),
  CategoryTreeModel: { find: () => ({ select() { return this; }, lean: async () => categories }) },
  ProductModel: {
    findOne(filter) { lookup = filter; return { select() { return this; }, lean: async () => ({ _id: 'product' }) }; },
    aggregate: async () => [{ categories: [{ _id: 'joggers', count: 1 }], colors: [{ _id: 'blue', count: 1 }] }],
  },
  escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  applyPublicProductFilter: filter => ({ ...filter, status: 'active', approvalStatus: 'approved' }),
  resolveCategorySearchScope,
  isElasticsearchEnabled: () => { throw new Error('Exact title must use current catalog, independent of index'); },
};
vm.createContext(context);
vm.runInContext(`class Probe { ${source.slice(start, end)} } globalThis.service = new Probe();`, context);
const service = context.service;
service.buildSearchFallbackFilter = query => {
  assert.equal(query.q, '', 'exact title must bypass category inference');
  return { status: 'active', approvalStatus: 'approved', brand: query.brand };
};
service.productRepository = { paginate: async filter => {
  captured = filter;
  const scopes = filter.$and || [];
  const allowed = scopes.every(scope => scope.$or.some(clause => Object.values(clause)[0].$in.includes('joggers')));
  return { items: allowed ? [{ title }] : [], total: allowed ? 1 : 0 };
} };
(async () => {
  const result = await service.searchProducts({ q: title, brand: 'brand-id' });
  assert.equal(result.total, 1);
  assert.equal(captured.$and, undefined, 'title words must not force contradictory categories');
  assert.equal(captured.brand, 'brand-id');
  assert.ok(captured.title.test(title));
  assert.ok(lookup.title.test(title.replace(/ /g, '  ')));
  assert.equal(result.facets.categories[0].value, 'joggers');
  const filtered = await service.searchProducts({ q: title, categoryId: 'pants' });
  assert.equal(filtered.total, 0, 'explicit category must remain enforced');
  let facetFilter;
  context.ProductModel.aggregate = async pipeline => {
    facetFilter = pipeline[0].$match;
    return [{ categories: [{ _id: 'joggers', count: 3 }], colors: [
      { _id: 'blue', count: 2 }, { _id: 'navy blue', count: 1 }, { _id: 'white', count: 1 },
    ] }];
  };
  const products = [
    { colors: ['Blue', 'Navy Blue'] }, { colors: ['Blue'] }, { colors: ['White'] },
  ];
  service.productRepository.paginate = async filter => {
    captured = filter;
    const condition = filter.$and?.find(clause => clause.$or?.some(value => value['attributes.color']));
    const patterns = condition?.$or[0]['attributes.color'].$in || [];
    const items = products.filter(product => !patterns.length || product.colors.some(color => patterns.some(regex => regex.test(color))));
    return { items, total: items.length };
  };
  const multiColor = await service.searchProducts({ q: title, attr_color: 'blue,navy blue' });
  assert.equal(multiColor.total, 2, 'OR within colors; overlapping products count only once');
  assert.equal(multiColor.facets.attributes[0].values.length, 3, 'other colors remain available');
  assert.equal(facetFilter.$and?.length || 0, 0, 'facet scope excludes selected colors');
  assert.ok(captured.$and[0].$or.some(clause => clause['variants.attributes.color']));
  const clearColor = await service.searchProducts({ q: title });
  assert.equal(clearColor.total, 3);
  console.log('PASS: full suggestion title finds catalog product; explicit filters preserved and category inference bypassed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
