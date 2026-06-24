const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const inventoryTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "reservation",
        "release",
        "sale",
        "restock",
        "return",
        "adjustment",
        "damage",
        "cancellation_release",
        "cancellation_restock",
      ],
      required: true,
      index: true,
    },
    status: { type: String, default: "completed", index: true },
    productId: { type: String, required: true, index: true },
    variantId: { type: String, default: "" },
    variantSku: { type: String, default: "", index: true },
    sellerId: { type: String, default: "", index: true },
    organizationId: { type: String, default: "", index: true },
    quantity: { type: Number, required: true },
    orderId: { type: String, default: "", index: true },
    returnId: { type: String, default: "", index: true },
    shipmentId: { type: String, default: "", index: true },
    referenceType: { type: String, required: true, index: true },
    referenceId: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    actorId: { type: String, default: "" },
    actorRole: { type: String, default: "" },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

const InventoryTransactionModel = mongoose.model("InventoryTransaction", inventoryTransactionSchema);

module.exports = { InventoryTransactionModel };
