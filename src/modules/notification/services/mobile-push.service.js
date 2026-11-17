const { createHash } = require("node:crypto");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { admin, getFirebaseApp } = require("../../../infrastructure/auth/firebase-admin");
const { AppError } = require("../../../shared/errors/app-error");
const { NotificationPreferenceModel } = require("../models/notification-preference.model");
const { deliveryDecision } = require("./delivery-preferences");
const deviceSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  token: { type: String, required: true, select: false },
  platform: { type: String, enum: ["android", "ios", "web"], required: true },
  disabled: { type: Boolean, default: false },
}, { timestamps: true });
const Device = mongoose.models.NotificationDevice || mongoose.model("NotificationDevice", deviceSchema);
const attemptSchema = new mongoose.Schema({
  notificationId: String, tokenHash: String, userId: String,
  status: String, providerMessageId: String, errorCode: String,
}, { timestamps: true });
attemptSchema.index({ notificationId: 1, tokenHash: 1 }, { unique: true });
const Attempt = mongoose.models.NotificationPushAttempt || mongoose.model("NotificationPushAttempt", attemptSchema);

async function registerDevice(userId, { token, platform } = {}) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096 || !["android", "ios", "web"].includes(platform)) throw new AppError("A valid push token and platform are required", 400);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await Device.findOneAndUpdate({ tokenHash }, { $set: { userId, token, platform, disabled: false } }, { upsert: true });
  return { registered: true };
}
async function unregisterDevice(userId, token) {
  if (typeof token !== "string" || !token || token.length > 4096) throw new AppError("Push token is required", 400);
  await Device.deleteOne({ userId, tokenHash: createHash("sha256").update(token).digest("hex") });
  return { removed: true };
}
async function sendPush({ notificationId, userId, subject, payload = {} }) {
  const app = getFirebaseApp();
  if (!app) return { skipped: true, reason: "firebase_not_configured" };
  const preference = await NotificationPreferenceModel.findOne({ userId }).lean();
  const decision = deliveryDecision(preference, { channel: "push", eventName: payload.eventName, payload, scheduled: true });
  if (!decision.allowed) return { skipped: true, reason: decision.reason };
  // Do not send delayed optional notifications during a newly changed DND window.
  if (decision.delay) throw new AppError("Push delivery deferred by updated quiet hours", 503);
  const devices = await Device.find({ userId, disabled: false }).select("+token").limit(100).lean();
  for (const device of devices) {
    let attempt;
    try {
      attempt = await Attempt.create({ notificationId, tokenHash: device.tokenHash, userId, status: "sending" });
    } catch (error) {
      if (error.code === 11000) continue; // A retry must not resend an accepted/ambiguous send.
      throw error;
    }
    try {
      const providerMessageId = await admin.messaging(app).send({
        token: device.token,
        notification: { title: subject || "Account update", body: "An update is available. Open your account to review the details." },
        data: { notificationId: String(notificationId), eventName: String(payload.eventName || ""), useCaseId: String(payload.useCaseId || "") },
      });
      await Attempt.updateOne({ _id: attempt._id }, { status: "provider_accepted", providerMessageId });
    } catch (error) {
      const invalid = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(error.code);
      if (invalid) await Device.updateOne({ _id: device._id }, { disabled: true });
      await Attempt.updateOne({ _id: attempt._id }, { status: invalid ? "invalid_device" : "delivery_unknown", errorCode: error.code || "provider_error" });
      // FCM acceptance cannot be assumed after a transport timeout. Retain the
      // attempt for operator reconciliation instead of blindly duplicating it.
    }
  }
  return { attempted: devices.length };
}
module.exports = { registerDevice, unregisterDevice, sendPush, Device, Attempt };
