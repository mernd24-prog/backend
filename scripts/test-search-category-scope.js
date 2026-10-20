const assert = require('node:assert/strict');
const { resolveCategorySearchScope: resolve } = require('../src/shared/search/category-search-scope');
const categories = [
  { categoryKey: 'fashion', _id: 'root', title: 'Fashion' },
  { categoryKey: 'mens-topwear', _id: 'men', title: 'Men’s Topwear', parentKey: 'fashion' },
  { categoryKey: 'shirts', _id: 'shirt', title: 'Shirts', parentKey: 'mens-topwear' },
  { categoryKey: 'womens-wear', _id: 'women', title: "Women's Wear", parentKey: 'fashion' },
  { categoryKey: 'tops', _id: 'top', title: 'Tops', parentKey: 'womens-wear' },
];
const original = JSON.stringify(categories);
for (const q of ['man', 'men', 'mens', "men's"]) {
  const result = resolve({ q }, categories);
  assert.equal(result.term, '');
  assert.ok(result.scopes[0].includes('shirts'));
  assert.ok(result.scopes[0].includes('shirt'));
  assert.ok(!result.scopes[0].includes('tops'));
}
assert.equal(resolve({ q: 'man shirt' }, categories).term, '');
assert.equal(resolve({ q: 'man shirt' }, categories).scopes.length, 2);
assert.ok(resolve({ q: 'women' }, categories).scopes[0].includes('tops'));
assert.ok(!resolve({ q: 'women' }, categories).scopes[0].includes('shirts'));
assert.deepEqual(resolve({ q: 'Batman' }, categories), { term: 'Batman', scopes: [] });
assert.ok(resolve({ q: 'shirt' }, categories).scopes[0].includes('shirts'));
assert.equal(resolve({ q: 'man' }, []).term, 'man');
assert.ok(resolve({ q: 'shirt', categoryId: 'root' }, categories).scopes.at(-1).includes('tops'));
assert.equal(resolve({ q: 'man', categoryId: 'womens-wear' }, categories).scopes.length, 2);
const catalog = [
  ...categories,
  { categoryKey: 'electronics', title: 'Electronics', _id: 'e' },
  { categoryKey: 'phones', title: 'Mobile Phones', parentKey: 'electronics', _id: 'p' },
  { categoryKey: 'chairs', title: 'Office Chairs', _id: 'c' },
  { categoryKey: 'serums', title: 'Face Serums', _id: 's' },
];
for (const [q, key] of [['wo', 'tops'], ['wom', 'tops'], ['mob', 'phones'], ['elec', 'phones'], ['cha', 'chairs'], ['ser', 'serums'], ['electronics', 'phones'], ['phone', 'phones'], ['mobile', 'phones'], ['chair', 'chairs'], ['serum', 'serums']]) {
  const result = resolve({ q }, catalog);
  assert.equal(result.term, '');
  assert.ok(result.scopes[0].includes(key), q);
}
assert.equal(resolve({ q: 'mobile black' }, catalog).term, 'black');
assert.deepEqual(resolve({ q: 'TV' }, catalog).scopes, [], 'do not invent synonyms absent from the catalog');
const ambiguous = [...catalog, { categoryKey: 'wood', title: 'Wood Furniture' }];
assert.equal(resolve({ q: 'wo' }, ambiguous).term, 'wo', 'ambiguous prefixes must not force a category');
assert.equal(resolve({ q: 'w' }, catalog).term, 'w', 'single letters do not infer category intent');
assert.equal(JSON.stringify(categories), original);
console.log('PASS: generic catalog intent across fashion, electronics, furniture and beauty; descendants and relationships preserved.');
