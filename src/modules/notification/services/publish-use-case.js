const { createHash } = require("node:crypto");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { createQueue } = require("../../../shared/queues/queue-factory");
const { logger } = require("../../../shared/logger/logger");
const schema = new mongoose.Schema({
  eventId: { type: String, unique: true, required: true },
  payload: Object, status: { type: String, default: "pending", index: true },
  claimedAt: Date, errorCode: String,
}, { timestamps: true });
const Event = mongoose.models.NotificationBusinessEvent || mongoose.model("NotificationBusinessEvent", schema);
const queue = createQueue("notifications");

async function publishUseCase(notificationCaseId, userId, payload = {}, revision) {
  if (!userId && !payload.recipientEmail) return { skipped: true, reason: "recipient_missing" };
  if (!/^N\d{3}$/.test(notificationCaseId) || !revision) throw new Error("A known notification case and stable business revision are required");
  const known = require("../templates/notification-use-cases.json").cases.some(entry => entry.id === notificationCaseId);
  if (!known) throw new Error("Unknown notification case");
  const eventId = createHash("sha256").update([notificationCaseId, userId || payload.recipientEmail, revision].join("|")).digest("hex");
  try {
    const event = await Event.findOneAndUpdate({ eventId }, { $setOnInsert: {
      status: "pending", payload: { ...payload, userId, notificationCaseId, emailDedupeKey: eventId },
    } }, { upsert: true, new: true });
    if (event.status === "published") return { duplicate: true };
    await queue.add("business-event", { eventId }, { jobId: `event-${eventId}` });
    return { eventId, queued: true };
  } catch (error) {
    // Notification trouble must never roll back a completed refund, payout or
    // account change. A persisted pending event is retried by the scheduler.
    logger.error({ notificationCaseId, eventId, errorCode: error.code || error.name }, "Business notification could not be queued");
    return { queued: false, eventId };
  }
}
async function deliverUseCaseEvent({ eventId }) {
  const stale = new Date(Date.now() - 5 * 60000);
  const event = await Event.findOneAndUpdate({ eventId, $or: [{ status: { $in: ["pending", "failed"] } }, { status: "processing", claimedAt: { $lt: stale } }] },
    { $set: { status: "processing", claimedAt: new Date() } }, { new: true }).lean();
  if (!event) return { skipped: true };
  try {
    const { NotificationService } = require("./notification.service");
    new NotificationService();
    const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
    const result = await eventPublisher.publish({ id: eventId, eventName: "notification.use_case.v1", version: 1,
      aggregateId: event.payload.orderId || event.payload.returnId || event.payload.payoutId || event.payload.userId,
      occurredAt: new Date(event.createdAt).toISOString(), payload: event.payload, source: "notification-outbox" });
    if (result?.failures?.length) throw new Error("Notification handler failed");
    await Event.updateOne({ eventId }, { status: "published", errorCode: null });
  } catch (error) {
    await Event.updateOne({ eventId }, { status: "failed", errorCode: error.code || error.name });
    throw error;
  }
}
async function retryNotificationEvents() {
  const events = await Event.find({ $or: [{ status: { $in: ["pending", "failed"] } }, { status: "processing", claimedAt: { $lt: new Date(Date.now() - 5 * 60000) } }] }).sort({ createdAt: 1 }).limit(100).lean();
  for (const event of events) {
    const existing = await queue.getJob(`event-${event.eventId}`);
    if (!existing) await queue.add("business-event", { eventId: event.eventId }, { jobId: `event-${event.eventId}` });
    else if (await existing.getState() === "failed") await existing.retry();
    else if (await existing.getState() === "completed") { await existing.remove(); await queue.add("business-event", { eventId: event.eventId }, { jobId: `event-${event.eventId}` }); }
  }
  return { scanned: events.length };
}
module.exports = { publishUseCase, deliverUseCaseEvent, retryNotificationEvents, Event };
