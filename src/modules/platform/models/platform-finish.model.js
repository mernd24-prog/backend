const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const platformFinishSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: null, index: true },
    updatedBy: { type: String, default: null, index: true },
  },
  { timestamps: true },
);

const PlatformFinishModel = mongoose.model("PlatformFinish", platformFinishSchema);

module.exports = { PlatformFinishModel };
