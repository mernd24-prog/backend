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

  // ==============================
  // AUTOCOMPLETE
  // ==============================
  async getAutocompleteSuggestions(query, limit = 10) {
    if (!query) return [];

    if (!isElasticsearchEnabled()) {
      const regex = new RegExp(escapeRegex(query), "i");
      const products = await ProductModel.find(
        applyPublicProductFilter({ title: regex }),
      )
        .sort({ "analytics.purchases": -1, createdAt: -1 })
        .limit(Math.min(limit, 20))
        .select("title")
        .lean();
      return products.map((product) => product.title).filter(Boolean);
    }

    try {
      const response = await elasticsearchClient.search({
        index: "products",
        body: {
          query: {
            bool: {
              must: [
                {
                  match_phrase_prefix: {
                    title: {
                      query,
                      boost: 2,
                    },
                  },
                },
              ],
              filter: buildPublicSearchFilters(),
            },
          },
          size: Math.min(limit, 20),
          _source: ["title"],
        },
      });

      return response.hits.hits.map((hit) => hit._source.title);
    } catch (error) {
      logger.warn({ err: error, query }, "Autocomplete Elasticsearch failed, falling back to Mongo");
      const regex = new RegExp(escapeRegex(query), "i");
      const products = await ProductModel.find(
        applyPublicProductFilter({ title: regex }),
      )
        .sort({ "analytics.purchases": -1, createdAt: -1 })
        .limit(Math.min(limit, 20))
        .select("title")
        .lean();
      return products.map((product) => product.title).filter(Boolean);
    }
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
