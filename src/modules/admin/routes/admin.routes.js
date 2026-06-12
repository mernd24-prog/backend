const express = require("express");
const { AdminController } = require("../controllers/admin.controller");
const { ProductController } = require("../../product/controllers/product.controller");
const {
  PlatformController,
} = require("../../platform/controllers/platform.controller");
const { CmsController } = require("../../cms/controllers/cms.controller");
const {
  slugParam: cmsSlugParam,
  createPageSchema: cmsCreateSchema,
  updatePageSchema: cmsUpdateSchema,
  listPagesSchema: cmsListSchema,
} = require("../../cms/validation/cms.validation");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions, allowRoles, allowPermissions } = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const {
  checkInput,
} = require("../../../shared/middleware/check-input");
const {
  referralAdminRoutes,
} = require("../../referral/routes/referral-admin.routes");
const {
  adminInventoryRoutes,
} = require("../../inventory/routes/admin-inventory.routes");
const {
  adminShippingRoutes,
} = require("../../delivery/routes/admin-shipping.routes");
const {
  adminCartRoutes,
} = require("../../cart/routes/cart.routes");
const {
  commonManagementRoutes,
} = require("./common-management.routes");
const {
  CommonManagementController,
} = require("../controllers/common-management.controller");
const {
  listSchema: commonListSchema,
} = require("../validation/common-management.validation");
const { ROLES } = require("../../../shared/constants/roles");
const {
  adminOverviewSchema,
  listActivityLogsSchema,
  listVendorsSchema,
  listUsersSchema,
  createManagedUserSchema,
  userParamSchema,
  updateUserSchema,
  deactivateUserSchema,
  updateVendorStatusSchema,
  sellerParamSchema,
  updateSellerKycStatusSchema,
  updateSellerBankStatusSchema,
  updateSellerOnboardingStatusSchema,
  updateSellerGoLiveSchema,
  moderationQueueSchema,
  moderateProductSchema,
  listOrdersSchema,
  listPaymentsSchema,
  createPayoutSchema,
  listPayoutsSchema,
  taxReportSchema,
  createInvoiceSchema,
  createApiKeySchema,
  listApiKeysSchema,
  createWebhookSubscriptionSchema,
  listWebhookSubscriptionsSchema,
  upsertFeatureFlagSchema,
  listFeatureFlagsSchema,
  realtimeAnalyticsSchema,
  returnsAnalyticsSchema,
  listChargebacksSchema,
  listDeadLetterSchema,
  deadLetterActionSchema,
  queueStatusSchema,
  queueActionSchema,
  createSubscriptionPlanSchema,
  listSubscriptionPlanSchema,
  subscriptionPlanParamSchema,
  updateSubscriptionPlanSchema,
  listPlatformSubscriptionsSchema,
  updatePlatformSubscriptionStatusSchema,
  createPlatformFeeConfigSchema,
  listPlatformFeeConfigSchema,
  platformFeeConfigParamSchema,
  updatePlatformFeeConfigSchema,
  listAccessModulesSchema,
  createAdminSchema,
  listAdminsSchema,
  createPlatformSubAdminSchema,
  listPlatformSubAdminsSchema,
  updatePlatformSubAdminModulesSchema,
} = require("../validation/admin.validation");
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
  hsnCodeSchema,
  createGeographySchema,
  updateGeographySchema,
  listGeographiesSchema,
  geographyCodeSchema,
  listProductReviewsSchema,
  updateProductReviewSchema,
  productReviewIdSchema,
  createBrandSchema,
  updateBrandSchema,
  listBrandsSchema,
  brandIdSchema,
  createWarrantyTemplateSchema,
  updateWarrantyTemplateSchema,
  listWarrantyTemplatesSchema,
  warrantyTemplateIdSchema,
  createFinishSchema,
  updateFinishSchema,
  listFinishesSchema,
  finishIdSchema,
  createDimensionSchema,
  updateDimensionSchema,
  listDimensionsSchema,
  dimensionIdSchema,
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
} = require("../../platform/validation/platform.validation");
const {
  createProductSchema,
  updateProductSchema,
  listProductSchema,
  productPrefillSchema,
  reviewProductSchema,
  rejectProductSchema,
  listProductRevisionsSchema,
  reviewProductRevisionSchema,
  productStatusSchema,
  productLifecycleSchema,
  bulkProductSchema,
  updateInventorySchema,
  productParamSchema,
} = require("../../product/validation/product.validation");
const { ACTIONS } = require("../../../shared/constants/actions");

const adminRoutes = express.Router();
const adminController = new AdminController();
const cmsController = new CmsController();
const platformController = new PlatformController();
const productController = new ProductController();
const commonManagementController = new CommonManagementController();

adminRoutes.get(
  "/platform/categories",
  authenticate,
  checkInput(listCategoriesSchema),
  catchErrors(platformController.listCategories),
);
adminRoutes.get(
  "/platform/categories/:categoryKey",
  authenticate,
  checkInput(categoryKeySchema),
  catchErrors(platformController.getCategory),
);
adminRoutes.get(
  "/categories/:categoryKey/attributes",
  authenticate,
  checkInput(categoryKeySchema),
  catchErrors(platformController.getCategoryAttributes),
);
adminRoutes.post(
  "/platform/categories",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createCategorySchema),
  catchErrors(platformController.createCategory),
);
adminRoutes.patch(
  "/platform/categories/:categoryKey",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateCategorySchema),
  catchErrors(platformController.updateCategory),
);
adminRoutes.delete(
  "/platform/categories/:categoryKey",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(categoryKeySchema),
  catchErrors(platformController.deleteCategory),
);
adminRoutes.get(
  "/platform/brands",
  authenticate,
  checkInput(listBrandsSchema),
  catchErrors(platformController.listBrands),
);
adminRoutes.get(
  "/platform/brands/:brandId",
  authenticate,
  checkInput(brandIdSchema),
  catchErrors(platformController.getBrand),
);
adminRoutes.post(
  "/platform/brands",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createBrandSchema),
  catchErrors(platformController.createBrand),
);
adminRoutes.patch(
  "/platform/brands/:brandId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateBrandSchema),
  catchErrors(platformController.updateBrand),
);
adminRoutes.delete(
  "/platform/brands/:brandId",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(brandIdSchema),
  catchErrors(platformController.deleteBrand),
);
adminRoutes.get(
  "/platform/hsn-codes",
  authenticate,
  checkInput(listHsnCodesSchema),
  catchErrors(platformController.listHsnCodes),
);
adminRoutes.get(
  "/platform/hsn-codes/:hsnCode",
  authenticate,
  checkInput(hsnCodeSchema),
  catchErrors(platformController.getHsnCode),
);
adminRoutes.post(
  "/platform/hsn-codes",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(createHsnCodeSchema),
  catchErrors(platformController.createHsnCode),
);
adminRoutes.patch(
  "/platform/hsn-codes/:hsnCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(updateHsnCodeSchema),
  catchErrors(platformController.updateHsnCode),
);
adminRoutes.delete(
  "/platform/hsn-codes/:hsnCode",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(hsnCodeSchema),
  catchErrors(platformController.deleteHsnCode),
);
adminRoutes.get(
  "/common/countries",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(commonListSchema),
  catchErrors(commonManagementController.listCountries),
);
adminRoutes.get(
  "/common/states",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(commonListSchema),
  catchErrors(commonManagementController.listStates),
);
adminRoutes.get(
  "/common/cities",
  authenticate,
  allowActions(ACTIONS.CATALOG_MANAGE),
  checkInput(commonListSchema),
  catchErrors(commonManagementController.listCities),
);

adminRoutes.use(authenticate, allowRoles(ROLES.ADMIN, ROLES.SUB_ADMIN));
adminRoutes.use("/referral", referralAdminRoutes);
adminRoutes.use("/common", commonManagementRoutes);
adminRoutes.use("/inventory", adminInventoryRoutes);
adminRoutes.use("/shipping", adminShippingRoutes);
adminRoutes.use("/carts", adminCartRoutes);

adminRoutes.get(
  "/access/modules",
  checkInput(listAccessModulesSchema),
  catchErrors(adminController.listAccessModules),
);
adminRoutes.get(
  "/access/activity-logs",
  allowPermissions("rbac:view"),
  checkInput(listActivityLogsSchema),
  catchErrors(adminController.listActivityLogs),
);
adminRoutes.post(
  "/access/admins",
  allowRoles(ROLES.SUPER_ADMIN),
  checkInput(createAdminSchema),
  catchErrors(adminController.createAdmin),
);
adminRoutes.get(
  "/access/admins",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(listAdminsSchema),
  catchErrors(adminController.listAdmins),
);
adminRoutes.post(
  "/access/sub-admins",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(createPlatformSubAdminSchema),
  catchErrors(adminController.createPlatformSubAdmin),
);
adminRoutes.get(
  "/access/sub-admins",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(listPlatformSubAdminsSchema),
  catchErrors(adminController.listPlatformSubAdmins),
);
adminRoutes.patch(
  "/access/sub-admins/:userId/modules",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(updatePlatformSubAdminModulesSchema),
  catchErrors(adminController.updatePlatformSubAdminModules),
);
adminRoutes.get(
  "/admin-users/admins",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(listAdminsSchema),
  catchErrors(adminController.listAdmins),
);
adminRoutes.get(
  "/admin-users/sub-admins",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(listPlatformSubAdminsSchema),
  catchErrors(adminController.listPlatformSubAdmins),
);
adminRoutes.post(
  "/admin-users/admin",
  allowRoles(ROLES.SUPER_ADMIN),
  checkInput(createAdminSchema),
  catchErrors(adminController.createAdmin),
);
adminRoutes.post(
  "/admin-users/sub-admin",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(createPlatformSubAdminSchema),
  catchErrors(adminController.createPlatformSubAdmin),
);
adminRoutes.put(
  "/admin-users/:userId",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(updateUserSchema),
  catchErrors(adminController.updateUser),
);
adminRoutes.put(
  "/admin-users/:userId/permissions",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(updatePlatformSubAdminModulesSchema),
  catchErrors(adminController.updatePlatformSubAdminModules),
);
adminRoutes.put(
  "/admin-users/:userId/status",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(updateUserSchema),
  catchErrors(adminController.updateUser),
);
adminRoutes.get(
  "/seller-users/sellers",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(listVendorsSchema),
  catchErrors(adminController.listSellerUsers),
);
adminRoutes.get(
  "/seller-users/seller-admins",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(listPlatformSubAdminsSchema),
  catchErrors(adminController.listSellerAdmins),
);
adminRoutes.get(
  "/seller-users/seller-sub-admins",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(listPlatformSubAdminsSchema),
  catchErrors(adminController.listSellerSubAdmins),
);
adminRoutes.post(
  "/seller-users/seller-admin",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(createPlatformSubAdminSchema),
  catchErrors(adminController.createSellerAdmin),
);
adminRoutes.post(
  "/seller-users/seller-sub-admin",
  allowRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  checkInput(createPlatformSubAdminSchema),
  catchErrors(adminController.createSellerSubAdmin),
);

adminRoutes.get(
  "/dashboard/overview",
  checkInput(adminOverviewSchema),
  catchErrors(adminController.overview),
);
adminRoutes.get(
  "/users",
  checkInput(listUsersSchema),
  catchErrors(adminController.listUsers),
);
adminRoutes.post(
  "/users",
  checkInput(createManagedUserSchema),
  catchErrors(adminController.createUser),
);
adminRoutes.get(
  "/users/:userId",
  checkInput(userParamSchema),
  catchErrors(adminController.getUser),
);
adminRoutes.patch(
  "/users/:userId",
  checkInput(updateUserSchema),
  catchErrors(adminController.updateUser),
);
adminRoutes.delete(
  "/users/:userId",
  checkInput(deactivateUserSchema),
  catchErrors(adminController.deactivateUser),
);
adminRoutes.get(
  "/vendors",
  checkInput(listVendorsSchema),
  catchErrors(adminController.listVendors),
);
adminRoutes.get(
  "/sellers",
  checkInput(listVendorsSchema),
  catchErrors(adminController.listVendors),
);
adminRoutes.get(
  "/sellers/:sellerId",
  checkInput(sellerParamSchema),
  catchErrors(adminController.getSeller),
);
adminRoutes.get(
  "/sellers/:sellerId/kyc",
  checkInput(sellerParamSchema),
  catchErrors(adminController.getSellerKyc),
);
adminRoutes.patch(
  "/vendors/:sellerId/status",
  checkInput(updateVendorStatusSchema),
  catchErrors(adminController.updateVendorStatus),
);
adminRoutes.patch(
  "/sellers/:sellerId/status",
  checkInput(updateVendorStatusSchema),
  catchErrors(adminController.updateVendorStatus),
);
adminRoutes.patch(
  "/sellers/:sellerId/kyc/status",
  checkInput(updateSellerKycStatusSchema),
  catchErrors(adminController.updateSellerKycStatus),
);
adminRoutes.patch(
  "/sellers/:sellerId/bank/status",
  checkInput(updateSellerBankStatusSchema),
  catchErrors(adminController.updateSellerBankStatus),
);
adminRoutes.patch(
  "/sellers/:sellerId/onboarding/status",
  checkInput(updateSellerOnboardingStatusSchema),
  catchErrors(adminController.updateSellerOnboardingStatus),
);
adminRoutes.patch(
  "/sellers/:sellerId/go-live",
  checkInput(updateSellerGoLiveSchema),
  catchErrors(adminController.updateSellerGoLiveStatus),
);
adminRoutes.get(
  "/products/moderation-queue",
  checkInput(moderationQueueSchema),
  catchErrors(adminController.moderationQueue),
);
adminRoutes.get(
  "/products/prefill",
  checkInput(productPrefillSchema),
  catchErrors(productController.prefill),
);
adminRoutes.post(
  "/products/bulk/update",
  checkInput(bulkProductSchema),
  catchErrors(productController.bulkUpdate),
);
adminRoutes.get(
  "/products/inventory/stats",
  catchErrors(productController.inventoryStats),
);
adminRoutes.get(
  "/products/analytics/top",
  catchErrors(productController.topProducts),
);
adminRoutes.get(
  "/products",
  checkInput(listProductSchema),
  catchErrors((req, res) => {
    req.query = { ...req.query, includeAllStatuses: "true" };
    return productController.list(req, res);
  }),
);
adminRoutes.post(
  "/products",
  checkInput(createProductSchema),
  catchErrors(productController.create),
);
adminRoutes.get(
  "/products/:productId/revisions",
  checkInput(listProductRevisionsSchema),
  catchErrors(productController.listRevisions),
);
adminRoutes.patch(
  "/products/:productId/revisions/:revisionId/review",
  checkInput(reviewProductRevisionSchema),
  catchErrors(productController.reviewRevision),
);
adminRoutes.get(
  "/products/:productId",
  checkInput(productParamSchema),
  catchErrors(productController.getOne),
);
adminRoutes.patch(
  "/products/:productId",
  checkInput(updateProductSchema),
  catchErrors(productController.update),
);
adminRoutes.delete(
  "/products/:productId",
  checkInput(productParamSchema),
  catchErrors(productController.delete),
);
adminRoutes.patch(
  "/products/:productId/status",
  checkInput(productStatusSchema),
  catchErrors(productController.status),
);
adminRoutes.patch(
  "/products/:productId/archive",
  checkInput(productLifecycleSchema),
  catchErrors(productController.archive),
);
adminRoutes.patch(
  "/products/:productId/restore",
  checkInput(productLifecycleSchema),
  catchErrors(productController.restore),
);
adminRoutes.post(
  "/products/:productId/duplicate",
  checkInput(productLifecycleSchema),
  catchErrors(productController.duplicate),
);
adminRoutes.patch(
  "/products/:productId/inventory",
  checkInput(updateInventorySchema),
  catchErrors(productController.adjustInventory),
);
adminRoutes.patch(
  "/products/:productId/approve",
  checkInput(productParamSchema),
  catchErrors((req, res) => {
    req.body = {
      status: "active",
      checklist: {
        titleVerified: true,
        categoryVerified: true,
        complianceVerified: true,
        mediaVerified: true,
      },
    };
    return productController.review(req, res);
  }),
);
adminRoutes.patch(
  "/products/:productId/reject",
  checkInput(rejectProductSchema),
  catchErrors((req, res) => {
    req.body = {
      ...req.body,
      status: "rejected",
    };
    return productController.review(req, res);
  }),
);
adminRoutes.patch(
  "/products/:productId/moderate",
  checkInput(moderateProductSchema),
  catchErrors(adminController.moderateProduct),
);
adminRoutes.get(
  "/orders",
  authenticate,
  allowPermissions("orders:view"),
  checkInput(listOrdersSchema),
  catchErrors(adminController.listOrders),
);
adminRoutes.get(
  "/payments",
  checkInput(listPaymentsSchema),
  catchErrors(adminController.listPayments),
);
adminRoutes.post(
  "/payouts",
  checkInput(createPayoutSchema),
  catchErrors(adminController.createPayout),
);
adminRoutes.get(
  "/payouts",
  checkInput(listPayoutsSchema),
  catchErrors(adminController.listPayouts),
);
adminRoutes.get(
  "/tax/reports",
  checkInput(taxReportSchema),
  catchErrors(adminController.taxReport),
);
adminRoutes.post(
  "/tax/orders/:orderId/invoice",
  checkInput(createInvoiceSchema),
  catchErrors(adminController.createInvoice),
);
adminRoutes.post(
  "/platform/api-keys",
  checkInput(createApiKeySchema),
  catchErrors(adminController.createApiKey),
);
adminRoutes.get(
  "/platform/api-keys",
  checkInput(listApiKeysSchema),
  catchErrors(adminController.listApiKeys),
);
adminRoutes.post(
  "/platform/webhooks",
  checkInput(createWebhookSubscriptionSchema),
  catchErrors(adminController.createWebhookSubscription),
);
adminRoutes.get(
  "/platform/webhooks",
  checkInput(listWebhookSubscriptionsSchema),
  catchErrors(adminController.listWebhookSubscriptions),
);
adminRoutes.put(
  "/platform/feature-flags",
  checkInput(upsertFeatureFlagSchema),
  catchErrors(adminController.upsertFeatureFlag),
);
adminRoutes.get(
  "/platform/feature-flags",
  checkInput(listFeatureFlagsSchema),
  catchErrors(adminController.listFeatureFlags),
);
adminRoutes.get(
  "/analytics/realtime",
  checkInput(realtimeAnalyticsSchema),
  catchErrors(adminController.realtimeAnalytics),
);
adminRoutes.get(
  "/returns/analytics",
  checkInput(returnsAnalyticsSchema),
  catchErrors(adminController.returnsAnalytics),
);
adminRoutes.get(
  "/chargebacks",
  checkInput(listChargebacksSchema),
  catchErrors(adminController.listChargebacks),
);
adminRoutes.get(
  "/system/health",
  checkInput(queueStatusSchema),
  catchErrors(adminController.systemHealth),
);
adminRoutes.get(
  "/system/queues",
  checkInput(queueStatusSchema),
  catchErrors(adminController.queueStatus),
);
adminRoutes.post(
  "/system/queues/:queueName/pause",
  checkInput(queueActionSchema),
  catchErrors(adminController.pauseQueue),
);
adminRoutes.post(
  "/system/queues/:queueName/resume",
  checkInput(queueActionSchema),
  catchErrors(adminController.resumeQueue),
);
adminRoutes.get(
  "/system/dead-letter",
  checkInput(listDeadLetterSchema),
  catchErrors(adminController.listDeadLetterEvents),
);
adminRoutes.post(
  "/system/dead-letter/:eventId/retry",
  checkInput(deadLetterActionSchema),
  catchErrors(adminController.retryDeadLetterEvent),
);
adminRoutes.post(
  "/system/dead-letter/:eventId/discard",
  checkInput(deadLetterActionSchema),
  catchErrors(adminController.discardDeadLetterEvent),
);
adminRoutes.post(
  "/platform/subscription-plans",
  checkInput(createSubscriptionPlanSchema),
  catchErrors(adminController.createSubscriptionPlan),
);
adminRoutes.get(
  "/platform/subscription-plans",
  checkInput(listSubscriptionPlanSchema),
  catchErrors(adminController.listSubscriptionPlans),
);
adminRoutes.get(
  "/platform/subscription-plans/:planId",
  checkInput(subscriptionPlanParamSchema),
  catchErrors(adminController.getSubscriptionPlan),
);
adminRoutes.patch(
  "/platform/subscription-plans/:planId",
  checkInput(updateSubscriptionPlanSchema),
  catchErrors(adminController.updateSubscriptionPlan),
);
adminRoutes.delete(
  "/platform/subscription-plans/:planId",
  checkInput(subscriptionPlanParamSchema),
  catchErrors(adminController.deleteSubscriptionPlan),
);
adminRoutes.get(
  "/platform/subscriptions",
  checkInput(listPlatformSubscriptionsSchema),
  catchErrors(adminController.listPlatformSubscriptions),
);
adminRoutes.patch(
  "/platform/subscriptions/:subscriptionId/status",
  checkInput(updatePlatformSubscriptionStatusSchema),
  catchErrors(adminController.updatePlatformSubscriptionStatus),
);
adminRoutes.post(
  "/platform/fee-config",
  checkInput(createPlatformFeeConfigSchema),
  catchErrors(adminController.createPlatformFeeConfig),
);
adminRoutes.get(
  "/platform/fee-config",
  checkInput(listPlatformFeeConfigSchema),
  catchErrors(adminController.listPlatformFeeConfigs),
);
adminRoutes.get(
  "/platform/fee-config/:configId",
  checkInput(platformFeeConfigParamSchema),
  catchErrors(adminController.getPlatformFeeConfig),
);
adminRoutes.patch(
  "/platform/fee-config/:configId",
  checkInput(updatePlatformFeeConfigSchema),
  catchErrors(adminController.updatePlatformFeeConfig),
);
adminRoutes.delete(
  "/platform/fee-config/:configId",
  checkInput(platformFeeConfigParamSchema),
  catchErrors(adminController.deletePlatformFeeConfig),
);

// Platform Management Routes
adminRoutes.get(
  "/platform/catalog-prefill",
  catchErrors(platformController.getCatalogPrefillData),
);

adminRoutes.post(
  "/platform/categories",
  checkInput(createCategorySchema),
  catchErrors(platformController.createCategory),
);
adminRoutes.get(
  "/platform/categories",
  checkInput(listCategoriesSchema),
  catchErrors(platformController.listCategories),
);
adminRoutes.get(
  "/platform/categories/:categoryKey",
  checkInput(categoryKeySchema),
  catchErrors(platformController.getCategory),
);
adminRoutes.get(
  "/categories/:categoryKey/attributes",
  checkInput(categoryKeySchema),
  catchErrors(platformController.getCategoryAttributes),
);
adminRoutes.patch(
  "/platform/categories/:categoryKey",
  checkInput(updateCategorySchema),
  catchErrors(platformController.updateCategory),
);
adminRoutes.delete(
  "/platform/categories/:categoryKey",
  checkInput(categoryKeySchema),
  catchErrors(platformController.deleteCategory),
);

adminRoutes.post(
  "/platform/product-families",
  checkInput(createProductFamilySchema),
  catchErrors(platformController.createProductFamily),
);
adminRoutes.get(
  "/platform/product-families",
  checkInput(listProductFamiliesSchema),
  catchErrors(platformController.listProductFamilies),
);
adminRoutes.get(
  "/platform/product-families/:familyCode",
  checkInput(productFamilyCodeSchema),
  catchErrors(platformController.getProductFamily),
);
adminRoutes.patch(
  "/platform/product-families/:familyCode",
  checkInput(updateProductFamilySchema),
  catchErrors(platformController.updateProductFamily),
);
adminRoutes.delete(
  "/platform/product-families/:familyCode",
  checkInput(productFamilyCodeSchema),
  catchErrors(platformController.deleteProductFamily),
);

adminRoutes.post(
  "/platform/product-variants",
  checkInput(createProductVariantSchema),
  catchErrors(platformController.createProductVariant),
);
adminRoutes.get(
  "/platform/product-variants",
  checkInput(listProductVariantsSchema),
  catchErrors(platformController.listProductVariants),
);
adminRoutes.get(
  "/platform/product-variants/:variantId",
  checkInput(productVariantIdSchema),
  catchErrors(platformController.getProductVariant),
);
adminRoutes.patch(
  "/platform/product-variants/:variantId",
  checkInput(updateProductVariantSchema),
  catchErrors(platformController.updateProductVariant),
);
adminRoutes.delete(
  "/platform/product-variants/:variantId",
  checkInput(productVariantIdSchema),
  catchErrors(platformController.deleteProductVariant),
);

adminRoutes.post(
  "/platform/hsn-codes",
  checkInput(createHsnCodeSchema),
  catchErrors(platformController.createHsnCode),
);
adminRoutes.get(
  "/platform/hsn-codes",
  checkInput(listHsnCodesSchema),
  catchErrors(platformController.listHsnCodes),
);
adminRoutes.get(
  "/platform/hsn-codes/:hsnCode",
  checkInput(hsnCodeSchema),
  catchErrors(platformController.getHsnCode),
);
adminRoutes.patch(
  "/platform/hsn-codes/:hsnCode",
  checkInput(updateHsnCodeSchema),
  catchErrors(platformController.updateHsnCode),
);
adminRoutes.delete(
  "/platform/hsn-codes/:hsnCode",
  checkInput(hsnCodeSchema),
  catchErrors(platformController.deleteHsnCode),
);

adminRoutes.post(
  "/platform/geography",
  checkInput(createGeographySchema),
  catchErrors(platformController.createGeography),
);
adminRoutes.get(
  "/platform/geography",
  checkInput(listGeographiesSchema),
  catchErrors(platformController.listGeographies),
);
adminRoutes.get(
  "/platform/geography/:countryCode",
  checkInput(geographyCodeSchema),
  catchErrors(platformController.getGeography),
);
adminRoutes.patch(
  "/platform/geography/:countryCode",
  checkInput(updateGeographySchema),
  catchErrors(platformController.updateGeography),
);
adminRoutes.delete(
  "/platform/geography/:countryCode",
  checkInput(geographyCodeSchema),
  catchErrors(platformController.deleteGeography),
);

adminRoutes.get(
  "/platform/product-reviews",
  checkInput(listProductReviewsSchema),
  catchErrors(platformController.listProductReviews),
);
adminRoutes.patch(
  "/platform/product-reviews/:reviewId",
  checkInput(updateProductReviewSchema),
  catchErrors(platformController.updateProductReview),
);
adminRoutes.delete(
  "/platform/product-reviews/:reviewId",
  checkInput(productReviewIdSchema),
  catchErrors(platformController.deleteProductReview),
);

adminRoutes.post(
  "/platform/brands",
  checkInput(createBrandSchema),
  catchErrors(platformController.createBrand),
);
adminRoutes.get(
  "/platform/brands",
  checkInput(listBrandsSchema),
  catchErrors(platformController.listBrands),
);
adminRoutes.get(
  "/platform/brands/:brandId",
  checkInput(brandIdSchema),
  catchErrors(platformController.getBrand),
);
adminRoutes.patch(
  "/platform/brands/:brandId",
  checkInput(updateBrandSchema),
  catchErrors(platformController.updateBrand),
);
adminRoutes.delete(
  "/platform/brands/:brandId",
  checkInput(brandIdSchema),
  catchErrors(platformController.deleteBrand),
);

adminRoutes.post(
  "/platform/warranty-templates",
  checkInput(createWarrantyTemplateSchema),
  catchErrors(platformController.createWarrantyTemplate),
);
adminRoutes.get(
  "/platform/warranty-templates",
  checkInput(listWarrantyTemplatesSchema),
  catchErrors(platformController.listWarrantyTemplates),
);
adminRoutes.get(
  "/platform/warranty-templates/:templateId",
  checkInput(warrantyTemplateIdSchema),
  catchErrors(platformController.getWarrantyTemplate),
);
adminRoutes.patch(
  "/platform/warranty-templates/:templateId",
  checkInput(updateWarrantyTemplateSchema),
  catchErrors(platformController.updateWarrantyTemplate),
);
adminRoutes.delete(
  "/platform/warranty-templates/:templateId",
  checkInput(warrantyTemplateIdSchema),
  catchErrors(platformController.deleteWarrantyTemplate),
);

adminRoutes.post("/platform/finishes", checkInput(createFinishSchema), catchErrors(platformController.createFinish));
adminRoutes.get("/platform/finishes", checkInput(listFinishesSchema), catchErrors(platformController.listFinishes));
adminRoutes.patch("/platform/finishes/:finishId", checkInput(updateFinishSchema), catchErrors(platformController.updateFinish));
adminRoutes.delete("/platform/finishes/:finishId", checkInput(finishIdSchema), catchErrors(platformController.deleteFinish));

adminRoutes.post("/platform/dimensions", checkInput(createDimensionSchema), catchErrors(platformController.createDimension));
adminRoutes.get("/platform/dimensions", checkInput(listDimensionsSchema), catchErrors(platformController.listDimensions));
adminRoutes.patch("/platform/dimensions/:dimensionId", checkInput(updateDimensionSchema), catchErrors(platformController.updateDimension));
adminRoutes.delete("/platform/dimensions/:dimensionId", checkInput(dimensionIdSchema), catchErrors(platformController.deleteDimension));

adminRoutes.post("/platform/batches", checkInput(createBatchSchema), catchErrors(platformController.createBatch));
adminRoutes.get("/platform/batches", checkInput(listBatchesSchema), catchErrors(platformController.listBatches));
adminRoutes.patch("/platform/batches/:batchId", checkInput(updateBatchSchema), catchErrors(platformController.updateBatch));
adminRoutes.delete("/platform/batches/:batchId", checkInput(batchIdSchema), catchErrors(platformController.deleteBatch));

adminRoutes.post("/platform/product-options", checkInput(createProductOptionSchema), catchErrors(platformController.createProductOption));
adminRoutes.get("/platform/product-options", checkInput(listProductOptionsSchema), catchErrors(platformController.listProductOptions));
adminRoutes.patch("/platform/product-options/:optionId", checkInput(updateProductOptionSchema), catchErrors(platformController.updateProductOption));
adminRoutes.delete("/platform/product-options/:optionId", checkInput(productOptionIdSchema), catchErrors(platformController.deleteProductOption));

adminRoutes.post("/platform/product-option-values", checkInput(createProductOptionValueSchema), catchErrors(platformController.createProductOptionValue));
adminRoutes.get("/platform/product-option-values", checkInput(listProductOptionValuesSchema), catchErrors(platformController.listProductOptionValues));
adminRoutes.patch("/platform/product-option-values/:optionValueId", checkInput(updateProductOptionValueSchema), catchErrors(platformController.updateProductOptionValue));
adminRoutes.delete("/platform/product-option-values/:optionValueId", checkInput(productOptionValueIdSchema), catchErrors(platformController.deleteProductOptionValue));

// CMS Routes
adminRoutes.get("/cms", checkInput(cmsListSchema), catchErrors(cmsController.listPages));
adminRoutes.post("/cms", checkInput(cmsCreateSchema), catchErrors(cmsController.createPage));
adminRoutes.get("/cms/:slug", checkInput(cmsSlugParam), catchErrors(cmsController.getPage));
adminRoutes.patch("/cms/:slug", checkInput(cmsUpdateSchema), catchErrors(cmsController.updatePage));
adminRoutes.delete("/cms/:slug", checkInput(cmsSlugParam), catchErrors(cmsController.deletePage));

module.exports = { adminRoutes };
