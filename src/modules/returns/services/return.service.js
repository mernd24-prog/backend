const { ReturnModel } = require("../models/return.model");
const { logger } = require("../../../shared/logger/logger");
const { AppError } = require("../../../shared/errors/app-error");
const { ORDER_STATUS } = require("../../../shared/domain/commerce-constants");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { WalletService } = require("../../wallet/services/wallet.service");
const { InventoryService } = require("../../inventory/services/inventory.service");
const { TaxService } = require("../../tax/services/tax.service");
const { CommissionService } = require("../../seller/services/commission.service");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");

const VALID_TRANSITIONS = {
  requested: ["approved", "rejected", "closed"],
  approved: ["reverse_pickup_scheduled", "manual_ship_back", "received", "closed"],
  reverse_pickup_scheduled: ["received", "closed"],
  manual_ship_back: ["shipped_back", "received", "closed"],
  shipped_back: ["received", "closed"],
  received: ["qc_passed", "qc_failed", "closed"],
  qc_passed: ["refunded", "replaced", "closed"],
  qc_failed: ["closed"],
  refunded: ["closed"],
  replaced: ["closed"],
  rejected: ["closed"],
};

class ReturnServiceClass {
  constructor({
    orderRepository = new OrderRepository(),
    walletService = new WalletService(),
    inventoryService = new InventoryService(),
    taxService = new TaxService({ orderRepository }),
    commissionService = CommissionService,
  } = {}) {
    this.orderRepository = orderRepository;
    this.walletService = walletService;
    this.inventoryService = inventoryService;
    this.taxService = taxService;
    this.commissionService = commissionService;
  }

  async getReturnOrThrow(returnId) {
    const returnRequest = await ReturnModel.findById(returnId);
    if (!returnRequest) throw new AppError("Return not found", 404);
    return returnRequest;
  }

  validateTransition(current, next) {
    if (current === next) return;
    if (!VALID_TRANSITIONS[current]?.includes(next)) {
      throw new AppError(`Invalid return status transition from ${current} to ${next}`, 409);
    }
  }

  isAdmin(actor = {}) {
    return ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
  }

  isSeller(actor = {}) {
    return ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);
  }

  async assertCanView(returnRequest, actor) {
    if (this.isAdmin(actor) || returnRequest.buyerId === actor.userId) return;
    if (this.isSeller(actor)) {
      const sellerId = actor.ownerSellerId || actor.userId;
      const isSellerInOrder = await this.orderRepository.isSellerInOrder(returnRequest.orderId, sellerId);
      if (isSellerInOrder) return;
    }
    throw new AppError("You are not allowed to view this return", 403);
  }

  async assertCanManage(returnRequest, actor) {
    if (this.isAdmin(actor)) return;
    if (this.isSeller(actor)) {
      const sellerId = actor.ownerSellerId || actor.userId;
      const isSellerInOrder = await this.orderRepository.isSellerInOrder(returnRequest.orderId, sellerId);
      if (isSellerInOrder) return;
    }
    throw new AppError("You are not allowed to manage this return", 403);
  }

  appendTimeline(returnRequest, status, actor = {}, payload = {}) {
    returnRequest.timeline.push({
      status,
      actorId: actor.userId || null,
      actorRole: actor.role || null,
      reason: payload.reason || null,
      note: payload.note || payload.notes || null,
      metadata: payload.metadata || {},
      at: new Date(),
    });
  }

  async requestReturn(orderId, buyerId, items, reason, description, actor = {}, extra = {}) {
    if (!items || items.length === 0) throw new AppError("Return items required", 400);

    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) throw new AppError("Order not found", 404);
    if (order.buyer_id !== buyerId) throw new AppError("You can request return only for your order", 403);
    if (![ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED].includes(order.status)) {
      throw new AppError("Only delivered orders are eligible for return", 409);
    }

    const orderItems = order.items || [];
    const existingReturns = await ReturnModel.find({
      orderId,
      status: { $nin: ["rejected", "closed"] },
    }).lean();

    const normalizedItems = items.map((item) => {
      const orderItem = orderItems.find((candidate) =>
        String(candidate.product_id) === String(item.productId) &&
        (!item.variantSku || String(candidate.variant_sku || "") === String(item.variantSku || "")),
      );
      if (!orderItem) throw new AppError(`Product ${item.productId} is not part of this order`, 400);

      const alreadyReturned = existingReturns.reduce((sum, returnDoc) => {
        const matched = (returnDoc.items || []).find((candidate) =>
          String(candidate.productId) === String(item.productId) &&
          (!item.variantSku || String(candidate.variantSku || "") === String(item.variantSku || "")),
        );
        return sum + Number(matched?.quantity || 0);
      }, 0);
      const availableQty = Number(orderItem.quantity || 0) - alreadyReturned;
      if (Number(item.quantity || 0) > availableQty) {
        throw new AppError(`Return quantity exceeds eligible quantity for ${item.productId}`, 400);
      }

      const unitPrice = Number(item.unitPrice || orderItem.unit_price || 0);
      const lineTotal = Number((unitPrice * Number(item.quantity || 0)).toFixed(2));
      return {
        productId: item.productId,
        sellerId: orderItem.seller_id || orderItem.sellerId || "",
        variantId: item.variantId || orderItem.variant_id || "",
        variantSku: item.variantSku || orderItem.variant_sku || "",
        quantity: Number(item.quantity),
        unitPrice,
        lineTotal,
        taxAmount: Number(item.taxAmount || 0),
        refundAmount: Number(item.refundAmount || lineTotal),
        photos: item.photos || [],
      };
    });

    const refundBreakup = this.calculateRefundBreakup(normalizedItems, order);
    const returnRequest = await ReturnModel.create({
      orderId,
      buyerId,
      items: normalizedItems,
      reason,
      description,
      photos: extra.photos || [],
      status: "requested",
      refundAmount: refundBreakup.totalRefundAmount,
      refundBreakup,
      timeline: [{
        status: "requested",
        actorId: actor.userId || buyerId,
        actorRole: actor.role || "buyer",
        reason,
        note: description || null,
        metadata: {},
        at: new Date(),
      }],
    });

    logger.info({ orderId, returnId: returnRequest._id }, "Return requested");
    await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_REQUESTED_V1, returnRequest, actor);
    return returnRequest;
  }

  calculateRefundBreakup(items, order) {
    const itemSubtotal = Number(items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0).toFixed(2));
    const orderSubtotal = Number(order.subtotal_amount || 0);
    const orderTax = Number(order.tax_amount || 0);
    const orderDiscount = Number(order.discount_amount || 0);
    const proportion = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
    const discountReversal = Number((orderDiscount * proportion).toFixed(2));
    const taxReversal = Number((orderTax * proportion).toFixed(2));
    const totalRefundAmount = Number((itemSubtotal - discountReversal + taxReversal).toFixed(2));
    return {
      itemSubtotal,
      discountReversal,
      taxReversal,
      shippingRefund: 0,
      walletRefundAmount: 0,
      originalPaymentRefundAmount: totalRefundAmount,
      totalRefundAmount,
    };
  }

  async approveReturn(returnId, refundAmount, actor = {}, payload = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    this.validateTransition(returnRequest.status, "approved");
    returnRequest.status = "approved";
    if (refundAmount) returnRequest.refundAmount = Number(refundAmount);
    returnRequest.approvedAt = new Date();
    this.appendTimeline(returnRequest, "approved", actor, payload);
    await returnRequest.save();
    await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_APPROVED_V1, returnRequest, actor);
    return returnRequest;
  }

  async rejectReturn(returnId, reason, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    this.validateTransition(returnRequest.status, "rejected");
    returnRequest.status = "rejected";
    returnRequest.notes = reason;
    returnRequest.rejectedAt = new Date();
    this.appendTimeline(returnRequest, "rejected", actor, { reason });
    await returnRequest.save();
    await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_REJECTED_V1, returnRequest, actor, { reason });
    return returnRequest;
  }

  async scheduleReversePickup(returnId, payload, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    const nextStatus = payload.trackingNumber ? "manual_ship_back" : "reverse_pickup_scheduled";
    this.validateTransition(returnRequest.status, nextStatus);
    returnRequest.status = nextStatus;
    returnRequest.trackingNumber = payload.trackingNumber || returnRequest.trackingNumber;
    this.appendTimeline(returnRequest, nextStatus, actor, payload);
    await returnRequest.save();
    return returnRequest;
  }

  async shipReturnBack(returnId, trackingNumber, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanView(returnRequest, actor);
    this.validateTransition(returnRequest.status, "shipped_back");
    returnRequest.status = "shipped_back";
    returnRequest.trackingNumber = trackingNumber;
    this.appendTimeline(returnRequest, "shipped_back", actor, { metadata: { trackingNumber } });
    await returnRequest.save();
    return returnRequest;
  }

  async receiveReturn(returnId, notes, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    this.validateTransition(returnRequest.status, "received");
    returnRequest.status = "received";
    returnRequest.notes = notes;
    returnRequest.receivedAt = new Date();
    this.appendTimeline(returnRequest, "received", actor, { note: notes });
    await returnRequest.save();
    await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_RECEIVED_V1, returnRequest, actor);
    return returnRequest;
  }

  async qcReturn(returnId, payload, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    const nextStatus = payload.passed ? "qc_passed" : "qc_failed";
    this.validateTransition(returnRequest.status, nextStatus);
    returnRequest.status = nextStatus;
    returnRequest.qcAt = new Date();
    returnRequest.items = returnRequest.items.map((item) => ({
      ...item.toObject?.() || item,
      condition: payload.condition || (payload.passed ? "sellable" : "damaged"),
    }));
    this.appendTimeline(returnRequest, nextStatus, actor, payload);
    if (payload.passed) {
      await this.inventoryService.restockForReturn(returnRequest, actor);
    } else {
      await this.inventoryService.recordReturnDamage(returnRequest, actor, {
        condition: payload.condition || "damaged",
        notes: payload.notes || "",
      });
    }
    await returnRequest.save();
    return returnRequest;
  }

  async processRefund(returnId, actor = {}, payload = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    if (returnRequest.refundedAt) return returnRequest;
    this.validateTransition(returnRequest.status, "refunded");

    const refundAmount = Number(payload.refundAmount || returnRequest.refundAmount || returnRequest.refundBreakup?.totalRefundAmount || 0);
    if (refundAmount <= 0) throw new AppError("Invalid refund amount", 400);

    const referenceId = payload.referenceId || `return_${returnRequest._id}`;
    try {
      await this.walletService.credit(returnRequest.buyerId, refundAmount, {
        referenceType: "return_refund",
        referenceId,
        metadata: {
          returnId: String(returnRequest._id),
          orderId: returnRequest.orderId,
          method: payload.method || "wallet_fallback",
        },
      });
    } catch (error) {
      await this.publishReturnEvent(DOMAIN_EVENTS.REFUND_FAILED_V1, returnRequest, actor, {
        refundAmount,
        referenceId,
        reason: error.message,
      });
      throw error;
    }

    await this.createCreditNoteSafely(returnRequest, refundAmount, actor, referenceId);
    await this.recordSellerRefundAdjustmentSafely(returnRequest, refundAmount, actor);

    returnRequest.status = "refunded";
    returnRequest.refundAmount = refundAmount;
    returnRequest.refundReferenceId = referenceId;
    returnRequest.refundMethod = payload.method || "wallet_fallback";
    returnRequest.refundedAt = new Date();
    this.appendTimeline(returnRequest, "refunded", actor, {
      note: payload.note,
      metadata: { refundAmount, referenceId },
    });
    await returnRequest.save();
    await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_REFUNDED_V1, returnRequest, actor, {
      refundAmount,
      referenceId,
      method: returnRequest.refundMethod,
    });
    await this.publishReturnEvent(DOMAIN_EVENTS.REFUND_PROCESSED_V1, returnRequest, actor, {
      refundAmount,
      referenceId,
      method: returnRequest.refundMethod,
    });
    return returnRequest;
  }

  async recordSellerRefundAdjustmentSafely(returnRequest, refundAmount, actor) {
    try {
      await this.commissionService.recordRefundAdjustment(returnRequest, refundAmount, actor);
    } catch (error) {
      logger.warn({ returnId: returnRequest._id, error: error.message }, "Seller refund adjustment skipped");
    }
  }

  async createCreditNoteSafely(returnRequest, refundAmount, actor, referenceId) {
    try {
      await this.taxService.createCreditNote({
        orderId: returnRequest.orderId,
        referenceType: "return",
        referenceId,
        taxableAmount: Number(returnRequest.refundBreakup?.itemSubtotal || refundAmount),
        taxAmount: Number(returnRequest.refundBreakup?.taxReversal || 0),
        totalAmount: refundAmount,
        reason: returnRequest.reason,
        metadata: {
          returnId: String(returnRequest._id),
          actorId: actor.userId || null,
        },
      });
    } catch (error) {
      logger.warn({ returnId: returnRequest._id, error: error.message }, "Credit note creation skipped");
    }
  }

  async createReplacement(returnId, payload, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    this.validateTransition(returnRequest.status, "replaced");
    returnRequest.status = "replaced";
    returnRequest.replacementOrderId = payload.replacementOrderId || "";
    returnRequest.replacementShipmentId = payload.replacementShipmentId || "";
    this.appendTimeline(returnRequest, "replaced", actor, payload);
    await returnRequest.save();
    return returnRequest;
  }

  async closeReturn(returnId, payload, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    this.validateTransition(returnRequest.status, "closed");
    returnRequest.status = "closed";
    returnRequest.closedAt = new Date();
    this.appendTimeline(returnRequest, "closed", actor, payload);
    await returnRequest.save();
    return returnRequest;
  }

  async getReturnsByBuyer(buyerId) {
    return ReturnModel.find({ buyerId }).sort({ createdAt: -1 }).lean();
  }

  async getReturnById(returnId, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanView(returnRequest, actor);
    return returnRequest.toObject();
  }

  async getReturnByOrder(orderId, actor = {}) {
    const returnRequest = await ReturnModel.findOne({ orderId }).sort({ createdAt: -1 });
    if (!returnRequest) return null;
    await this.assertCanView(returnRequest, actor);
    return returnRequest.toObject();
  }

  async listReturns(query = {}, actor = {}) {
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.orderId) filter.orderId = query.orderId;
    if (query.buyerId) filter.buyerId = query.buyerId;
    if (query.reason) filter.reason = query.reason;
    if (query.fromDate || query.toDate) {
      filter.createdAt = {};
      if (query.fromDate) filter.createdAt.$gte = new Date(query.fromDate);
      if (query.toDate) filter.createdAt.$lte = new Date(query.toDate);
    }
    if (query.search) {
      const search = new RegExp(String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ orderId: search }, { buyerId: search }, { reason: search }, { trackingNumber: search }];
    }
    if (!this.isAdmin(actor) && this.isSeller(actor)) {
      // Seller scoping is enforced on detail/actions; list is narrowed only when sellerId is passed.
      if (query.sellerId) filter["items.sellerId"] = query.sellerId;
    }
    if (!this.isAdmin(actor) && !this.isSeller(actor)) filter.buyerId = actor.userId;
    const limit = Math.min(Number(query.limit || 50), 200);
    const offset = Number(query.offset || 0);
    const [items, total] = await Promise.all([
      ReturnModel.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      ReturnModel.countDocuments(filter),
    ]);
    return { items, total, limit, offset };
  }

  async publishReturnEvent(eventName, returnRequest, actor = {}, extra = {}) {
    await eventPublisher.publish(
      makeEvent(
        eventName,
        {
          returnId: String(returnRequest._id || returnRequest.id),
          orderId: returnRequest.orderId,
          buyerId: returnRequest.buyerId,
          status: returnRequest.status,
          reason: returnRequest.reason,
          updatedBy: actor.userId || null,
          actorRole: actor.role || null,
          ...extra,
        },
        { source: "returns-module", aggregateId: returnRequest.orderId },
      ),
    );
  }
}

const ReturnService = new ReturnServiceClass();

module.exports = { ReturnService, ReturnServiceClass };
