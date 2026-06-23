const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformFeeRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ruleScope: {
      type: String,
      enum: ["global", "category", "product", "seller", "organization"],
      default: "global",
      index: true,
    },
    feeType: {
      type: String,
      enum: ["flat", "percentage", "tiered", "mixed"],
      required: true,
      index: true,
    },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "CategoryTree", default: null, index: true },
    categoryName: { type: String, default: "", trim: true },
    productId: { type: String, default: "", trim: true, index: true },
    productSku: { type: String, default: "", trim: true, index: true },
    sellerId: { type: String, default: "", trim: true, index: true },
    organizationId: { type: String, default: "", trim: true, index: true },
    amount: { type: Number, default: 0, min: 0 },
    rate: { type: Number, default: 0, min: 0, max: 1 },
    percentage: { type: Number, default: null, min: 0, max: 100 },
    fixedFeeAmount: { type: Number, default: 0, min: 0 },
    applyOn: {
      type: String,
      enum: ["product_amount", "order_subtotal", "final_paid_amount"],
      default: "product_amount",
    },
    taxHandling: {
      type: String,
      enum: ["exclusive", "inclusive"],
      default: "exclusive",
    },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    chargeToCustomer: { type: Boolean, default: false, index: true },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    maxFeeAmount: { type: Number, default: null },
    applicableTiers: {
      type: [String],
      enum: ["bronze", "silver", "gold", "platinum", "all"],
      default: ["all"],
    },
    tiers: [
      {
        minAmount: { type: Number, required: true },
        maxAmount: { type: Number, default: null },
        rate: { type: Number, required: true, min: 0, max: 1 },
        flatAmount: { type: Number, default: 0, min: 0 },
      },
    ],
    effectiveFrom: { type: Date, default: null, index: true },
    effectiveTo: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    priority: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true },
);

platformFeeRuleSchema.index({ isActive: 1, priority: -1 });
platformFeeRuleSchema.index({ feeType: 1, isActive: 1 });
platformFeeRuleSchema.index({ ruleScope: 1, status: 1, isActive: 1, priority: -1 });
platformFeeRuleSchema.index({ productId: 1, sellerId: 1, organizationId: 1, isActive: 1 });

const PlatformFeeRuleModel = mongoose.model("PlatformFeeRule", platformFeeRuleSchema);

module.exports = { PlatformFeeRuleModel };
