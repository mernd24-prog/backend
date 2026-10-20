const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require.resolve('../src/modules/deal/services/deal.service'), 'utf8');
const helpers = require('../src/modules/deal/services/deal-variant');
const begin = source.indexOf('  normalizeProductForDeal(');
const end = source.indexOf('  async getAnalytics(', begin);
let categoryLookups = 0;
const CategoryTreeModel = { find(filter) {
  categoryLookups++;
  assert.deepEqual(Array.from(filter.$or[0].categoryKey.$in), ['shirts'], 'category lookup must be limited to current deal categories');
  return { select() { return this; }, lean() { return this; }, async maxTimeMS(ms) {
    assert.equal(ms, 1500);
    return (await service.platformRepository.listCategoriesFast()).items;
  } };
} };
const Service = vm.runInNewContext(`(class {${source.slice(begin, end)}})`, { ...helpers, CategoryTreeModel, mongoose: require('mongoose') });
const service = new Service();
const products = [
  { _id: 'a', status: 'active', title: 'Shirt', category: 'shirts', brand: 'brand', variants: [
    { _id: 'red', sku: 'RED', status: 'active', price: 100, stock: 0, attributes: { color: 'Red', size: 'L' } },
    { _id: 'blue', sku: 'BLUE', status: 'active', price: 200, stock: 9, attributes: { color: 'Blue', size: 'M' } },
  ] },
  { _id: 'b', status: 'active', title: 'Shirt 2', category: 'shirts', brand: 'brand', variants: [
    { _id: 'green', sku: 'GREEN', status: 'active', price: 300, stock: 2, attributes: { color: 'Green', size: 'M' } },
  ] },
];
service.dealRepository = {
  expireDueDeals: async () => {},
  listActiveDealProducts: async () => [
    { id: 'd1', productId: 'a', variantId: 'red', variantSku: 'RED' },
    { id: 'd2', productId: 'b', variantId: 'green', variantSku: 'GREEN' },
  ],
};
service.productRepository = { findByIds: async () => products };
service.platformRepository = {
  listCategoriesFast: async () => ({ items: [{ _id: 'cat', categoryKey: 'shirts', title: 'Shirts', parentKey: 'fashion', attributeSchema: [
    { key: 'color', label: 'Color', type: 'select', isFilterable: true, isVariantAttribute: true },
    { key: 'size', label: 'Size', type: 'select', isFilterable: true, isVariantAttribute: true },
  ] }] }),
  resolveBrandReferences: async () => new Map([['brand', { name: 'Real Brand' }]]),
  getCategoryDescendantKeys: async key => [key],
};
(async () => {
  const all = await service.getPublicDealProducts({ limit: 1 });
  assert.equal(all.total, 2);
  assert.equal(all.facets.brands[0].label, 'Real Brand');
  assert.equal(all.facets.availability.inStock, 1, 'unrelated sibling stock must not make a sold-out deal in stock');
  const colors = all.facets.attributes.find(facet => facet.key === 'color').values;
  assert.equal(colors.length, 2);
  assert.ok(!colors.some(option => option.value === 'Blue'), 'non-deal sibling color must not be offered');
  const red = await service.getPublicDealProducts({ attr_color: 'Red', limit: 1 });
  assert.equal(red.total, 1);
  assert.equal(red.items[0].variantId, 'red');
  assert.equal(red.facets.attributes[0].values.length, 2, 'facets stay stable while color selected');
  assert.equal((await service.getPublicDealProducts({ attr_color: 'Blue' })).total, 0);
  assert.equal((await service.getPublicDealProducts({ attr_color: 'Red,Green' })).total, 2);
  assert.equal((await service.getPublicDealProducts({ attr_color: 'Red', attr_size: 'M' })).total, 0, 'AND across attributes');
  assert.equal((await service.getPublicDealProducts({ in_stock: 'true' })).items[0].variantId, 'green');
  const { publicDealProductsSchema } = require('../src/modules/deal/validation/deal.validation');
  assert.equal(publicDealProductsSchema.query.validate({ attr_color: 'Red,Green', attr_size: 'M' }).error, undefined);
  console.log('PASS: schema-driven deal filters, selected variant, OR/AND matching, stable counts, stock, labels and validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
