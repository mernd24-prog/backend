const express = require("express");
const router = express.Router();

const { authenticate } = require("../middleware/authenticate");
const { allowRoles } = require("../middleware/access");

const { AdvancedSearchService } = require("../services/advanced-search.service");
const { searchValidation } = require("../../modules/validation");

const PRODUCT_ATTRIBUTE_FILTER_KEYS = [
  "color",
  "size",
  "material",
  "fit",
  "storage",
  "skinType",
  "shade",
  "finish",
  "room",
  "sport",
  "concern",
  "hsnCode",
  "tags",
];

function buildAttributeFilters(query = {}) {
  const filters = {};

  PRODUCT_ATTRIBUTE_FILTER_KEYS.forEach((key) => {
    if (query[key] !== undefined && query[key] !== null && query[key] !== "") {
      filters[key] = query[key];
    }
  });

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (key.startsWith("attr_")) {
      filters[key.replace(/^attr_/, "")] = value;
    } else if (key.startsWith("attribute.")) {
      filters[key.replace(/^attribute\./, "")] = value;
    }
  });

  return filters;
}

// ==============================
// Public: Search products
// ==============================
router.get("/", async (req, res, next) => {
  try {
    const { error, value } = searchValidation.search.validate(req.query);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid search parameters",
        details: error.details,
      });
    }

    const page = Math.max(1, Number(value.page) || 1);
    const limit = Math.min(50, Number(value.limit) || 20); // 🔥 limit cap

    const category = value.category || value.categoryId || value.categorySlug;
    const filters = {
      category,
      priceRange:
        value.minPrice !== undefined || value.maxPrice !== undefined
          ? [value.minPrice, value.maxPrice]
          : undefined,
      minRating: value.minRating,
      rating: value.rating,
      seller: value.seller,
      inStock: value.inStock,
      brand: value.brand,
      productType: value.productType,
      productFamilyCode: value.productFamilyCode || value.family || value.familyCode,
      attributeFilters: buildAttributeFilters(value),
    };

    const results = await AdvancedSearchService.search({
      query: value.q,
      filters,
      facets: ["category", "price", "rating", "seller"],
      page,
      limit,
      sort: value.sort,
    });

    return res.status(200).json({
      success: true,
      data: results,
      meta: {
        page,
        limit,
        total: results.total,
        totalPages: Math.max(1, Math.ceil((results.total || 0) / limit)),
        source: results.source || "elasticsearch",
      },
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Public: Autocomplete suggestions
// ==============================
router.get("/autocomplete", async (req, res, next) => {
  try {
    const { error, value } = searchValidation.autocomplete.validate(req.query);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid autocomplete query",
        details: error.details,
      });
    }

    const limit = Math.min(20, value.limit || 10);

    const suggestions =
      await AdvancedSearchService.getAutocompleteSuggestions(
        value.q,
        limit
      );

    return res.status(200).json({
      success: true,
      data: suggestions,
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Index all products
// ==============================
router.post(
  "/index-all",
  authenticate,
  allowRoles(["admin"]),
  async (req, res, next) => {
    try {
      const result = await AdvancedSearchService.indexAllProducts();

      return res.status(200).json({
        success: true,
        message: "Products indexed successfully",
        indexedCount: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ==============================
// Admin: Rebuild indexes
// ==============================
router.post(
  "/rebuild",
  authenticate,
  allowRoles(["admin"]),
  async (req, res, next) => {
    try {
      const result = await AdvancedSearchService.rebuildIndexes();

      return res.status(200).json({
        success: true,
        message: "Search index rebuilt successfully",
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
