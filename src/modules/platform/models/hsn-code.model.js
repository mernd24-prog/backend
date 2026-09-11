const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const hsnCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    description: { type: String, required: true },
    gstRate: { type: Number, required: true, default: 18 },
    cessRate: { type: Number, default: 0 },
    taxType: { type: String, default: "gst" },
    exempt: { type: Boolean, default: false },
    category: { type: String, default: null, index: true },
    active: { type: Boolean, default: true, index: true },
    approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "approved", index: true },
    submittedBySellerId: { type: String, default: "", index: true },
    submittedByUserId: { type: String, default: "" },
    rejectionReason: { type: String, default: "", trim: true },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const HsnCodeModel = mongoose.model("HsnCode", hsnCodeSchema);

module.exports = { HsnCodeModel };
