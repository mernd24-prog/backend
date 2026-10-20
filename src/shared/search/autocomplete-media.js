const { normalizeImages } = require('./product-search-document');

function suggestionImages(product = {}) {
  const active = (product.variants || []).filter(variant => !variant.status || variant.status === 'active');
  const defaults = active.filter(variant => variant.isDefault);
  return normalizeImages([
    ...defaults.flatMap(variant => variant.images || []),
    ...(Array.isArray(product.images) ? product.images : [product.images]),
    ...(product.commonImages || []),
    ...active.flatMap(variant => variant.images || []),
    product.image, product.imageUrl, product.thumbnail, product.thumbnailUrl,
  ]).slice(0, 8);
}

async function resolveAutocompleteMedia(products, ProductModel, publicFilter) {
  const ids = [...new Set(products.map(product => String(product._id || product.id || '')).filter(id => /^[a-f0-9]{24}$/i.test(id)))];
  if (!ids.length) return products.map(product => ({ ...product, suggestionImages: suggestionImages(product) }));
  // One bounded query for the final suggestions, never the whole corpus.
  const latest = await ProductModel.find({ ...publicFilter, _id: { $in: ids } })
    .select('images commonImages image imageUrl thumbnail thumbnailUrl variants.images variants.isDefault variants.status')
    .lean().maxTimeMS(600).catch(() => []);
  const byId = new Map(latest.map(product => [String(product._id), product]));
  return products.map(product => {
    const current = byId.get(String(product._id || product.id || ''));
    const images = suggestionImages(current || product);
    return { ...product, suggestionImages: images.length ? images : suggestionImages(product) };
  });
}
module.exports = { suggestionImages, resolveAutocompleteMedia };
