const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const returnSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true },
    buyerId: { type: String, required: true, index: true },
    reason: { type: String, enum: ["defective", "not_as_described", "changed_mind", "other"], required: true },
    description: String,
    items: [
      {
        productId: String,
        variantId: String,
        variantSku: String,
        quantity: Number,
        unitPrice: Number,
        lineTotal: Number,
        taxAmount: { type: Number, default: 0 },
        refundAmount: { type: Number, default: 0 },
        condition: String,
        photos: [String],
      },
    ],
    status: {
      type: String,
      enum: [
        "requested",
        "approved",
        "rejected",
        "reverse_pickup_scheduled",
        "manual_ship_back",
        "shipped_back",
        "received",
        "qc_passed",
        "qc_failed",
        "refunded",
        "replaced",
        "closed",
      ],
      default: "requested",
      index: true,
    },
    refundAmount: Number,
    refundBreakup: { type: Object, default: {} },
    refundReferenceId: String,
    refundMethod: String,
    trackingNumber: String,
    replacementOrderId: String,
    replacementShipmentId: String,
    timeline: [
      {
        status: String,
        actorId: String,
        actorRole: String,
        reason: String,
        note: String,
        metadata: { type: Object, default: {} },
        at: { type: Date, default: Date.now },
      },
    ],
    photos: [String],
    requestedAt: { type: Date, default: Date.now },
    approvedAt: Date,
    rejectedAt: Date,
    receivedAt: Date,
    qcAt: Date,
    refundedAt: Date,
    closedAt: Date,
    notes: String,
  },
  { timestamps: true },
);

const ReturnModel = mongoose.model("Return", returnSchema);

module.exports = { ReturnModel };
