const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const categoryTreeSchema = new mongoose.Schema(
  {
    categoryKey: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    parentKey: { type: String, default: null, index: true },
    level: { type: Number, default: 0, min: 0 },
    attributesSchema: { type: Object, default: {} },
    attributeSchema: [
      {
        platformOptionId: { type: String, default: "", index: true },
        allowCustomOptions: { type: Boolean, default: false },
        key: { type: String, required: true },
        label: { type: String, required: true },
        type: {
          type: String,
          enum: ["text", "number", "select", "multi_select", "boolean", "date"],
          default: "text",
        },
        required: { type: Boolean, default: false },
        options: [{ type: String }],
        unit: { type: String, default: null },
        isVariantAttribute: { type: Boolean, default: false },
        isFilterable: { type: Boolean, default: false },
        isSearchable: { type: Boolean, default: false },
      },
    ],
    active: { type: Boolean, default: true, index: true },
    approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "approved", index: true },
    submittedBySellerId: { type: String, default: "", index: true },
    submittedByUserId: { type: String, default: "" },
    rejectionReason: { type: String, default: "", trim: true },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    sortOrder: { type: Number, default: 0 },
    bannerUrl: { type: String, default: "" },
    iconUrl: { type: String, default: "" },
    isDashboardVisible: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

categoryTreeSchema.index({ active: 1, isDashboardVisible: 1, sortOrder: 1, title: 1 });
categoryTreeSchema.index({ parentKey: 1, active: 1, categoryKey: 1 });

const CategoryTreeModel = mongoose.model("CategoryTree", categoryTreeSchema);

module.exports = { CategoryTreeModel };
