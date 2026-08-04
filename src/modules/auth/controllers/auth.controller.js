const { okResponse } = require("../../../shared/http/reply");
const { AuthService } = require("../services/auth.service");
const { getRequestInfo } = require("../../../shared/tools/request");

class AuthController {
  constructor({ authService = new AuthService() } = {}) {
    this.authService = authService;
  }

  register = async (req, res) => {
    const result = await this.authService.register(req.body, getRequestInfo(req));
    res.status(201).json(okResponse(result));
  };

  registerWithOtp = async (req, res) => {
    const result = await this.authService.registerWithOtp(req.body, getRequestInfo(req));
    res.status(201).json(okResponse(result));
  };
 
  buyerOtpAuth = async (req, res) => {
    const result = await this.authService.buyerOtpAuth(
      req.body,
      getRequestInfo(req),
    );

    const isNewRegistration =
      Boolean(req.body.otp) &&
      result?.otpAuth?.action === "register";

    res
      .status(isNewRegistration ? 201 : 200)
      .json(okResponse(result));
  };

  verifyRegistration = async (req, res) => {
    const result = await this.authService.verifyRegistration(req.body, getRequestInfo(req));
    res.status(201).json(okResponse(result));
  };

  login = async (req, res) => {
    const result = await this.authService.login(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  influencerLogin = async (req, res) => {
    const result = await this.authService.loginInfluencer(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  refresh = async (req, res) => {
    const result = await this.authService.refreshToken(req.body.refreshToken, getRequestInfo(req));
    res.json(okResponse(result));
  };

  socialLogin = async (req, res) => {
    const result = await this.authService.socialLogin(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  sendOtp = async (req, res) => {
    const result = await this.authService.sendOtp(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  verifyOtp = async (req, res) => {
    const result = await this.authService.verifyOtp(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  resendOtp = async (req, res) => {
    const result = await this.authService.resendOtp(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  forgotPassword = async (req, res) => {
    const result = await this.authService.forgotPassword(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  resetPassword = async (req, res) => {
    const result = await this.authService.resetPassword(req.body, getRequestInfo(req));
    res.json(okResponse(result));
  };

  changePassword = async (req, res) => {
    const payload = { ...req.body, userId: req.auth.sub };
    const result = await this.authService.changePassword(payload, getRequestInfo(req));
    res.json(okResponse(result));
  };

  status = async (req, res) => {
    const result = await this.authService.getAuthStatus(req.auth.sub);
    res.json(okResponse(result));
  };
}

module.exports = { AuthController };
