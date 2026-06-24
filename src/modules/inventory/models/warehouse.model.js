const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    sellerId: { type: String, default: "", trim: true, index: true },
    organizationId: { type: String, default: "", trim: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    managerName: { type: String, default: "", trim: true },
    managerPhone: { type: String, default: "", trim: true },
    managerEmail: { type: String, default: "", trim: true, lowercase: true },
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, default: "", trim: true },
    countryId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminCountry", required: true, index: true },
    stateId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminState", required: true, index: true },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminCity", required: true, index: true },
    zipCodeId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminZipCode", index: true },
    pincode: { type: String, required: true, trim: true, index: true },
    capacity: { type: Number, default: 0, min: 0 },
    skuCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    metadata: { type: Object, default: {} },
    createdBy: { type: String, index: true },
    updatedBy: { type: String, index: true },
  },
  { timestamps: true },
);

const WarehouseModel = mongoose.model("Warehouse", warehouseSchema);

module.exports = { WarehouseModel };
