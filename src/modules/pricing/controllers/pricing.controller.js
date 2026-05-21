const { okResponse } = require("../../../shared/http/reply");
const { PricingService } = require("../services/pricing.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class PricingController {
  constructor({ pricingService = new PricingService() } = {}) {
    this.pricingService = pricingService;
  }

  createCoupon = async (req, res) => {
    const coupon = await this.pricingService.createCoupon(req.body, getCurrentUser(req));
    res.status(201).json(okResponse(coupon));
  };

  listCoupons = async (req, res) => {
    const coupons = await this.pricingService.listCoupons(getCurrentUser(req));
    res.json(okResponse(coupons));
  };

  getCoupon = async (req, res) => {
    const coupon = await this.pricingService.getCoupon(req.params.couponId, getCurrentUser(req));
    res.json(okResponse(coupon));
  };

  updateCoupon = async (req, res) => {
    const coupon = await this.pricingService.updateCoupon(req.params.couponId, req.body, getCurrentUser(req));
    res.json(okResponse(coupon));
  };

  deleteCoupon = async (req, res) => {
    const coupon = await this.pricingService.deleteCoupon(req.params.couponId, getCurrentUser(req));
    res.json(okResponse(coupon));
  };
}

module.exports = { PricingController };
