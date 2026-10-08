const { okResponse } = require("../../../shared/http/reply");
const { UserService } = require("../services/user.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { readProfileImage } = require("../../../shared/upload/profile-image.service");

class UserController {
  constructor({ userService = new UserService() } = {}) {
    this.userService = userService;
  }

  getMe = async (req, res) => {
    res.set("Cache-Control", "no-store");
    const actor = getCurrentUser(req);
    const user = await this.userService.getProfile(actor.userId);
    res.json(okResponse(user));
  };

  profileImage = async (req, res) => {
    const actor = getCurrentUser(req);
    const image = await readProfileImage(actor.userId);
    res.set({ "Content-Type": image.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Authorization" });
    res.send(image.body);
  };

  updateMe = async (req, res) => {
    res.set("Cache-Control", "no-store");
    const actor = getCurrentUser(req);
    const user = await this.userService.updateProfile(actor.userId, req.body);
    res.json(okResponse(user));
  };

  addAddress = async (req, res) => {
    const actor = getCurrentUser(req);
    const addresses = await this.userService.addAddress(actor.userId, req.body);
    res.status(201).json(okResponse(addresses));
  };

  updateAddress = async (req, res) => {
    const actor = getCurrentUser(req);
    const addresses = await this.userService.updateAddress(actor.userId, req.params.addressId, req.body);
    res.json(okResponse(addresses));
  };

  deleteAddress = async (req, res) => {
    const actor = getCurrentUser(req);
    const addresses = await this.userService.deleteAddress(actor.userId, req.params.addressId);
    res.json(okResponse(addresses));
  };

  submitKyc = async (req, res) => {
    const actor = getCurrentUser(req);
    const kyc = await this.userService.submitKyc(actor.userId, req.body);
    res.status(201).json(okResponse(kyc));
  };

  uploadKycDocuments = async (req, res) => {
    const actor = getCurrentUser(req);
    const documents = await this.userService.uploadKycDocuments(actor.userId, req.body.documents);
    res.status(201).json(okResponse({ documents }));
  };

  reviewKyc = async (req, res) => {
    const actor = getCurrentUser(req);
    const kyc = await this.userService.reviewKyc(req.params.userId, req.body, actor);
    res.json(okResponse(kyc));
  };
}

module.exports = { UserController };
