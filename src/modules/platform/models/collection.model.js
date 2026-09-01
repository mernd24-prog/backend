const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const collectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    type: { type: String, trim: true, default: "custom", index: true },
    description: { type: String, trim: true, default: "", maxlength: 1000 },
    bannerImage: { type: String, trim: true, default: "" },
    thumbnailImage: { type: String, trim: true, default: "" },
    categories: [{ type: String, trim: true }],
    tags: [{ type: String, trim: true }],
    brandKey: { type: String, trim: true, default: null },
    sortOrder: { type: Number, default: 0, index: true },
    featured: { type: Boolean, default: false, index: true },
    active: { type: Boolean, default: true, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "collections" },
);

collectionSchema.index({ active: 1, featured: -1, sortOrder: 1 });

const CollectionModel = mongoose.model("Collection", collectionSchema);

module.exports = { CollectionModel };
