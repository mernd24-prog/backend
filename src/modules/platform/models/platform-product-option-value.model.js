const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformProductOptionValueSchema = new mongoose.Schema(
  {
    // Canonical field for option relationship (string id for backward compatibility)
    optionId: { type: String, required: true, index: true },
    // Legacy field kept for backward compatibility with existing records/clients.
    option_id: { type: String, index: true },
    name: { type: String, required: true, trim: true, index: true },
    optionName: { type: String, trim: true, default: "" },
    valueCode: { type: String, trim: true, default: "" },
    colorHex: { type: String, trim: true, default: "" },
    imageUrl: { type: String, trim: true, default: "" },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
    submittedBySellerId: { type: String, default: "", index: true },
  },
  { timestamps: true },
);

platformProductOptionValueSchema.pre("save", function syncOptionIds(next) {
  if (this.optionId && !this.option_id) this.option_id = this.optionId;
  if (this.option_id && !this.optionId) this.optionId = this.option_id;
  next();
});

platformProductOptionValueSchema.index({ optionId: 1, name: 1 }, { unique: true });

const PlatformProductOptionValueModel = mongoose.model("PlatformProductOptionValue", platformProductOptionValueSchema);

module.exports = { PlatformProductOptionValueModel };
