const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { COUPON_TYPE } = require("../../../shared/domain/commerce-constants");

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    sellerId: { type: String, index: true },
    createdBy: { type: String, index: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    type: { type: String, enum: Object.values(COUPON_TYPE), required: true },
    value: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscountAmount: { type: Number, default: null },
    active: { type: Boolean, default: true, index: true },
    usageLimit: { type: Number, default: null },
    usesPerCustomer: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    startsAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);

const CouponModel = mongoose.model("Coupon", couponSchema);

module.exports = { CouponModel };
