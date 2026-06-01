const { AuditLogModel } = require("./audit-log.model");

class AuditLogService {
  async record(payload = {}) {
    if (payload.idempotencyKey) {
      return AuditLogModel.findOneAndUpdate(
        { idempotencyKey: payload.idempotencyKey },
        { $setOnInsert: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    return AuditLogModel.create(payload);
  }

  async recordEvent(event, targetType, targetId, metadata = {}) {
    const payload = event.payload || {};
    return this.record({
      actorId: payload.updatedBy || payload.actorId || payload.userId || payload.buyerId || null,
      method: "EVENT",
      path: event.eventName,
      statusCode: 200,
      requestId: event.correlationId || event.id,
      eventName: event.eventName,
      targetType,
      targetId: targetId || payload.orderId || payload.returnId || payload.shipmentId || payload.paymentId || null,
      beforeStatus: payload.previousStatus || metadata.beforeStatus || null,
      afterStatus: payload.status || metadata.afterStatus || null,
      reason: payload.reason || metadata.reason || null,
      metadata: {
        source: event.source,
        eventId: event.id,
        ...metadata,
      },
      idempotencyKey: `event:${event.eventName}:${event.id}:${targetType}:${targetId || ""}`,
    });
  }
}

const auditLogService = new AuditLogService();

module.exports = { AuditLogService, auditLogService };
