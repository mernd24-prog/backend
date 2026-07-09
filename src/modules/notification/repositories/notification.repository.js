const { NotificationModel } = require("../models/notification.model");
const { UserModel } = require("../../user/models/user.model");

const formatRecipientName = (user) => {
  if (!user) return null;
  const profileName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ");
  return (
    user.profile?.name ||
    profileName ||
    user.sellerProfile?.displayName ||
    user.sellerProfile?.businessName ||
    user.email ||
    null
  );
};

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

  async listByUser(userId, options = {}) {
    return NotificationModel.find({
      userId,
      ...(options.channel ? { channel: options.channel } : {}),
    }).sort({ createdAt: -1 });
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
    const userIds = [
      ...new Set(
        items
          .map((item) => String(item.userId || ""))
          .filter((id) => UserModel.db.base.Types.ObjectId.isValid(id)),
      ),
    ];

    const users = userIds.length
      ? await UserModel.find({ _id: { $in: userIds } })
        .select("email profile sellerProfile")
        .lean()
      : [];
    const usersById = new Map(users.map((user) => [String(user._id), user]));

    return {
      items: items.map((item) => {
        const user = usersById.get(String(item.userId || ""));
        const recipientName = formatRecipientName(user);
        return {
          ...item,
          ...(recipientName ? { recipientName, userName: recipientName } : {}),
        };
      }),
      total,
    };
  }
}

module.exports = { NotificationRepository };
