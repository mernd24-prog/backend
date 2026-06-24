const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { AppError } = require("../../../shared/errors/app-error");
const { ORDER_STATUS, PAYMENT_PROVIDER, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { InventoryService } = require("../../inventory/services/inventory.service");
const { WalletService } = require("../../wallet/services/wallet.service");
const { DeliveryRepository } = require("../../delivery/repositories/delivery.repository");
const { TaxService } = require("../../tax/services/tax.service");
const { DealService } = require("../../deal/services/deal.service");
const { CommissionService } = require("../../seller/services/commission.service");
const { RazorpayProvider } = require("../../../infrastructure/payments/providers/razorpay.provider");
const { shippingProviderRegistry } = require("../../../infrastructure/shipping/provider-registry");
const { CancellationRepository } = require("../repositories/cancellation.repository");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");

const CANCELLABLE_ORDER_STATUSES = new Set([
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.PAYMENT_FAILED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PACKED,
]);
const CANCELLABLE_SHIPMENT_STATUSES = new Set(["initiated", "manifested", "failed", "cancelled"]);

class CancellationService {
  constructor({
    cancellationRepository = new CancellationRepository(),
    orderRepository = new OrderRepository(),
    inventoryService = new InventoryService(),
    walletService = new WalletService(),
    deliveryRepository = new DeliveryRepository(),
    taxService = new TaxService({ orderRepository }),
    dealService = new DealService(),
    commissionService = CommissionService,
    razorpayProvider = new RazorpayProvider(),
  } = {}) {
    this.cancellationRepository = cancellationRepository;
    this.orderRepository = orderRepository;
    this.inventoryService = inventoryService;
    this.walletService = walletService;
    this.deliveryRepository = deliveryRepository;
    this.taxService = taxService;
    this.dealService = dealService;
    this.commissionService = commissionService;
    this.razorpayProvider = razorpayProvider;
  }

  round(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  isAdmin(actor = {}) {
    return ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
  }

  isSeller(actor = {}) {
    return ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);
  }

  makeNumber() {
    return `CAN-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  makeIdempotencyKey(orderId, items, payload, actor) {
    if (payload.idempotencyKey) return payload.idempotencyKey;
    const identity = JSON.stringify({
      orderId,
      items: items.map((item) => [item.orderItemId, item.quantity]).sort(),
      reason: payload.reason,
      actorId: actor.userId,
    });
    return `cancel:${orderId}:${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
  }

  async assertCanCancel(order, items, actor) {
    const isBuyer = String(order.buyer_id) === String(actor.userId);
    if (isBuyer || this.isAdmin(actor)) return;
    if (this.isSeller(actor)) {
      const sellerId = String(actor.ownerSellerId || actor.userId);
      if (items.every((item) => String(item.sellerId) === sellerId)) return;
    }
    throw new AppError("You are not allowed to cancel these order items", 403);
  }

  normalizeItems(order, requestedItems = []) {
    const source = requestedItems.length
      ? requestedItems
      : (order.items || []).map((item) => ({ orderItemId: item.id, quantity: Number(item.quantity || 0) - Number(item.cancelled_quantity || 0) }));
    const seen = new Set();
    return source.map((requested) => {
      const orderItem = (order.items || []).find((item) =>
        String(item.id) === String(requested.orderItemId || requested.id) ||
        (
          String(item.product_id) === String(requested.productId || "") &&
          String(item.variant_sku || item.variant_id || "") === String(requested.variantSku || requested.variantId || "")
        ),
      );
      if (!orderItem) throw new AppError("One or more cancellation items are not part of the order", 400);
      if (seen.has(String(orderItem.id))) throw new AppError("Duplicate cancellation item", 400);
      seen.add(String(orderItem.id));
      const remaining = Number(orderItem.quantity || 0) - Number(orderItem.cancelled_quantity || 0);
      const quantity = Number(requested.quantity || remaining);
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > remaining) {
        throw new AppError(`Invalid cancellation quantity for ${orderItem.product_title || orderItem.product_id}`, 400);
      }
      const ratio = quantity / Math.max(Number(orderItem.quantity || 1), 1);
      const itemAmount = this.round(Number(orderItem.line_total || 0) * ratio);
      const discountAmount = this.round(Number(orderItem.discount_amount || 0) * ratio);
      const taxAmount = this.round(Number(orderItem.tax_amount || 0) * ratio);
      return {
        orderItemId: orderItem.id,
        productId: orderItem.product_id,
        productTitle: orderItem.product_title,
        variantId: orderItem.variant_id || "",
        variantSku: orderItem.variant_sku || "",
        sellerId: orderItem.seller_id,
        organizationId: orderItem.organization_id || null,
        quantity,
        orderedQuantity: Number(orderItem.quantity || 0),
        itemAmount,
        discountAmount,
        taxAmount,
        refundAmount: this.round(Math.max(itemAmount - discountAmount + taxAmount, 0)),
      };
    });
  }

  isFullCancellation(order, items) {
    const cancelledByItem = new Map(items.map((item) => [String(item.orderItemId), Number(item.quantity || 0)]));
    return (order.items || []).every((item) => {
      const remaining = Number(item.quantity || 0) - Number(item.cancelled_quantity || 0);
      return Number(cancelledByItem.get(String(item.id)) || 0) === remaining;
    });
  }

  calculateRefund(order, items, payment, fullCancellation = false) {
    const itemRefundAmount = this.round(items.reduce((sum, item) => sum + item.refundAmount, 0));
    const itemBase = items.reduce((sum, item) => sum + item.itemAmount, 0);
    const proportion = Number(order.subtotal_amount || 0) > 0
      ? Math.min(itemBase / Number(order.subtotal_amount), 1)
      : 0;
    const refundAmount = fullCancellation
      ? this.round(Number(order.total_amount || itemRefundAmount))
      : this.round(itemRefundAmount + Number(order.cod_charge_amount || 0) * proportion);
    const walletRefundAmount = this.round(Math.min(
      fullCancellation
        ? Number(order.wallet_discount_amount || 0)
        : Number(order.wallet_discount_amount || 0) * proportion,
      refundAmount,
    ));
    const captured = payment?.status === PAYMENT_STATUS.CAPTURED || order.payment_status === PAYMENT_STATUS.CAPTURED;
    const isCod = (payment?.provider || order.payment_provider) === PAYMENT_PROVIDER.COD;
    const providerRefundAmount = captured && !isCod
      ? this.round(refundAmount - walletRefundAmount)
      : 0;
    return {
      refundAmount,
      walletRefundAmount,
      providerRefundAmount,
      refundRequired: captured && refundAmount > 0 && !isCod,
      captured,
      isCod,
    };
  }

  async cancelOrder(orderId, payload = {}, actor = {}) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) throw new AppError("Order not found", 404);
    if (!CANCELLABLE_ORDER_STATUSES.has(order.status)) {
      throw new AppError("Order cannot be cancelled after shipment handover. Use return or RTO flow.", 409);
    }
    const items = this.normalizeItems(order, payload.items || []);
    await this.assertCanCancel(order, items, actor);
    const fullCancellation = this.isFullCancellation(order, items);
    const payment = await this.orderRepository.findRefundablePaymentByOrderId(orderId);
    const refund = this.calculateRefund(order, items, payment, fullCancellation);
    const idempotencyKey = this.makeIdempotencyKey(orderId, items, payload, actor);
    const existing = await this.cancellationRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) return existing;

    await this.assertShipmentsCancellable(order, items);
    const cancellation = await this.cancellationRepository.create({
      id: uuidv4(),
      cancellationNumber: this.makeNumber(),
      orderId,
      buyerId: order.buyer_id,
      scope: fullCancellation ? "full" : "partial",
      reasonCode: payload.reasonCode || "other",
      reason: payload.reason,
      sourceOrderStatus: order.status,
      items,
      refundAmount: refund.refundAmount,
      walletRefundAmount: refund.walletRefundAmount,
      providerRefundAmount: refund.providerRefundAmount,
      refundMethod: payload.refundMethod || "auto",
      refundStatus: refund.refundRequired || refund.walletRefundAmount > 0 ? "pending" : "not_required",
      paymentId: payment?.id || null,
      paymentProvider: payment?.provider || order.payment_provider || null,
      idempotencyKey,
      requestedBy: actor.userId,
      requestedByRole: actor.role,
      metadata: { fullCancellation, requestedAt: new Date().toISOString() },
    });
    return this.processCancellation(cancellation.id, actor);
  }

  async assertShipmentsCancellable(order, items) {
    const sellerIds = new Set(items.map((item) => String(item.sellerId)));
    const shipments = (order.relations?.shipments || []).filter((shipment) => sellerIds.has(String(shipment.seller_id)) && shipment.direction !== "reverse");
    const blocked = shipments.find((shipment) => !CANCELLABLE_SHIPMENT_STATUSES.has(shipment.status));
    if (blocked) throw new AppError("Cancellation is blocked because a shipment was handed to the courier", 409);
    for (const shipment of shipments.filter((entry) => entry.status !== "cancelled")) {
      const sellerId = String(shipment.seller_id);
      const selectedByItem = new Map(
        items
          .filter((item) => String(item.sellerId) === sellerId)
          .map((item) => [String(item.orderItemId), Number(item.quantity || 0)]),
      );
      const cancelsSellerPackage = (order.items || [])
        .filter((item) => String(item.seller_id) === sellerId)
        .every((item) => {
          const remaining = Number(item.quantity || 0) - Number(item.cancelled_quantity || 0);
          return Number(selectedByItem.get(String(item.id)) || 0) === remaining;
        });
      if (!cancelsSellerPackage) {
        throw new AppError("A packed seller shipment can only be cancelled as a complete shipment group", 409);
      }
    }
  }

  async cancelShipments(order, cancellation, actor) {
    const sellerIds = new Set((cancellation.items || []).map((item) => String(item.sellerId)));
    const shipments = (order.relations?.shipments || []).filter((shipment) =>
      sellerIds.has(String(shipment.seller_id)) && shipment.direction !== "reverse" && shipment.status !== "cancelled",
    );
    for (const shipment of shipments) {
      const provider = shippingProviderRegistry.get(shipment.provider || "manual");
      await provider.cancelShipment({ shipmentId: shipment.id, trackingNumber: shipment.tracking_number });
      await this.deliveryRepository.addTrackingEvent(shipment.id, {
        status: "cancelled",
        note: cancellation.reason,
        source: "order_cancellation",
        actorId: actor.userId,
        idempotencyKey: `cancellation:${cancellation.id}:shipment:${shipment.id}`,
        rawPayload: { cancellationId: cancellation.id },
      });
    }
    return shipments.length ? "cancelled" : "not_required";
  }

  async processCancellation(cancellationId, actor = {}) {
    let cancellation = await this.cancellationRepository.findById(cancellationId);
    if (!cancellation) throw new AppError("Cancellation not found", 404);
    if (cancellation.status === "completed") return cancellation;
    const order = await this.orderRepository.findByIdWithItems(cancellation.order_id);
    if (!order) throw new AppError("Order not found", 404);
    const attempt = { attemptId: uuidv4(), startedAt: new Date().toISOString(), status: "processing" };
    const attempts = [...(cancellation.attempts || []), attempt];
    cancellation = await this.cancellationRepository.update(cancellation.id, {
      status: "processing", attempts, lastError: null,
    });

    try {
      if (!["cancelled", "not_required", "completed"].includes(cancellation.shipment_status)) {
        const shipmentStatus = await this.cancelShipments(order, cancellation, actor);
        cancellation = await this.cancellationRepository.update(cancellation.id, { shipmentStatus });
      }

      if (cancellation.inventory_status !== "completed") {
        await this.inventoryService.cancelOrderItems(
          order.id,
          cancellation.id,
          cancellation.items,
          actor,
          { reason: cancellation.reason, cancellationNumber: cancellation.cancellation_number },
        );
        cancellation = await this.cancellationRepository.update(cancellation.id, { inventoryStatus: "completed" });
      }

      if (!cancellation.metadata?.walletProcessed) {
        await this.processWallet(cancellation, order, actor);
        cancellation = await this.cancellationRepository.update(cancellation.id, {
          metadata: { walletProcessed: true, walletProcessedAt: new Date().toISOString() },
        });
      }
      const refundResult = ["completed", "not_required"].includes(cancellation.refund_status)
        ? { refundStatus: cancellation.refund_status, providerRefundId: cancellation.provider_refund_id }
        : await this.processProviderRefund(cancellation, order);
      cancellation = await this.cancellationRepository.update(cancellation.id, {
        refundStatus: refundResult.refundStatus,
        providerRefundId: refundResult.providerRefundId || cancellation.provider_refund_id || null,
      });
      const fullCancellation = cancellation.scope === "full";
      await this.cancellationRepository.applyOrderProjection(cancellation, fullCancellation);
      cancellation = await this.cancellationRepository.update(cancellation.id, {
        metadata: { projectionApplied: true, projectionAppliedAt: new Date().toISOString() },
      });

      if (fullCancellation) {
        const paymentStatus = this.resolveOrderPaymentStatus(cancellation, order, refundResult.refundStatus);
        if (order.status !== ORDER_STATUS.CANCELLED || order.payment_status !== paymentStatus) {
          await this.orderRepository.updateStatus(order.id, ORDER_STATUS.CANCELLED, {
          actorId: actor.userId,
          actorRole: actor.role,
          reason: cancellation.reason,
          paymentStatus,
          orderMetadata: { cancellationId: cancellation.id, cancellationNumber: cancellation.cancellation_number },
          metadata: { cancellationId: cancellation.id, scope: cancellation.scope },
          });
        }
      }
      await this.dealService.cancelOrderItemSales(order.id, cancellation.id, cancellation.items, actor);
      await this.syncPaymentState(cancellation, order, refundResult.refundStatus);

      const creditNote = await this.createCreditNoteIfRequired(cancellation, actor);
      const financeResult = ["completed", "not_required"].includes(refundResult.refundStatus)
        ? await this.processSellerFinance(cancellation, actor)
        : null;
      const finalStatus = ["pending", "provider_pending", "manual_review"].includes(refundResult.refundStatus)
        ? refundResult.refundStatus === "manual_review" ? "manual_review" : "refund_pending"
        : "completed";
      attempt.status = finalStatus;
      attempt.completedAt = new Date().toISOString();
      cancellation = await this.cancellationRepository.update(cancellation.id, {
        status: finalStatus,
        refundStatus: refundResult.refundStatus,
        providerRefundId: refundResult.providerRefundId || null,
        financeStatus: financeResult === null && !["completed", "not_required"].includes(refundResult.refundStatus) ? "pending" : "completed",
        creditNoteId: creditNote?.id || null,
        attempts,
        completedAt: finalStatus === "completed" ? new Date() : null,
        metadata: {
          walletProcessed: true,
          sellerFinance: financeResult,
        },
      });
      await this.publishCancellationEvent(cancellation, actor);
      return cancellation;
    } catch (error) {
      attempt.status = "failed";
      attempt.failureReason = error.message;
      attempt.completedAt = new Date().toISOString();
      await this.cancellationRepository.update(cancellation.id, {
        status: "failed", lastError: error.message, attempts,
      });
      throw error;
    }
  }

  async processWallet(cancellation, order, actor) {
    const amount = Number(cancellation.wallet_refund_amount || 0);
    if (amount <= 0) return;
    const paymentCaptured = order.payment_status === PAYMENT_STATUS.CAPTURED;
    if (paymentCaptured) {
      await this.walletService.credit(order.buyer_id, amount, {
        referenceType: "order_cancellation",
        referenceId: cancellation.id,
        metadata: { orderId: order.id, cancellationNumber: cancellation.cancellation_number },
      });
    } else {
      await this.walletService.releasePartial(order.buyer_id, order.id, amount, cancellation.id, {
        cancellationNumber: cancellation.cancellation_number,
        actorId: actor.userId,
      });
    }
  }

  async processProviderRefund(cancellation, order) {
    const amount = Number(cancellation.provider_refund_amount || 0);
    if (amount <= 0) {
      return { refundStatus: Number(cancellation.wallet_refund_amount || 0) > 0 ? "completed" : "not_required" };
    }
    if (cancellation.payment_provider !== PAYMENT_PROVIDER.RAZORPAY) {
      return { refundStatus: "manual_review" };
    }
    const payment = await this.orderRepository.findRefundablePaymentByOrderId(order.id);
    if (!payment?.provider_payment_id) throw new AppError("Refundable provider payment was not found", 409);
    let result;
    if (cancellation.provider_refund_id) {
      result = await this.razorpayProvider.fetchRefund(cancellation.provider_refund_id);
    } else {
      result = await this.razorpayProvider.createRefund({
        providerPaymentId: payment.provider_payment_id,
        amount,
        returnId: `cancellation:${cancellation.id}`,
        notes: { orderId: order.id, cancellationId: cancellation.id },
      });
    }
    if (result.status === "failed") {
      throw new AppError(result.failureReason || "Provider refund failed and requires retry", 409);
    }
    return {
      providerRefundId: result.refundId,
      refundStatus: ["processed", "completed"].includes(result.status) ? "completed" : "provider_pending",
    };
  }

  resolveOrderPaymentStatus(cancellation, order, refundStatus) {
    if (cancellation.scope !== "full") return order.payment_status;
    const wasCaptured = order.payment_status === PAYMENT_STATUS.CAPTURED;
    if (wasCaptured && refundStatus === "completed") return PAYMENT_STATUS.REFUNDED;
    if (["provider_pending", "pending", "manual_review"].includes(refundStatus)) return order.payment_status;
    return PAYMENT_STATUS.CANCELLED;
  }

  async syncPaymentState(cancellation, order, refundStatus) {
    const paymentStatus = this.resolveOrderPaymentStatus(cancellation, order, refundStatus);
    return this.orderRepository.updatePaymentsForOrderCancellation(order.id, {
      status: cancellation.scope === "full" ? paymentStatus : undefined,
      failedReason: paymentStatus === PAYMENT_STATUS.CANCELLED ? cancellation.reason : undefined,
      metadata: {
        cancellationId: cancellation.id,
        cancellationNumber: cancellation.cancellation_number,
        scope: cancellation.scope,
        refundStatus,
        refundAmount: Number(cancellation.refund_amount || 0),
        providerRefundId: cancellation.provider_refund_id || null,
      },
    });
  }

  async processSellerFinance(cancellation, actor) {
    if (Number(cancellation.refund_amount || 0) <= 0) return null;
    return this.commissionService.recordRefundAdjustment({
      id: cancellation.id,
      orderId: cancellation.order_id,
      items: cancellation.items || [],
    }, Number(cancellation.refund_amount || 0), actor);
  }

  async createCreditNoteIfRequired(cancellation, actor) {
    if (Number(cancellation.refund_amount || 0) <= 0) return null;
    const invoice = await this.taxService.taxRepository.findInvoiceByOrderId(cancellation.order_id);
    if (!invoice) return null;
    const itemSubtotal = (cancellation.items || []).reduce((sum, item) => sum + Number(item.itemAmount || 0) - Number(item.discountAmount || 0), 0);
    const taxAmount = (cancellation.items || []).reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
    return this.taxService.createMarketplaceCreditNotes({
      orderId: cancellation.order_id,
      referenceType: "cancellation",
      referenceId: cancellation.id,
      items: cancellation.items || [],
      taxableAmount: this.round(itemSubtotal),
      taxAmount: this.round(taxAmount),
      totalAmount: Number(cancellation.refund_amount || 0),
      reason: cancellation.reason,
      metadata: {
        cancellationNumber: cancellation.cancellation_number,
        cancellationScope: cancellation.scope,
      },
    }, actor);
  }

  async completeManualRefund(cancellationId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can confirm manual refunds", 403);
    const cancellation = await this.cancellationRepository.findById(cancellationId);
    if (!cancellation) throw new AppError("Cancellation not found", 404);
    if (cancellation.refund_status !== "manual_review") throw new AppError("Cancellation is not awaiting a manual refund", 409);
    const order = await this.orderRepository.findByIdWithItems(cancellation.order_id);
    if (!order) throw new AppError("Order not found", 404);
    const creditNote = await this.createCreditNoteIfRequired(cancellation, actor);
    const financeResult = await this.processSellerFinance(cancellation, actor);
    await this.syncPaymentState(cancellation, order, "completed");
    if (cancellation.scope === "full" && order.payment_status !== PAYMENT_STATUS.REFUNDED) {
      await this.orderRepository.updateStatus(order.id, ORDER_STATUS.CANCELLED, {
        actorId: actor.userId,
        actorRole: actor.role,
        reason: "manual_refund_completed",
        paymentStatus: PAYMENT_STATUS.REFUNDED,
        metadata: { cancellationId, manualRefundReference: payload.referenceId },
      });
    }
    const completed = await this.cancellationRepository.update(cancellationId, {
      status: "completed",
      refundStatus: "completed",
      financeStatus: "completed",
      creditNoteId: creditNote?.id || null,
      completedAt: new Date(),
      metadata: {
        manualRefundReference: payload.referenceId,
        manualRefundProofUrl: payload.proofUrl || null,
        manualRefundConfirmedBy: actor.userId,
        sellerFinance: financeResult,
      },
    });
    await this.publishCancellationEvent(completed, actor);
    return completed;
  }

  async retry(cancellationId, actor = {}) {
    const cancellation = await this.get(cancellationId, actor);
    if (!["failed", "refund_pending"].includes(cancellation.status)) {
      throw new AppError("Only failed or pending cancellations can be retried", 409);
    }
    return this.processCancellation(cancellationId, actor);
  }

  async handleProviderRefundWebhook(entity = {}, eventType, actor = {}) {
    const cancellationId = entity.notes?.cancellationId ||
      (String(entity.notes?.returnId || "").startsWith("cancellation:")
        ? String(entity.notes.returnId).slice("cancellation:".length)
        : null);
    let cancellation = cancellationId
      ? await this.cancellationRepository.findById(cancellationId)
      : await this.cancellationRepository.findByProviderRefundId(entity.id);
    if (!cancellation) return { ignored: true };

    if (eventType === "refund.failed" || entity.status === "failed") {
      return this.cancellationRepository.update(cancellation.id, {
        status: "failed",
        refundStatus: "failed",
        providerRefundId: entity.id,
        lastError: entity.error_description || entity.error_reason || "Provider refund failed",
        metadata: { providerRefundWebhook: entity },
      });
    }

    cancellation = await this.cancellationRepository.update(cancellation.id, {
      refundStatus: eventType === "refund.processed" || entity.status === "processed" ? "completed" : "provider_pending",
      providerRefundId: entity.id,
      metadata: { providerRefundWebhook: entity },
    });
    if (cancellation.refund_status !== "completed" || cancellation.status === "processing") return cancellation;

    const order = await this.orderRepository.findByIdWithItems(cancellation.order_id);
    if (!order) throw new AppError("Order not found", 404);
    const creditNote = await this.createCreditNoteIfRequired(cancellation, actor);
    const financeResult = await this.processSellerFinance(cancellation, actor);
    await this.syncPaymentState(cancellation, order, "completed");
    if (cancellation.scope === "full" && order.payment_status !== PAYMENT_STATUS.REFUNDED) {
      await this.orderRepository.updateStatus(order.id, ORDER_STATUS.CANCELLED, {
        actorId: actor.userId,
        actorRole: actor.role,
        reason: "provider_refund_completed",
        paymentStatus: PAYMENT_STATUS.REFUNDED,
        metadata: { cancellationId: cancellation.id, providerRefundId: entity.id },
      });
    }
    const completed = await this.cancellationRepository.update(cancellation.id, {
      status: "completed",
      refundStatus: "completed",
      financeStatus: "completed",
      creditNoteId: creditNote?.id || cancellation.credit_note_id || null,
      completedAt: new Date(),
      metadata: { sellerFinance: financeResult },
    });
    await this.publishCancellationEvent(completed, actor);
    return completed;
  }

  async get(cancellationId, actor = {}) {
    const cancellation = await this.cancellationRepository.findById(cancellationId);
    if (!cancellation) throw new AppError("Cancellation not found", 404);
    if (!this.isAdmin(actor) && String(cancellation.buyer_id) !== String(actor.userId)) {
      const order = await this.orderRepository.findByIdWithItems(cancellation.order_id);
      await this.assertCanCancel(order, cancellation.items || [], actor);
    }
    return cancellation;
  }

  async list(query = {}, actor = {}) {
    if (!this.isAdmin(actor)) {
      if (this.isSeller(actor)) {
        query.sellerId = actor.ownerSellerId || actor.userId;
        query.organizationId = actor.organizationId || null;
      }
      else query.buyerId = actor.userId;
    }
    return this.cancellationRepository.list(query);
  }

  async publishCancellationEvent(cancellation, actor) {
    await eventPublisher.publish(makeEvent(
      DOMAIN_EVENTS.ORDER_CANCELLED_V1,
      {
        cancellationId: cancellation.id,
        cancellationNumber: cancellation.cancellation_number,
        orderId: cancellation.order_id,
        buyerId: cancellation.buyer_id,
        scope: cancellation.scope,
        status: cancellation.status,
        refundStatus: cancellation.refund_status,
        refundAmount: Number(cancellation.refund_amount || 0),
        updatedBy: actor.userId || null,
      },
      { source: "cancellation-module", aggregateId: cancellation.order_id },
    ));
  }
}

module.exports = { CancellationService };
