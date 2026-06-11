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

  async listAll({ page = 1, limit = 50, type, userId, search } = {}) {
    const filter = {};
    if (type) filter.type = type;
    if (userId) filter.userId = userId;
    if (search) filter.title = { $regex: search, $options: "i" };
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      NotificationModel.countDocuments(filter),
    ]);
    return { items, total };
  }
}

module.exports = { NotificationRepository };
