const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const cartSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    items: [
      {
        productId: { type: String, required: true },
        variantId: { type: String, default: "" },
        variantSku: { type: String, default: "" },
        variantTitle: { type: String, default: "" },
        attributes: { type: Object, default: {} },
        title: { type: String, default: "" },
        sku: { type: String, default: "" },
        sellerId: { type: String, default: "", index: true },
        image: { type: String, default: "" },
        currency: { type: String, default: "INR" },
        mrp: { type: Number, default: 0, min: 0 },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true },
        availableStock: { type: Number, default: 0 },
        stockStatus: { type: String, enum: ["in_stock", "low_stock", "out_of_stock", "backorder"], default: "in_stock" },
      },
    ],
    wishlist: [{ type: String }],
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

cartSchema.index({ updatedAt: -1 });
cartSchema.index({ "items.productId": 1 });
cartSchema.index({ "items.sellerId": 1 });

const CartModel = mongoose.model("Cart", cartSchema);

module.exports = { CartModel };
