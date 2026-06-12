const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const productReviewSchema = new mongoose.Schema(
  {
    productId:      { type: String, required: true, index: true },
    buyerId:        { type: String, required: true, index: true },
    orderId:        { type: String, required: true, index: true },
    rating:         { type: Number, required: true, min: 1, max: 5 },
    title:          { type: String, default: "" },
    reviewText:     { type: String, default: "" },
    media:          { type: [String], default: [] },
    helpfulVotes:   { type: Number, default: 0 },
    helpfulVotedBy: { type: [String], default: [] },
    reportCount:    { type: Number, default: 0 },
    reportedBy:     { type: [String], default: [] },
    adminReply: {
      text:        { type: String, default: "" },
      repliedAt:   { type: Date },
      repliedById: { type: String },
    },
    status: {
      type: String,
      enum: ["pending", "published", "hidden", "rejected"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true },
);

productReviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
productReviewSchema.index({ productId: 1, buyerId: 1, orderId: 1 }, { unique: true });

const ProductReviewModel = mongoose.model("ProductReview", productReviewSchema);

module.exports = { ProductReviewModel };
