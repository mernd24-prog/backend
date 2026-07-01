const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const badgeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, index: true },
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["product", "seller", "buyer", "custom"],
      default: "product",
      index: true,
    },
    icon: { type: String, trim: true, default: "" },
    color: { type: String, trim: true, default: "#E53E3E" },
    bgColor: { type: String, trim: true, default: "#FFF5F5" },
    description: { type: String, trim: true, default: "" },
    priority: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true, index: true },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
  },
  { timestamps: true },
);

badgeSchema.index({ active: 1, priority: -1 });

const BadgeModel = mongoose.model("Badge", badgeSchema);

module.exports = { BadgeModel };
