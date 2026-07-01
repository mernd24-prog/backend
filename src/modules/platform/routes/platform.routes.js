const express = require("express");
const { PlatformController } = require("../controllers/platform.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { ACTIONS } = require("../../../shared/constants/actions");
const {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesSchema,
  categoryKeySchema,
  createProductFamilySchema,
  updateProductFamilySchema,
  listProductFamiliesSchema,
  productFamilyCodeSchema,
  createProductVariantSchema,
  updateProductVariantSchema,
  listProductVariantsSchema,
  productVariantIdSchema,
  createHsnCodeSchema,
  updateHsnCodeSchema,
  listHsnCodesSchema,
  hsnCodeParamSchema,
  createGeographySchema,
  updateGeographySchema,
  listGeographiesSchema,
  geographyParamSchema,
  createBrandSchema,
  updateBrandSchema,
  listBrandsSchema,
  brandIdSchema,
  createBatchSchema,
  updateBatchSchema,
  listBatchesSchema,
  batchIdSchema,
  createProductOptionSchema,
  updateProductOptionSchema,
  listProductOptionsSchema,
  productOptionIdSchema,
  createProductOptionValueSchema,
  updateProductOptionValueSchema,
  listProductOptionValuesSchema,
  productOptionValueIdSchema,
  listProductReviewsSchema,
  updateProductReviewSchema,
  bulkUpdateProductReviewsSchema,
  productReviewIdSchema,
  createBadgeSchema,
  updateBadgeSchema,
  listBadgesSchema,
  badgeIdSchema,
} = require("../validation/platform.validation");

const platformRoutes = express.Router();
const cmsRoutes = express.Router();
const platformController = new PlatformController();

platformRoutes.get("/catalog-prefill", catchErrors(platformController.getCatalogPrefillData));

platformRoutes.get("/categories", checkInput(listCategoriesSchema), catchErrors(platformController.listCategories));
platformRoutes.get("/categories/:categoryKey", checkInput(categoryKeySchema), catchErrors(platformController.getCategory));
platformRoutes.get(
  "/categories/:categoryKey/attributes",
  checkInput(categoryKeySchema),
  catchErrors(platformController.getCategoryAttributes),
);
platformRoutes.post(
  "/categories",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createCategorySchema),
  catchErrors(platformController.createCategory),
);
platformRoutes.patch(
  "/categories/:categoryKey",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateCategorySchema),
  catchErrors(platformController.updateCategory),
);
platformRoutes.delete(
  "/categories/:categoryKey",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(categoryKeySchema),
  catchErrors(platformController.deleteCategory),
);

platformRoutes.get("/families", checkInput(listProductFamiliesSchema), catchErrors(platformController.listProductFamilies));
platformRoutes.get("/families/:familyCode", checkInput(productFamilyCodeSchema), catchErrors(platformController.getProductFamily));
platformRoutes.post(
  "/families",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createProductFamilySchema),
  catchErrors(platformController.createProductFamily),
);
platformRoutes.patch(
  "/families/:familyCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateProductFamilySchema),
  catchErrors(platformController.updateProductFamily),
);
platformRoutes.delete(
  "/families/:familyCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productFamilyCodeSchema),
  catchErrors(platformController.deleteProductFamily),
);

platformRoutes.get("/variants", checkInput(listProductVariantsSchema), catchErrors(platformController.listProductVariants));
platformRoutes.get("/variants/:variantId", checkInput(productVariantIdSchema), catchErrors(platformController.getProductVariant));
platformRoutes.post(
  "/variants",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createProductVariantSchema),
  catchErrors(platformController.createProductVariant),
);
platformRoutes.patch(
  "/variants/:variantId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateProductVariantSchema),
  catchErrors(platformController.updateProductVariant),
);
platformRoutes.delete(
  "/variants/:variantId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(productVariantIdSchema),
  catchErrors(platformController.deleteProductVariant),
);

platformRoutes.get("/hsn-codes", checkInput(listHsnCodesSchema), catchErrors(platformController.listHsnCodes));
platformRoutes.get("/hsn-codes/:hsnCode", checkInput(hsnCodeParamSchema), catchErrors(platformController.getHsnCode));
platformRoutes.post(
  "/hsn-codes",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createHsnCodeSchema),
  catchErrors(platformController.createHsnCode),
);
platformRoutes.patch(
  "/hsn-codes/:hsnCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateHsnCodeSchema),
  catchErrors(platformController.updateHsnCode),
);
platformRoutes.delete(
  "/hsn-codes/:hsnCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(hsnCodeParamSchema),
  catchErrors(platformController.deleteHsnCode),
);

platformRoutes.get("/geographies", checkInput(listGeographiesSchema), catchErrors(platformController.listGeographies));
platformRoutes.get("/geographies/:countryCode", checkInput(geographyParamSchema), catchErrors(platformController.getGeography));
platformRoutes.post(
  "/geographies",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createGeographySchema),
  catchErrors(platformController.createGeography),
);
platformRoutes.patch(
  "/geographies/:countryCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateGeographySchema),
  catchErrors(platformController.updateGeography),
);
platformRoutes.delete(
  "/geographies/:countryCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(geographyParamSchema),
  catchErrors(platformController.deleteGeography),
);

platformRoutes.get("/brands", checkInput(listBrandsSchema), catchErrors(platformController.listBrands));
platformRoutes.get("/brands/:brandId", checkInput(brandIdSchema), catchErrors(platformController.getBrand));
platformRoutes.post(
  "/brands",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createBrandSchema),
  catchErrors(platformController.createBrand),
);
platformRoutes.patch(
  "/brands/:brandId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateBrandSchema),
  catchErrors(platformController.updateBrand),
);
platformRoutes.delete(
  "/brands/:brandId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(brandIdSchema),
  catchErrors(platformController.deleteBrand),
);

platformRoutes.get("/batches", checkInput(listBatchesSchema), catchErrors(platformController.listBatches));
platformRoutes.post("/batches", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(createBatchSchema), catchErrors(platformController.createBatch));
platformRoutes.patch("/batches/:batchId", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(updateBatchSchema), catchErrors(platformController.updateBatch));
platformRoutes.delete("/batches/:batchId", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(batchIdSchema), catchErrors(platformController.deleteBatch));

platformRoutes.get("/product-options", checkInput(listProductOptionsSchema), catchErrors(platformController.listProductOptions));
platformRoutes.post("/product-options", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(createProductOptionSchema), catchErrors(platformController.createProductOption));
platformRoutes.patch("/product-options/:optionId", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(updateProductOptionSchema), catchErrors(platformController.updateProductOption));
platformRoutes.delete("/product-options/:optionId", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(productOptionIdSchema), catchErrors(platformController.deleteProductOption));

platformRoutes.get("/product-option-values", checkInput(listProductOptionValuesSchema), catchErrors(platformController.listProductOptionValues));
platformRoutes.post("/product-option-values", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(createProductOptionValueSchema), catchErrors(platformController.createProductOptionValue));
platformRoutes.patch("/product-option-values/:optionValueId", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(updateProductOptionValueSchema), catchErrors(platformController.updateProductOptionValue));
platformRoutes.delete("/product-option-values/:optionValueId", authenticate, allowActions(ACTIONS.CATALOG_MANAGE), checkInput(productOptionValueIdSchema), catchErrors(platformController.deleteProductOptionValue));

// ── Product Reviews (Admin) ───────────────────────────────────────────────────

platformRoutes.get(
  "/product-reviews",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  checkInput(listProductReviewsSchema),
  catchErrors(platformController.listProductReviews),
);
platformRoutes.post(
  "/product-reviews/bulk-action",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  checkInput(bulkUpdateProductReviewsSchema),
  catchErrors(platformController.bulkUpdateProductReviews),
);
platformRoutes.patch(
  "/product-reviews/:reviewId",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  checkInput(updateProductReviewSchema),
  catchErrors(platformController.updateProductReview),
);
platformRoutes.delete(
  "/product-reviews/:reviewId",
  authenticate,
  allowActions(ACTIONS.CATALOG_REVIEW),
  checkInput(productReviewIdSchema),
  catchErrors(platformController.deleteProductReview),
);

// ── Badges (public read, auth for write) ─────────────────────────────────────

platformRoutes.get("/badges", checkInput(listBadgesSchema), catchErrors(platformController.listBadges));
platformRoutes.get("/badges/active", catchErrors(platformController.listActiveBadges));
platformRoutes.get("/badges/:badgeId", checkInput(badgeIdSchema), catchErrors(platformController.getBadge));
platformRoutes.post(
  "/badges",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createBadgeSchema),
  catchErrors(platformController.createBadge),
);
platformRoutes.patch(
  "/badges/:badgeId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateBadgeSchema),
  catchErrors(platformController.updateBadge),
);
platformRoutes.delete(
  "/badges/:badgeId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(badgeIdSchema),
  catchErrors(platformController.deleteBadge),
);

module.exports = { platformRoutes, cmsRoutes };
