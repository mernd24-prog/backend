const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const warrantyTemplateSchema = new mongoose.Schema(
  {
    period: { type: String, required: true, trim: true, unique: true, index: true },
    active: { type: Boolean, default: true, index: true },
    metadata: { type: Object, default: {} },
    createdBy: { type: String, default: null, index: true },
    updatedBy: { type: String, default: null, index: true },
  },
  { timestamps: true },
);

const WarrantyTemplateModel = mongoose.model("WarrantyTemplate", warrantyTemplateSchema);

module.exports = { WarrantyTemplateModel };
