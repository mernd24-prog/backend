const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/modules/product/services/product.service.js'), 'utf8');
const start = source.indexOf('  buildSearchFallbackFilter(query');
const end = source.indexOf('\n  // ─── Get single', start);
const context = {
  applyPublicProductFilter: () => ({ status: 'active', approvalStatus: 'approved' }),
  escapeRegExp: text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
};
vm.createContext(context);
vm.runInContext(`class Probe { ${source.slice(start, end)} } globalThis.service = new Probe();`, context);
context.service.applyStockFilters = () => {};
context.service.applyAttributeFilters = () => {};
function matches(product, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(clause => matches(product, clause));
    if (key === '$or') return value.some(clause => matches(product, clause));
    return typeof value?.test === 'function' ? value.test(product[key] || '') : product[key] === value;
  });
}
const product = { title: 'Premium Cotton Casual Shirt', 'attributes.color': 'Blue', status: 'active', approvalStatus: 'approved' };
for (const q of ['cotton premium', 'premium   cotton', 'blue cotton', 'PREMIUM']) {
  assert.ok(matches(product, context.service.buildSearchFallbackFilter({ q })), q);
}
assert.ok(!matches(product, context.service.buildSearchFallbackFilter({ q: 'cotton missing' })));
assert.ok(!matches({ ...product, status: 'draft' }, context.service.buildSearchFallbackFilter({ q: 'cotton' })));
assert.ok(!matches(product, context.service.buildSearchFallbackFilter({ q: '.*' })), 'regex characters are literal');
const scoped = context.service.buildSearchFallbackFilter({ q: 'cotton premium', categoryId: 'shirts' });
assert.ok(matches({ ...product, categoryId: 'shirts' }, scoped));
assert.ok(!matches({ ...product, categoryId: 'pants' }, scoped));
console.log('PASS: unordered words, whitespace, cross-field matches, all-word requirements, literal input and category/public filters.');
