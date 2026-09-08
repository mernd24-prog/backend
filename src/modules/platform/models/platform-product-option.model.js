const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformProductOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    nameKey: { type: String, trim: true, lowercase: true, unique: true, sparse: true, index: true },
    slug: { type: String, trim: true, default: "", index: true },
    displayType: {
      type: String,
      enum: ["button", "dropdown", "color_swatch", "radio", "thumbnail"],
      default: "button",
    },
    description: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true, index: true },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
    submittedBySellerId: { type: String, default: "", index: true },
    submittedByUserId: { type: String, default: "" },
    rejectionReason: { type: String, default: "", trim: true },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const PlatformProductOptionModel = mongoose.model("PlatformProductOption", platformProductOptionSchema);

module.exports = { PlatformProductOptionModel };
