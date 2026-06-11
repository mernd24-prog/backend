const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformBatchSchema = new mongoose.Schema(
  {
    batchCode: { type: String, required: true, trim: true, unique: true, index: true },
    manufactureDate: { type: Number, required: true },
    expiryDate: { type: Number, required: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: null, index: true },
    updatedBy: { type: String, default: null, index: true },
  },
  { timestamps: true },
);

const PlatformBatchModel = mongoose.model("PlatformBatch", platformBatchSchema);

module.exports = { PlatformBatchModel };
