const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const {
  PRODUCT_REVISION_STATUS,
} = require("../../../shared/domain/commerce-constants");

const productRevisionSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, index: true },
    sellerId: { type: String, index: true },
    baseVersion: { type: Number, default: 1 },
    targetVersion: { type: Number },
    draftChanges: { type: Object, required: true, default: {} },
    changedFields: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: Object.values(PRODUCT_REVISION_STATUS),
      default: PRODUCT_REVISION_STATUS.PENDING,
      index: true,
    },
    submittedBy: { type: String, index: true },
    submittedByRole: { type: String },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: { type: String },
    reviewedByRole: { type: String },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
    notes: { type: String },
    checklist: { type: Object, default: {} },
    publishedVersion: { type: Number },
  },
  { timestamps: true },
);

productRevisionSchema.index({ productId: 1, status: 1, createdAt: -1 });
productRevisionSchema.index({ sellerId: 1, status: 1, createdAt: -1 });

const ProductRevisionModel = mongoose.model("ProductRevision", productRevisionSchema);

module.exports = { ProductRevisionModel };
