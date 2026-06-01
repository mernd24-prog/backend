const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const inventoryReservationSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true, unique: true },
    buyerId: { type: String, required: true, index: true },
    status: { type: String, required: true, index: true },
    items: [
      {
        productId: { type: String, required: true },
        variantId: { type: String, default: "" },
        variantSku: { type: String, default: "" },
        variantTitle: { type: String, default: "" },
        attributes: { type: Object, default: {} },
        sellerId: { type: String, required: true },
        quantity: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
      },
    ],
    expiresAt: { type: Date, index: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

const InventoryReservationModel = mongoose.model("InventoryReservation", inventoryReservationSchema);

module.exports = { InventoryReservationModel };
