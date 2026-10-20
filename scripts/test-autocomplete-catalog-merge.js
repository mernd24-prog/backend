const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const godrej = { title: 'Godrej 600 L Frost Free', images: [] };
const golden = { title: 'Golden party wear Saree', images: [] };
const query = { sort() { return this; }, limit() { return this; }, select() { return this; }, lean() { return this; }, maxTimeMS: async () => [godrej, golden] };
const modules = {
  "../tools/cache": { remember: async (key, ttl, loader) => loader() },
  "../search/autocomplete-media": require("../src/shared/search/autocomplete-media"),
  "../search/category-search-scope": require("../src/shared/search/category-search-scope"),
  '../search/elasticsearch-client': { isElasticsearchEnabled: () => true, elasticsearchClient: { search: async () => ({ hits: { hits: [{ _source: golden }] } }) } },
  '../logger/logger': { logger: { warn() {} } },
  '../../modules/product/models/product.model': { ProductModel: { find: () => query } },
  '../../modules/platform/repositories/platform.repository': { PlatformRepository: class { async listCategoriesFast() { return { items: [] }; } } },
  '../catalog/public-product-filter': { applyPublicProductFilter: value => value, buildPublicSearchFilters: () => [] },
  '../search/product-search-document': {},
};
const ctx = { module: { exports: {} }, require: name => { assert.ok(modules[name], name); return modules[name]; } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/shared/services/advanced-search.service.js'), 'utf8'), ctx);
const service = ctx.module.exports.AdvancedSearchService;
service.resolveSuggestionLabels = async rows => rows;
service.getAutocompleteCorpus = async () => [];
(async () => {
  const results = await service.getAutocompleteSuggestions('go', 8);
  assert.ok(results.some(row => row.title === godrej.title), 'catalog prefix product missing from index must appear');
  assert.equal(results.filter(row => row.title === golden.title).length, 1, 'merged duplicates removed');
  const shirt = { title: "Men's Casual Shirt", category: 'mens-shirts', categoryId: 'mens-shirts' };
  const top = { title: "Women's Wrap-style Top", category: 'womens-t-shirts', categoryId: 'womens-t-shirts' };
  service.getAutocompleteCorpus = async () => [top, shirt];
  modules['../search/elasticsearch-client'].elasticsearchClient.search = async () => ({ hits: { hits: [] } });
  const typo = await service.getAutocompleteSuggestions('shur', 8);
  assert.equal(typo[0].title, shirt.title, 'title typo match must outrank category-only matches');
  assert.ok(!typo.some(row => row.title === top.title), 'weak category typo must not introduce unrelated tops');
  service.platformRepository.listCategoriesFast = async () => ({ items: [
    { categoryKey: 'mens-shirts', title: 'Mens Shirts' },
    { categoryKey: 'womens-t-shirts', title: 'Womens T-Shirts' },
  ] });
  const scoped = await service.getAutocompleteSuggestions('shirt', 8, 'mens-shirts');
  assert.ok(scoped.some(row => row.title === shirt.title));
  assert.ok(!scoped.some(row => row.title === top.title), 'selected category must constrain suggestions');
  let capturedFilter;
  modules['../../modules/product/models/product.model'].ProductModel.findOne = filter => {
    capturedFilter = filter;
    return { select() { return this; }, lean() { return this; }, maxTimeMS: async () => ({ _id: 'godrej' }) };
  };
  let fallbackQuery;
  service.searchMongoFallback = async args => { fallbackQuery = args; return { results: [godrej] }; };
  const fullTitle = await service.search({ query: godrej.title, filters: { inStock: true } });
  assert.ok(capturedFilter.title.test(godrej.title));
  assert.ok(capturedFilter.title.test(godrej.title.replace(/ /g, "  ")), "extra spaces in stored title still match");
  assert.equal(fallbackQuery.query, godrej.title);
  assert.equal(fallbackQuery.filters.inStock, true);
  assert.equal(fullTitle.results[0].title, godrej.title);
  let esQuery;
  modules['../search/elasticsearch-client'].elasticsearchClient.search = async query => { esQuery = query; throw new Error('simulated index failure'); };
  await service.search({ query: 'godrj' });
  assert.equal(esQuery.body.query.bool.must[0].multi_match.operator, 'and');
  console.log('PASS: catalog/index autocomplete merge, exact-title search priority, filter preservation and strict fuzzy query.');
})().catch(error => { console.error(error); process.exitCode = 1; });
