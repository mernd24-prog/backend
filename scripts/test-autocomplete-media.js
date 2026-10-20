const assert = require('node:assert/strict');
const { suggestionImages, resolveAutocompleteMedia } = require('../src/shared/search/autocomplete-media');
(async () => {
  const product = { images: ['catalog'], commonImages: ['common'], variants: [
    { images: ['disabled'], status: 'inactive', isDefault: true },
    { images: ['default'], status: 'active', isDefault: true },
    { images: ['other', 'catalog'], status: 'active' },
  ], imageUrl: 'legacy' };
  assert.deepEqual(suggestionImages(product), ['default', 'catalog', 'common', 'other', 'legacy']);
  assert.deepEqual(suggestionImages({ variants: [{ images: ['variant-only'] }] }), ['variant-only']);
  let calls = 0;
  const id = '6ad6026d9d9d11dad775ad36';
  const model = { find(filter) {
    calls++;
    assert.deepEqual(filter._id.$in, [id]);
    assert.equal(filter.status, 'active');
    return { select() { return this; }, lean() { return this; }, async maxTimeMS(ms) {
      assert.equal(ms, 600);
      return [{ _id: id, ...product }];
    } };
  } };
  const result = await resolveAutocompleteMedia([{ _id: id }, { id }], model, { status: 'active' });
  assert.equal(calls, 1, 'one query for all final suggestions');
  assert.equal(result[0].suggestionImages[0], 'default');
  model.find = () => ({ select() { return this; }, lean() { return this; }, maxTimeMS: async () => { throw new Error('timeout'); } });
  const fallback = await resolveAutocompleteMedia([{ _id: id, imageUrl: 'indexed' }], model, {});
  assert.equal(fallback[0].suggestionImages[0], 'indexed');
  console.log('PASS: variant/catalog/common media priority, deduplication, one bounded query, timeout fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
