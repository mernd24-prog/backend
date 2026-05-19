const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformBrandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    logo: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
    thumbnails: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);

const PlatformBrandModel = mongoose.model("PlatformBrand", platformBrandSchema);

module.exports = { PlatformBrandModel };
