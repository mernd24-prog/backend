const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/modules/product/services/product.service.js'), 'utf8');
const start = source.indexOf('      const cacheKey = `products:management:');
const end = source.indexOf('\n      const result =', start);
assert.ok(start >= 0 && end > start);
const keyFor = (term, flags = 'i') => vm.runInNewContext(`
  const filter = { $or: [{ title: new RegExp(term, flags) }] };
  const pagination = { page: 1, limit: 10 };
  const projection = { title: 1 };
  ${source.slice(start, end)}
  cacheKey;
`, { term, flags });
const first = keyFor('Kurta');
const second = keyFor('I M G Fashion Baby Boys');
assert.notEqual(first, second, 'different searches must not share cached results');
assert.equal(second, keyFor('I M G Fashion Baby Boys'), 'same search reuses cache');
assert.notEqual(first, keyFor('Kurta', ''), 'regex flags affect cache identity');
assert.ok(second.startsWith('products:management:v4:'), 'old cache namespace is invalidated');
console.log('PASS: management search cache distinguishes terms and regex flags and invalidates old entries.');
