// Resolve search-only category scopes without changing catalog relationships.
function normalize(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
// Apply the same possessive/plural normalization to every catalog word.
function canonical(token) {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss')
    ? token.slice(0, -1) : token;
}

function closeToken(left, right) {
  if (left.length < 3 || left.length !== right.length || left[0] !== right[0]) return false;
  let differences = 0;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) differences++;
  }
  return differences === 1;
}

function resolveCategorySearchScope(query = {}, categories = []) {
  const terms = normalize(query.q).split(' ').filter(Boolean);

  const references = category => [category.categoryKey, String(category._id || '')].filter(Boolean);
  const descendants = roots => {
    const keys = new Set(roots.map(category => category.categoryKey));
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) {
        if (keys.has(category.parentKey) && !keys.has(category.categoryKey)) {
          keys.add(category.categoryKey);
          changed = true;
        }
      }
    }
    return categories.filter(category => keys.has(category.categoryKey));
  };
  const rootsByToken = new Map();
  for (const category of categories) {
    const tokens = normalize(category.title || category.categoryKey).split(' ').filter(Boolean);
    for (const token of new Set(tokens.map(canonical))) {
      if (!rootsByToken.has(token)) rootsByToken.set(token, []);
      rootsByToken.get(token).push(category);
    }
  }
  const matchedIndexes = new Set();
  const inferredScopes = [];
  terms.forEach((term, index) => {
    const token = canonical(term);
    let match = rootsByToken.has(token) ? token : null;
    if (!match && token.length >= 2) {
      const prefixes = [...rootsByToken.keys()].filter(candidate => candidate.startsWith(token));
      // Only infer an unambiguous catalog word; ambiguous prefixes stay text searches.
      if (prefixes.length === 1) match = prefixes[0];
    }
    if (!match) {
      const candidates = [...rootsByToken.keys()].filter(candidate => closeToken(token, candidate));
      // Ambiguous spelling stays in the product query rather than forcing a category.
      if (candidates.length === 1) match = candidates[0];
    }
    if (!match) return;
    matchedIndexes.add(index);
    inferredScopes.push(descendants(rootsByToken.get(match)).flatMap(references));
  });
  const selected = query.category || query.categoryId || query.categorySlug;
  const selectedValues = String(selected || '').split(',').map(value => value.trim()).filter(Boolean);
  const explicit = selectedValues.length ? [...new Set(selectedValues.flatMap(value => {
    const root = categories.find(category => references(category).includes(value));
    return root ? descendants([root]).flatMap(references) : [value];
  }))] : null;
  const scopes = [...inferredScopes, explicit].filter(Boolean);
  return {
    term: matchedIndexes.size ? terms.filter((token, index) => !matchedIndexes.has(index)).join(' ') : String(query.q || '').trim(),
    scopes,
  };
}

module.exports = { resolveCategorySearchScope };
