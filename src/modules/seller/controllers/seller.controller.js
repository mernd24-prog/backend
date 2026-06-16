const { okResponse } = require("../../../shared/http/reply");
const { SellerService } = require("../services/seller.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class SellerController {
  constructor({ sellerService = new SellerService() } = {}) {
    this.sellerService = sellerService;
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

  listAccessModules = async (req, res) => {
    const actor = getCurrentUser(req);
    const modules = await this.sellerService.listAccessModules(req.query, actor);
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
}

module.exports = { SellerController };
