/**
 * Advanced Search Service (PRODUCTION READY)
 */

const {
  elasticsearchClient,
  isElasticsearchEnabled,
} = require("../search/elasticsearch-client");
const { logger } = require("../logger/logger");
const { ProductModel } = require("../../modules/product/models/product.model");
const {
  applyPublicProductFilter,
  buildPublicSearchFilters,
  isPublicProduct,
} = require("../catalog/public-product-filter");

const AUTOCOMPLETE_CACHE_TTL_MS = 2 * 60 * 1000;
const AUTOCOMPLETE_CACHE_MAX_ITEMS = 200;
const AUTOCOMPLETE_CORPUS_CACHE_TTL_MS = 5 * 60 * 1000;
const autocompleteCache = new Map();
const autocompleteInFlight = new Map();
let autocompleteCorpusCache = null;

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendExpressionFilter(filter, expression) {
  if (!filter.$expr) {
    filter.$expr = expression;
    return;
  }

  filter.$and = [
    ...(filter.$and || []),
    { $expr: filter.$expr },
    { $expr: expression },
  ];
  delete filter.$expr;
}

function addAndFilter(filter, condition) {
  filter.$and = [
    ...(filter.$and || []),
    condition,
  ];
}

function normalizeFilterValues(value) {
  const values = Array.isArray(value) ? value : String(value).split(",");
  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function buildElasticExactFilter(fields = [], value) {
  const values = normalizeFilterValues(value);
  if (!values.length) return null;

  return {
    bool: {
      should: fields.flatMap((field) => (
        values.length > 1
          ? [{ terms: { [field]: values } }]
          : [{ term: { [field]: values[0] } }]
      )),
      minimum_should_match: 1,
    },
  };
}

function getAutocompleteCache(key) {
  const cached = autocompleteCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > AUTOCOMPLETE_CACHE_TTL_MS) {
    autocompleteCache.delete(key);
    return null;
  }
  return cached.value;
}

function setAutocompleteCache(key, value) {
  autocompleteCache.set(key, { value, cachedAt: Date.now() });
  if (autocompleteCache.size > AUTOCOMPLETE_CACHE_MAX_ITEMS) {
    autocompleteCache.delete(autocompleteCache.keys().next().value);
  }
}

function normalizeAutocompleteText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(a = "", b = "") {
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > 2) return 3;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let last = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = previous[j];
      previous[j] = a[i - 1] === b[j - 1]
        ? last
        : Math.min(last, previous[j - 1], previous[j]) + 1;
      last = current;
    }
  }
  return previous[b.length];
}

function tokenMatchScore(query, text = "", scores = {}) {
  const normalized = normalizeAutocompleteText(text);
  if (!query || !normalized) return 0;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let bestScore = 0;

  tokens.forEach((token) => {
    if (token === query) {
      bestScore = Math.max(bestScore, scores.exact || 100);
      return;
    }
    if (token.startsWith(query) || token.replace(/s$/, "").startsWith(query)) {
      bestScore = Math.max(bestScore, scores.prefix || 90);
      return;
    }
    if (query.length >= 4 && token.includes(query)) {
      bestScore = Math.max(bestScore, scores.contains || 50);
      return;
    }
    if (query.length >= 3 && query[0] === token[0]) {
      const prefix = token.slice(0, query.length);
      const allowedDistance = query.length >= 5 ? 2 : 1;
      if (editDistance(query, prefix) <= allowedDistance) {
        bestScore = Math.max(bestScore, scores.fuzzy || 60);
      }
    }
  });

  return bestScore;
}

function scoreAutocompleteSuggestion(term, product = {}) {
  const query = normalizeAutocompleteText(term);
  const title = normalizeAutocompleteText(product.title);
  const brand = normalizeAutocompleteText(product.brand);
  const category = normalizeAutocompleteText(product.category || product.categoryId);
  if (!query || !title) return 0;

  const categoryScore = tokenMatchScore(query, category, {
    exact: 130,
    prefix: 120,
    contains: 105,
    fuzzy: 90,
  });
  const brandScore = tokenMatchScore(query, brand, {
    exact: 125,
    prefix: 115,
    contains: 95,
    fuzzy: 88,
  });
  const titleScore = tokenMatchScore(query, title, {
    exact: 100,
    prefix: 92,
    contains: 45,
    fuzzy: 70,
  });

  if (title.startsWith(query)) return Math.max(110, categoryScore, brandScore, titleScore);
  return Math.max(categoryScore, brandScore, titleScore);
}

class AdvancedSearchService {
  buildSearchDocument(product) {
    const source = typeof product.toObject === "function" ? product.toObject() : product;
    return {
      id: String(source._id || source.id),
      title: source.title,
      shortDescription: source.shortDescription || "",
      category: source.category,
      categoryId: source.categoryId,
      brand: source.brand || "",
      sku: source.sku || "",
      description: source.description,
      price: source.price,
      salePrice: source.salePrice || source.price,
      gstRate: source.gstRate || 18,
      hsnCode: source.hsnCode || "",
      color: source.color || "",
      productType: source.productType || "simple",
      productFamilyCode: source.productFamilyCode || "",
      tags: Array.isArray(source.tags) ? source.tags : [],
      origin: source.origin || {},
      sellerId: source.sellerId,
      stock: source.stock || 0,
      availableStock: Math.max(0, (source.stock || 0) - (source.reservedStock || 0)),
      rating: source.rating || 0,
      reviewCount: source.reviewCount || 0,
      analytics: {
        views: source.analytics?.views || 0,
        purchases: source.analytics?.purchases || 0,
        cartAdds: source.analytics?.cartAdds || 0,
      },
      attributes: source.attributes
        ? Object.fromEntries(
            source.attributes instanceof Map
              ? source.attributes
              : Object.entries(source.attributes),
          )
        : {},
      status: source.status,
      visibility: source.visibility || "public",
      publishedAt: source.publishedAt || source.createdAt,
      scheduledAt: source.scheduledAt || null,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }

  // ==============================
  // MAIN SEARCH
  // ==============================
  async search({
    query = "",
    filters = {},
    facets = [],
    page = 1,
    limit = 20,
    sort = "_score",
  }) {
    if (!isElasticsearchEnabled()) {
      return this.searchMongoFallback({
        query,
        filters,
        page,
        limit,
        sort,
      });
    }

    try {
      // 🔒 safety
      page = Math.max(1, Number(page) || 1);
      limit = Math.min(50, Number(limit) || 20);

      const must = [];
      const filter = buildPublicSearchFilters();

      // ==============================
      // Query logic
      // ==============================
      if (query) {
        must.push({
          multi_match: {
            query,
            fields: [
              "title^4",
              "shortDescription^2",
              "description^2",
              "brand^2",
              "category^2",
              "categoryId",
              "sku^2",
              "tags^2",
              "color",
              "hsnCode",
              "productFamilyCode",
            ],
            fuzziness: "AUTO",
          },
        });
      } else {
        // fallback → show popular products
        must.push({ match_all: {} });
      }

      // ==============================
      // Filters
      // ==============================
      if (filters.category) {
        filter.push({
          bool: {
            should: [
              { term: { "category.keyword": filters.category } },
              { term: { "categoryId.keyword": filters.category } },
            ],
            minimum_should_match: 1,
          },
        });
      }

      if (filters.brand) {
        filter.push({ term: { "brand.keyword": filters.brand } });
      }

      if (filters.productType) {
        filter.push({ term: { productType: filters.productType } });
      }

      if (filters.productFamilyCode) {
        const familyFilter = buildElasticExactFilter(
          ["productFamilyCode.keyword", "productFamilyCode"],
          filters.productFamilyCode,
        );
        if (familyFilter) filter.push(familyFilter);
      }

      Object.entries(filters.attributeFilters || {}).forEach(([key, value]) => {
        const attributeFilter = buildElasticExactFilter(
          [
            `${key}.keyword`,
            key,
            `attributes.${key}.keyword`,
            `attributes.${key}`,
          ],
          value,
        );
        if (attributeFilter) filter.push(attributeFilter);
      });

      if (filters.priceRange) {
        const priceRange = {};
        if (filters.priceRange[0] !== undefined) {
          priceRange.gte = filters.priceRange[0];
        }
        if (filters.priceRange[1] !== undefined) {
          priceRange.lte = filters.priceRange[1];
        }
        filter.push({
          range: {
            price: priceRange,
          },
        });
      }

      const rating = filters.minRating ?? filters.rating;
      if (rating) {
        filter.push({
          range: { rating: { gte: rating } },
        });
      }

      if (filters.seller) {
        filter.push({ term: { "sellerId.keyword": filters.seller } });
      }

      if (filters.inStock !== undefined) {
        if (filters.inStock === true || filters.inStock === "true") {
          filter.push({ range: { availableStock: { gt: 0 } } });
        }
      }

      // ==============================
      // Sorting
      // ==============================
      const sortOptions = {
        price_asc: [{ price: "asc" }],
        price_desc: [{ price: "desc" }],
        rating: [{ rating: "desc" }],
        newest: [{ createdAt: "desc" }],
        _score: ["_score"],
      };

      const sortQuery = sortOptions[sort] || ["_score"];

      // ==============================
      // Aggregations (Facets)
      // ==============================
      const aggs = {
        categories: {
          terms: { field: "category.keyword", size: 20 },
        },
        priceStats: {
          stats: { field: "price" },
        },
        ratings: {
          terms: { field: "rating", size: 5 },
        },
      };

      const response = await elasticsearchClient.search({
        index: "products",
        body: {
          query: {
            bool: {
              must,
              filter,
            },
          },
          aggs,
          from: (page - 1) * limit,
          size: limit,
          sort: sortQuery,
        },
      });

      return {
        results: response.hits.hits.map((hit) => ({
          id: hit._id,
          score: hit._score,
          ...hit._source,
        })),
        total: response.hits.total.value,
        page,
        limit,
        facets: {
          category: response.aggregations.categories.buckets,
          categories: response.aggregations.categories.buckets,
          priceStats: response.aggregations.priceStats,
          ratings: response.aggregations.ratings.buckets,
        },
        source: "elasticsearch",
      };
    } catch (error) {
      logger.warn({ err: error, query }, "Elasticsearch search failed, falling back to Mongo search");
      return this.searchMongoFallback({
        query,
        filters,
        page,
        limit,
        sort,
      });
    }
  }

  buildMongoSearchFilter(query = "", filters = {}) {
    const mongoFilter = applyPublicProductFilter();
    const term = String(query || "").trim();

    if (term) {
      const regex = new RegExp(escapeRegex(term), "i");
      mongoFilter.$or = [
        { title: regex },
        { shortDescription: regex },
        { description: regex },
        { category: regex },
        { categoryId: regex },
        { brand: regex },
        { sku: regex },
        { color: regex },
        { hsnCode: regex },
        { productFamilyCode: regex },
        { tags: regex },
      ];
    }

    if (filters.category) {
      const category = String(filters.category);
      addAndFilter(mongoFilter, {
        $or: [
          { category },
          { categoryId: category },
          { "category.categoryKey": category },
          { "category._id": category },
        ],
      });
    }

    if (filters.brand) {
      mongoFilter.brand = new RegExp(`^${escapeRegex(filters.brand)}$`, "i");
    }

    if (filters.productType) {
      mongoFilter.productType = filters.productType;
    }

    if (filters.productFamilyCode) {
      mongoFilter.productFamilyCode = new RegExp(`^${escapeRegex(filters.productFamilyCode)}$`, "i");
    }

    Object.entries(filters.attributeFilters || {}).forEach(([key, value]) => {
      const values = normalizeFilterValues(value);
      if (!values.length) return;
      const regexes = values.map((item) => new RegExp(`^${escapeRegex(item)}$`, "i"));
      addAndFilter(mongoFilter, {
        $or: [
          { [key]: { $in: regexes } },
          { [`attributes.${key}`]: { $in: regexes } },
        ],
      });
    });

    if (filters.seller) {
      mongoFilter.sellerId = filters.seller;
    }

    if (filters.priceRange) {
      mongoFilter.price = {};
      if (filters.priceRange[0] !== undefined) {
        mongoFilter.price.$gte = Number(filters.priceRange[0]);
      }
      if (filters.priceRange[1] !== undefined) {
        mongoFilter.price.$lte = Number(filters.priceRange[1]);
      }
    }

    const rating = filters.minRating ?? filters.rating;
    if (rating !== undefined && rating !== null && rating !== "") {
      mongoFilter.rating = { $gte: Number(rating) };
    }

    if (filters.inStock === true || filters.inStock === "true") {
      const availableStock = {
        $subtract: [
          { $ifNull: ["$stock", 0] },
          { $ifNull: ["$reservedStock", 0] },
        ],
      };
      appendExpressionFilter(mongoFilter, { $gt: [availableStock, 0] });
    }

    return mongoFilter;
  }

  buildMongoSort(sort = "_score", hasQuery = false) {
    const sortOptions = {
      price_asc: { price: 1, createdAt: -1 },
      price_desc: { price: -1, createdAt: -1 },
      rating: { rating: -1, reviewCount: -1, createdAt: -1 },
      newest: { createdAt: -1 },
      _score: hasQuery
        ? { "analytics.purchases": -1, "analytics.views": -1, createdAt: -1 }
        : { "analytics.purchases": -1, createdAt: -1 },
    };
    return sortOptions[sort] || sortOptions._score;
  }

  async buildMongoFacets(filter) {
    const [categories, priceStats, ratings] = await Promise.all([
      ProductModel.aggregate([
        { $match: filter },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ""] } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 20 },
        { $project: { key: "$_id", count: 1, _id: 0 } },
      ]),
      ProductModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            min: { $min: "$price" },
            max: { $max: "$price" },
            avg: { $avg: "$price" },
            count: { $sum: 1 },
          },
        },
        { $project: { _id: 0 } },
      ]),
      ProductModel.aggregate([
        { $match: filter },
        { $bucket: {
          groupBy: "$rating",
          boundaries: [0, 1, 2, 3, 4, 5.01],
          default: "unrated",
          output: { count: { $sum: 1 } },
        } },
      ]),
    ]);

    return {
      category: categories,
      categories,
      priceStats: priceStats[0] || { min: 0, max: 0, avg: 0, count: 0 },
      ratings: ratings.map((bucket) => ({
        key: bucket._id,
        count: bucket.count,
      })),
    };
  }

  async searchMongoFallback({
    query = "",
    filters = {},
    page = 1,
    limit = 20,
    sort = "_score",
  }) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(50, Number(limit) || 20);

    const filter = this.buildMongoSearchFilter(query, filters);
    const sortQuery = this.buildMongoSort(sort, Boolean(String(query || "").trim()));
    const skip = (page - 1) * limit;

    const [items, total, facets] = await Promise.all([
      ProductModel.find(filter)
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductModel.countDocuments(filter),
      this.buildMongoFacets(filter),
    ]);

    if (!total && String(query || "").trim().length >= 3) {
      return this.searchMongoFuzzyFallback({
        query,
        filters,
        page,
        limit,
      });
    }

    return {
      results: items.map((item) => ({
        id: String(item._id || item.id),
        ...item,
      })),
      total,
      page,
      limit,
      facets,
      source: "mongo",
    };
  }

  async searchMongoFuzzyFallback({
    query = "",
    filters = {},
    page = 1,
    limit = 20,
  }) {
    const corpus = await this.getAutocompleteCorpus();
    const scored = corpus
      .map((product) => ({
        id: String(product._id || product.id || ""),
        score: scoreAutocompleteSuggestion(query, product),
      }))
      .filter((entry) => entry.id && entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const seen = new Set();
    const orderedIds = scored
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .map((entry) => entry.id);

    if (!orderedIds.length) {
      return {
        results: [],
        total: 0,
        page,
        limit,
        facets: await this.buildMongoFacets(this.buildMongoSearchFilter("", filters)),
        source: "mongo_fuzzy",
      };
    }

    const filter = this.buildMongoSearchFilter("", filters);
    filter._id = { $in: orderedIds };
    const skip = (page - 1) * limit;
    const pageIds = orderedIds.slice(skip, skip + limit);

    const [items, total, facets] = await Promise.all([
      ProductModel.find({ ...filter, _id: { $in: pageIds } }).lean(),
      ProductModel.countDocuments(filter),
      this.buildMongoFacets(filter),
    ]);

    const order = new Map(pageIds.map((id, index) => [String(id), index]));
    const results = items
      .sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0))
      .map((item) => ({
        id: String(item._id || item.id),
        ...item,
      }));

    return {
      results,
      total,
      page,
      limit,
      facets,
      source: "mongo_fuzzy",
    };
  }

  // ==============================
  // AUTOCOMPLETE
  // ==============================
  async getAutocompleteCorpus() {
    if (
      autocompleteCorpusCache &&
      Date.now() - autocompleteCorpusCache.cachedAt < AUTOCOMPLETE_CORPUS_CACHE_TTL_MS
    ) {
      return autocompleteCorpusCache.items;
    }

    const items = await ProductModel.find(applyPublicProductFilter())
      .sort({ "analytics.purchases": -1, "analytics.views": -1, createdAt: -1 })
      .limit(800)
      .select("title brand category categoryId images commonImages")
      .lean()
      .maxTimeMS(1200)
      .catch(() => []);

    autocompleteCorpusCache = { items, cachedAt: Date.now() };
    return items;
  }

  async getAutocompleteSuggestions(query, limit = 10) {
    const term = String(query || "").trim();
    const maxLimit = Math.min(Math.max(Number(limit) || 6, 1), 8);
    if (term.length < 2) return [];
    const cacheKey = `${term.toLowerCase()}:${maxLimit}:mongo-fuzzy`;
    const cached = getAutocompleteCache(cacheKey);
    if (cached) return cached;

    const pending = autocompleteInFlight.get(cacheKey);
    if (pending) return pending;

    const lookup = (async () => {
      const regex = new RegExp(`^${escapeRegex(term)}`, "i");
      const prefixProducts = await ProductModel.find(
        applyPublicProductFilter({ title: regex }),
      )
        .sort({ title: 1, "analytics.purchases": -1, createdAt: -1 })
        .limit(maxLimit)
        .select("title brand category categoryId images commonImages")
        .lean()
        .maxTimeMS(800)
        .catch(() => []);

      const corpus = prefixProducts.length >= maxLimit
        ? prefixProducts
        : await this.getAutocompleteCorpus();

      const scored = [...prefixProducts, ...corpus]
        .map((product) => ({
          product,
          score: scoreAutocompleteSuggestion(term, product),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const seen = new Set();
      const suggestions = scored
        .filter(({ product }) => {
          const title = String(product.title || "").trim();
          const key = title.toLowerCase();
          if (!title || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, maxLimit)
        .map(({ product }) => ({
          title: product.title,
          brandName: product.brand || "",
          categoryName: product.category || product.categoryId || "",
          image: product.images?.[0] || product.commonImages?.[0] || "",
        }));

      setAutocompleteCache(cacheKey, suggestions);
      return suggestions;
    })().finally(() => {
      autocompleteInFlight.delete(cacheKey);
    });

    autocompleteInFlight.set(cacheKey, lookup);
    return lookup;
  }

  // ==============================
  // INDEX PRODUCT
  // ==============================
  async indexProduct(productId, productData) {
    if (!isElasticsearchEnabled()) return;

    try {
      if (!isPublicProduct(productData)) {
        await this.deleteProduct(productId);
        return;
      }

      await elasticsearchClient.index({
        index: "products",
        id: productId,
        document: this.buildSearchDocument({ ...productData, _id: productId }),
        refresh: "wait_for",
      });
    } catch (error) {
      logger.error({ err: error, productId }, "Indexing failed");
    }
  }

  // ==============================
  // UPDATE PRODUCT
  // ==============================
  async updateProduct(productId, updates) {
    if (!isElasticsearchEnabled()) return;

    try {
      if (
        updates.status ||
        updates.visibility ||
        updates.publishedAt ||
        updates.scheduledAt
      ) {
        const product = await ProductModel.findById(productId);
        const nextProduct = {
          ...(product?.toObject?.() || product || {}),
          ...updates,
        };
        if (!isPublicProduct(nextProduct)) {
          await this.deleteProduct(productId);
          return;
        }
      }

      await elasticsearchClient.update({
        index: "products",
        id: productId,
        doc: updates,
        refresh: "wait_for",
      });
    } catch (error) {
      logger.error({ err: error, productId }, "Update failed");
    }
  }

  // ==============================
  // DELETE PRODUCT
  // ==============================
  async deleteProduct(productId) {
    if (!isElasticsearchEnabled()) return;

    try {
      await elasticsearchClient.delete({
        index: "products",
        id: productId,
      });
    } catch (error) {
      logger.warn({ err: error, productId }, "Delete failed");
    }
  }

  async indexAllProducts() {
    const products = await ProductModel.find(applyPublicProductFilter()).lean();
    const results = await Promise.allSettled(
      products.map((product) =>
        this.indexProduct(String(product._id), product),
      ),
    );

    return results.filter((result) => result.status === "fulfilled").length;
  }

  async rebuildIndexes() {
    if (!isElasticsearchEnabled()) {
      return { indexedCount: 0, source: "mongo_fallback" };
    }

    try {
      await elasticsearchClient.indices.delete({ index: "products" });
    } catch (error) {
      if (error?.meta?.statusCode !== 404) {
        logger.warn({ err: error }, "Search index delete before rebuild failed");
      }
    }

    const indexedCount = await this.indexAllProducts();
    return { indexedCount };
  }
}

module.exports = {
  AdvancedSearchService: new AdvancedSearchService(),
};
