const { NotificationRepository } = require("../repositories/notification.repository");
const { createQueue } = require("../../../shared/queues/queue-factory");
const { sendMail } = require("../../../infrastructure/mail/mailer");
const { eventBus } = require("../../../infrastructure/events/event-bus");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { makeEvent } = require("../../../contracts/events/event");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { NotificationPreferenceModel } = require("../models/notification-preference.model");

const notificationQueue = createQueue("notifications");
let subscribersRegistered = false;

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
      [DOMAIN_EVENTS.ORDER_PAID_V1, "Payment Successful", (p) => `Payment received for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1, "Payment Failed", (p) => `Payment failed for order ${p.orderNumber || p.orderId}.`],
      [DOMAIN_EVENTS.ORDER_CANCELLED_V1, "Order Cancelled", (p) => `Order ${p.orderNumber || p.orderId} was cancelled.`],
      [DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1, "Order Updated", (p) => `Order ${p.orderNumber || p.orderId} is now ${String(p.status || "").replace(/_/g, " ")}.`],
      [DOMAIN_EVENTS.RETURN_REQUESTED_V1, "Return Requested", (p) => `Return requested for order ${p.orderId}.`],
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
      [DOMAIN_EVENTS.SHIPMENT_DELIVERY_VERIFIED_V1, "Delivery Verified", (p) => `Delivery verified for order ${p.orderId}.`],
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
        if (!userId) return;
        await this.createNotification({
          userId,
          channel: "in_app",
          subject,
          template: templateBuilder(event.payload),
          payload: {
            eventName,
            eventId: event.id,
            ...event.payload,
          },
          status: "queued",
          idempotencyKey: `${eventName}:${event.id}:${userId}:in_app`,
        });

        await notificationQueue.add("commerce-email-placeholder", {
          userId,
          subject,
          eventName,
          eventId: event.id,
        });
        await notificationQueue.add("commerce-sms-placeholder", {
          userId,
          subject,
          eventName,
          eventId: event.id,
        });
      });
    });
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

  async listMyNotifications(actor) {
    return this.notificationRepository.listByUser(actor.userId);
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
