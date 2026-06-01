const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    channel: { type: String, enum: ["in_app", "email", "sms", "push"], required: true },
    template: { type: String, required: true },
    subject: { type: String },
    payload: { type: Object, default: {} },
    status: { type: String, default: "queued", index: true },
    idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  },
  { timestamps: true },
);

const NotificationModel = mongoose.model("Notification", notificationSchema);

module.exports = { NotificationModel };
