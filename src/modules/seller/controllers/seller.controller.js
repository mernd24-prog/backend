const { okResponse } = require("../../../shared/http/reply");
const { SellerService } = require("../services/seller.service");
const { PlatformService } = require("../../platform/services/platform.service");
const { sellerOrganizationService } = require("../services/seller-organization.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { getPage } = require("../../../shared/tools/page");
const { paginationMeta } = require("../../../shared/http/reply");

class SellerController {
  constructor({
    sellerService = new SellerService(),
    platformService = new PlatformService(),
  } = {}) {
    this.sellerService = sellerService;
    this.platformService = platformService;
  }

  submitKyc = async (req, res) => {
    const actor = getCurrentUser(req);
    const kyc = await this.sellerService.submitKyc(req.body, actor);
    res.status(201).json(okResponse(kyc));
  };

  uploadKycDocuments = async (req, res) => {
    const actor = getCurrentUser(req);
    const documents = await this.sellerService.uploadKycDocuments(req.body.documents, actor);
    res.status(201).json(okResponse({ documents }));
  };

  sendAadhaarOtp = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.sellerService.sendAadhaarOtp(req.body, actor);
    res.json(okResponse(result, { message: result.message || "Aadhaar OTP sent successfully" }));
  };

  precheckAadhaar = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.sellerService.precheckAadhaar(req.body, actor);
    res.json(okResponse(result, { message: result.message || "Aadhaar precheck completed" }));
  };

  verifyAadhaarOtp = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.sellerService.verifyAadhaarOtp(req.body, actor);
    res.json(okResponse(result, { message: "Aadhaar verified successfully" }));
  };

  verifyPan = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.sellerService.verifyPan(req.body, actor);
    res.json(okResponse(result, { message: result.message || "PAN verified successfully" }));
  };

  precheckPan = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.sellerService.precheckPan(req.body, actor);
    res.json(okResponse(result, { message: result.message || "PAN precheck completed" }));
  };

  reviewKyc = async (req, res) => {
    const actor = getCurrentUser(req);
    const kyc = await this.sellerService.reviewKyc(req.params.sellerId, req.body, { ...actor, _req: req });
    res.json(okResponse(kyc));
  };

  getProfile = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await this.sellerService.getProfile(actor);
    res.json(okResponse(profile));
  };

  getWebStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const status = await this.sellerService.getWebStatus(actor);
    res.json(okResponse(status));
  };

  listWebTracking = async (req, res) => {
    const actor = getCurrentUser(req);
    const tracking = await this.sellerService.listWebTracking(req.query, actor);
    res.json(okResponse(tracking));
  };

  getWebTrackingOrder = async (req, res) => {
    const actor = getCurrentUser(req);
    const tracking = await this.sellerService.getWebTrackingOrder(req.params.orderId, actor);
    res.json(okResponse(tracking));
  };

  updateProfile = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await this.sellerService.updateProfile(req.body, actor);
    res.json(okResponse(profile));
  };

  updateBusinessAddress = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await this.sellerService.patchProfileSection("businessAddress", req.body, actor);
    res.json(okResponse(profile));
  };

  updatePickupAddress = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await this.sellerService.patchProfileSection("pickupAddress", req.body, actor);
    res.json(okResponse(profile));
  };

  updateReturnAddress = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await this.sellerService.patchProfileSection("returnAddress", req.body, actor);
    res.json(okResponse(profile));
  };

  updateBankDetails = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await this.sellerService.patchProfileSection("bankDetails", req.body, actor);
    res.json(okResponse(profile));
  };

  updateMoreInfo = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await this.sellerService.updateMoreInfo(req.body, actor);
    res.json(okResponse(profile));
  };

  updateSettings = async (req, res) => {
    const actor = getCurrentUser(req);
    const settings = await this.sellerService.updateSettings(req.body, actor);
    res.json(okResponse(settings));
  };

  dashboard = async (req, res) => {
    const actor = getCurrentUser(req);
    const dashboard = await this.sellerService.getDashboard(req.query, actor);
    res.json(okResponse(dashboard));
  };

  listProductReviews = async (req, res) => {
    const actor = getCurrentUser(req);
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listSellerProductReviews(req.query, actor);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  updateProductReview = async (req, res) => {
    const actor = getCurrentUser(req);
    const review = await this.platformService.updateSellerProductReview(req.params.reviewId, req.body, actor);
    res.json(okResponse(review, { message: "Product review updated successfully." }));
  };

  bulkUpdateProductReviews = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.platformService.bulkUpdateSellerProductReviews(req.body, actor);
    res.json(okResponse(result, { message: "Product reviews updated successfully." }));
  };

  listAccessModules = async (req, res) => {
    const actor = getCurrentUser(req);
    const modules = await this.sellerService.listAccessModules(req.query, actor);
    res.json(okResponse(modules));
  };

  listSidebarModules = async (req, res) => {
    const actor = getCurrentUser(req);
    const modules = await this.sellerService.listSidebarModules(req.query, actor);
    res.json(okResponse(modules));
  };

  createSubAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.sellerService.createSellerSubAdmin(req.body, { ...actor, _req: req });
    res.status(201).json(okResponse(user));
  };

  listSubAdmins = async (req, res) => {
    const actor = getCurrentUser(req);
    const users = await this.sellerService.listSellerSubAdmins(actor);
    res.json(okResponse(users));
  };

  updateSubAdminModules = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.sellerService.updateSellerSubAdminModules(req.params.userId, req.body, actor);
    res.json(okResponse(user));
  };

  updateSubAdminStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.sellerService.updateSellerSubAdminStatus(req.params.userId, req.body, actor);
    res.json(okResponse(user));
  };

  deleteSubAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.sellerService.deleteSellerSubAdmin(req.params.userId, { ...actor, _req: req });
    res.json(okResponse(result));
  };

  listOrganizations = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await sellerOrganizationService.listMine(req.query, actor);
    res.json(okResponse(result));
  };

  createOrganization = async (req, res) => {
    const actor = getCurrentUser(req);
    const organization = await sellerOrganizationService.createMine(req.body, actor);
    res.status(201).json(okResponse(organization));
  };

  updateOrganization = async (req, res) => {
    const actor = getCurrentUser(req);
    const organization = await sellerOrganizationService.updateMine(
      req.params.organizationId,
      req.body,
      actor,
    );
    res.json(okResponse(organization));
  };

  setDefaultOrganization = async (req, res) => {
    const actor = getCurrentUser(req);
    const organization = await sellerOrganizationService.setMineDefault(
      req.params.organizationId,
      actor,
    );
    res.json(okResponse(organization));
  };
}

module.exports = { SellerController };
