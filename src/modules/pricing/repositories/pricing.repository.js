const { CouponModel } = require("../models/coupon.model");
const { postgresPool } = require("../../../infrastructure/postgres/postgres-client");

class PricingRepository {
  async createCoupon(payload) {
    return CouponModel.create(payload);
  }

  async findCouponByCode(code) {
    return CouponModel.findOne({ code: code.toUpperCase() });
  }

  async incrementCouponUsage(couponId) {
    return CouponModel.findByIdAndUpdate(couponId, { $inc: { usedCount: 1 } }, { new: true });
  }

  async listCoupons(filter = {}) {
    return CouponModel.find(filter).sort({ createdAt: -1 });
  }

  async findCouponById(couponId, filter = {}) {
    return CouponModel.findOne({ _id: couponId, ...filter });
  }

  async updateCoupon(couponId, payload, filter = {}) {
    return CouponModel.findOneAndUpdate({ _id: couponId, ...filter }, payload, { new: true });
  }

  async deleteCoupon(couponId, filter = {}) {
    return CouponModel.findOneAndDelete({ _id: couponId, ...filter });
  }

  async listActivePlatformFeeRules(categories = []) {
    try {
      const normalized = Array.from(
        new Set((categories || []).map((category) => String(category || "").trim().toLowerCase()).filter(Boolean)),
      );
      const lookup = normalized.length ? normalized : ["default"];

      const { rows } = await postgresPool.query(
        `SELECT *
         FROM platform_fee_config
         WHERE active = true
           AND (effective_from IS NULL OR effective_from <= NOW())
           AND (effective_to IS NULL OR effective_to >= NOW())
           AND (LOWER(category) = ANY($1) OR LOWER(category) IN ('default', '*'))
         ORDER BY updated_at DESC`,
        [lookup],
      );
      return rows;
    } catch (error) {
      return [];
    }
  }
}

module.exports = { PricingRepository };
