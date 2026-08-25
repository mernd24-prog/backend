const { NotificationRepository } = require("../repositories/notification.repository");
const { createQueue } = require("../../../shared/queues/queue-factory");
const { eventBus } = require("../../../infrastructure/events/event-bus");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { makeEvent } = require("../../../contracts/events/event");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { NotificationPreferenceModel } = require("../models/notification-preference.model");
const { ROLES } = require("../../../shared/constants/roles");
const { UserModel } = require("../../user/models/user.model");
const { ORDER_STATUS, PAYMENT_PROVIDER, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");

const notificationQueue = createQueue("notifications");
let subscribersRegistered = false;
const EMAIL_SUPPRESSED_EVENTS = new Set([
  DOMAIN_EVENTS.INVOICE_GENERATED_V1,
  DOMAIN_EVENTS.CREDIT_NOTE_GENERATED_V1,
]);
const SELLER_ROLES = new Set([
  ROLES.SELLER,
  ROLES.SELLER_ADMIN,
  ROLES.SELLER_SUB_ADMIN,
]);

class NotificationService {
  constructor({ notificationRepository = new NotificationRepository() } = {}) {
    this.notificationRepository = notificationRepository;
    this.registerSubscribers();
  }

  registerSubscribers() {
    if (subscribersRegistered) {
      return;
    }

    subscribersRegistered = true;

    eventBus.subscribe(DOMAIN_EVENTS.AUTH_USER_REGISTERED_V1, async (event) => {
      const { userId, email } = event.payload;
      await notificationQueue.add("welcome-email", { userId, email });
    });

    this.registerCommerceSubscribers();
  }

  registerCommerceSubscribers() {
    const definitions = [
      [DOMAIN_EVENTS.ORDER_CREATED_V1, "Order Created", (p) => `Your order ${p.orderNumber || p.orderId} has been created.`],
      [DOMAIN_EVENTS.ORDER_PAID_V1, "Order Confirmed", (p) => `Your order ${p.orderNumber || p.orderId} has been confirmed.`],
      [DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1, "Payment Failed", (p) => `Payment failed for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.ORDER_CANCELLED_V1, "Order Cancelled", (p) => `Order ${p.orderNumber || p.orderId} was cancelled.`],
      [DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1, "Order Updated", (p) => `Order ${p.orderNumber || p.orderId} is now ${String(p.status || "").replace(/_/g, " ")}.`],
      [DOMAIN_EVENTS.RETURN_REQUESTED_V1, "Return Requested", (p) => `Return requested for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.RETURN_STATUS_UPDATED_V1, "Return Updated", (p) => `Return ${p.returnNumber || p.returnId} is now ${String(p.status || "").replace(/_/g, " ")}.`],
      [DOMAIN_EVENTS.RETURN_APPROVED_V1, "Return Approved", (p) => `Return ${p.returnNumber || p.returnId} has been approved.`],
      [DOMAIN_EVENTS.RETURN_REJECTED_V1, "Return Rejected", (p) => `Return ${p.returnNumber || p.returnId} has been rejected.`],
      [DOMAIN_EVENTS.RETURN_RECEIVED_V1, "Return Received", (p) => `Return ${p.returnNumber || p.returnId} has been received.`],
      [DOMAIN_EVENTS.RETURN_REFUNDED_V1, "Return Refunded", (p) => `Refund processed for return ${p.returnNumber || p.returnId}.`],
      [DOMAIN_EVENTS.REFUND_PROCESSED_V1, "Refund Processed", (p) => `Refund ${p.referenceId || p.returnId || ""} has been processed.`],
      [DOMAIN_EVENTS.REFUND_FAILED_V1, "Refund Failed", (p) => `Refund failed for order ${p.orderNumber || p.returnNumber || p.orderId || p.returnId}.`],
      [DOMAIN_EVENTS.PAYMENT_REFUNDED_V1, "Payment Refunded", (p) => `Payment refund processed for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.SHIPMENT_CREATED_V1, "Shipment Created", (p) => `Shipment created for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.SHIPMENT_TRACKING_UPDATED_V1, "Shipment Updated", (p) => `Shipment ${p.shipmentId} is ${String(p.status || "").replace(/_/g, " ")}.`],
      [DOMAIN_EVENTS.SHIPMENT_DELIVERED_V1, "Shipment Delivered", (p) => `Order ${p.orderNumber || p.orderId} has been delivered.`],
      [DOMAIN_EVENTS.DEAL_SUBMITTED_V1, "Deal Submitted", (p) => `Deal ${p.dealNumber || p.dealId} is waiting for approval.`],
      [DOMAIN_EVENTS.DEAL_APPROVED_V1, "Deal Approved", (p) => `Deal ${p.dealNumber || p.dealId} has been approved.`],
      [DOMAIN_EVENTS.DEAL_REJECTED_V1, "Deal Rejected", (p) => `Deal ${p.dealNumber || p.dealId} was rejected.`],
      [DOMAIN_EVENTS.DEAL_CANCELLED_V1, "Deal Cancelled", (p) => `Deal ${p.dealNumber || p.dealId} was cancelled.`],
      [DOMAIN_EVENTS.SHIPMENT_FAILED_V1, "Shipment Failed", (p) => `Shipment failed for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.SHIPMENT_RTO_V1, "Shipment RTO", (p) => `Shipment for order ${p.orderNumber || p.orderId} is returning to origin.`],
      [DOMAIN_EVENTS.INVOICE_GENERATED_V1, "Invoice Generated", (p) => `Invoice generated for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.CREDIT_NOTE_GENERATED_V1, "Credit Note Generated", (p) => `Credit note generated for order ${p.orderNumber || p.orderId}.`],
    ];

    definitions.forEach(([eventName, subject, templateBuilder]) => {
      eventBus.subscribe(eventName, async (event) => {
        const userId = event.payload.buyerId || event.payload.userId;
        const customerPayload = this.withViewMetadata(event.payload, "buyer");
        const hasCustomerEmail = Boolean(
          customerPayload.recipientEmail ||
            customerPayload.customerEmail ||
            customerPayload.buyerEmail ||
            customerPayload.email,
        );
        if (userId) {
          await this.createNotification({
            userId,
            channel: "in_app",
            subject,
            template: templateBuilder(event.payload),
            payload: {
              eventName,
              eventId: event.id,
              recipientType: "buyer",
              ...customerPayload,
            },
            status: "queued",
            idempotencyKey: `${eventName}:${event.id}:${userId}:buyer:in_app`,
          });
        }

        if ((userId || hasCustomerEmail) && this.shouldQueueEmail(eventName, "buyer", event.payload)) {
          await this.queueEmailForUser(userId, {
            subject,
            message: templateBuilder(event.payload),
            eventName,
            eventId: event.id,
            recipientType: "buyer",
            payload: customerPayload,
          });
        }

        const sellerIds = this.extractSellerRecipientIds(event.payload)
          .filter((sellerId) => String(sellerId) !== String(userId || ""));
        await Promise.all(sellerIds.map(async (sellerId) => {
          const sellerMessage = this.buildSellerCommerceMessage(eventName, event.payload, templateBuilder);
          const sellerPayload = this.withViewMetadata(event.payload, "seller");
          await this.createNotification({
            userId: sellerId,
            channel: "in_app",
            subject,
            template: sellerMessage,
            payload: {
              eventName,
              eventId: event.id,
              recipientType: "seller",
              ...sellerPayload,
            },
            status: "queued",
            idempotencyKey: `${eventName}:${event.id}:${sellerId}:seller:in_app`,
          });
          if (this.shouldQueueEmail(eventName, "seller", event.payload)) {
            await this.queueEmailForUser(sellerId, {
              subject,
              message: sellerMessage,
              eventName,
              eventId: event.id,
              recipientType: "seller",
              payload: sellerPayload,
            });
          }
        }));

        if (this.shouldQueueAdminEmail(eventName, event.payload)) {
          const admins = await this.findAdminRecipients();
          const adminPayload = this.withViewMetadata(event.payload, "admin");
          await Promise.all(admins.map((admin) => this.queueEmailForUser(String(admin._id || admin.id), {
            subject,
            message: templateBuilder(event.payload),
            eventName,
            eventId: event.id,
            recipientType: "admin",
            payload: {
              ...adminPayload,
              adminName: admin.profile?.firstName || admin.email || "",
            },
          })));
        }
      });
    });

    this.registerOnboardingSubscribers();
    this.registerPayoutSubscribers();
  }

  registerOnboardingSubscribers() {
    eventBus.subscribe(DOMAIN_EVENTS.SELLER_KYC_SUBMITTED_V1, async (event) => {
      const admins = await this.findAdminRecipients();
      await Promise.all(admins.map((admin) => this.createNotification({
        userId: String(admin._id || admin.id),
        channel: "in_app",
        subject: "Seller Onboarding Submitted",
        template: `${event.payload.legalName || "A seller"} completed onboarding and is ready for review.`,
        payload: {
          eventName: event.eventName,
          eventId: event.id,
          recipientType: "admin",
          targetType: "seller_onboarding",
          viewUrl: `/app/seller-organizations?sellerId=${encodeURIComponent(event.payload.sellerId || "")}`,
          ...event.payload,
        },
        status: "queued",
        idempotencyKey: `${event.eventName}:${event.id}:${admin._id || admin.id}:admin:in_app`,
      })));
    });

    const sellerStatusEvents = [
      DOMAIN_EVENTS.KYC_STATUS_UPDATED_V1,
      DOMAIN_EVENTS.SELLER_ORGANIZATION_STATUS_UPDATED_V1,
    ];
    sellerStatusEvents.forEach((eventName) => {
      eventBus.subscribe(eventName, async (event) => {
        const sellerId = event.payload.sellerId;
        const status = event.payload.status || event.payload.verificationStatus || event.payload.approvalStatus;
        if (!sellerId || !["verified", "approved", "active", "live", "rejected"].includes(String(status || ""))) return;
        const isRejected = String(status) === "rejected";
        const subject = isRejected ? "Seller Onboarding Rejected" : "Seller Onboarding Approved";
        const message = isRejected
          ? `Your seller onboarding was rejected. ${event.payload.rejectionReason || "Please review the requested changes and resubmit."}`
          : "Your seller onboarding has been approved. You can continue selling on Sam Global.";
        const payload = {
          ...event.payload,
          eventName,
          eventId: event.id,
          recipientType: "seller",
          targetType: "seller_onboarding",
          viewUrl: "/app/seller-status",
        };
        await this.createNotification({
          userId: sellerId,
          channel: "in_app",
          subject,
          template: message,
          payload,
          status: "queued",
          idempotencyKey: `${eventName}:${event.id}:${sellerId}:seller:in_app`,
        });
        await this.queueEmailForUser(sellerId, {
          subject,
          message,
          eventName,
          eventId: event.id,
          recipientType: "seller",
          payload,
        });
      });
    });
  }

  registerPayoutSubscribers() {
    eventBus.subscribe(DOMAIN_EVENTS.SELLER_PAYOUT_STATUS_UPDATED_V1, async (event) => {
      const sellerId = event.payload.sellerId;
      if (!sellerId) return;
      const status = String(event.payload.status || "").replace(/_/g, " ");
      const subject = "Payout Update";
      const message = `Your payout ${event.payload.payoutId || ""} is now ${status}.`;
      const payload = {
        ...event.payload,
        eventName: event.eventName,
        eventId: event.id,
        recipientType: "seller",
        targetType: "payout",
        viewUrl: event.payload.viewUrl || `/app/seller-payouts?payoutId=${encodeURIComponent(event.payload.payoutId || "")}`,
      };
      await this.createNotification({
        userId: sellerId,
        channel: "in_app",
        subject,
        template: message,
        payload,
        status: "queued",
        idempotencyKey: `${event.eventName}:${event.id}:${sellerId}:seller:in_app`,
      });
      await this.queueEmailForUser(sellerId, {
        subject,
        message,
        eventName: event.eventName,
        eventId: event.id,
        recipientType: "seller",
        payload,
      });
    });
  }

  withViewMetadata(payload = {}, recipientType = "buyer") {
    const orderId = payload.orderId || payload.order_id || "";
    const returnId = payload.returnId || payload.return_id || "";
    const payoutId = payload.payoutId || payload.payout_id || "";
    const viewUrl = payload.viewUrl ||
      (returnId ? `/app/returns?returnId=${encodeURIComponent(returnId)}` : "") ||
      (payoutId ? `/app/seller-payouts?payoutId=${encodeURIComponent(payoutId)}` : "") ||
      (orderId
        ? recipientType === "buyer"
          ? `/orders/${encodeURIComponent(orderId)}`
          : `/app/orders/view/${encodeURIComponent(orderId)}`
        : "");
    return {
      ...payload,
      ...(viewUrl ? { viewUrl } : {}),
      targetType: returnId ? "return" : payoutId ? "payout" : orderId ? "order" : payload.targetType,
    };
  }

  async queueEmailForUser(userId, { subject, message, eventName, eventId, recipientType, payload = {} }) {
    const isBuyerRecipient = ["buyer", "customer"].includes(String(recipientType || ""));
    const directEmail = isBuyerRecipient
      ? payload.recipientEmail || payload.customerEmail || payload.buyerEmail || payload.email
      : payload.recipientEmail || this.extractSellerRecipientEmail(payload, userId);
    const to = directEmail || await this.findUserEmail(userId, recipientType);
    if (!to) return;
    const referenceId = payload.orderId || payload.returnId || payload.payoutId || eventId;
    const statusKey = this.emailJobStatusKey(eventName, payload);
    const jobId = [
      eventName,
      referenceId,
      statusKey,
      recipientType,
      userId || to,
    ].filter(Boolean).join("|");
    await notificationQueue.add("templated-email", {
      to,
      subject,
      message,
      eventName,
      eventId,
      recipientType,
      payload,
    }, { jobId });
  }

  async findUserEmail(userId, recipientType = "buyer") {
    if (!userId) return null;
    const id = String(userId);
    const isObjectId = UserModel.db.base.Types.ObjectId.isValid(id);
    const projection = "email sellerProfile";
    let user = isObjectId
      ? await UserModel.findById(id).select(projection).lean().catch(() => null)
      : null;

    if (!user && String(recipientType || "") === "seller") {
      user = await UserModel.findOne({
        $or: [
          { ownerSellerId: id },
          { parentSellerId: id },
        ],
        accountStatus: { $ne: "deleted" },
      }).select(projection).lean().catch(() => null);
    }

    return user?.email || user?.sellerProfile?.supportEmail || null;
  }

  async queueDirectEmail({ to, subject, html, text, from, idempotencyKey }) {
    if (!to) return;
    const jobId = idempotencyKey
      ? `direct-email:${idempotencyKey}`
      : ["direct-email", to, subject].filter(Boolean).join("|");
    await notificationQueue.add("direct-email", {
      to,
      subject,
      html,
      text,
      from,
    }, { jobId });
  }

  isOnlinePaymentProvider(payload = {}) {
    const provider = payload.paymentProvider || payload.payment_provider || payload.metadata?.paymentProvider;
    return [PAYMENT_PROVIDER.RAZORPAY, PAYMENT_PROVIDER.STRIPE].includes(provider);
  }

  emailJobStatusKey(eventName, payload = {}) {
    if (
      [DOMAIN_EVENTS.ORDER_PAID_V1, DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1].includes(eventName) &&
      String(payload.status || "") === ORDER_STATUS.CONFIRMED
    ) {
      return "confirmed";
    }
    return eventName === DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1
      ? payload.status || payload.orderStatus || "updated"
      : "";
  }

  shouldQueueEmail(eventName, recipientType = "buyer", payload = {}) {
    if (EMAIL_SUPPRESSED_EVENTS.has(eventName)) return false;

    const isSellerRecipient = String(recipientType || "") === "seller";
    const status = String(payload.status || payload.orderStatus || "");

    if (eventName === DOMAIN_EVENTS.ORDER_CREATED_V1) {
      return !this.isOnlinePaymentProvider(payload);
    }

    if (isSellerRecipient) {
      if ([DOMAIN_EVENTS.ORDER_PAID_V1, DOMAIN_EVENTS.ORDER_CANCELLED_V1, DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1].includes(eventName)) {
        return true;
      }
      return false;
    }

    if (this.isOnlinePaymentProvider(payload)) {
      const paymentStatus = String(payload.paymentStatus || payload.payment_status || "");
      if (
        eventName === DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1 &&
        String(payload.status || "") === ORDER_STATUS.CONFIRMED &&
        [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.AUTHORIZED, ""].includes(paymentStatus)
      ) {
        return false;
      }
    }

    if (eventName === DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1 && status === ORDER_STATUS.CONFIRMED) {
      return false;
    }

    return true;
  }

  shouldQueueAdminEmail(eventName, payload = {}) {
    const status = String(payload.status || payload.orderStatus || "");
    if (eventName === DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1) {
      return [ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED, "completed", "complete"].includes(status);
    }
    return [
      DOMAIN_EVENTS.ORDER_CREATED_V1,
      DOMAIN_EVENTS.ORDER_PAID_V1,
      DOMAIN_EVENTS.ORDER_CANCELLED_V1,
      DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1,
      DOMAIN_EVENTS.RETURN_REFUNDED_V1,
      DOMAIN_EVENTS.REFUND_PROCESSED_V1,
      DOMAIN_EVENTS.REFUND_FAILED_V1,
      DOMAIN_EVENTS.PAYMENT_REFUNDED_V1,
    ].includes(eventName);
  }

  extractSellerRecipientEmail(payload = {}, sellerId = "") {
    const targetSellerId = String(sellerId || "");
    const addFromObject = (entry = {}) => {
      if (!entry || typeof entry !== "object") return null;
      const entrySellerId = String(entry.sellerId || entry.seller_id || entry.ownerSellerId || entry.userId || entry.id || "");
      if (targetSellerId && entrySellerId && entrySellerId !== targetSellerId) return null;
      return entry.sellerEmail || entry.seller_email || entry.email || entry.supportEmail || null;
    };

    const direct = payload.sellerEmail || payload.seller_email || null;
    if (direct) return direct;

    for (const list of [payload.items, payload.sellers, payload.shipments]) {
      for (const entry of Array.isArray(list) ? list : []) {
        const email = addFromObject(entry);
        if (email) return email;
      }
    }

    return null;
  }

  async findAdminRecipients() {
    return UserModel.find({
      role: { $in: [ROLES.ADMIN, ROLES.SUB_ADMIN, ROLES.SUPER_ADMIN, "admin", "sub-admin", "super-admin"] },
      accountStatus: { $ne: "deleted" },
    }).select("_id email role profile").lean();
  }

  extractSellerRecipientIds(payload = {}) {
    const sellerIds = new Set();
    const add = (value) => {
      if (value === undefined || value === null || value === "" || value === "platform") return;
      sellerIds.add(String(value));
    };
    const parseObject = (value) => {
      if (!value) return {};
      if (typeof value === "object") return value;
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }
      return {};
    };
    const addFromObject = (entry = {}) => {
      if (!entry || typeof entry !== "object") return;
      add(entry.sellerId || entry.seller_id || entry.ownerSellerId || entry.userId || entry.id);
      const sellerSnapshot = parseObject(entry.sellerSnapshot || entry.seller_snapshot);
      const productSnapshot = parseObject(entry.productSnapshot || entry.product_snapshot);
      add(sellerSnapshot.sellerId || sellerSnapshot.seller_id);
      add(productSnapshot.sellerId || productSnapshot.seller_id);
    };

    add(payload.sellerId || payload.seller_id || payload.ownerSellerId);
    (Array.isArray(payload.sellerIds) ? payload.sellerIds : []).forEach(add);
    (Array.isArray(payload.seller_ids) ? payload.seller_ids : []).forEach(add);
    (Array.isArray(payload.items) ? payload.items : []).forEach(addFromObject);
    (Array.isArray(payload.sellers) ? payload.sellers : []).forEach(addFromObject);
    (Array.isArray(payload.shipments) ? payload.shipments : []).forEach(addFromObject);
    add(payload.deal?.sellerId || payload.deal?.seller_id);
    add(payload.metadata?.sellerId || payload.metadata?.seller_id);

    return Array.from(sellerIds);
  }

  buildSellerCommerceMessage(eventName, payload = {}, buyerTemplateBuilder) {
    const reference = payload.orderNumber || payload.orderId || payload.dealNumber || payload.dealId || payload.returnNumber || payload.returnId || "";
    const status = String(payload.status || "").replace(/_/g, " ");
    const messages = {
      [DOMAIN_EVENTS.ORDER_CREATED_V1]: `New order ${reference} has been placed.`,
      [DOMAIN_EVENTS.ORDER_PAID_V1]: `Payment received for order ${reference}.`,
      [DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1]: `Payment failed for order ${reference}.`,
      [DOMAIN_EVENTS.ORDER_CANCELLED_V1]: `Order ${reference} was cancelled.`,
      [DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1]: `Order ${reference} is now ${status}.`,
      [DOMAIN_EVENTS.RETURN_REQUESTED_V1]: `Return requested for order ${payload.orderNumber || reference}.`,
      [DOMAIN_EVENTS.RETURN_STATUS_UPDATED_V1]: `Return ${reference} is now ${status}.`,
      [DOMAIN_EVENTS.RETURN_APPROVED_V1]: `Return ${reference} has been approved.`,
      [DOMAIN_EVENTS.RETURN_REJECTED_V1]: `Return ${reference} has been rejected.`,
      [DOMAIN_EVENTS.RETURN_RECEIVED_V1]: `Return ${reference} has been received.`,
      [DOMAIN_EVENTS.RETURN_REFUNDED_V1]: `Refund processed for return ${reference}.`,
      [DOMAIN_EVENTS.SHIPMENT_CREATED_V1]: `Shipment created for order ${payload.orderNumber || reference}.`,
      [DOMAIN_EVENTS.SHIPMENT_TRACKING_UPDATED_V1]: `Shipment ${payload.shipmentId || reference} is ${status}.`,
      [DOMAIN_EVENTS.SHIPMENT_DELIVERED_V1]: `Order ${payload.orderNumber || reference} has been delivered.`,
      [DOMAIN_EVENTS.SHIPMENT_FAILED_V1]: `Shipment failed for order ${payload.orderNumber || reference}.`,
      [DOMAIN_EVENTS.SHIPMENT_RTO_V1]: `Shipment for order ${payload.orderNumber || reference} is returning to origin.`,
    };
    return messages[eventName] || buyerTemplateBuilder(payload);
  }

  async createNotification(payload) {
    const notification = await this.notificationRepository.create(payload);

    if (notification.channel === "email" && payload.email) {
      await this.queueDirectEmail({
        to: payload.email,
        subject: notification.subject || "Notification",
        html: `<p>${notification.template}</p>`,
        idempotencyKey: payload.idempotencyKey || notification.id,
      });
    }

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.NOTIFICATION_CREATED_V1,
        {
          userId: notification.userId,
          channel: notification.channel,
          subject: notification.subject,
        },
        {
          source: "notification-module",
          aggregateId: notification.id,
        },
      ),
    );

    return notification;
  }

  async listMyNotifications(actor, query = {}) {
    const userIds = [actor.userId];
    if (SELLER_ROLES.has(actor.role) && actor.ownerSellerId) {
      userIds.push(actor.ownerSellerId);
    }

    return this.notificationRepository.listByUser([...new Set(userIds.filter(Boolean))], {
      channel: query.type || query.channel || null,
      page: query.page,
      limit: query.limit,
      search: query.search || query.q || query.keyWord,
    });
  }

  async getPreferences(userId) {
    return NotificationPreferenceModel.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true },
    );
  }

  async updatePreferences(userId, payload) {
    return NotificationPreferenceModel.findOneAndUpdate(
      { userId },
      { $set: payload, $setOnInsert: { userId } },
      { upsert: true, new: true },
    );
  }
}

module.exports = { NotificationService, notificationQueue };
