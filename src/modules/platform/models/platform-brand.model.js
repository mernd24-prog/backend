const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformBrandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    // Canonical key closes the case-insensitive duplicate race that a display
    // name's normal Mongo unique index cannot cover.
    nameKey: { type: String, trim: true, lowercase: true, unique: true, sparse: true, index: true },
    slug: { type: String, trim: true, default: "", index: true },
    description: { type: String, trim: true, default: "" },
    logo: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
    thumbnails: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
    // Admin brands are immediately usable. Seller submissions must be reviewed
    // before they can be selected on a product.
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
    sortOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);

const PlatformBrandModel = mongoose.model("PlatformBrand", platformBrandSchema);

module.exports = { PlatformBrandModel };
