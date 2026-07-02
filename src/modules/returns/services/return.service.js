const { v4: uuidv4 } = require("uuid");
const { ReturnModel } = require("../models/return.model");
const { logger } = require("../../../shared/logger/logger");
const { AppError } = require("../../../shared/errors/app-error");
const { ORDER_STATUS, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { WalletService } = require("../../wallet/services/wallet.service");
const { InventoryService } = require("../../inventory/services/inventory.service");
const { TaxService } = require("../../tax/services/tax.service");
const { CommissionService } = require("../../seller/services/commission.service");
const { DeliveryRepository } = require("../../delivery/repositories/delivery.repository");
const { UserModel } = require("../../user/models/user.model");
const { shippingProviderRegistry } = require("../../../infrastructure/shipping/provider-registry");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { RazorpayProvider } = require("../../../infrastructure/payments/providers/razorpay.provider");

const VALID_TRANSITIONS = {
  requested: ["approved", "rejected", "closed"],
  approved: ["reverse_pickup_scheduled", "manual_ship_back", "received", "closed"],
  reverse_pickup_scheduled: ["pickup_failed", "in_reverse_transit", "received", "closed"],
  pickup_failed: ["reverse_pickup_scheduled", "manual_ship_back", "closed"],
  manual_ship_back: ["shipped_back", "in_reverse_transit", "received", "closed"],
  shipped_back: ["in_reverse_transit", "received", "closed"],
  in_reverse_transit: ["pickup_failed", "received", "closed"],
  received: ["qc_passed", "qc_failed", "qc_completed", "closed"],
  qc_passed: ["refund_pending", "replacement_pending", "refunded", "replaced", "closed"],
  qc_completed: ["refund_pending", "replacement_pending", "refunded", "replaced", "closed"],
  qc_failed: ["closed"],
  refund_pending: ["refunded", "refund_failed", "partially_refunded", "closed"],
  refund_failed: ["refund_pending", "refunded", "closed"],
  partially_refunded: ["refund_pending", "refunded", "closed"],
  replacement_pending: ["replaced", "closed"],
  refunded: ["closed"],
  replaced: ["closed"],
  rejected: ["closed"],
};

const RETURN_REASONS = new Set([
  "defective",
  "damaged_in_transit",
  "wrong_item",
  "missing_parts",
  "size_issue",
  "quality_issue",
  "not_as_described",
  "changed_mind",
  "other",
]);

const REVERSE_STATUS_MAP = {
  initiated: "reverse_pickup_scheduled",
  manifested: "reverse_pickup_scheduled",
  pickup_scheduled: "reverse_pickup_scheduled",
  failed: "pickup_failed",
  pickup_failed: "pickup_failed",
  picked_up: "in_reverse_transit",
  in_transit: "in_reverse_transit",
  out_for_delivery: "in_reverse_transit",
  delivered: "received",
  delivered_verified: "received",
  received: "received",
};

class ReturnServiceClass {
  constructor({
    orderRepository = new OrderRepository(),
    walletService = new WalletService(),
    inventoryService = new InventoryService(),
    taxService = new TaxService({ orderRepository }),
    commissionService = CommissionService,
    deliveryRepository = new DeliveryRepository(),
    razorpayProvider = new RazorpayProvider(),
  } = {}) {
    this.orderRepository = orderRepository;
    this.walletService = walletService;
    this.inventoryService = inventoryService;
    this.taxService = taxService;
    this.commissionService = commissionService;
    this.deliveryRepository = deliveryRepository;
    this.razorpayProvider = razorpayProvider;
  }

  parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  round(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  makeReturnNumber() {
    return `RMA-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  getReturnId(returnRequest = {}) {
    return String(returnRequest._id || returnRequest.id || "");
  }

  getReturnMetadata(returnRequest = {}) {
    return {
      returnId: this.getReturnId(returnRequest),
      returnNumber: returnRequest.returnNumber || null,
      sellerId: returnRequest.sellerId || null,
      status: returnRequest.status || null,
    };
  }

  userDisplayName(user = {}) {
    const profileName = [user.profile?.firstName, user.profile?.lastName]
      .filter(Boolean)
      .join(" ");
    return user.sellerProfile?.displayName ||
      user.sellerProfile?.businessName ||
      profileName ||
      user.email ||
      null;
  }

  toReturnUserSummary(user = {}) {
    if (!user?._id) return null;
    const displayName = this.userDisplayName(user);
    return {
      id: String(user._id),
      name: displayName,
      displayName,
      fullName: [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ") || displayName,
      businessName: user.sellerProfile?.businessName || user.sellerProfile?.displayName || null,
      email: user.email || null,
      phone: user.phone || null,
    };
  }

  snapshotDisplayName(snapshot = {}) {
    return snapshot.displayName ||
      snapshot.fullName ||
      snapshot.name ||
      [snapshot.firstName || snapshot.profile?.firstName, snapshot.lastName || snapshot.profile?.lastName]
        .filter(Boolean)
        .join(" ") ||
      snapshot.businessName ||
      snapshot.email ||
      null;
  }

  async enrichReturnDetail(response = {}) {
    const userIds = new Set([
      response.buyerId,
      response.sellerId,
      ...(response.items || []).map((item) => item.sellerId),
    ].map((id) => String(id || "")).filter(Boolean));
    const objectIds = [...userIds].filter((id) => UserModel.db.base.Types.ObjectId.isValid(id));

    const [order, users] = await Promise.all([
      response.orderId
        ? this.orderRepository.findById(response.orderId).catch(() => null)
        : Promise.resolve(null),
      objectIds.length
        ? UserModel.find({ _id: { $in: objectIds } })
          .select("email phone profile sellerProfile")
          .lean()
          .catch(() => [])
        : Promise.resolve([]),
    ]);

    const usersById = new Map(
      users.map((user) => [String(user._id), this.toReturnUserSummary(user)]),
    );
    const buyerSnapshot = response.buyerSnapshot || {};
    const buyer = usersById.get(String(response.buyerId || "")) || buyerSnapshot;
    const seller = usersById.get(String(response.sellerId || "")) || response.seller || null;

    return {
      ...response,
      orderNumber: response.orderNumber || order?.order_number || order?.orderNumber || null,
      buyer,
      buyerName: this.snapshotDisplayName(buyer),
      buyerEmail: buyer?.email || buyerSnapshot.email || null,
      buyerPhone: buyer?.phone || buyerSnapshot.phone || null,
      seller,
      sellerName: this.snapshotDisplayName(seller || {}),
      items: (response.items || []).map((item) => {
        const itemSeller = usersById.get(String(item.sellerId || "")) || null;
        return {
          ...item,
          seller: itemSeller,
          sellerName: this.snapshotDisplayName(itemSeller || {}) || item.sellerName || null,
        };
      }),
    };
  }

  async markOrderReturnRequested(order = {}, returnRequests = [], actor = {}) {
    if (!order?.id) return null;
    const metadata = this.parseJson(order.metadata, {});
    const returnIds = returnRequests.map((item) => this.getReturnId(item)).filter(Boolean);
    const existingIds = Array.isArray(metadata.returnLifecycle?.returnIds)
      ? metadata.returnLifecycle.returnIds
      : [];
    const nextReturnIds = Array.from(new Set([...existingIds, ...returnIds]));
    const now = new Date().toISOString();

    return this.orderRepository.updateStatus(order.id, ORDER_STATUS.RETURN_REQUESTED, {
      actorId: actor.userId || null,
      actorRole: actor.role || null,
      reason: "return_requested",
      paymentStatus: order.payment_status,
      deliveryStatus: order.delivery_status,
      metadata: {
        returnIds,
        returnStatus: ORDER_STATUS.RETURN_REQUESTED,
      },
      orderMetadata: {
        returnLifecycle: {
          ...(metadata.returnLifecycle || {}),
          status: ORDER_STATUS.RETURN_REQUESTED,
          paymentStatus: order.payment_status,
          returnIds: nextReturnIds,
          openReturnCount: nextReturnIds.length,
          lastReturnId: returnIds[returnIds.length - 1] || metadata.returnLifecycle?.lastReturnId || null,
          requestedAt: metadata.returnLifecycle?.requestedAt || now,
          updatedAt: now,
        },
      },
    });
  }

  isCompletedReturn(returnRequest = {}) {
    const status = returnRequest.status;
    const refundStatus = returnRequest.refund?.status;
    return Boolean(
      returnRequest.refundedAt ||
      refundStatus === "completed" ||
      ["refunded", "replaced"].includes(status) ||
      (status === "closed" && ["completed", "not_required"].includes(refundStatus)),
    );
  }

  getReturnRefundedAmount(returnRequest = {}) {
    if (!this.isCompletedReturn(returnRequest)) return 0;
    return this.round(returnRequest.refund?.refundedAmount || returnRequest.refundAmount || 0);
  }

  buildReturnItemKey(item = {}) {
    return [
      item.orderItemId || "",
      item.productId || "",
      item.variantSku || item.variantId || "",
    ].join(":");
  }

  async buildOrderReturnLifecycle(orderId) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) return null;

    const returnRequests = await ReturnModel.find({
      orderId,
      status: { $ne: "rejected" },
    }).lean();

    const orderItems = order.items || [];
    const totalQuantity = orderItems.reduce((sum, item) => {
      const quantity = Number(item.quantity || 0);
      const cancelledQuantity = Number(item.cancelled_quantity || 0);
      return sum + Math.max(quantity - cancelledQuantity, 0);
    }, 0);
    const orderItemIds = new Set(orderItems.map((item) => String(item.id || "")));
    const returnedQuantityByItem = new Map();
    let refundedAmount = 0;
    let completedReturnCount = 0;
    let openReturnCount = 0;

    returnRequests.forEach((returnRequest) => {
      const completed = this.isCompletedReturn(returnRequest);
      if (completed) {
        completedReturnCount += 1;
        refundedAmount = this.round(refundedAmount + this.getReturnRefundedAmount(returnRequest));
      } else if (!["closed", "qc_failed"].includes(returnRequest.status)) {
        openReturnCount += 1;
      }

      if (!completed) return;
      (returnRequest.items || []).forEach((item) => {
        const orderItemId = String(item.orderItemId || "");
        const key = orderItemIds.has(orderItemId)
          ? orderItemId
          : this.buildReturnItemKey(item);
        const quantity = Number(
          item.receivedQuantity ||
          item.approvedQuantity ||
          item.requestedQuantity ||
          item.quantity ||
          0,
        );
        returnedQuantityByItem.set(key, (returnedQuantityByItem.get(key) || 0) + Math.max(quantity, 0));
      });
    });

    const returnedQuantity = Array.from(returnedQuantityByItem.values())
      .reduce((sum, quantity) => sum + quantity, 0);
    const refundableAmount = this.round(Math.max(
      Number(order.payable_amount || 0),
      Number(order.total_amount || 0),
    ));
    const hasFullQuantityReturn = totalQuantity > 0 && returnedQuantity >= totalQuantity;
    const hasFullAmountRefund = refundableAmount > 0 && refundedAmount >= this.round(refundableAmount - 0.01);
    const paymentStatus = refundedAmount > 0
      ? (hasFullAmountRefund ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED)
      : order.payment_status;
    const status = hasFullQuantityReturn
      ? ORDER_STATUS.RETURNED
      : openReturnCount > 0
        ? ORDER_STATUS.RETURN_REQUESTED
        : refundedAmount > 0 || returnedQuantity > 0
          ? ORDER_STATUS.PARTIALLY_RETURNED
          : order.status;

    return {
      order,
      lifecycle: {
        status,
        paymentStatus,
        refundedAmount,
        refundableAmount,
        returnedQuantity,
        totalQuantity,
        completedReturnCount,
        openReturnCount,
        returnIds: returnRequests.map((item) => this.getReturnId(item)).filter(Boolean),
        lastReturnId: returnRequests[0] ? this.getReturnId(returnRequests[0]) : null,
        fullQuantityReturned: hasFullQuantityReturn,
        fullAmountRefunded: hasFullAmountRefund,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  async syncParentOrderAfterReturnRefund(returnRequest, actor = {}) {
    const result = await this.buildOrderReturnLifecycle(returnRequest.orderId);
    if (!result) return null;

    const { order, lifecycle } = result;
    const returnMetadata = this.getReturnMetadata(returnRequest);
    const updatedOrder = await this.orderRepository.updateStatus(order.id, lifecycle.status, {
      actorId: actor.userId || null,
      actorRole: actor.role || null,
      reason: "return_refund_completed",
      paymentStatus: lifecycle.paymentStatus,
      deliveryStatus: order.delivery_status,
      metadata: {
        ...returnMetadata,
        refundAmount: returnRequest.refundAmount || 0,
        parentOrderStatus: lifecycle.status,
        parentPaymentStatus: lifecycle.paymentStatus,
      },
      orderMetadata: {
        returnLifecycle: lifecycle,
      },
    });

    if ([PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.PARTIALLY_REFUNDED].includes(lifecycle.paymentStatus)) {
      await this.orderRepository.updatePaymentsForOrderReturnRefund(order.id, {
        status: lifecycle.paymentStatus,
        metadata: {
          ...returnMetadata,
          refundedAmount: lifecycle.refundedAmount,
          refundableAmount: lifecycle.refundableAmount,
          paymentStatus: lifecycle.paymentStatus,
          orderStatus: lifecycle.status,
        },
      });
    }

    return updatedOrder;
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
      const sellerId = String(actor.ownerSellerId || actor.sellerId || actor.userId);
      const organizationId = actor.organizationId ? String(actor.organizationId) : null;
      if ((returnRequest.items || []).some((item) =>
        String(item.sellerId) === sellerId &&
        (!organizationId || !item.organizationId || String(item.organizationId) === organizationId),
      )) return;
    }
    throw new AppError("You are not allowed to view this return", 403);
  }

  async assertCanManage(returnRequest, actor) {
    if (this.isAdmin(actor)) return;
    if (this.isSeller(actor)) {
      const sellerId = String(actor.ownerSellerId || actor.sellerId || actor.userId);
      const itemSellerIds = new Set((returnRequest.items || []).map((item) => String(item.sellerId || "")));
      const itemOrganizationIds = new Set(
        (returnRequest.items || [])
          .map((item) => String(item.organizationId || returnRequest.organizationId || ""))
          .filter(Boolean),
      );
      const organizationMatches = !actor.organizationId ||
        itemOrganizationIds.size === 0 ||
        (itemOrganizationIds.size <= 1 && itemOrganizationIds.has(String(actor.organizationId)));
      if (itemSellerIds.size === 1 && itemSellerIds.has(sellerId) && organizationMatches) return;
    }
    throw new AppError("You are not allowed to manage this return", 403);
  }

  appendTimeline(returnRequest, status, actor = {}, payload = {}) {
    returnRequest.updatedBy = actor.userId || returnRequest.updatedBy || null;
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

  resolveDeliveredAt(order = {}) {
    const delivered = [...(order.timeline || [])]
      .reverse()
      .find((entry) => ["delivered", "fulfilled", "completed"].includes(entry.to_status || entry.toStatus));
    return new Date(delivered?.created_at || delivered?.createdAt || order.updated_at || order.created_at || Date.now());
  }

  async resolveReturnPolicy(order, orderItems) {
    const orderMetadata = this.parseJson(order.metadata, {});
    const policies = orderItems.map((item) => {
      const snapshot = this.parseJson(item.product_snapshot, {});
      return snapshot.returnPolicy || snapshot.return_policy || snapshot.commercialPolicy?.returnPolicy || {};
    });
    if (policies.some((policy) => policy.returnable === false || policy.eligible === false)) {
      throw new AppError("One or more selected items are not returnable", 409);
    }
    const sellerPolicies = await this.loadSellerReturnPolicies(
      orderItems.map((item) => item.seller_id).filter(Boolean),
    );
    const configuredWindows = policies
      .map((policy) => Number(policy.returnWindowDays || policy.windowDays || policy.days || 0))
      .concat(sellerPolicies.map((policy) => Number(policy.returnWindowDays || 0)))
      .filter((days) => days > 0);
    const returnWindowDays = configuredWindows.length
      ? Math.min(...configuredWindows)
      : Number(orderMetadata.returnWindowDays || 7);
    const deliveredAt = this.resolveDeliveredAt(order);
    const eligibleUntil = new Date(deliveredAt);
    eligibleUntil.setDate(eligibleUntil.getDate() + returnWindowDays);
    if (eligibleUntil.getTime() < Date.now()) {
      throw new AppError(`Return window expired on ${eligibleUntil.toISOString()}`, 409);
    }
    return {
      returnable: true,
      returnWindowDays,
      deliveredAt,
      eligibleUntil,
      shippingPaidBy: policies.find((policy) => policy.shippingPaidBy)?.shippingPaidBy || "platform_policy",
      requiresQc: !policies.some((policy) => policy.requiresQc === false),
      source: configuredWindows.length ? "product_or_seller_policy" : "order_default",
      sellerPolicyWindows: sellerPolicies,
    };
  }

  async loadSellerReturnPolicies(sellerIds = []) {
    const uniqueIds = Array.from(new Set(sellerIds.map((sellerId) => String(sellerId || "")).filter(Boolean)));
    const objectIds = uniqueIds.filter((sellerId) => UserModel.db.base.Types.ObjectId.isValid(sellerId));
    if (!objectIds.length) return [];

    const sellers = await UserModel.find({ _id: { $in: objectIds } })
      .select("sellerSettings.returnWindowDays sellerSettings.shippingModes")
      .lean();
    return sellers.map((seller) => ({
      sellerId: String(seller._id),
      returnWindowDays: Number(seller.sellerSettings?.returnWindowDays || 0),
      source: "seller_settings",
    }));
  }

  findOrderItem(orderItems, requestedItem) {
    return orderItems.find((candidate) => {
      if (requestedItem.orderItemId && String(candidate.id) === String(requestedItem.orderItemId)) return true;
      return String(candidate.product_id) === String(requestedItem.productId) &&
        (!requestedItem.variantSku || String(candidate.variant_sku || "") === String(requestedItem.variantSku || "")) &&
        (!requestedItem.variantId || String(candidate.variant_id || "") === String(requestedItem.variantId || ""));
    });
  }

  async requestReturn(orderId, buyerId, items, reason, description, actor = {}, extra = {}) {
    if (!items?.length) throw new AppError("Return items required", 400);
    if (!RETURN_REASONS.has(reason)) throw new AppError("Invalid return reason", 400);

    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) throw new AppError("Order not found", 404);
    if (order.buyer_id !== buyerId) throw new AppError("You can request return only for your order", 403);
    if (![ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED, ORDER_STATUS.RETURN_REQUESTED, ORDER_STATUS.PARTIALLY_RETURNED, "completed"].includes(order.status)) {
      throw new AppError("Only delivered orders are eligible for return", 409);
    }

    const orderItems = order.items || [];
    const matchedOrderItems = items.map((item) => {
      const orderItem = this.findOrderItem(orderItems, item);
      if (!orderItem) throw new AppError(`Product ${item.productId} is not part of this order`, 400);
      return orderItem;
    });
    const policySnapshot = await this.resolveReturnPolicy(order, matchedOrderItems);
    const existingReturns = await ReturnModel.find({ orderId, status: { $ne: "rejected" } }).lean();

    const normalizedItems = items.map((item, index) => {
      const orderItem = matchedOrderItems[index];
      const quantity = Number(item.quantity || 0);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new AppError("Return quantity must be a positive whole number", 400);
      }
      const alreadyReturned = existingReturns.reduce((sum, returnDoc) => {
        const matched = (returnDoc.items || []).find((candidate) =>
          String(candidate.orderItemId || "") === String(orderItem.id || "") ||
          (
            String(candidate.productId) === String(orderItem.product_id) &&
            String(candidate.variantSku || candidate.variantId || "") ===
              String(orderItem.variant_sku || orderItem.variant_id || "")
          ),
        );
        return sum + Number(matched?.approvedQuantity || matched?.requestedQuantity || matched?.quantity || 0);
      }, 0);
      const availableQty = Number(orderItem.quantity || 0) - alreadyReturned;
      if (quantity > availableQty) {
        throw new AppError(`Return quantity exceeds eligible quantity for ${item.productId}`, 400);
      }

      const unitPrice = Number(orderItem.unit_price || item.unitPrice || 0);
      const lineTotal = this.round(unitPrice * quantity);
      const orderItemTax = Number(orderItem.tax_amount || 0);
      const taxAmount = this.round(orderItemTax * (quantity / Math.max(Number(orderItem.quantity || 1), 1)));
      return {
        orderItemId: orderItem.id,
        productId: orderItem.product_id,
        productTitle: orderItem.product_title || "",
        productSku: orderItem.product_sku || "",
        productImage: orderItem.product_image || "",
        sellerId: orderItem.seller_id || "",
        organizationId: orderItem.organization_id || "",
        variantId: item.variantId || orderItem.variant_id || "",
        variantSku: item.variantSku || orderItem.variant_sku || "",
        quantity,
        requestedQuantity: quantity,
        approvedQuantity: 0,
        receivedQuantity: 0,
        unitPrice,
        lineTotal,
        taxAmount,
        refundAmount: 0,
        qcResult: "pending",
        photos: item.photos || [],
      };
    });

    const grouped = new Map();
    normalizedItems.forEach((item) => {
      const sellerId = String(item.sellerId || "platform");
      const organizationId = String(item.organizationId || "");
      const key = `${sellerId}:${organizationId || "default"}`;
      if (!grouped.has(key)) grouped.set(key, { sellerId, organizationId, items: [] });
      grouped.get(key).items.push(item);
    });

    const buyerSnapshot = order.relations?.buyer || { id: buyerId };
    const shippingAddress = this.parseJson(order.shipping_address, {});
    const createdReturns = [];
    for (const group of grouped.values()) {
      const { sellerId, organizationId, items: sellerItems } = group;
      const refundBreakup = this.calculateRefundBreakup(sellerItems, order);
      this.allocateItemRefunds(sellerItems, refundBreakup.totalRefundAmount, { setEligible: true });
      const returnRequest = await ReturnModel.create({
        returnNumber: this.makeReturnNumber(),
        orderId,
        buyerId,
        sellerId,
        organizationId: organizationId || null,
        items: sellerItems,
        reason,
        resolution: extra.resolution || "refund",
        description,
        photos: extra.photos || [],
        status: "requested",
        refundAmount: refundBreakup.totalRefundAmount,
        refundBreakup,
        refund: {
          status: "not_started",
          requestedAmount: refundBreakup.totalRefundAmount,
          approvedAmount: 0,
        },
        policySnapshot,
        buyerSnapshot,
        shipFromSnapshot: shippingAddress,
        createdBy: actor.userId || buyerId,
        updatedBy: actor.userId || buyerId,
        timeline: [{
          status: "requested",
          actorId: actor.userId || buyerId,
          actorRole: actor.role || "buyer",
          reason,
          note: description || null,
          metadata: { sellerId, organizationId: organizationId || null, resolution: extra.resolution || "refund" },
          at: new Date(),
        }],
      });
      createdReturns.push(returnRequest);
      await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_REQUESTED_V1, returnRequest, actor);
    }

    await this.markOrderReturnRequested(order, createdReturns, actor);

    logger.info({ orderId, returnIds: createdReturns.map((item) => item._id) }, "Return requested");
    return createdReturns.length === 1
      ? createdReturns[0]
      : { split: true, count: createdReturns.length, returns: createdReturns };
  }

  calculateRefundBreakup(items, order) {
    const itemSubtotal = this.round(items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0));
    const orderSubtotal = Number(order.subtotal_amount || 0);
    const proportion = orderSubtotal > 0 ? Math.min(itemSubtotal / orderSubtotal, 1) : 0;
    const discountReversal = this.round(Number(order.discount_amount || 0) * proportion);
    const taxReversal = this.round(Number(order.tax_amount || 0) * proportion);
    const totalRefundAmount = this.round(Math.max(itemSubtotal - discountReversal + taxReversal, 0));
    const walletRefundAmount = this.round(Math.min(
      Number(order.wallet_discount_amount || 0) * proportion,
      totalRefundAmount,
    ));
    return {
      itemSubtotal,
      discountReversal,
      taxReversal,
      shippingRefund: 0,
      walletRefundAmount,
      originalPaymentRefundAmount: this.round(totalRefundAmount - walletRefundAmount),
      totalRefundAmount,
    };
  }

  allocateItemRefunds(items, totalRefundAmount, options = {}) {
    const weights = items.map((item) => Number(
      options.useCurrentRefund ? item.refundAmount : item.lineTotal,
    ) || 0);
    const weightTotal = weights.reduce((sum, amount) => sum + amount, 0);
    const positiveIndexes = weights
      .map((weight, index) => (weight > 0 ? index : -1))
      .filter((index) => index >= 0);
    const lastPositiveIndex = positiveIndexes[positiveIndexes.length - 1];
    let allocated = 0;
    items.forEach((item, index) => {
      const amount = weights[index] <= 0
        ? 0
        : index === lastPositiveIndex
          ? this.round(totalRefundAmount - allocated)
          : this.round(totalRefundAmount * (weights[index] / Math.max(weightTotal, 1)));
      item.refundAmount = amount;
      if (options.setEligible) item.eligibleRefundAmount = amount;
      allocated = this.round(allocated + amount);
    });
  }

  async approveReturn(returnId, refundAmount, actor = {}, payload = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    this.validateTransition(returnRequest.status, "approved");

    const approvedItems = payload.items || [];
    returnRequest.items.forEach((item) => {
      const approved = approvedItems.find((candidate) =>
        String(candidate.orderItemId || "") === String(item.orderItemId || "") ||
        (
          String(candidate.productId || "") === String(item.productId || "") &&
          String(candidate.variantSku || "") === String(item.variantSku || "")
        ),
      );
      const quantity = Number(approved?.approvedQuantity ?? approved?.quantity ?? item.requestedQuantity ?? item.quantity);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > Number(item.requestedQuantity || item.quantity || 0)) {
        throw new AppError(`Invalid approved quantity for ${item.productTitle || item.productId}`, 400);
      }
      item.approvedQuantity = quantity;
      item.refundAmount = this.round(
        Number(item.eligibleRefundAmount || item.refundAmount || 0) *
        (quantity / Math.max(Number(item.requestedQuantity || item.quantity || 1), 1)),
      );
    });
    if (!returnRequest.items.some((item) => Number(item.approvedQuantity || 0) > 0)) {
      throw new AppError("At least one return item quantity must be approved", 400);
    }

    const eligibleAmount = this.round(
      returnRequest.items.reduce((sum, item) => sum + Number(item.refundAmount || 0), 0),
    );
    const approvedAmount = this.round(refundAmount || eligibleAmount);
    if (approvedAmount <= 0 || approvedAmount > eligibleAmount) {
      throw new AppError("Approved refund amount exceeds the eligible refund amount", 400);
    }
    this.allocateItemRefunds(returnRequest.items, approvedAmount, { useCurrentRefund: true });
    returnRequest.status = "approved";
    returnRequest.refundAmount = approvedAmount;
    returnRequest.refund.approvedAmount = approvedAmount;
    returnRequest.approvedAt = new Date();
    this.appendTimeline(returnRequest, "approved", actor, {
      ...payload,
      metadata: {
        approvedAmount,
        approvedItems: returnRequest.items.map((item) => ({
          orderItemId: item.orderItemId,
          approvedQuantity: item.approvedQuantity,
        })),
      },
    });
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

  async scheduleReversePickup(returnId, payload = {}, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    const manualShipBack = payload.mode === "manual_ship_back" || payload.manualShipBack;
    const nextStatus = manualShipBack ? "manual_ship_back" : "reverse_pickup_scheduled";
    this.validateTransition(returnRequest.status, nextStatus);

    if (!manualShipBack) {
      const order = await this.orderRepository.findByIdWithItems(returnRequest.orderId);
      const provider = shippingProviderRegistry.get(payload.provider || "manual");
      const providerResult = await provider.createShipment({
        ...payload,
        orderId: returnRequest.orderId,
        returnId: String(returnRequest._id),
      });
      const trackingNumber = providerResult.trackingNumber || payload.trackingNumber || providerResult.awbNumber;
      const shipment = await this.deliveryRepository.createShipment({
        orderId: returnRequest.orderId,
        returnId: String(returnRequest._id),
        sellerId: returnRequest.sellerId || returnRequest.items[0]?.sellerId || "platform",
        shipmentType: "return",
        direction: "reverse",
        provider: payload.provider || providerResult.provider || "manual",
        courierName: payload.courierName || null,
        awbNumber: providerResult.awbNumber || payload.awbNumber || trackingNumber,
        trackingNumber,
        status: "initiated",
        shippingMode: payload.shippingMode || "standard",
        packageSnapshot: payload.packageSnapshot || {},
        pickupAddressSnapshot: payload.pickupAddressSnapshot || returnRequest.shipFromSnapshot || {},
        shipToSnapshot: payload.warehouseAddressSnapshot || payload.shipToSnapshot || {},
        rateSnapshot: payload.rateSnapshot || {},
        labelData: providerResult.labelData || payload.labelData || {},
        expectedDeliveryAt: payload.expectedDeliveryAt || null,
        idempotencyKey: payload.idempotencyKey || `return:${returnRequest._id}:reverse-shipment`,
        metadata: {
          ...(payload.metadata || {}),
          returnNumber: returnRequest.returnNumber,
          reason: returnRequest.reason,
        },
        createdBy: actor.userId,
        updatedBy: actor.userId,
        note: payload.note || "Reverse pickup scheduled",
      });

      returnRequest.trackingNumber = shipment.tracking_number || "";
      returnRequest.shipToSnapshot = shipment.ship_to_snapshot || {};
      returnRequest.reverseShipment = {
        shipmentId: shipment.id,
        provider: shipment.provider,
        courierName: shipment.courier_name || "",
        awbNumber: shipment.awb_number || "",
        trackingNumber: shipment.tracking_number || "",
        labelUrl: shipment.label_data?.url || shipment.label_data?.labelUrl || "",
        status: shipment.status,
        pickupScheduledAt: payload.pickupScheduledAt || new Date(),
        packageSnapshot: shipment.package_snapshot || {},
        pickupAddressSnapshot: shipment.pickup_address_snapshot || {},
        warehouseAddressSnapshot: shipment.ship_to_snapshot || {},
        rateSnapshot: shipment.rate_snapshot || {},
        cost: Number(payload.cost || shipment.rate_snapshot?.amount || 0),
        metadata: shipment.metadata || {},
        events: [{
          status: shipment.status,
          note: payload.note || "Reverse pickup scheduled",
          source: "return_service",
          actorId: actor.userId,
          at: new Date(),
        }],
      };
    }

    returnRequest.status = nextStatus;
    if (manualShipBack) {
      returnRequest.trackingNumber = payload.trackingNumber || returnRequest.trackingNumber;
    }
    this.appendTimeline(returnRequest, nextStatus, actor, {
      ...payload,
      metadata: {
        shipmentId: returnRequest.reverseShipment?.shipmentId || null,
        trackingNumber: returnRequest.trackingNumber || null,
        mode: manualShipBack ? "manual_ship_back" : "reverse_pickup",
      },
    });
    await returnRequest.save();
    return returnRequest;
  }

  async updateReverseShipment(returnId, payload = {}, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    const shipmentId = payload.shipmentId || returnRequest.reverseShipment?.shipmentId;
    if (!shipmentId) throw new AppError("Reverse shipment has not been created", 409);
    const reverseShipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!reverseShipment) throw new AppError("Reverse shipment not found", 404);
    if (
      String(reverseShipment.return_id || "") !== String(returnRequest._id || "") &&
      String(returnRequest.reverseShipment?.shipmentId || "") !== String(reverseShipment.id || "")
    ) {
      throw new AppError("Shipment does not belong to this return", 403);
    }

    const returnStatus = REVERSE_STATUS_MAP[payload.status];
    if (!returnStatus) throw new AppError("Unsupported reverse shipment status", 400);
    if (returnRequest.status !== returnStatus) {
      this.validateTransition(returnRequest.status, returnStatus);
    }

    const result = await this.deliveryRepository.addTrackingEvent(shipmentId, {
      status: payload.status,
      eventTime: payload.eventTime || new Date(),
      location: payload.location || null,
      note: payload.note || null,
      source: payload.source || "return_admin",
      rawPayload: payload.rawPayload || {},
      deliveryException: payload.deliveryException || null,
      actorId: actor.userId,
    });
    if (!result) throw new AppError("Reverse shipment not found", 404);

    if (returnRequest.status !== returnStatus) {
      returnRequest.status = returnStatus;
    }
    returnRequest.reverseShipment.status = payload.status;
    returnRequest.reverseShipment.trackingNumber = result.shipment.tracking_number || returnRequest.reverseShipment.trackingNumber;
    if (payload.status === "picked_up") returnRequest.reverseShipment.pickedUpAt = payload.eventTime || new Date();
    if (["delivered", "delivered_verified", "received"].includes(payload.status)) {
      const receivedAt = payload.eventTime || new Date();
      returnRequest.reverseShipment.deliveredToWarehouseAt = receivedAt;
      returnRequest.receivedAt = returnRequest.receivedAt || receivedAt;
      returnRequest.items.forEach((item) => {
        item.receivedQuantity = Number(item.approvedQuantity || item.requestedQuantity || item.quantity || 0);
      });
    }
    returnRequest.reverseShipment.events.push({
      status: payload.status,
      location: payload.location || null,
      note: payload.note || null,
      source: payload.source || "return_admin",
      rawPayload: payload.rawPayload || {},
      actorId: actor.userId,
      at: payload.eventTime || new Date(),
    });
    this.appendTimeline(returnRequest, returnStatus, actor, {
      note: payload.note,
      metadata: { shipmentId, shipmentStatus: payload.status, location: payload.location || null },
    });
    await returnRequest.save();
    if (returnStatus === "received") {
      await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_RECEIVED_V1, returnRequest, actor);
    }
    return returnRequest;
  }

  async shipReturnBack(returnId, trackingNumber, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanView(returnRequest, actor);
    this.validateTransition(returnRequest.status, "shipped_back");
    returnRequest.status = "shipped_back";
    returnRequest.trackingNumber = trackingNumber;
    returnRequest.reverseShipment = {
      ...(returnRequest.reverseShipment?.toObject?.() || returnRequest.reverseShipment || {}),
      provider: returnRequest.reverseShipment?.provider || "customer_manual",
      trackingNumber,
      status: "shipped_back",
      events: [
        ...(returnRequest.reverseShipment?.events || []),
        {
          status: "shipped_back",
          note: "Customer shipped the return",
          source: "buyer",
          actorId: actor.userId,
          at: new Date(),
        },
      ],
    };
    this.appendTimeline(returnRequest, "shipped_back", actor, { metadata: { trackingNumber } });
    await returnRequest.save();
    return returnRequest;
  }

  async receiveReturn(returnId, payload = {}, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    this.validateTransition(returnRequest.status, "received");
    returnRequest.status = "received";
    returnRequest.notes = payload.notes || payload.note || "";
    returnRequest.receivedAt = new Date();
    const receivedItems = payload.items || [];
    returnRequest.items.forEach((item) => {
      const received = receivedItems.find((candidate) =>
        String(candidate.orderItemId || "") === String(item.orderItemId || "") ||
        (
          String(candidate.productId || "") === String(item.productId || "") &&
          String(candidate.variantSku || "") === String(item.variantSku || "")
        ),
      );
      const quantity = Number(received?.receivedQuantity ?? received?.quantity ?? item.approvedQuantity ?? item.requestedQuantity ?? item.quantity);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > Number(item.approvedQuantity || item.requestedQuantity || item.quantity || 0)) {
        throw new AppError(`Invalid received quantity for ${item.productTitle || item.productId}`, 400);
      }
      item.receivedQuantity = quantity;
    });
    this.appendTimeline(returnRequest, "received", actor, {
      note: returnRequest.notes,
      metadata: {
        receivedItems: returnRequest.items.map((item) => ({
          orderItemId: item.orderItemId,
          receivedQuantity: item.receivedQuantity,
        })),
      },
    });
    await returnRequest.save();
    await this.publishReturnEvent(DOMAIN_EVENTS.RETURN_RECEIVED_V1, returnRequest, actor);
    return returnRequest;
  }

  async qcReturn(returnId, payload = {}, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    if (returnRequest.status !== "received") {
      throw new AppError("QC can be recorded only after the return is received", 409);
    }

    const qcItems = payload.items || [];
    const sellableItems = [];
    const damagedItems = [];
    returnRequest.items.forEach((item) => {
      const qcItem = qcItems.find((candidate) =>
        String(candidate.orderItemId || "") === String(item.orderItemId || "") ||
        (
          String(candidate.productId || "") === String(item.productId || "") &&
          String(candidate.variantSku || "") === String(item.variantSku || "")
        ),
      );
      if (qcItems.length && !qcItem) {
        throw new AppError(`QC decision is required for ${item.productTitle || item.productId}`, 400);
      }
      const result = qcItem?.result || qcItem?.qcResult || (payload.passed ? "sellable" : "damaged");
      const quantity = Number(qcItem?.quantity ?? qcItem?.receivedQuantity ?? item.receivedQuantity ?? item.approvedQuantity ?? item.quantity);
      if (!["sellable", "damaged", "missing", "rejected"].includes(result)) {
        throw new AppError(`Invalid QC result for ${item.productTitle || item.productId}`, 400);
      }
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > Number(item.receivedQuantity || item.approvedQuantity || item.quantity || 0)) {
        throw new AppError(`Invalid QC quantity for ${item.productTitle || item.productId}`, 400);
      }
      item.condition = qcItem?.condition || payload.condition || result;
      item.qcResult = result;
      item.qcNotes = qcItem?.notes || payload.notes || "";
      item.qcPhotos = qcItem?.photos || [];
      if (result === "sellable" && quantity > 0) {
        item.restockedQuantity = quantity;
        sellableItems.push({ ...item.toObject(), quantity });
      } else if (result === "damaged" && quantity > 0) {
        item.damagedQuantity = quantity;
        damagedItems.push({ ...item.toObject(), quantity });
      }
    });

    if (sellableItems.length) {
      await this.inventoryService.restockForReturn(returnRequest, actor, sellableItems);
    }
    if (damagedItems.length) {
      await this.inventoryService.recordReturnDamage(
        returnRequest,
        actor,
        { condition: "damaged", notes: payload.notes || "" },
        damagedItems,
      );
    }

    const results = new Set(returnRequest.items.map((item) => item.qcResult));
    returnRequest.items.forEach((item) => {
      if (!["sellable", "damaged"].includes(item.qcResult)) item.refundAmount = 0;
    });
    const qcApprovedRefundAmount = this.round(
      returnRequest.items.reduce((sum, item) => sum + Number(item.refundAmount || 0), 0),
    );
    returnRequest.refundAmount = qcApprovedRefundAmount;
    returnRequest.refund.approvedAmount = qcApprovedRefundAmount;
    returnRequest.refundBreakup = {
      ...(returnRequest.refundBreakup?.toObject?.() || returnRequest.refundBreakup || {}),
      qcApprovedRefundAmount,
    };
    const hasAccepted = [...results].some((result) => ["sellable", "damaged"].includes(result));
    const hasRejected = [...results].some((result) => ["missing", "rejected"].includes(result));
    const nextStatus = hasAccepted && hasRejected
      ? "qc_completed"
      : hasAccepted
        ? "qc_passed"
        : "qc_failed";
    this.validateTransition(returnRequest.status, nextStatus);
    returnRequest.status = nextStatus;
    returnRequest.qcAt = new Date();
    this.appendTimeline(returnRequest, nextStatus, actor, {
      ...payload,
      metadata: {
        sellableQuantity: sellableItems.reduce((sum, item) => sum + item.quantity, 0),
        damagedQuantity: damagedItems.reduce((sum, item) => sum + item.quantity, 0),
      },
    });
    await returnRequest.save();
    return returnRequest;
  }

  resolveRefundAllocation(returnRequest, payload, originalPayment) {
    const amount = this.round(payload.refundAmount || returnRequest.refund?.approvedAmount || returnRequest.refundAmount);
    const method = payload.method || "auto";
    const isRazorpay = originalPayment?.provider === "razorpay" && originalPayment.provider_payment_id;
    let walletAmount = 0;
    let providerAmount = 0;

    if (method === "wallet" || method === "store_credit") {
      walletAmount = amount;
    } else if (method === "manual") {
      // A manual bank or cash refund is recorded by reference after Admin confirms it.
    } else if (method === "original_payment") {
      if (!isRazorpay) throw new AppError("Original payment provider does not support automated refunds", 409);
      providerAmount = amount;
    } else if (method === "split") {
      walletAmount = this.round(payload.walletAmount ?? returnRequest.refundBreakup?.walletRefundAmount ?? 0);
      providerAmount = this.round(payload.providerAmount ?? amount - walletAmount);
      if (this.round(walletAmount + providerAmount) !== amount) {
        throw new AppError("Wallet and provider refund amounts must equal the approved refund", 400);
      }
      if (providerAmount > 0 && !isRazorpay) {
        throw new AppError("Split refund requires a refundable original payment provider", 409);
      }
    } else if (isRazorpay) {
      walletAmount = this.round(Math.min(returnRequest.refundBreakup?.walletRefundAmount || 0, amount));
      providerAmount = this.round(amount - walletAmount);
    } else {
      walletAmount = amount;
    }

    return { amount, method, walletAmount, providerAmount, isRazorpay };
  }

  async processRefund(returnId, actor = {}, payload = {}) {
    let returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    if (!this.isAdmin(actor)) {
      throw new AppError("Only platform finance/admin users can process refunds", 403);
    }
    if (returnRequest.refund?.status === "completed" || returnRequest.refundedAt) return returnRequest;
    if (!["qc_passed", "qc_completed", "refund_failed"].includes(returnRequest.status)) {
      throw new AppError("Refund can be processed only after accepted QC", 409);
    }

    const originalPayment = await this.orderRepository.findRefundablePaymentByOrderId(returnRequest.orderId);
    const allocation = this.resolveRefundAllocation(returnRequest, payload, originalPayment);
    const approvedAmount = Number(returnRequest.refund?.approvedAmount || returnRequest.refundAmount || 0);
    if (allocation.amount <= 0 || allocation.amount > approvedAmount) {
      throw new AppError("Refund amount exceeds the approved amount", 400);
    }
    if (allocation.amount !== this.round(approvedAmount)) {
      throw new AppError("Process the full approved refund amount; adjust approval before refunding", 400);
    }

    const referenceId = payload.referenceId || returnRequest.refund?.referenceId || `return_${returnRequest._id}`;
    const attemptId = uuidv4();
    const idempotencyKey = payload.idempotencyKey || `${referenceId}:attempt:${Number(returnRequest.retryCount || 0)}`;
    const attempt = {
      attemptId,
      idempotencyKey,
      method: allocation.method,
      provider: allocation.providerAmount > 0 ? "razorpay" : allocation.walletAmount > 0 ? "wallet" : "manual",
      amount: allocation.amount,
      walletAmount: allocation.walletAmount,
      providerAmount: allocation.providerAmount,
      status: "pending",
      actorId: actor.userId,
      startedAt: new Date(),
      metadata: {},
    };

    const existingAttempt = await ReturnModel.findOne({
      _id: returnRequest._id,
      "refund.attempts.idempotencyKey": idempotencyKey,
    });
    if (existingAttempt) return existingAttempt;

    returnRequest = await ReturnModel.findOneAndUpdate(
      {
        _id: returnRequest._id,
        status: { $in: ["qc_passed", "qc_completed", "refund_failed"] },
        "refund.status": { $nin: ["pending", "provider_pending", "completed", "manual_review"] },
        "refund.attempts.idempotencyKey": { $ne: idempotencyKey },
      },
      {
        $set: {
          status: "refund_pending",
          "refund.status": "pending",
          "refund.requestedAmount": allocation.amount,
          "refund.approvedAmount": approvedAmount,
          "refund.method": allocation.method,
          "refund.provider": attempt.provider,
          "refund.referenceId": referenceId,
          "refund.idempotencyKey": idempotencyKey,
          "refund.failureReason": "",
          "refund.providerAmount": allocation.providerAmount,
          updatedBy: actor.userId || null,
        },
        $push: {
          "refund.attempts": attempt,
          timeline: {
            status: "refund_pending",
            actorId: actor.userId || null,
            actorRole: actor.role || null,
            note: payload.note || null,
            metadata: {
              attemptId,
              amount: allocation.amount,
              walletAmount: allocation.walletAmount,
              providerAmount: allocation.providerAmount,
            },
            at: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!returnRequest) {
      throw new AppError("Refund is already being processed. Sync its status before retrying.", 409);
    }
    const attemptDoc = returnRequest.refund.attempts.find((item) => item.attemptId === attemptId);

    try {
      let providerStatus = allocation.providerAmount > 0 ? "pending" : "not_required";
      if (allocation.providerAmount > 0) {
        if (returnRequest.refund.providerRefundId) {
          providerStatus = returnRequest.refund.status === "provider_pending" ? "pending" : "processed";
        } else {
          const providerResult = await this.razorpayProvider.createRefund({
            providerPaymentId: originalPayment.provider_payment_id,
            amount: allocation.providerAmount,
            returnId: String(returnRequest._id),
            notes: {
              orderId: returnRequest.orderId,
              returnId: String(returnRequest._id),
              referenceId,
            },
          });
          returnRequest.refund.providerRefundId = providerResult.refundId;
          returnRequest.providerRefundId = providerResult.refundId;
          providerStatus = providerResult.status || "pending";
          attemptDoc.providerRefundId = providerResult.refundId;
          attemptDoc.metadata = providerResult.metadata || {};
        }
      }

      await this.ensureWalletRefund(returnRequest, allocation.walletAmount, referenceId, allocation.method, attemptId);

      if (allocation.providerAmount > 0 && !["processed", "completed"].includes(providerStatus)) {
        returnRequest.refund.status = "provider_pending";
        returnRequest.status = "refund_pending";
        attemptDoc.status = "provider_pending";
        attemptDoc.completedAt = new Date();
        this.appendTimeline(returnRequest, "refund_pending", actor, {
          note: "Provider refund is pending confirmation",
          metadata: {
            attemptId,
            providerRefundId: returnRequest.refund.providerRefundId,
            providerStatus,
          },
        });
        await returnRequest.save();
        return returnRequest;
      }

      attemptDoc.status = "completed";
      attemptDoc.completedAt = new Date();
      return await this.finalizeRefund(returnRequest, allocation.amount, actor, {
        referenceId,
        method: allocation.method,
        note: payload.note,
        attemptId,
      });
    } catch (error) {
      attemptDoc.status = returnRequest.refund.providerRefundId ? "manual_review" : "failed";
      attemptDoc.failureReason = error.message;
      attemptDoc.completedAt = new Date();
      returnRequest.status = "refund_failed";
      returnRequest.refund.status = returnRequest.refund.providerRefundId ? "manual_review" : "failed";
      returnRequest.refund.failureReason = error.message;
      returnRequest.lastError = error.message;
      returnRequest.retryCount = Number(returnRequest.retryCount || 0) + 1;
      this.appendTimeline(returnRequest, "refund_failed", actor, {
        reason: error.message,
        metadata: {
          attemptId,
          providerRefundId: returnRequest.refund.providerRefundId || null,
          requiresReview: Boolean(returnRequest.refund.providerRefundId),
        },
      });
      await returnRequest.save();
      await this.publishReturnEvent(DOMAIN_EVENTS.REFUND_FAILED_V1, returnRequest, actor, {
        refundAmount: allocation.amount,
        referenceId,
        reason: error.message,
      });
      throw error;
    }
  }

  async retryRefund(returnId, actor = {}, payload = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    if (returnRequest.status !== "refund_failed") {
      throw new AppError("Only failed refunds can be retried", 409);
    }
    if (returnRequest.refund?.status === "manual_review" && returnRequest.refund?.providerRefundId) {
      throw new AppError("Sync the existing provider refund before retrying", 409);
    }
    return this.processRefund(returnId, actor, {
      ...payload,
      method: payload.method || returnRequest.refund?.method || "auto",
      refundAmount: payload.refundAmount || returnRequest.refund?.approvedAmount || returnRequest.refundAmount,
      referenceId: payload.referenceId || returnRequest.refund?.referenceId,
    });
  }

  async syncRefund(returnId, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    const providerRefundId = returnRequest.refund?.providerRefundId || returnRequest.providerRefundId;
    if (!providerRefundId) throw new AppError("Provider refund ID is missing", 409);
    const providerResult = await this.razorpayProvider.fetchRefund(providerRefundId);
    const lastAttempt = returnRequest.refund.attempts[returnRequest.refund.attempts.length - 1];
    if (lastAttempt) {
      lastAttempt.status = providerResult.status;
      lastAttempt.metadata = providerResult.metadata || {};
      lastAttempt.completedAt = new Date();
    }
    if (["processed", "completed"].includes(providerResult.status)) {
      const expectedWalletAmount = Number(lastAttempt?.walletAmount || returnRequest.refund?.walletAmount || 0);
      await this.ensureWalletRefund(
        returnRequest,
        expectedWalletAmount,
        returnRequest.refund?.referenceId || `return_${returnRequest._id}`,
        returnRequest.refund?.method || "auto",
        lastAttempt?.attemptId || "provider_sync",
      );
      try {
        return await this.finalizeRefund(
          returnRequest,
          Number(returnRequest.refund?.approvedAmount || returnRequest.refundAmount),
          actor,
          {
            referenceId: returnRequest.refund?.referenceId || `return_${returnRequest._id}`,
            method: returnRequest.refund?.method || "original_payment",
            note: "Provider refund synchronized",
            providerStatus: providerResult.status,
          },
        );
      } catch (error) {
        returnRequest.status = "refund_failed";
        returnRequest.refund.status = "manual_review";
        returnRequest.refund.failureReason = error.message;
        returnRequest.lastError = error.message;
        this.appendTimeline(returnRequest, "refund_failed", actor, {
          reason: error.message,
          note: "Provider refund completed but finance finalization requires review",
          metadata: { providerRefundId, providerStatus: providerResult.status },
        });
        await returnRequest.save();
        throw error;
      }
    }
    if (["failed", "rejected"].includes(providerResult.status)) {
      returnRequest.status = "refund_failed";
      returnRequest.refund.status = "failed";
      returnRequest.refund.failureReason = providerResult.failureReason || `Provider status: ${providerResult.status}`;
    } else {
      returnRequest.status = "refund_pending";
      returnRequest.refund.status = "provider_pending";
    }
    this.appendTimeline(returnRequest, returnRequest.status, actor, {
      note: "Provider refund synchronized",
      metadata: { providerRefundId, providerStatus: providerResult.status },
    });
    await returnRequest.save();
    return returnRequest;
  }

  async handleProviderRefundWebhook(entity = {}, eventType = "refund.processed", actor = {}) {
    const providerRefundId = entity.id;
    if (!providerRefundId) throw new AppError("Provider refund ID is missing", 400);
    const returnRequest = await ReturnModel.findOne({
      $or: [
        { "refund.providerRefundId": providerRefundId },
        { providerRefundId },
      ],
    });
    if (!returnRequest) return { acknowledged: true, ignored: true };

    const providerStatus = entity.status || eventType.split(".")[1] || "pending";
    const lastAttempt = returnRequest.refund.attempts[returnRequest.refund.attempts.length - 1];
    if (lastAttempt) {
      lastAttempt.status = providerStatus;
      lastAttempt.metadata = entity;
      lastAttempt.completedAt = new Date();
    }
    const systemActor = {
      userId: actor.userId || "razorpay-webhook",
      role: actor.role || "system",
    };

    if (["processed", "completed"].includes(providerStatus)) {
      const expectedWalletAmount = Number(lastAttempt?.walletAmount || returnRequest.refund?.walletAmount || 0);
      await this.ensureWalletRefund(
        returnRequest,
        expectedWalletAmount,
        returnRequest.refund?.referenceId || `return_${returnRequest._id}`,
        returnRequest.refund?.method || "auto",
        lastAttempt?.attemptId || "provider_webhook",
      );
      return this.finalizeRefund(
        returnRequest,
        Number(returnRequest.refund?.approvedAmount || returnRequest.refundAmount),
        systemActor,
        {
          referenceId: returnRequest.refund?.referenceId || `return_${returnRequest._id}`,
          method: returnRequest.refund?.method || "original_payment",
          note: "Provider refund confirmed by webhook",
        },
      );
    }

    returnRequest.status = ["failed", "rejected"].includes(providerStatus)
      ? "refund_failed"
      : "refund_pending";
    returnRequest.refund.status = ["failed", "rejected"].includes(providerStatus)
      ? "failed"
      : "provider_pending";
    returnRequest.refund.failureReason = entity.error_description || entity.error_reason || "";
    this.appendTimeline(returnRequest, returnRequest.status, systemActor, {
      reason: returnRequest.refund.failureReason || null,
      note: `Provider refund webhook: ${providerStatus}`,
      metadata: { providerRefundId, eventType },
    });
    await returnRequest.save();
    return returnRequest;
  }

  async ensureWalletRefund(returnRequest, amount, referenceId, method, attemptId) {
    const walletAmount = this.round(amount);
    if (walletAmount <= 0) return;
    await this.walletService.credit(returnRequest.buyerId, walletAmount, {
      referenceType: "return_refund",
      referenceId: `${referenceId}:wallet`,
      metadata: {
        returnId: String(returnRequest._id),
        orderId: returnRequest.orderId,
        method,
        attemptId,
      },
    });
    returnRequest.refund.walletAmount = walletAmount;
  }

  async finalizeRefund(returnRequest, refundAmount, actor, payload = {}) {
    if (returnRequest.refund?.status === "completed" || returnRequest.refundedAt) return returnRequest;
    const referenceId = payload.referenceId || `return_${returnRequest._id}`;
    const creditNote = await this.createCreditNote(returnRequest, refundAmount, actor);
    const sellerAdjustment = await this.recordSellerRefundAdjustment(returnRequest, refundAmount, actor);

    returnRequest.status = "refunded";
    returnRequest.refundAmount = refundAmount;
    returnRequest.refundReferenceId = referenceId;
    returnRequest.refundMethod = payload.method || returnRequest.refund?.method || "wallet";
    returnRequest.refundedAt = new Date();
    returnRequest.refund.status = "completed";
    returnRequest.refund.refundedAmount = refundAmount;
    returnRequest.refund.referenceId = referenceId;
    returnRequest.refund.processedAt = new Date();
    returnRequest.refund.failureReason = "";
    returnRequest.refund.metadata = {
      ...(returnRequest.refund.metadata?.toObject?.() || returnRequest.refund.metadata || {}),
      creditNoteId: creditNote?.id || null,
      creditNoteNumber: creditNote?.credit_note_number || null,
      sellerAdjustmentApplied: Boolean(sellerAdjustment),
      finalizedAt: new Date().toISOString(),
    };
    this.appendTimeline(returnRequest, "refunded", actor, {
      note: payload.note,
      metadata: {
        refundAmount,
        referenceId,
        refundMethod: returnRequest.refundMethod,
        providerRefundId: returnRequest.refund.providerRefundId || null,
      },
    });
    await returnRequest.save();
    await this.syncParentOrderAfterReturnRefund(returnRequest, actor);
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

  async recordSellerRefundAdjustment(returnRequest, refundAmount, actor) {
    return this.commissionService.recordRefundAdjustment(returnRequest, refundAmount, actor);
  }

  async createCreditNote(returnRequest, refundAmount, actor) {
    const originalRefundAmount = Number(returnRequest.refundBreakup?.totalRefundAmount || refundAmount || 1);
    const ratio = Math.min(Number(refundAmount || 0) / Math.max(originalRefundAmount, 1), 1);
    return this.taxService.createMarketplaceCreditNotes({
      orderId: returnRequest.orderId,
      referenceType: "return",
      referenceId: String(returnRequest._id),
      items: returnRequest.items || [],
      taxableAmount: this.round(Number(returnRequest.refundBreakup?.itemSubtotal || refundAmount) * ratio),
      taxAmount: this.round(Number(returnRequest.refundBreakup?.taxReversal || 0) * ratio),
      totalAmount: refundAmount,
      reason: returnRequest.reason,
      metadata: {
        returnId: String(returnRequest._id),
        returnNumber: returnRequest.returnNumber,
        actorId: actor.userId || null,
        refundRatio: ratio,
      },
    }, actor);
  }

  async createReplacement(returnId, payload, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    if (!["qc_passed", "qc_completed", "replacement_pending"].includes(returnRequest.status)) {
      throw new AppError("Replacement can be created only after accepted QC", 409);
    }
    if (!payload.replacementOrderId && !payload.replacementShipmentId) {
      returnRequest.status = "replacement_pending";
      returnRequest.replacement.status = "pending";
      this.appendTimeline(returnRequest, "replacement_pending", actor, payload);
      await returnRequest.save();
      return returnRequest;
    }
    this.validateTransition(returnRequest.status, "replaced");
    returnRequest.status = "replaced";
    returnRequest.replacementOrderId = payload.replacementOrderId || "";
    returnRequest.replacementShipmentId = payload.replacementShipmentId || "";
    returnRequest.replacement = {
      status: "created",
      orderId: payload.replacementOrderId || "",
      shipmentId: payload.replacementShipmentId || "",
      trackingNumber: payload.trackingNumber || "",
      createdAt: new Date(),
      metadata: payload.metadata || {},
    };
    this.appendTimeline(returnRequest, "replaced", actor, payload);
    await returnRequest.save();
    return returnRequest;
  }

  async closeReturn(returnId, payload, actor = {}) {
    const returnRequest = await this.getReturnOrThrow(returnId);
    await this.assertCanManage(returnRequest, actor);
    if (
      returnRequest.status === "refund_pending" ||
      ["pending", "provider_pending", "manual_review"].includes(returnRequest.refund?.status)
    ) {
      throw new AppError("Return cannot be closed while refund processing is pending", 409);
    }
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
    let response = await this.enrichReturnDetail(returnRequest.toObject());
    if (response.reverseShipment?.shipmentId) {
      const shipment = await this.deliveryRepository.findShipmentById(response.reverseShipment.shipmentId);
      if (shipment) {
        response.reverseShipment = {
          ...response.reverseShipment,
          shipment,
          trackingEvents: shipment.trackingEvents || [],
        };
      }
    }
    return response;
  }

  async getReturnByOrder(orderId, actor = {}) {
    const returnRequests = await ReturnModel.find({ orderId }).sort({ createdAt: -1 });
    if (!returnRequests.length) return null;
    await Promise.all(returnRequests.map((returnRequest) => this.assertCanView(returnRequest, actor)));
    return returnRequests.map((returnRequest) => returnRequest.toObject());
  }

  async listReturns(query = {}, actor = {}) {
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.orderId) filter.orderId = query.orderId;
    if (query.buyerId) filter.buyerId = query.buyerId;
    if (query.reason) filter.reason = query.reason;
    if (query.refundStatus) filter["refund.status"] = query.refundStatus;
    if (query.shipmentStatus) filter["reverseShipment.status"] = query.shipmentStatus;
    if (query.fromDate || query.toDate) {
      filter.createdAt = {};
      if (query.fromDate) filter.createdAt.$gte = new Date(query.fromDate);
      if (query.toDate) filter.createdAt.$lte = new Date(query.toDate);
    }
    if (query.search) {
      const search = new RegExp(String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { returnNumber: search },
        { orderId: search },
        { buyerId: search },
        { reason: search },
        { trackingNumber: search },
        { "reverseShipment.trackingNumber": search },
        { "refund.providerRefundId": search },
      ];
    }
    if (this.isAdmin(actor)) {
      if (query.sellerId) filter["items.sellerId"] = query.sellerId;
      if (query.organizationId) filter["items.organizationId"] = query.organizationId;
    } else if (this.isSeller(actor)) {
      filter["items.sellerId"] = actor.ownerSellerId || actor.sellerId || actor.userId;
      if (actor.organizationId) {
        filter.$and = [
          ...(filter.$and || []),
          {
            $or: [
              { "items.organizationId": actor.organizationId },
              { "items.organizationId": { $exists: false } },
              { "items.organizationId": "" },
            ],
          },
        ];
      }
    }
    if (!this.isAdmin(actor) && !this.isSeller(actor)) filter.buyerId = actor.userId;
    const limit = Math.min(Number(query.limit || 50), 200);
    const offset = Number(query.offset || 0);
    const sortMap = {
      createdAt: "createdAt",
      requestedAt: "requestedAt",
      refundAmount: "refundAmount",
      status: "status",
      reason: "reason",
      orderId: "orderId",
      buyerId: "buyerId",
      returnNumber: "returnNumber",
    };
    const sortKey = sortMap[query.sortBy] || "createdAt";
    const sortDir = query.sortDir === "asc" ? 1 : -1;
    const [items, total] = await Promise.all([
      ReturnModel.find(filter).sort({ [sortKey]: sortDir }).skip(offset).limit(limit).lean(),
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
          returnNumber: returnRequest.returnNumber || null,
          orderId: returnRequest.orderId,
          buyerId: returnRequest.buyerId,
          sellerId: returnRequest.sellerId || null,
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
