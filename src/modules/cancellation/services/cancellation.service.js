const crypto = require("crypto");
const { ReturnModel } = require("../../returns/models/return.model");
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
const { CancellationRepository } = require("../repositories/cancellation.repository");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");
const { prorateMoney } = require("../../../shared/domain/quantity-allocation");
const { knex } = require("../../../infrastructure/postgres/postgres-client");

const CANCELLABLE_ORDER_STATUSES = new Set([
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.PAYMENT_FAILED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.PACKED,
  ORDER_STATUS.READY_TO_SHIP,
  ORDER_STATUS.ON_HOLD,
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

  parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return value;
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

  normalizeItems(order, requestedItems = [], returnReservedByItem = new Map()) {
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
      const returnReserved = Number(returnReservedByItem.get(String(orderItem.id)) || 0);
      const remaining = Math.max(
        Number(orderItem.quantity || 0) - Number(orderItem.cancelled_quantity || 0) - returnReserved,
        0,
      );
      const quantity = Number(requested.quantity ?? remaining);
      const itemLabel = orderItem.product_title || orderItem.product_id;
      if (remaining <= 0) {
        const message = returnReserved > 0
          ? `${itemLabel} is already in a return/refund request and cannot be cancelled`
          : `${itemLabel} is already fully cancelled`;
        throw new AppError(message, 409, null, "ITEM_ALREADY_PROCESSED");
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new AppError(`Cancellation quantity for ${itemLabel} must be a positive whole number`, 400);
      }
      if (quantity > remaining) {
        throw new AppError(
          `Only ${remaining} unit${remaining === 1 ? " is" : "s are"} still cancellable for ${itemLabel}`,
          409,
        );
      }
      const itemAmount = prorateMoney(orderItem.line_total, quantity, orderItem.quantity);
      const discountAmount = prorateMoney(orderItem.discount_amount, quantity, orderItem.quantity);
      const taxAmount = prorateMoney(orderItem.tax_amount, quantity, orderItem.quantity);
      const taxBreakup = this.parseJson(orderItem.tax_breakup, {});
      const additionalTaxAmount = prorateMoney(taxBreakup.taxPayableAmount, quantity, orderItem.quantity);
      return {
        orderItemId: orderItem.id,
        productId: orderItem.product_id,
        productTitle: orderItem.product_title,
        variantId: orderItem.variant_id || "",
        variantSku: orderItem.variant_sku || "",
        sellerId: orderItem.seller_id,
        quantity,
        orderedQuantity: Number(orderItem.quantity || 0),
        itemAmount,
        discountAmount,
        taxAmount,
        // Inclusive GST is already part of line_total. Add only tax that was
        // charged separately at checkout so a cancellation cannot refund GST twice.
        refundAmount: this.round(Math.max(itemAmount - discountAmount + additionalTaxAmount, 0)),
      };
    });
  }

  async getReturnReservedQuantities(orderId) {
    const returns = await ReturnModel.find({
      orderId,
      status: { $nin: ["rejected", "qc_failure_upheld"] },
    }).lean();
    const quantities = new Map();
    returns.forEach((returnRequest) => {
      const status = String(returnRequest.status || "").toLowerCase();
      const refundStatus = String(returnRequest.refund?.status || "").toLowerCase();
      if (status === "closed" && !["completed", "not_required"].includes(refundStatus)) return;
      (returnRequest.items || []).forEach((item) => {
        if (!item.orderItemId) return;
        const key = String(item.orderItemId);
        const quantity = Number(
          item.receivedQuantity || item.approvedQuantity || item.requestedQuantity || item.quantity || 0,
        );
        quantities.set(key, (quantities.get(key) || 0) + Math.max(quantity, 0));
      });
    });
    return quantities;
  }

  isFullCancellation(order, items) {
    const cancelledByItem = new Map(items.map((item) => [String(item.orderItemId), Number(item.quantity || 0)]));
    return (order.items || []).every((item) => {
      const remaining = Number(item.quantity || 0) - Number(item.cancelled_quantity || 0);
      return Number(cancelledByItem.get(String(item.id)) || 0) === remaining;
    });
  }

  calculateRefund(order, items, payment, fullCancellation = false, additionalRefundAmount = 0) {
    const itemRefundAmount = this.round(items.reduce((sum, item) => sum + item.refundAmount, 0));
    const itemBase = items.reduce((sum, item) => sum + item.itemAmount, 0);
    const proportion = Number(order.subtotal_amount || 0) > 0
      ? Math.min(itemBase / Number(order.subtotal_amount), 1)
      : 0;
    const refundAmount = this.round(
      itemRefundAmount +
      Number(order.cod_charge_amount || 0) * proportion +
      Number(additionalRefundAmount || 0),
    );
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
    const rtoSettlement = payload.source === "shipment_rto";
    if (rtoSettlement && !this.isAdmin(actor)) {
      throw new AppError("Only the system or an admin can finalize an RTO settlement", 403);
    }
    // Resolve retries before validating quantities. The original request may
    // already have increased cancelled_quantity, making its payload look stale.
    if (payload.idempotencyKey) {
      const existing = await this.cancellationRepository.findByIdempotencyKey(payload.idempotencyKey);
      if (existing) {
        const sameOrder = String(existing.order_id) === String(orderId);
        const sameRequester = String(existing.requested_by || "") === String(actor.userId || "");
        if (!sameOrder || (!sameRequester && !this.isAdmin(actor))) {
          throw new AppError("Cancellation request key is already in use", 409);
        }
        return rtoSettlement && existing.status !== "completed"
          ? this.processCancellation(existing.id, actor)
          : existing;
      }
    }
    // A multi-seller parent order can already be `shipped` because another
    // seller handed over their package. Seller cancellation eligibility must
    // therefore be decided from the affected seller shipment(s), which is
    // enforced by assertShipmentsCancellable below. This also repairs legacy
    // shipments that were directly marked cancelled before the cancellation
    // workflow was introduced.
    if (!rtoSettlement && !this.isSeller(actor) && !CANCELLABLE_ORDER_STATUSES.has(order.status)) {
      throw new AppError("Order cannot be cancelled after shipment handover. Use return or RTO flow.", 409);
    }
    let requestedItems = payload.items || [];
    if (rtoSettlement && requestedItems.length === 0) {
      requestedItems = (order.items || [])
        .filter((item) =>
          String(item.seller_id || "") === String(payload.sellerId || "") &&
          String(item.organization_id || "default") === String(payload.organizationId || "default"),
        )
        .map((item) => ({
          orderItemId: item.id,
          quantity: Number(item.quantity || 0) - Number(item.cancelled_quantity || 0),
        }))
        .filter((item) => item.quantity > 0);
      if (!requestedItems.length) {
        throw new AppError("No active order items were found for the RTO shipment", 409);
      }
    }
    if (this.isSeller(actor) && requestedItems.length === 0) {
      const sellerId = String(actor.ownerSellerId || actor.userId);
      requestedItems = (order.items || [])
        .filter((item) => String(item.seller_id) === sellerId)
        .map((item) => ({
          orderItemId: item.id,
          quantity: Number(item.quantity || 0) - Number(item.cancelled_quantity || 0),
        }))
        .filter((item) => item.quantity > 0);
      if (requestedItems.length === 0) {
        throw new AppError("There are no active items from this seller to cancel", 409);
      }
    }
    const returnReservedByItem = await this.getReturnReservedQuantities(orderId);
    const items = this.normalizeItems(order, requestedItems, returnReservedByItem);
    await this.assertCanCancel(order, items, actor);
    const fullCancellation = this.isFullCancellation(order, items);
    const payment = await this.orderRepository.findRefundablePaymentByOrderId(orderId);
    const commerceSettings = await commerceSettingsService.getSettings();
    const componentPolicies = commerceSettings.returns?.refundPolicy || {};
    const scenario = rtoSettlement
      ? "rtoDeliveryFailed"
      : this.isSeller(actor)
        ? "sellerCancellation"
        : fullCancellation
          ? "fullCancellation"
          : "itemCancellation";
    const shippingRefundEnabled = componentPolicies.shipping?.[scenario] === true;
    const platformFeeRefundEnabled = componentPolicies.platformFee?.[scenario] === true;
    const shippingRefundAmount = shippingRefundEnabled
      ? fullCancellation
        ? this.round(order.shipping_fee_amount || order.summary?.shippingFeeAmount || 0)
        : this.getCompletedSellerGroupShippingAmount(order, items)
      : 0;
    const itemBase = items.reduce((sum, item) => sum + Number(item.itemAmount || 0), 0);
    const proportion = Number(order.subtotal_amount || 0) > 0
      ? Math.min(itemBase / Number(order.subtotal_amount), 1)
      : 0;
    const platformFeeRefundAmount = platformFeeRefundEnabled
      ? this.round(this.getCustomerPlatformFeeAmount(order) * proportion)
      : 0;
    const refund = this.calculateRefund(
      order,
      items,
      payment,
      fullCancellation,
      shippingRefundAmount + platformFeeRefundAmount,
    );
    const idempotencyKey = this.makeIdempotencyKey(orderId, items, payload, actor);
    const existing = await this.cancellationRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return rtoSettlement && existing.status !== "completed"
        ? this.processCancellation(existing.id, actor)
        : existing;
    }

    if (rtoSettlement) {
      this.assertRtoShipment(order, payload);
    } else {
      await this.assertShipmentsCancellable(order, items);
    }
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
      metadata: {
        fullCancellation,
        sellerSupplyCancellation: rtoSettlement,
        reverseSellerShipping: rtoSettlement,
        rtoSettlement,
        shipmentId: payload.shipmentId || null,
        shippingRefundAmount,
        platformFeeRefundAmount,
        refundPolicyScenario: scenario,
        refundPolicySnapshot: componentPolicies,
        requestedAt: new Date().toISOString(),
      },
    });
    return this.processCancellation(cancellation.id, actor);
  }

  async reconcileRtoSettlements({ limit = 100 } = {}) {
    const rows = await knex("shipments as s")
      .leftJoin("order_cancellations as c", function joinRtoCancellation() {
        this.on("c.order_id", "=", "s.order_id")
          .andOn(knex.raw("c.metadata ->> 'shipmentId' = s.id::text"));
      })
      .where("s.status", "rto")
      .where((builder) =>
        builder.whereNull("c.id").orWhereNot("c.status", "completed"),
      )
      .select(
        "s.id as shipment_id",
        "s.order_id",
        "s.seller_id",
        knex.raw("COALESCE(s.organization_id::text, s.metadata->>'organizationId') as organization_id"),
      )
      .orderBy("s.updated_at", "asc")
      .limit(Math.min(Math.max(Number(limit || 100), 1), 500));

    const processed = [];
    const failed = [];
    for (const row of rows) {
      try {
        const cancellation = await this.cancelOrder(row.order_id, {
          source: "shipment_rto",
          shipmentId: row.shipment_id,
          sellerId: row.seller_id,
          organizationId: row.organization_id || null,
          reasonCode: "shipment_rto",
          reason: "Shipment returned to origin",
          idempotencyKey: `shipment-rto:${row.shipment_id}`,
        }, {
          userId: "rto-reconciliation",
          role: "super-admin",
        });
        processed.push({
          shipmentId: row.shipment_id,
          cancellationId: cancellation?.id || null,
          status: cancellation?.status || null,
        });
      } catch (error) {
        failed.push({ shipmentId: row.shipment_id, error: error.message });
      }
    }
    return { scanned: rows.length, processed, failed };
  }

  getSellerShippingAmount(order = {}, sellerId, organizationId = null) {
    const metadata = this.parseJson(order.metadata, {});
    const entries = Array.isArray(metadata.deliveryCharge?.sellers)
      ? metadata.deliveryCharge.sellers
      : [];
    const match = entries.find((entry) =>
      String(entry.sellerId || "") === String(sellerId || "") &&
      String(entry.organizationId || "default") === String(organizationId || "default"),
    );
    return this.round(match?.chargeAmount || 0);
  }

  getCustomerPlatformFeeAmount(order = {}) {
    const metadata = this.parseJson(order.metadata, {});
    return this.round(
      order.summary?.customerPlatformFeeAmount ??
      metadata.pricingSummary?.customerPlatformFeeAmount ??
      metadata.pricingSummary?.customerPlatformFee ??
      0,
    );
  }

  getCompletedSellerGroupShippingAmount(order = {}, cancellationItems = []) {
    const cancelledByItem = new Map(
      cancellationItems.map((item) => [String(item.orderItemId), Number(item.quantity || 0)]),
    );
    const completedGroups = new Set();
    for (const item of cancellationItems) {
      const orderItem = (order.items || []).find((entry) => String(entry.id) === String(item.orderItemId));
      if (!orderItem) continue;
      const sellerId = String(orderItem.seller_id || item.sellerId || "");
      const organizationId = String(orderItem.organization_id || "default");
      const groupItems = (order.items || []).filter((entry) =>
        String(entry.seller_id || "") === sellerId &&
        String(entry.organization_id || "default") === organizationId,
      );
      const groupCompletes = groupItems.length > 0 && groupItems.every((entry) => {
        const remaining = Number(entry.quantity || 0) - Number(entry.cancelled_quantity || 0);
        return Number(cancelledByItem.get(String(entry.id)) || 0) === remaining;
      });
      if (groupCompletes) completedGroups.add(`${sellerId}:${organizationId}`);
    }
    return this.round([...completedGroups].reduce((sum, key) => {
      const separator = key.lastIndexOf(":");
      return sum + this.getSellerShippingAmount(order, key.slice(0, separator), key.slice(separator + 1));
    }, 0));
  }

  assertRtoShipment(order = {}, payload = {}) {
    const shipment = (order.relations?.shipments || []).find((entry) =>
      String(entry.id || "") === String(payload.shipmentId || ""),
    );
    if (!shipment || String(shipment.status || "") !== "rto") {
      throw new AppError("RTO settlement requires a shipment in RTO status", 409);
    }
    if (
      String(shipment.seller_id || "") !== String(payload.sellerId || "") ||
      String(shipment.organization_id || "default") !== String(payload.organizationId || "default")
    ) {
      throw new AppError("RTO shipment does not match the seller fulfillment group", 409);
    }
  }

  async assertShipmentsCancellable(order, items) {
    const sellerIds = new Set(items.map((item) => String(item.sellerId)));
    const shipments = (order.relations?.shipments || []).filter((shipment) => sellerIds.has(String(shipment.seller_id)) && shipment.direction !== "reverse");
    if (!shipments.length && !CANCELLABLE_ORDER_STATUSES.has(order.status)) {
      throw new AppError("Order cannot be cancelled after shipment handover. Use return or RTO flow.", 409);
    }
    const blocked = shipments.find((shipment) => !CANCELLABLE_SHIPMENT_STATUSES.has(shipment.status));
    if (blocked) throw new AppError("Cancellation is blocked because a shipment was handed to the courier", 409);
  }

  shipmentOrderItems(order = {}, shipment = {}) {
    const metadata = this.parseJson(shipment.metadata, {});
    const shipmentItemIds = new Set(
      (Array.isArray(metadata.orderItemIds) ? metadata.orderItemIds : []).map(String),
    );
    if (shipmentItemIds.size) {
      return (order.items || []).filter((item) => shipmentItemIds.has(String(item.id)));
    }
    return (order.items || []).filter(
      (item) => String(item.seller_id) === String(shipment.seller_id),
    );
  }

  cancellationCompletesShipment(order = {}, shipment = {}, cancellationItems = []) {
    const selected = new Map(
      cancellationItems.map((item) => [String(item.orderItemId), Number(item.quantity || 0)]),
    );
    const shipmentItems = this.shipmentOrderItems(order, shipment);
    return shipmentItems.length > 0 && shipmentItems.every((item) => {
      const activeQuantity = Math.max(
        Number(item.quantity || 0) - Number(item.cancelled_quantity || 0),
        0,
      );
      return activeQuantity <= Number(selected.get(String(item.id)) || 0);
    });
  }

  async cancelShipments(order, cancellation, actor) {
    const sellerIds = new Set((cancellation.items || []).map((item) => String(item.sellerId)));
    const shipments = (order.relations?.shipments || []).filter((shipment) =>
      sellerIds.has(String(shipment.seller_id)) && shipment.direction !== "reverse" && shipment.status !== "cancelled",
    );
    const completedShipments = shipments.filter((shipment) =>
      this.cancellationCompletesShipment(order, shipment, cancellation.items || []),
    );
    for (const shipment of completedShipments) {
      await this.deliveryRepository.addTrackingEvent(shipment.id, {
        status: "cancelled",
        note: cancellation.reason,
        source: "order_cancellation",
        actorId: actor.userId,
        idempotencyKey: `cancellation:${cancellation.id}:shipment:${shipment.id}`,
        rawPayload: { cancellationId: cancellation.id },
      });
    }
    return completedShipments.length ? "cancelled" : "not_required";
  }

  async processCancellation(cancellationId, actor = {}) {
    let cancellation = await this.cancellationRepository.findById(cancellationId);
    if (!cancellation) throw new AppError("Cancellation not found", 404);
    if (cancellation.status === "completed") return cancellation;
    const order = await this.orderRepository.findByIdWithItems(cancellation.order_id);
    if (!order) throw new AppError("Order not found", 404);
    const commerceSettings = await commerceSettingsService.getSettings();
    const refundPolicy = commerceSettings.payments?.refundPolicy || "manual_review";
    const requiresManualRefundReview = refundPolicy === "manual_review";
    const attempt = { attemptId: uuidv4(), startedAt: new Date().toISOString(), status: "processing" };
    const attempts = [...(cancellation.attempts || []), attempt];
    cancellation = await this.cancellationRepository.update(cancellation.id, {
      status: "processing", attempts, lastError: null,
    });

    try {
      if (cancellation.metadata?.rtoSettlement) {
        if (cancellation.shipment_status !== "completed") {
          cancellation = await this.cancellationRepository.update(cancellation.id, {
            shipmentStatus: "completed",
          });
        }
      } else if (!["cancelled", "not_required", "completed"].includes(cancellation.shipment_status)) {
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

      if (!requiresManualRefundReview && !cancellation.metadata?.walletProcessed) {
        await this.processWallet(cancellation, order, actor);
        cancellation = await this.cancellationRepository.update(cancellation.id, {
          metadata: { walletProcessed: true, walletProcessedAt: new Date().toISOString() },
        });
      }
      const refundResult = requiresManualRefundReview && cancellation.refund_status !== "not_required"
        ? { refundStatus: "manual_review", providerRefundId: cancellation.provider_refund_id }
        : ["completed", "not_required"].includes(cancellation.refund_status)
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
          walletProcessed: Boolean(cancellation.metadata?.walletProcessed),
          refundPolicy,
          manualRefundReviewRequired: requiresManualRefundReview,
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
      scope: cancellation.scope,
      cancellationScope: cancellation.scope,
      sellerSupplyCancellation: Boolean(cancellation.metadata?.sellerSupplyCancellation),
      refundBreakup: {
        shippingRefund: Number(cancellation.metadata?.shippingRefundAmount || 0),
        platformFeeRefund: Number(cancellation.metadata?.platformFeeRefundAmount || 0),
      },
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
        reverseSellerShipping: Boolean(cancellation.metadata?.reverseSellerShipping),
      },
    }, actor);
  }

  async completeManualRefund(cancellationId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can confirm manual refunds", 403);
    const cancellation = await this.cancellationRepository.findById(cancellationId);
    if (!cancellation) throw new AppError("Cancellation not found", 404);
    if (cancellation.refund_status === "completed") {
      throw new AppError("This cancellation has already been refunded", 409, null, "REFUND_ALREADY_COMPLETED");
    }
    if (cancellation.refund_status !== "manual_review") throw new AppError("Cancellation is not awaiting a manual refund", 409);
    const order = await this.orderRepository.findByIdWithItems(cancellation.order_id);
    if (!order) throw new AppError("Order not found", 404);
    if (!cancellation.metadata?.walletProcessed && Number(cancellation.wallet_refund_amount || 0) > 0) {
      await this.processWallet(cancellation, order, actor);
    }
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
        walletProcessed: Number(cancellation.wallet_refund_amount || 0) > 0 || Boolean(cancellation.metadata?.walletProcessed),
        walletProcessedAt: Number(cancellation.wallet_refund_amount || 0) > 0 ? new Date().toISOString() : cancellation.metadata?.walletProcessedAt,
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

  async reconcileProviderRefunds({ limit = 100 } = {}) {
    const rows = await this.cancellationRepository.findProviderRefundsForReconciliation({ limit });
    const result = { scanned: rows.length, completed: 0, pending: 0, failed: 0, errors: [] };
    const actor = { userId: "system", role: "system", isSuperAdmin: true };

    for (const cancellation of rows) {
      try {
        const providerRefund = await this.razorpayProvider.fetchRefund(cancellation.provider_refund_id);
        const entity = {
          ...(providerRefund.metadata || {}),
          id: providerRefund.refundId || cancellation.provider_refund_id,
          status: providerRefund.status,
          error_description: providerRefund.failureReason || null,
        };
        if (providerRefund.status === "failed") {
          await this.handleProviderRefundWebhook(entity, "refund.failed", actor);
          result.failed += 1;
        } else if (["processed", "completed"].includes(providerRefund.status)) {
          await this.handleProviderRefundWebhook(entity, "refund.processed", actor);
          result.completed += 1;
        } else {
          await this.handleProviderRefundWebhook(entity, "refund.pending", actor);
          result.pending += 1;
        }
      } catch (error) {
        result.errors.push({ cancellationId: cancellation.id, message: String(error.message || error) });
      }
    }
    return result;
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
    if (this.isSeller(actor)) {
      return this.scopeForSeller(cancellation, actor.ownerSellerId || actor.userId);
    }
    return cancellation;
  }

  scopeForSeller(cancellation = {}, sellerId) {
    const sellerKey = String(sellerId || "");
    const items = (cancellation.items || []).filter((item) => String(item.sellerId || item.seller_id || "") === sellerKey);
    const sellerCancelledValue = this.round(items.reduce(
      (sum, item) => sum + Math.max(
        0,
        Number(item.itemAmount || item.item_amount || 0) - Number(item.discountAmount || item.discount_amount || 0),
      ),
      0,
    ));
    const metadata = cancellation.metadata || {};
    const sellerFinance = metadata.sellerFinance || {};
    const adjustments = Array.isArray(sellerFinance.adjustments)
      ? sellerFinance.adjustments.filter((adjustment) => String(adjustment.sellerId || adjustment.seller_id || "") === sellerKey)
      : [];

    return {
      ...cancellation,
      items,
      // Seller APIs expose only this seller's commercial value. Complete order
      // and other-seller refund amounts remain admin/customer data.
      refund_amount: sellerCancelledValue,
      wallet_refund_amount: 0,
      provider_refund_amount: 0,
      provider_refund_id: null,
      payment_id: null,
      seller_scoped: true,
      seller_id: sellerKey,
      seller_cancelled_value: sellerCancelledValue,
      metadata: {
        fullCancellation: Boolean(metadata.fullCancellation),
        sellerFinance: { ...sellerFinance, adjustments },
      },
    };
  }

  async list(query = {}, actor = {}) {
    if (!this.isAdmin(actor)) {
      if (this.isSeller(actor)) query.sellerId = actor.ownerSellerId || actor.userId;
      else query.buyerId = actor.userId;
    }
    const result = await this.cancellationRepository.list(query);
    if (this.isSeller(actor)) {
      const sellerId = actor.ownerSellerId || actor.userId;
      return { ...result, items: result.items.map((item) => this.scopeForSeller(item, sellerId)) };
    }
    return result;
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
