const { NotificationModel } = require("../models/notification.model");

class NotificationRepository {
  async create(payload) {
    if (payload.idempotencyKey) {
      return NotificationModel.findOneAndUpdate(
        { idempotencyKey: payload.idempotencyKey },
        { $setOnInsert: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    return NotificationModel.create(payload);
  }

  async listByUser(userId) {
    return NotificationModel.find({ userId }).sort({ createdAt: -1 });
  }
}

module.exports = { NotificationRepository };
