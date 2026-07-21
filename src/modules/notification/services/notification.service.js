const { NotificationRepository } = require("../repositories/notification.repository");
const { createQueue } = require("../../../shared/queues/queue-factory");
const { sendMail } = require("../../../infrastructure/mail/mailer");
const { eventBus } = require("../../../infrastructure/events/event-bus");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { makeEvent } = require("../../../contracts/events/event");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { NotificationPreferenceModel } = require("../models/notification-preference.model");
const { ROLES } = require("../../../shared/constants/roles");
const { UserModel } = require("../../user/models/user.model");

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
      [DOMAIN_EVENTS.RETURN_REQUESTED_V1, "Return Requested", (p) => `Return requested for order ${p.orderId}.`],
      [DOMAIN_EVENTS.RETURN_STATUS_UPDATED_V1, "Return Updated", (p) => `Return ${p.returnNumber || p.returnId} is now ${String(p.status || "").replace(/_/g, " ")}.`],
      [DOMAIN_EVENTS.RETURN_APPROVED_V1, "Return Approved", (p) => `Return ${p.returnId} has been approved.`],
      [DOMAIN_EVENTS.RETURN_REJECTED_V1, "Return Rejected", (p) => `Return ${p.returnId} has been rejected.`],
      [DOMAIN_EVENTS.RETURN_RECEIVED_V1, "Return Received", (p) => `Return ${p.returnId} has been received.`],
      [DOMAIN_EVENTS.RETURN_REFUNDED_V1, "Return Refunded", (p) => `Refund processed for return ${p.returnId}.`],
      [DOMAIN_EVENTS.REFUND_PROCESSED_V1, "Refund Processed", (p) => `Refund ${p.referenceId || p.returnId || ""} has been processed.`],
      [DOMAIN_EVENTS.REFUND_FAILED_V1, "Refund Failed", (p) => `Refund failed for order ${p.orderId || p.returnId}.`],
      [DOMAIN_EVENTS.PAYMENT_REFUNDED_V1, "Payment Refunded", (p) => `Payment refund processed for order ${p.orderId}.`],
      [DOMAIN_EVENTS.SHIPMENT_CREATED_V1, "Shipment Created", (p) => `Shipment created for order ${p.orderId}.`],
      [DOMAIN_EVENTS.SHIPMENT_TRACKING_UPDATED_V1, "Shipment Updated", (p) => `Shipment ${p.shipmentId} is ${String(p.status || "").replace(/_/g, " ")}.`],
      [DOMAIN_EVENTS.SHIPMENT_DELIVERED_V1, "Shipment Delivered", (p) => `Order ${p.orderId} has been delivered.`],
      [DOMAIN_EVENTS.DEAL_SUBMITTED_V1, "Deal Submitted", (p) => `Deal ${p.dealNumber || p.dealId} is waiting for approval.`],
      [DOMAIN_EVENTS.DEAL_APPROVED_V1, "Deal Approved", (p) => `Deal ${p.dealNumber || p.dealId} has been approved.`],
      [DOMAIN_EVENTS.DEAL_REJECTED_V1, "Deal Rejected", (p) => `Deal ${p.dealNumber || p.dealId} was rejected.`],
      [DOMAIN_EVENTS.DEAL_CANCELLED_V1, "Deal Cancelled", (p) => `Deal ${p.dealNumber || p.dealId} was cancelled.`],
      [DOMAIN_EVENTS.SHIPMENT_FAILED_V1, "Shipment Failed", (p) => `Shipment failed for order ${p.orderId}.`],
      [DOMAIN_EVENTS.SHIPMENT_RTO_V1, "Shipment RTO", (p) => `Shipment for order ${p.orderId} is returning to origin.`],
      [DOMAIN_EVENTS.INVOICE_GENERATED_V1, "Invoice Generated", (p) => `Invoice generated for order ${p.orderId}.`],
      [DOMAIN_EVENTS.CREDIT_NOTE_GENERATED_V1, "Credit Note Generated", (p) => `Credit note generated for order ${p.orderId}.`],
    ];

    definitions.forEach(([eventName, subject, templateBuilder]) => {
      eventBus.subscribe(eventName, async (event) => {
        const userId = event.payload.buyerId || event.payload.userId;
        const customerPayload = this.withViewMetadata(event.payload, "buyer");
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

          if (this.shouldQueueEmail(eventName, "buyer", event.payload)) {
            await this.queueEmailForUser(userId, {
              subject,
              message: templateBuilder(event.payload),
              eventName,
              eventId: event.id,
              recipientType: "buyer",
              payload: customerPayload,
            });
          }
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
    const user = await UserModel.findById(userId).select("email").lean();
    if (!user?.email) return;
    await notificationQueue.add("templated-email", {
      to: user.email,
      subject,
      message,
      eventName,
      eventId,
      recipientType,
      payload,
    });
  }

  shouldQueueEmail(eventName) {
    return !EMAIL_SUPPRESSED_EVENTS.has(eventName);
  }

  async findAdminRecipients() {
    return UserModel.find({
      role: { $in: [ROLES.ADMIN, ROLES.SUB_ADMIN, ROLES.SUPER_ADMIN, "admin", "sub-admin", "super-admin"] },
      accountStatus: { $ne: "deleted" },
    }).select("_id email role").lean();
  }

  extractSellerRecipientIds(payload = {}) {
    const sellerIds = new Set();
    const add = (value) => {
      if (value === undefined || value === null || value === "" || value === "platform") return;
      sellerIds.add(String(value));
    };
    const addFromObject = (entry = {}) => {
      if (!entry || typeof entry !== "object") return;
      add(entry.sellerId || entry.seller_id || entry.ownerSellerId || entry.userId || entry.id);
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
      [DOMAIN_EVENTS.RETURN_REQUESTED_V1]: `Return requested for order ${payload.orderId || reference}.`,
      [DOMAIN_EVENTS.RETURN_STATUS_UPDATED_V1]: `Return ${reference} is now ${status}.`,
      [DOMAIN_EVENTS.RETURN_APPROVED_V1]: `Return ${reference} has been approved.`,
      [DOMAIN_EVENTS.RETURN_REJECTED_V1]: `Return ${reference} has been rejected.`,
      [DOMAIN_EVENTS.RETURN_RECEIVED_V1]: `Return ${reference} has been received.`,
      [DOMAIN_EVENTS.RETURN_REFUNDED_V1]: `Refund processed for return ${reference}.`,
      [DOMAIN_EVENTS.SHIPMENT_CREATED_V1]: `Shipment created for order ${payload.orderId || reference}.`,
      [DOMAIN_EVENTS.SHIPMENT_TRACKING_UPDATED_V1]: `Shipment ${payload.shipmentId || reference} is ${status}.`,
      [DOMAIN_EVENTS.SHIPMENT_DELIVERED_V1]: `Order ${payload.orderId || reference} has been delivered.`,
      [DOMAIN_EVENTS.SHIPMENT_FAILED_V1]: `Shipment failed for order ${payload.orderId || reference}.`,
      [DOMAIN_EVENTS.SHIPMENT_RTO_V1]: `Shipment for order ${payload.orderId || reference} is returning to origin.`,
    };
    return messages[eventName] || buyerTemplateBuilder(payload);
  }

  async createNotification(payload) {
    const notification = await this.notificationRepository.create(payload);

    if (notification.channel === "email" && payload.email) {
      await sendMail({
        to: payload.email,
        subject: notification.subject || "Notification",
        html: `<p>${notification.template}</p>`,
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
