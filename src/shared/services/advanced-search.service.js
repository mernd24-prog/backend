/**
 * Advanced Search Service (PRODUCTION READY)
 */

const { elasticsearchClient } = require("../search/elasticsearch-client");
const { logger } = require("../logger/logger");

class AdvancedSearchService {
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
    try {
      // 🔒 safety
      page = Math.max(1, Number(page) || 1);
      limit = Math.min(50, Number(limit) || 20);

      const must = [];
      const filter = [];

      // ==============================
      // Query logic
      // ==============================
      if (query) {
        must.push({
          multi_match: {
            query,
            fields: ["title^3", "description^2", "category"],
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

      if (filters.priceRange) {
        filter.push({
          range: {
            price: {
              gte: filters.priceRange[0],
              lte: filters.priceRange[1],
            },
          },
        });
      }

      if (filters.minRating) {
        filter.push({
          range: { rating: { gte: filters.minRating } },
        });
      }

      if (filters.seller) {
        filter.push({ term: { "sellerId.keyword": filters.seller } });
      }

      if (filters.inStock !== undefined) {
        filter.push({ term: { inStock: filters.inStock } });
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
          categories: response.aggregations.categories.buckets,
          priceStats: response.aggregations.priceStats,
          ratings: response.aggregations.ratings.buckets,
        },
      };
    } catch (error) {
      logger.error({ err: error, query }, "Search error");
      throw new Error("Search service unavailable");
    }
  }

  // ==============================
  // AUTOCOMPLETE
  // ==============================
  async getAutocompleteSuggestions(query, limit = 10) {
    try {
      if (!query) return [];

      const response = await elasticsearchClient.search({
        index: "products",
        body: {
          query: {
            match_phrase_prefix: {
              title: {
                query,
                boost: 2,
              },
            },
          },
          size: Math.min(limit, 20),
          _source: ["title"],
        },
      });

      return response.hits.hits.map((hit) => hit._source.title);
    } catch (error) {
      logger.warn({ err: error, query }, "Autocomplete error");
      return [];
    }
  }

  // ==============================
  // INDEX PRODUCT
  // ==============================
  async indexProduct(productId, productData) {
    try {
      await elasticsearchClient.index({
        index: "products",
        id: productId,
        document: productData, // ✅ updated ES syntax
        refresh: "wait_for", // ensures consistency
      });
    } catch (error) {
      logger.error({ err: error, productId }, "Indexing failed");
    }
  }

  // ==============================
  // UPDATE PRODUCT
  // ==============================
  async updateProduct(productId, updates) {
    try {
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
    try {
      await elasticsearchClient.delete({
        index: "products",
        id: productId,
      });
    } catch (error) {
      logger.warn({ err: error, productId }, "Delete failed");
    }
  }
}

module.exports = {
  AdvancedSearchService: new AdvancedSearchService(),
};
