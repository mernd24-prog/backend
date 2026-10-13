const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const campaignSchema = new mongoose.Schema({
  title: String,
  body: String,
  channel: String,
  audience: String,
  userIds: [String],
  data: { type: Object, default: {} },
  cursor: { type: String, default: null },
  upperBound: String,
  status: { type: String, default: "queued", index: true },
  lastError: String,
}, { timestamps: true });

const deliverySchema = new mongoose.Schema({
  campaignId: { type: String, required: true },
  userId: { type: String, required: true },
  email: String,
  role: String,
  status: { type: String, default: "queued" },
  attempts: { type: Number, default: 0 },
  lastError: String,
  completedAt: Date,
  sendStartedAt: Date,
  providerMessageId: String,
}, { timestamps: true });
deliverySchema.index({ campaignId: 1, userId: 1 }, { unique: true });
deliverySchema.index({ campaignId: 1, status: 1, _id: 1 });

module.exports = {
  NotificationCampaignModel: mongoose.model("NotificationCampaign", campaignSchema),
  NotificationDeliveryModel: mongoose.model("NotificationDelivery", deliverySchema),
};
