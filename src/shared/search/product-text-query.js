function buildProductTextQuery(term) {
  const fields = ['title^4', 'shortDescription^2', 'brand^2', 'category^2', 'description', 'sku^2', 'tags^3', 'color', 'hsnCode', 'productFamilyCode'];
  return { bool: { should: [
    { multi_match: { query: term, fields, operator: 'and', fuzziness: 'AUTO', prefix_length: 2 } },
    { multi_match: { query: term, fields, operator: 'and', type: 'bool_prefix' } },
  ], minimum_should_match: 1 } };
}
module.exports = { buildProductTextQuery };
