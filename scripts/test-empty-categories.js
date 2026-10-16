const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/modules/platform/repositories/platform.repository.js'), 'utf8');
const start = source.indexOf('  async listCategories(');
const stop = source.indexOf('\n  async ', source.indexOf('  async listCategoriesFast(') + 10);
const chain = { sort() { return this; }, select() { return this; }, lean() { return Promise.resolve([]); } };
// listCategoriesFast calls select after lean; use a thenable query like Mongoose.
const query = { sort() { return this; }, select() { return this; }, lean() { return this; }, then(resolve) { return Promise.resolve([]).then(resolve); } };
const context = { CategoryTreeModel: { find: () => query } };
vm.createContext(context);
vm.runInContext('class Probe {' + source.slice(start, stop) + '} globalThis.repo = new Probe();', context);
context.repo.getProductCountsByCategories = () => { throw new Error('Empty categories must not query products'); };
(async () => {
  for (const method of ['listCategories', 'listCategoriesFast']) {
    const result = await context.repo[method]({}, {}, ...(method === 'listCategoriesFast' ? [null, { hasProducts: true }] : [{ hasProducts: true }]));
    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  }
  console.log('PASS: empty category APIs return items=[]/total=0 without product aggregation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
