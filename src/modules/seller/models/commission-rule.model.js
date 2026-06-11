const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const commissionRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sellerTier: {
      type: String,
      enum: ["bronze", "silver", "gold", "platinum", "all"],
      default: "all",
      index: true,
    },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "CategoryTree", default: null, index: true },
    categoryName: { type: String, default: "" },
    rate: { type: Number, required: true, min: 0, max: 1 },
    taxRate: { type: Number, default: 0.18, min: 0, max: 1 },
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

const CommissionRuleModel = mongoose.model("CommissionRule", commissionRuleSchema);

module.exports = { CommissionRuleModel };
