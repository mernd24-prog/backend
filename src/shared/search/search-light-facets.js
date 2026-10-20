// Only categories and colors are exposed on search; one bucket per product/color.
const asArray = expression => ({ $cond: [{ $isArray: expression }, expression, [expression]] });
function mongoSearchFacetPipeline(filter) {
  const variantColors = { $reduce: {
    input: { $filter: { input: { $ifNull: ['$variants', []] }, as: 'variant',
      cond: { $eq: [{ $ifNull: ['$$variant.status', 'active'] }, 'active'] } } },
    initialValue: [], in: { $concatArrays: ['$$value', asArray('$$this.attributes.color')] },
  } };
  return [
    { $match: filter },
    { $facet: {
      categories: [{ $group: { _id: { $cond: [{ $ne: [{ $ifNull: ['$categoryId', ''] }, ''] }, '$categoryId', '$category'] }, count: { $sum: 1 } } }],
      colors: [
        { $project: { colors: { $setUnion: [asArray('$attributes.color'), variantColors] } } },
        { $unwind: '$colors' },
        { $match: { colors: { $type: 'string', $nin: ['', null] } } },
        { $project: { color: { $toLower: { $trim: { input: '$colors' } } } } },
        { $match: { color: { $ne: '' } } },
        { $group: { _id: { product: '$_id', color: '$color' } } },
        { $group: { _id: '$_id.color', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } }, { $limit: 100 },
      ],
    } },
  ];
}

// Runtime reads existing index source, so no mapping migration/reindex is needed.
const colorRuntime = { type: 'keyword', script: { source: `
def p = params._source;
def colors = new HashSet();
def add = new ArrayList();
if (p.attributes != null && p.attributes.color != null) add.add(p.attributes.color);
if (p.variants != null) for (def v : p.variants) {
  if ((v.status == null || v.status == '' || v.status == 'active') && v.attributes != null && v.attributes.color != null) add.add(v.attributes.color);
}
for (def value : add) {
  if (value instanceof List) { for (def item : value) { if (item instanceof String && !item.trim().isEmpty()) colors.add(item.trim().toLowerCase()); } }
  else if (value instanceof String && !value.trim().isEmpty()) colors.add(value.trim().toLowerCase());
}
for (def color : colors) emit(color);
` } };

function colorFacets(buckets = []) {
  const values = buckets.map(bucket => {
    const value = String(bucket.key ?? bucket._id ?? '').trim();
    return { value, label: value.replace(/\b\w/g, letter => letter.toUpperCase()), count: Number(bucket.doc_count ?? bucket.count ?? 0) };
  }).filter(option => option.value && option.count > 0);
  return values.length ? [{ key: 'color', label: 'Color', values }] : [];
}
module.exports = { mongoSearchFacetPipeline, colorRuntime, colorFacets };
