const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const commissionRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ruleScope: {
      type: String,
      enum: ["global", "category", "product", "seller", "organization"],
      default: "global",
      index: true,
    },
    commissionType: {
      type: String,
      enum: ["percentage", "fixed", "mixed"],
      default: "percentage",
      index: true,
    },
    sellerTier: {
      type: String,
      enum: ["bronze", "silver", "gold", "platinum", "all"],
      default: "all",
      index: true,
    },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "CategoryTree", default: null, index: true },
    categoryName: { type: String, default: "" },
    productId: { type: String, default: "", trim: true, index: true },
    productSku: { type: String, default: "", trim: true, index: true },
    sellerId: { type: String, default: "", trim: true, index: true },
    organizationId: { type: String, default: "", trim: true, index: true },
    percentage: { type: Number, default: null, min: 0, max: 100 },
    fixedFeeAmount: { type: Number, default: 0, min: 0 },
    rate: { type: Number, default: 0, min: 0, max: 1 },
    taxRate: { type: Number, default: 0.18, min: 0, max: 1 },
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

commissionRuleSchema.index({ sellerTier: 1, isActive: 1, priority: -1 });
commissionRuleSchema.index({ categoryId: 1, isActive: 1 });
commissionRuleSchema.index({ ruleScope: 1, status: 1, isActive: 1, priority: -1 });
commissionRuleSchema.index({ productId: 1, sellerId: 1, organizationId: 1, isActive: 1 });

const CommissionRuleModel = mongoose.model("CommissionRule", commissionRuleSchema);

module.exports = { CommissionRuleModel };
