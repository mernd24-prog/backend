const express = require("express");
const { ProductController } = require("../controllers/product.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions, allowPermissions } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
const { WarehouseController } = require("../../inventory/controllers/warehouse.controller");
const {
  createProductSchema,
  updateProductSchema,
  listProductSchema,
  searchProductSchema,
  productPrefillSchema,
  reviewProductSchema,
  listProductRevisionsSchema,
  reviewProductRevisionSchema,
  productStatusSchema,
  productLifecycleSchema,
  bulkProductSchema,
  specialPriceBulkUpdateSchema,
  updateInventorySchema,
  productParamSchema,
  submitReviewSchema,
  listReviewsSchema,
  myReviewSchema,
  reviewParamSchema,
} = require("../validation/product.validation");
const {
  listVariantInventorySchema,
  productInventorySchema,
  adjustVariantInventorySchema,
  bulkSetVariantInventorySchema,
} = require("../../inventory/validation/warehouse.validation");
const { ACTIONS } = require("../../../shared/constants/actions");

const productRoutes = express.Router();
const productController = new ProductController();
const inventoryController = new WarehouseController();

// ── Public ────────────────────────────────────────────────────────────────────

productRoutes.get("/", checkInput(listProductSchema), catchErrors(productController.list));
productRoutes.get("/discover", checkInput(listProductSchema), catchErrors(productController.discover));
productRoutes.get("/search", checkInput(searchProductSchema), catchErrors(productController.search));
productRoutes.get(
  "/prefill",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productPrefillSchema),
  catchErrors(productController.prefill),
);
productRoutes.get(
  "/prefill/basic",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productPrefillSchema),
  catchErrors(productController.prefillBasic),
);
productRoutes.get(
  "/prefill/lookups",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productPrefillSchema),
  catchErrors(productController.prefillLookups),
);
productRoutes.get(
  "/prefill/locations",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productPrefillSchema),
  catchErrors(productController.prefillLocations),
);
productRoutes.get(
  "/prefill/products",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productPrefillSchema),
  catchErrors(productController.prefillProducts),
);

// ── Seller ────────────────────────────────────────────────────────────────────

productRoutes.get(
  "/seller/me",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(listProductSchema),
  catchErrors(productController.listMine),
);
productRoutes.get(
  "/manage/:productId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productParamSchema),
  catchErrors(productController.getOne),
);
productRoutes.patch(
  "/manage/:productId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateProductSchema),
  catchErrors(productController.update),
);
productRoutes.post(
  "/",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createProductSchema),
  catchErrors(productController.create),
);
productRoutes.patch(
  "/:productId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateProductSchema),
  catchErrors(productController.update),
);
productRoutes.patch(
  "/:productId/status",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productStatusSchema),
  catchErrors(productController.status),
);
productRoutes.post(
  "/:productId/duplicate",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productLifecycleSchema),
  catchErrors(productController.duplicate),
);

// ── Admin / review ────────────────────────────────────────────────────────────

productRoutes.patch(
  "/:productId/review",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  checkInput(reviewProductSchema),
  catchErrors(productController.review),
);
productRoutes.get(
  "/:productId/revisions",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(listProductRevisionsSchema),
  catchErrors(productController.listRevisions),
);
productRoutes.patch(
  "/:productId/revisions/:revisionId/review",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  checkInput(reviewProductRevisionSchema),
  catchErrors(productController.reviewRevision),
);

// ── Bulk ─────────────────────────────────────────────────────────────────────

productRoutes.post(
  "/bulk/update",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  checkInput(bulkProductSchema),
  catchErrors(productController.bulkUpdate),
);
productRoutes.post(
  "/special-prices/bulk",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(specialPriceBulkUpdateSchema),
  catchErrors(productController.bulkUpdateSpecialPrices),
);

// ── Inventory ─────────────────────────────────────────────────────────────────

productRoutes.get(
  "/inventory/variants",
  authenticate,
  allowPermissions("inventory:view"),
  checkInput(listVariantInventorySchema),
  catchErrors(inventoryController.listVariantInventory),
);
productRoutes.get(
  "/inventory/products/:productId",
  authenticate,
  allowPermissions("inventory:view"),
  checkInput(productInventorySchema),
  catchErrors(inventoryController.getProductInventory),
);
productRoutes.patch(
  "/inventory/products/:productId/variants/:variantSku/adjust",
  authenticate,
  allowPermissions("inventory:adjust"),
  checkInput(adjustVariantInventorySchema),
  catchErrors(inventoryController.adjustVariantInventory),
);
productRoutes.patch(
  "/inventory/products/:productId/variants/adjust",
  authenticate,
  allowPermissions("inventory:adjust"),
  checkInput(adjustVariantInventorySchema),
  catchErrors(inventoryController.adjustVariantInventory),
);
productRoutes.post(
  "/inventory/variants/bulk-set",
  authenticate,
  allowPermissions("inventory:adjust"),
  checkInput(bulkSetVariantInventorySchema),
  catchErrors(inventoryController.bulkSetVariantInventory),
);
productRoutes.patch(
  "/:productId/inventory",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateInventorySchema),
  catchErrors(productController.adjustInventory),
);
productRoutes.get(
  "/inventory/stats",
  authenticate,
  catchErrors(productController.inventoryStats),
);
productRoutes.get(
  "/inventory/low-stock",
  authenticate,
  catchErrors(productController.lowStockProducts),
);

// ── Analytics ─────────────────────────────────────────────────────────────────

productRoutes.get(
  "/analytics/top",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  catchErrors(productController.topProducts),
);

// ── Customer Reviews ──────────────────────────────────────────────────────────

productRoutes.get(
  "/:productId/reviews",
  checkInput(listReviewsSchema),
  catchErrors(productController.listReviews),
);
productRoutes.post(
  "/:productId/reviews",
  authenticate,
  checkInput(submitReviewSchema),
  catchErrors(productController.submitReview),
);
productRoutes.patch(
  "/:productId/reviews/:reviewId/helpful",
  authenticate,
  checkInput(reviewParamSchema),
  catchErrors(productController.markHelpful),
);
productRoutes.delete(
  "/:productId/reviews/:reviewId",
  authenticate,
  checkInput(reviewParamSchema),
  catchErrors(productController.deleteMyReview),
);
productRoutes.get(
  "/:productId/my-review",
  authenticate,
  checkInput(myReviewSchema),
  catchErrors(productController.myReview),
);

productRoutes.get("/:productId/related", checkInput(productParamSchema), catchErrors(productController.relatedProducts));
productRoutes.get("/:productId/cross-sell", checkInput(productParamSchema), catchErrors(productController.crossSellProducts));
productRoutes.get("/:productId/up-sell", checkInput(productParamSchema), catchErrors(productController.upSellProducts));
productRoutes.get("/:productId/completeness", authenticate, checkInput(productParamSchema), catchErrors(productController.completenessScore));
productRoutes.get("/:productId", checkInput(productParamSchema), catchErrors(productController.getOne));

module.exports = { productRoutes };
