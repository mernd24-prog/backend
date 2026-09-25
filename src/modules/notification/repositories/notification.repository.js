const { NotificationModel } = require("../models/notification.model");
const { UserModel } = require("../../user/models/user.model");

const CUSTOMER_FEED_HIDDEN_EVENTS = [
  "invoice.generated.v1",
  "credit_note.generated.v1",
  "shipment.created.v1",
];

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

const compactCustomerOrderNotification = (group = {}) => {
  const primary = { ...(group.primary || {}) };
  const feedOrderId = primary.feedOrderId;
  delete primary.feedOrderId;
  delete primary.feedGroupKey;
  delete primary.feedPriority;

  const payload = primary.payload || {};
  const eventCount = Number(group.eventCount || 1);
  const orderId = group.orderId || feedOrderId || payload.orderId || payload.order_id || null;

  return {
    ...primary,
    payload: {
      ...payload,
      ...(orderId ? { orderId } : {}),
      groupedNotification: true,
      groupedEventCount: eventCount,
      latestEventName: payload.eventName || null,
    },
    groupKey: group._id,
    grouped: eventCount > 1,
    eventCount,
    latestCreatedAt: group.latestCreatedAt || primary.createdAt,
  };
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
    const userIds = Array.isArray(userId)
      ? userId.map((id) => String(id || "").trim()).filter(Boolean)
      : [String(userId || "").trim()].filter(Boolean);
    const filter = {
      userId: userIds.length > 1 ? { $in: userIds } : userIds[0],
      ...(options.channel ? { channel: options.channel } : {}),
      ...(options.search
        ? {
            $or: [
              { title: { $regex: options.search, $options: "i" } },
              { subject: { $regex: options.search, $options: "i" } },
              { template: { $regex: options.search, $options: "i" } },
            ],
          }
        : {}),
    };

    const limit = Math.min(Math.max(Number(options.limit || 50), 1), 100);
    const page = Math.max(Number(options.page || 1), 1);
    const skip = (page - 1) * limit;

    if (options.compactOrderGroups) {
      return this.listCompactCustomerFeed(filter, { page, limit, skip });
    }

    const [items, total] = await Promise.all([
      NotificationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      NotificationModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  async listCompactCustomerFeed(filter, { page, limit, skip }) {
    const pipeline = [
      {
        $match: {
          ...filter,
          "payload.eventName": { $nin: CUSTOMER_FEED_HIDDEN_EVENTS },
        },
      },
      {
        $addFields: {
          feedOrderId: {
            $ifNull: [
              "$payload.orderId",
              {
                $ifNull: [
                  "$payload.order_id",
                  "$payload.metadata.orderId",
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          feedGroupKey: {
            $cond: [
              {
                $and: [
                  { $ne: ["$feedOrderId", null] },
                  { $ne: ["$feedOrderId", ""] },
                ],
              },
              { $concat: ["order:", { $toString: "$feedOrderId" }] },
              { $concat: ["notification:", { $toString: "$_id" }] },
            ],
          },
          feedPriority: {
            $switch: {
              branches: [
                {
                  case: {
                    $or: [
                      { $eq: ["$payload.eventName", "shipment.delivered.v1"] },
                      { $eq: ["$payload.status", "delivered"] },
                    ],
                  },
                  then: 100,
                },
                {
                  case: {
                    $in: [
                      "$payload.status",
                      ["out_for_delivery", "out-for-delivery", "out for delivery"],
                    ],
                  },
                  then: 90,
                },
                { case: { $eq: ["$payload.eventName", "shipment.tracking_updated.v1"] }, then: 80 },
                { case: { $eq: ["$payload.eventName", "order.paid.v1"] }, then: 70 },
                { case: { $eq: ["$payload.eventName", "order.status_updated.v1"] }, then: 60 },
                { case: { $eq: ["$payload.eventName", "order.created.v1"] }, then: 50 },
              ],
              default: 40,
            },
          },
        },
      },
      { $sort: { feedGroupKey: 1, feedPriority: -1, createdAt: -1 } },
      {
        $group: {
          _id: "$feedGroupKey",
          primary: { $first: "$$ROOT" },
          latestCreatedAt: { $max: "$createdAt" },
          eventCount: { $sum: 1 },
          orderId: { $first: "$feedOrderId" },
        },
      },
      { $sort: { latestCreatedAt: -1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "value" }],
        },
      },
    ];

    const [result = {}] = await NotificationModel.aggregate(pipeline);
    const items = (result.items || []).map(compactCustomerOrderNotification);
    const total = result.total?.[0]?.value || 0;
    return { items, total, page, limit };
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
