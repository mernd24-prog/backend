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
    return CouponModel.findOneAndUpdate(
      {
        _id: couponId,
        $expr: {
          $or: [
            { $eq: [{ $ifNull: ["$usageLimit", null] }, null] },
            { $lt: [{ $ifNull: ["$usedCount", 0] }, "$usageLimit"] },
          ],
        },
      },
      { $inc: { usedCount: 1 } },
      { new: true },
    );
  }

  async decrementCouponUsage(couponId) {
    if (!couponId) return null;
    return CouponModel.findOneAndUpdate(
      { _id: couponId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
      { new: true },
    );
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

  async countCouponUsageByCustomer(couponCode, buyerId) {
    try {
      const { rows } = await postgresPool.query(
        `SELECT COUNT(*) AS cnt FROM orders
         WHERE UPPER(coupon_code) = UPPER($1)
           AND buyer_id = $2
           AND status NOT IN ('cancelled', 'payment_failed')`,
        [couponCode, buyerId],
      );
      return Number(rows[0]?.cnt || 0);
    } catch {
      return 0;
    }
  }

}

module.exports = { PricingRepository };
