const express = require("express");
const { SellerController } = require("../controllers/seller.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authenticate, authenticatePendingSeller } = require("../../../shared/middleware/authenticate");
const { allowActions, allowRoles, allowPermissions } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  submitKycSchema,
  uploadSellerKycDocumentsSchema,
  reviewSellerKycSchema,
  updateSellerProfileSchema,
  updateSellerSettingsSchema,
  updateSellerChargeSettingsSchema,
  updateSellerAddressSchema,
  updateSellerBankSchema,
  updateSellerMoreInfoSchema,
  sellerDashboardSchema,
  sellerWebStatusSchema,
  sellerTrackingSchema,
  sellerTrackingOrderSchema,
  listSellerAccessModulesSchema,
  createSellerSubAdminSchema,
  listSellerSubAdminsSchema,
  updateSellerSubAdminModulesSchema,
  updateSellerSubAdminStatusSchema,
  sellerSubAdminParamSchema,
  createSellerOrganizationSchema,
  updateSellerOrganizationSchema,
  sellerOrganizationParamSchema,
  listSellerOrganizationsSchema,
} = require("../validation/seller.validation");
const { ACTIONS } = require("../../../shared/constants/actions");
const { ROLES } = require("../../../shared/constants/roles");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { okResponse } = require("../../../shared/http/reply");
const { sellerChargeSettingsService } = require("../services/seller-charge-settings.service");

const sellerRoutes = express.Router();
const sellerController = new SellerController();

// Onboarding routes - accessible with onboarding token
sellerRoutes.post(
  "/onboarding/kyc/documents",
  authenticatePendingSeller,
  checkInput(uploadSellerKycDocumentsSchema),
  catchErrors(sellerController.uploadKycDocuments),
);
sellerRoutes.post(
  "/onboarding/kyc",
  authenticatePendingSeller,
  checkInput(submitKycSchema),
  catchErrors(sellerController.submitKyc),
);
sellerRoutes.patch(
  "/onboarding/profile",
  authenticatePendingSeller,
  checkInput(updateSellerProfileSchema),
  catchErrors(sellerController.updateProfile),
);

// Admin routes
sellerRoutes.patch(
  "/:sellerId/kyc/review",
  authenticate,
  allowActions(ACTIONS.KYC_REVIEW),
  checkInput(reviewSellerKycSchema),
  catchErrors(sellerController.reviewKyc),
);

// Authenticated seller routes
sellerRoutes.get(
  "/me/access/modules",
  authenticate,
  allowRoles(ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN),
  checkInput(listSellerAccessModulesSchema),
  catchErrors(sellerController.listAccessModules),
);
sellerRoutes.get(
  "/me/sidebar/modules",
  authenticate,
  allowRoles(ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN),
  checkInput(listSellerAccessModulesSchema),
  catchErrors(sellerController.listSidebarModules),
);
sellerRoutes.get(
  "/me/status",
  authenticate,
  checkInput(sellerWebStatusSchema),
  catchErrors(sellerController.getWebStatus),
);
sellerRoutes.get(
  "/me/tracking",
  authenticate,
  checkInput(sellerTrackingSchema),
  catchErrors(sellerController.listWebTracking),
);
sellerRoutes.get(
  "/me/tracking/:orderId",
  authenticate,
  checkInput(sellerTrackingOrderSchema),
  catchErrors(sellerController.getWebTrackingOrder),
);
sellerRoutes.get(
  "/me/profile",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  catchErrors(sellerController.getProfile),
);
sellerRoutes.get(
  "/me/organizations",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(listSellerOrganizationsSchema),
  catchErrors(sellerController.listOrganizations),
);
sellerRoutes.post(
  "/me/organizations",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(createSellerOrganizationSchema),
  catchErrors(sellerController.createOrganization),
);
sellerRoutes.patch(
  "/me/organizations/:organizationId",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerOrganizationSchema),
  catchErrors(sellerController.updateOrganization),
);
sellerRoutes.patch(
  "/me/organizations/:organizationId/default",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(sellerOrganizationParamSchema),
  catchErrors(sellerController.setDefaultOrganization),
);
sellerRoutes.patch(
  "/me/profile",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerProfileSchema),
  catchErrors(sellerController.updateProfile),
);
sellerRoutes.patch(
  "/me/business-address",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerAddressSchema),
  catchErrors(sellerController.updateBusinessAddress),
);
sellerRoutes.patch(
  "/me/pickup-address",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerAddressSchema),
  catchErrors(sellerController.updatePickupAddress),
);
sellerRoutes.patch(
  "/me/return-address",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerAddressSchema),
  catchErrors(sellerController.updateReturnAddress),
);
sellerRoutes.patch(
  "/me/bank-details",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerBankSchema),
  catchErrors(sellerController.updateBankDetails),
);
sellerRoutes.patch(
  "/me/more-info",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerMoreInfoSchema),
  catchErrors(sellerController.updateMoreInfo),
);
sellerRoutes.patch(
  "/me/settings",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerSettingsSchema),
  catchErrors(sellerController.updateSettings),
);
sellerRoutes.get(
  "/me/charge-settings",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const sellerId = sellerChargeSettingsService.resolveSellerId(actor);
    const settings = await sellerChargeSettingsService.getSettings(sellerId, actor.organizationId);
    res.json(okResponse(settings));
  }),
);
sellerRoutes.put(
  "/me/charge-settings",
  authenticate,
  allowActions(ACTIONS.SELLER_PROFILE_MANAGE),
  checkInput(updateSellerChargeSettingsSchema),
  catchErrors(async (req, res) => {
    const actor = getCurrentUser(req);
    const sellerId = sellerChargeSettingsService.resolveSellerId(actor);
    const settings = await sellerChargeSettingsService.updateSettings(sellerId, req.body, actor, actor.organizationId);
    res.json(okResponse(settings, { message: "Seller charge settings updated" }));
  }),
);
sellerRoutes.post(
  "/me/kyc",
  authenticate,
  allowActions(ACTIONS.SELLER_KYC_SUBMIT),
  checkInput(submitKycSchema),
  catchErrors(sellerController.submitKyc),
);
sellerRoutes.post(
  "/me/kyc/documents",
  authenticate,
  allowActions(ACTIONS.SELLER_KYC_SUBMIT),
  checkInput(uploadSellerKycDocumentsSchema),
  catchErrors(sellerController.uploadKycDocuments),
);
sellerRoutes.get(
  "/me/dashboard",
  authenticate,
  allowActions(ACTIONS.SELLER_DASHBOARD_VIEW),
  checkInput(sellerDashboardSchema),
  catchErrors(sellerController.dashboard),
);
sellerRoutes.post(
  "/me/sub-admins",
  authenticate,
  allowRoles(ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN),
  // Seller admins/sub-sellers need the sellers:create permission to create child seller accounts.
  // Sellers (full role) are exempt from the permission check (isSuperAdmin bypass in allowPermissions).
  allowPermissions("sellers:create"),
  checkInput(createSellerSubAdminSchema),
  catchErrors(sellerController.createSubAdmin),
);
sellerRoutes.get(
  "/me/sub-admins",
  authenticate,
  allowRoles(ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN),
  allowPermissions("sellers:view"),
  checkInput(listSellerSubAdminsSchema),
  catchErrors(sellerController.listSubAdmins),
);
sellerRoutes.patch(
  "/me/sub-admins/:userId/modules",
  authenticate,
  allowRoles(ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN),
  allowPermissions("sellers:update"),
  checkInput(updateSellerSubAdminModulesSchema),
  catchErrors(sellerController.updateSubAdminModules),
);
sellerRoutes.patch(
  "/me/sub-admins/:userId/status",
  authenticate,
  allowRoles(ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN),
  allowPermissions("sellers:status_change"),
  checkInput(updateSellerSubAdminStatusSchema),
  catchErrors(sellerController.updateSubAdminStatus),
);
sellerRoutes.delete(
  "/me/sub-admins/:userId",
  authenticate,
  allowRoles(ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN),
  allowPermissions("sellers:delete"),
  checkInput(sellerSubAdminParamSchema),
  catchErrors(sellerController.deleteSubAdmin),
);

module.exports = { sellerRoutes };
