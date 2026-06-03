const express = require("express");
const router = express.Router();

const { authenticate } = require("../middleware/authenticate");
const { allowRoles } = require("../middleware/access");

const { AdvancedSearchService } = require("../services/advanced-search.service");
const { searchValidation } = require("../../modules/validation");

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
        value.minPrice && value.maxPrice
          ? [value.minPrice, value.maxPrice]
          : undefined,
      minRating: value.minRating,
      seller: value.seller,
      inStock: value.inStock,
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
        message: result || "Search index rebuilt successfully",
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
