const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const godrej = { title: 'Godrej 600 L Frost Free', images: [] };
const golden = { title: 'Golden party wear Saree', images: [] };
const query = { sort() { return this; }, limit() { return this; }, select() { return this; }, lean() { return this; }, maxTimeMS: async () => [godrej, golden] };
const modules = {
  '../search/elasticsearch-client': { isElasticsearchEnabled: () => true, elasticsearchClient: { search: async () => ({ hits: { hits: [{ _source: golden }] } }) } },
  '../logger/logger': { logger: { warn() {} } },
  '../../modules/product/models/product.model': { ProductModel: { find: () => query } },
  '../../modules/platform/repositories/platform.repository': { PlatformRepository: class {} },
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
  console.log('PASS: partial Elasticsearch suggestions include current catalog prefixes without duplicates.');
})().catch(error => { console.error(error); process.exitCode = 1; });
