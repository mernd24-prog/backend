const express = require("express");
const { ProductController } = require("../controllers/product.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
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
  updateInventorySchema,
  productParamSchema,
} = require("../validation/product.validation");
const { ACTIONS } = require("../../../shared/constants/actions");

const productRoutes = express.Router();
const productController = new ProductController();

// ── Public ────────────────────────────────────────────────────────────────────

productRoutes.get("/", checkInput(listProductSchema), catchErrors(productController.list));
productRoutes.get("/search", checkInput(searchProductSchema), catchErrors(productController.search));
productRoutes.get(
  "/prefill",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productPrefillSchema),
  catchErrors(productController.prefill),
);

// ── Seller ────────────────────────────────────────────────────────────────────

productRoutes.get(
  "/seller/me",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(listProductSchema),
  catchErrors(productController.listMine),
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
productRoutes.delete(
  "/:productId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productParamSchema),
  catchErrors(productController.delete),
);
productRoutes.patch(
  "/:productId/status",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productStatusSchema),
  catchErrors(productController.status),
);
productRoutes.patch(
  "/:productId/archive",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productLifecycleSchema),
  catchErrors(productController.archive),
);
productRoutes.patch(
  "/:productId/restore",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productLifecycleSchema),
  catchErrors(productController.restore),
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

// ── Inventory ─────────────────────────────────────────────────────────────────

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

// ── Analytics ─────────────────────────────────────────────────────────────────

productRoutes.get(
  "/analytics/top",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  catchErrors(productController.topProducts),
);

productRoutes.get("/:productId", checkInput(productParamSchema), catchErrors(productController.getOne));

module.exports = { productRoutes };
