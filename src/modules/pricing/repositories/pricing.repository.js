const { CouponModel } = require("../models/coupon.model");
const { postgresPool } = require("../../../infrastructure/postgres/postgres-client");

class PricingRepository {
  async getMarketingUsage({ campaignKey, userId, code, policyType = null, partnerIds = [] }) {
    // Persisted order snapshots are the reservation ledger, including pending payments.
    // Never swallow query failures: limits must fail closed.
    const { rows } = await postgresPool.query(`
      WITH live AS (
        SELECT *, metadata->'marketing' AS marketing FROM orders
        WHERE status NOT IN ('cancelled', 'refunded')
          AND COALESCE(payment_status::text, '') <> 'refunded'
      ), campaign AS (
        SELECT * FROM live WHERE marketing->>'campaignKey' = $1
          AND ($5::text IS NULL OR marketing->>'policyType' = $5 OR marketing->>'policyType' IS NULL)
      ), partner AS (
        SELECT entry->>'partnerId' AS id, SUM((entry->>'amount')::numeric) AS amount
        FROM campaign CROSS JOIN LATERAL jsonb_array_elements(COALESCE(marketing->'commissions', '[]'::jsonb)) entry
        WHERE entry->>'partnerId' = ANY($4::text[]) GROUP BY entry->>'partnerId'
      )
      SELECT
        COUNT(*) AS "campaignUses",
        (SELECT COUNT(*) FROM orders WHERE buyer_id = $2 AND status <> 'cancelled') AS "previousOrders",
        COUNT(*) FILTER (WHERE buyer_id = $2) AS "customerUses",
        COUNT(*) FILTER (WHERE buyer_id = $2 AND UPPER(coupon_code) = UPPER($3)) AS "codeUses",
        COUNT(*) FILTER (WHERE buyer_id = $2 AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS "monthlyUses",
        COALESCE(SUM((marketing->>'discountAmount')::numeric) FILTER (WHERE buyer_id = $2), 0) AS "customerDiscount",
        COALESCE(SUM((marketing->>'discountAmount')::numeric) FILTER (WHERE buyer_id = $2 AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS "monthlyDiscount",
        COALESCE(SUM((marketing->>'cost')::numeric), 0) AS "campaignCost",
        (SELECT COALESCE(jsonb_object_agg(id, amount), '{}'::jsonb) FROM partner) AS "partnerCommissions"
      FROM campaign`, [campaignKey, userId, code, partnerIds.map(String), policyType]);
    const result = rows[0];
    for (const key of ["campaignUses", "previousOrders", "customerUses", "codeUses", "monthlyUses", "customerDiscount", "monthlyDiscount", "campaignCost"]) result[key] = Number(result[key] || 0);
    return result;
  }

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
