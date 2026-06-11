const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformFeeRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    feeType: {
      type: String,
      enum: ["flat", "percentage", "tiered"],
      required: true,
      index: true,
    },
    amount: { type: Number, default: 0, min: 0 },
    rate: { type: Number, default: 0, min: 0, max: 1 },
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

const PlatformFeeRuleModel = mongoose.model("PlatformFeeRule", platformFeeRuleSchema);

module.exports = { PlatformFeeRuleModel };
