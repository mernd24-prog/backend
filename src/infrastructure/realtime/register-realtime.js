const { eventBus } = require("../events/event-bus");
const { DOMAIN_EVENTS } = require("../../contracts/events/domain-events");
const { emitToOrder, emitToRole, emitToUser } = require("./socket-server");
const { ROLES } = require("../../shared/constants/roles");

let realtimeRegistered = false;

function registerRealtimeSubscribers() {
  if (realtimeRegistered) {
    return;
  }

  realtimeRegistered = true;

  eventBus.subscribe(DOMAIN_EVENTS.ORDER_CREATED_V1, async (event) => {
    emitToUser(event.payload.buyerId, "order:created", event.payload);
    emitToOrder(event.aggregateId, "order:update", event.payload);
  });

  eventBus.subscribe(DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1, async (event) => {
    emitToUser(event.payload.buyerId, "order:status", event.payload);
    emitToOrder(event.payload.orderId, "order:update", event.payload);
  });

  eventBus.subscribe(DOMAIN_EVENTS.PAYMENT_INITIATED_V1, async (event) => {
    emitToUser(event.payload.buyerId, "payment:initiated", event.payload);
    emitToOrder(event.payload.orderId, "payment:update", event.payload);
  });

  eventBus.subscribe(DOMAIN_EVENTS.PAYMENT_VERIFIED_V1, async (event) => {
    emitToUser(event.payload.buyerId, "payment:verified", event.payload);
    emitToOrder(event.payload.orderId, "payment:update", event.payload);
  });

  eventBus.subscribe(DOMAIN_EVENTS.PAYMENT_FAILED_V1, async (event) => {
    emitToUser(event.payload.buyerId, "payment:failed", event.payload);
    emitToOrder(event.payload.orderId, "payment:update", event.payload);
  });

  eventBus.subscribe(DOMAIN_EVENTS.NOTIFICATION_CREATED_V1, async (event) => {
    emitToUser(event.payload.userId, "notification:new", event.payload);
  });

  [
    DOMAIN_EVENTS.RETURN_REQUESTED_V1,
    DOMAIN_EVENTS.RETURN_APPROVED_V1,
    DOMAIN_EVENTS.RETURN_REJECTED_V1,
    DOMAIN_EVENTS.RETURN_RECEIVED_V1,
    DOMAIN_EVENTS.RETURN_REFUNDED_V1,
    DOMAIN_EVENTS.REFUND_PROCESSED_V1,
    DOMAIN_EVENTS.REFUND_FAILED_V1,
  ].forEach((eventName) => {
    eventBus.subscribe(eventName, async (event) => {
      emitToUser(event.payload.buyerId, "return:update", event.payload);
      emitToOrder(event.payload.orderId, "return:update", event.payload);
      emitToRole(ROLES.ADMIN, "admin:return:update", event.payload);
    });
  });

  [
    DOMAIN_EVENTS.SHIPMENT_CREATED_V1,
    DOMAIN_EVENTS.SHIPMENT_TRACKING_UPDATED_V1,
    DOMAIN_EVENTS.SHIPMENT_DELIVERED_V1,
    DOMAIN_EVENTS.SHIPMENT_DELIVERY_OTP_GENERATED_V1,
    DOMAIN_EVENTS.SHIPMENT_DELIVERY_VERIFIED_V1,
    DOMAIN_EVENTS.DEAL_CREATED_V1,
    DOMAIN_EVENTS.DEAL_UPDATED_V1,
    DOMAIN_EVENTS.DEAL_SUBMITTED_V1,
    DOMAIN_EVENTS.DEAL_APPROVED_V1,
    DOMAIN_EVENTS.DEAL_REJECTED_V1,
    DOMAIN_EVENTS.DEAL_CANCELLED_V1,
    DOMAIN_EVENTS.SHIPMENT_FAILED_V1,
    DOMAIN_EVENTS.SHIPMENT_RTO_V1,
  ].forEach((eventName) => {
    eventBus.subscribe(eventName, async (event) => {
      emitToUser(event.payload.buyerId, "shipment:update", event.payload);
      emitToOrder(event.payload.orderId, "shipment:update", event.payload);
      emitToRole(ROLES.ADMIN, "admin:shipment:update", event.payload);
    });
  });

  [DOMAIN_EVENTS.INVOICE_GENERATED_V1, DOMAIN_EVENTS.CREDIT_NOTE_GENERATED_V1].forEach((eventName) => {
    eventBus.subscribe(eventName, async (event) => {
      emitToUser(event.payload.buyerId, "tax:update", event.payload);
      emitToOrder(event.payload.orderId, "tax:update", event.payload);
      emitToRole(ROLES.ADMIN, "admin:tax:update", event.payload);
    });
  });

  eventBus.subscribe(DOMAIN_EVENTS.SELLER_KYC_SUBMITTED_V1, async (event) => {
    emitToUser(event.payload.sellerId, "kyc:submitted", event.payload);
    emitToRole(ROLES.ADMIN, "admin:kyc:update", event.payload);
  });

  eventBus.subscribe(DOMAIN_EVENTS.USER_KYC_SUBMITTED_V1, async (event) => {
    emitToUser(event.payload.userId, "kyc:submitted", event.payload);
    emitToRole(ROLES.ADMIN, "admin:kyc:update", event.payload);
  });

  eventBus.subscribe(DOMAIN_EVENTS.KYC_STATUS_UPDATED_V1, async (event) => {
    const targetUserId = event.payload.userId || event.payload.sellerId;
    emitToUser(targetUserId, "kyc:status", event.payload);
    emitToRole(ROLES.ADMIN, "admin:kyc:update", event.payload);
  });
}

module.exports = { registerRealtimeSubscribers };
