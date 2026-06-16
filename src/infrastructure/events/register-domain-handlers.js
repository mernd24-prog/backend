const { eventBus } = require("./event-bus");
const { DOMAIN_EVENTS } = require("../../contracts/events/domain-events");
const { OrderRepository } = require("../../modules/order/repositories/order.repository");
const { ORDER_STATUS } = require("../../shared/domain/commerce-constants");
const { InventoryService } = require("../../modules/inventory/services/inventory.service");
const { WalletService } = require("../../modules/wallet/services/wallet.service");
const { auditLogService } = require("../../shared/logger/audit-log.service");

let handlersRegistered = false;

function registerDomainHandlers() {
  if (handlersRegistered) {
    return;
  }

  handlersRegistered = true;
  const orderRepository = new OrderRepository();
  const inventoryService = new InventoryService();
  const walletService = new WalletService();

  eventBus.subscribe(DOMAIN_EVENTS.PAYMENT_VERIFIED_V1, async (event) => {
    await inventoryService.commitForOrder(event.payload.orderId);
    await walletService.capture(event.payload.buyerId, event.payload.orderId);
    await orderRepository.updateStatus(event.payload.orderId, ORDER_STATUS.CONFIRMED);
  });

  eventBus.subscribe(DOMAIN_EVENTS.PAYMENT_FAILED_V1, async (event) => {
    await inventoryService.releaseForOrder(event.payload.orderId);
    await walletService.release(event.payload.buyerId, event.payload.orderId);
    await orderRepository.updateStatus(event.payload.orderId, ORDER_STATUS.PAYMENT_FAILED);
  });

  const auditTargets = [
    [DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1, "order", (p) => p.orderId],
    [DOMAIN_EVENTS.ORDER_CANCELLED_V1, "order", (p) => p.orderId],
    [DOMAIN_EVENTS.ORDER_PAID_V1, "order", (p) => p.orderId],
    [DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1, "order", (p) => p.orderId],
    [DOMAIN_EVENTS.PAYMENT_VERIFIED_V1, "payment", (p) => p.paymentId],
    [DOMAIN_EVENTS.PAYMENT_FAILED_V1, "payment", (p) => p.paymentId],
    [DOMAIN_EVENTS.PAYMENT_REFUNDED_V1, "payment", (p) => p.paymentId],
    [DOMAIN_EVENTS.RETURN_REQUESTED_V1, "return", (p) => p.returnId],
    [DOMAIN_EVENTS.RETURN_APPROVED_V1, "return", (p) => p.returnId],
    [DOMAIN_EVENTS.RETURN_REJECTED_V1, "return", (p) => p.returnId],
    [DOMAIN_EVENTS.RETURN_RECEIVED_V1, "return", (p) => p.returnId],
    [DOMAIN_EVENTS.RETURN_REFUNDED_V1, "return", (p) => p.returnId],
    [DOMAIN_EVENTS.REFUND_PROCESSED_V1, "refund", (p) => p.referenceId || p.returnId],
    [DOMAIN_EVENTS.REFUND_FAILED_V1, "refund", (p) => p.referenceId || p.returnId],
    [DOMAIN_EVENTS.SHIPMENT_CREATED_V1, "shipment", (p) => p.shipmentId],
    [DOMAIN_EVENTS.SHIPMENT_TRACKING_UPDATED_V1, "shipment", (p) => p.shipmentId],
    [DOMAIN_EVENTS.SHIPMENT_DELIVERED_V1, "shipment", (p) => p.shipmentId],
    [DOMAIN_EVENTS.SHIPMENT_DELIVERY_OTP_GENERATED_V1, "shipment", (p) => p.shipmentId],
    [DOMAIN_EVENTS.SHIPMENT_DELIVERY_VERIFIED_V1, "shipment", (p) => p.shipmentId],
    [DOMAIN_EVENTS.SHIPMENT_FAILED_V1, "shipment", (p) => p.shipmentId],
    [DOMAIN_EVENTS.SHIPMENT_RTO_V1, "shipment", (p) => p.shipmentId],
    [DOMAIN_EVENTS.INVOICE_GENERATED_V1, "invoice", (p) => p.invoiceId],
    [DOMAIN_EVENTS.CREDIT_NOTE_GENERATED_V1, "credit_note", (p) => p.creditNoteId],
    [DOMAIN_EVENTS.DEAL_CREATED_V1, "deal", (p) => p.dealId],
    [DOMAIN_EVENTS.DEAL_UPDATED_V1, "deal", (p) => p.dealId],
    [DOMAIN_EVENTS.DEAL_SUBMITTED_V1, "deal", (p) => p.dealId],
    [DOMAIN_EVENTS.DEAL_APPROVED_V1, "deal", (p) => p.dealId],
    [DOMAIN_EVENTS.DEAL_REJECTED_V1, "deal", (p) => p.dealId],
    [DOMAIN_EVENTS.DEAL_CANCELLED_V1, "deal", (p) => p.dealId],
  ];

  auditTargets.forEach(([eventName, targetType, getTargetId]) => {
    eventBus.subscribe(eventName, async (event) => {
      await auditLogService.recordEvent(event, targetType, getTargetId(event.payload || {}));
    });
  });
}

module.exports = { registerDomainHandlers };
