const { OrderRepository } = require("../repositories/order.repository");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { ORDER_STATUS, PAYMENT_PROVIDER, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { PricingService } = require("../../pricing/services/pricing.service");
const { InventoryService } = require("../../inventory/services/inventory.service");
const { AppError } = require("../../../shared/errors/app-error");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { v4: uuidv4 } = require("uuid");
const { WalletService } = require("../../wallet/services/wallet.service");
const { ProductModel } = require("../../product/models/product.model");
const { validateStatusTransition } = require("../../../shared/domain/status-transition");
const { auditService } = require("../../../shared/logger/audit.service");
const { TaxService } = require("../../tax/services/tax.service");
const { CommissionService } = require("../../seller/services/commission.service");
const { DealService } = require("../../deal/services/deal.service");
const { CartRepository } = require("../../cart/repositories/cart.repository");
const { logger } = require("../../../shared/logger/logger");
const { ReferralService } = require("../../referral/services/referral.service");
const { ROLES } = require("../../../shared/constants/roles");
const { UserModel } = require("../../user/models/user.model");
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");
const { documentRendererService } = require("../../../shared/services/document-renderer.service");
const { ReturnModel } = require("../../returns/models/return.model");
const { withTransientDatabaseRetry } = require("../../../shared/errors/database-error");

class OrderService {
  constructor({
    orderRepository = new OrderRepository(),
    pricingService = new PricingService(),
    inventoryService = new InventoryService(),
    walletService = new WalletService(),
    taxService = new TaxService({ orderRepository }),
    commissionService = CommissionService,
    dealService = new DealService(),
    cartRepository = new CartRepository(),
    referralService = new ReferralService(),
  } = {}) {
    this.orderRepository = orderRepository;
    this.pricingService = pricingService;
    this.inventoryService = inventoryService;
    this.walletService = walletService;
    this.taxService = taxService;
    this.commissionService = commissionService;
    this.dealService = dealService;
    this.cartRepository = cartRepository;
    this.referralService = referralService;
  }

  orderStatusToShipmentStatus(status, deliveryStatus = null) {
    if (deliveryStatus === "delivered") return "delivered";
    return {
      [ORDER_STATUS.PACKED]: "initiated",
      [ORDER_STATUS.READY_TO_SHIP]: "manifested",
      [ORDER_STATUS.SHIPPED]: "in_transit",
      [ORDER_STATUS.OUT_FOR_DELIVERY]: "out_for_delivery",
      [ORDER_STATUS.DELIVERED]: "delivered",
      [ORDER_STATUS.FAILED_DELIVERY]: "failed",
      [ORDER_STATUS.FULFILLED]: "delivered",
    }[status] || null;
  }

  async ensureOrderTaxDocuments(orderId) {
    const bundle = await this.taxService.createMarketplaceInvoices(orderId, {
      userId: "tax-service",
      role: ROLES.SUPER_ADMIN,
    });
    return bundle?.orderInvoice || null;
  }

  orderStatusToDeliveryStatus(status, currentDeliveryStatus = null) {
    return this.orderStatusToShipmentStatus(status);
  }

  groupOrderItemsBySeller(items = []) {
    return items.reduce((groups, item) => {
      const sellerSnapshot = this.normalizeJson(item.seller_snapshot || item.sellerSnapshot, {});
      const productSnapshot = this.normalizeJson(item.product_snapshot || item.productSnapshot, {});
      // Older/platform catalog products may not have seller_id on the order
      // item. They still need a forward shipment record, grouped as platform.
      const sellerId = String(
        item.seller_id || item.sellerId || sellerSnapshot.sellerId || productSnapshot.sellerId || "platform",
      );
      const organizationId = item.organization_id || item.organizationId ||
        sellerSnapshot.organizationId || productSnapshot.organizationId || null;
      const key = `${sellerId}:${organizationId || "default"}`;
      if (!groups.has(key)) {
        groups.set(key, { sellerId, organizationId, items: [] });
      }
      groups.get(key).items.push(item);
      return groups;
    }, new Map());
  }

  sellerIdsFromItems(items = []) {
    return [...new Set(
      items
        .map((item) => {
          const sellerSnapshot = this.normalizeJson(item.seller_snapshot || item.sellerSnapshot, {});
          const productSnapshot = this.normalizeJson(item.product_snapshot || item.productSnapshot, {});
          return item.sellerId || item.seller_id || sellerSnapshot.sellerId || productSnapshot.sellerId;
        })
        .filter((sellerId) => sellerId && String(sellerId) !== "platform")
        .map(String),
    )];
  }

  notificationItemsFromOrderItems(items = []) {
    return items.map((item) => {
      const sellerSnapshot = this.normalizeJson(item.seller_snapshot || item.sellerSnapshot, {});
      const productSnapshot = this.normalizeJson(item.product_snapshot || item.productSnapshot, {});
      return {
        sellerId: item.sellerId || item.seller_id || sellerSnapshot.sellerId || productSnapshot.sellerId || null,
        sellerEmail: sellerSnapshot.email || sellerSnapshot.sellerEmail || productSnapshot.sellerEmail || null,
        productId: item.productId || item.product_id || null,
        productName: item.productName || item.product_name || item.productTitle || item.product_title || null,
        productSku: item.productSku || item.product_sku || item.sku || null,
        variantTitle: item.variantTitle || item.variant_title || null,
        quantity: Number(item.quantity || 0),
        lineTotal: item.lineTotal || item.line_total || null,
      };
    });
  }

  getDisplayNameFromProfile(profile = {}, fallback = "") {
    return [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
      profile.fullName ||
      fallback ||
      "";
  }

  async getBuyerNotificationPayload(buyerId, fallbackEmail = null, shippingAddress = {}) {
    if (!buyerId) return {};
    const buyer = fallbackEmail
      ? null
      : await UserModel.findById(buyerId).select("email phone profile").lean().catch(() => null);
    const buyerEmail = fallbackEmail || buyer?.email || null;
    const buyerName = shippingAddress.fullName ||
      this.getDisplayNameFromProfile(buyer?.profile, buyerEmail || "Customer");
    const buyerPhone = shippingAddress.phone || buyer?.phone || null;
    return {
      ...(buyerEmail ? { buyerEmail, customerEmail: buyerEmail } : {}),
      ...(buyerName ? { buyerName, customerName: buyerName } : {}),
      ...(buyerPhone ? { buyerPhone, customerPhone: buyerPhone } : {}),
      ...(shippingAddress && Object.keys(shippingAddress).length ? { shippingAddress } : {}),
    };
  }

  async getOrderNotificationSellerPayload(orderId) {
    const items = await this.orderRepository.findItemsByOrderId(orderId).catch(() => []);
    return {
      sellerIds: this.sellerIdsFromItems(items),
      items: this.notificationItemsFromOrderItems(items),
    };
  }

  async publishOrderPaidNotification(orderId, order = {}, updatedOrder = {}, actor = {}, invoice = null) {
    const notificationSellerPayload = await this.getOrderNotificationSellerPayload(orderId);
    const buyerNotificationPayload = await this.getBuyerNotificationPayload(
      order.buyer_id || order.buyerId,
      null,
      this.normalizeJson(order.shipping_address || order.shippingAddress, {}),
    );
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.ORDER_PAID_V1 || DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
        {
          orderId,
          orderNumber: updatedOrder.order_number || order.order_number || updatedOrder.orderNumber || order.orderNumber,
          buyerId: order.buyer_id || order.buyerId,
          ...buyerNotificationPayload,
          ...notificationSellerPayload,
          status: ORDER_STATUS.CONFIRMED,
          paymentStatus: PAYMENT_STATUS.CAPTURED,
          paymentProvider: updatedOrder.payment_provider || order.payment_provider || updatedOrder.paymentProvider || order.paymentProvider,
          totalAmount: updatedOrder.total_amount ?? order.total_amount ?? updatedOrder.totalAmount ?? order.totalAmount,
          payableAmount: updatedOrder.payable_amount ?? order.payable_amount ?? updatedOrder.payableAmount ?? order.payableAmount,
          currency: updatedOrder.currency || order.currency,
          invoiceId: invoice?.id || null,
          updatedBy: actor.userId || null,
        },
        { source: "order-module", aggregateId: orderId },
      ),
    );
  }

  getFulfillmentSnapshotForItems(items = []) {
    const result = {
      dealId: null,
      fulfillmentModel: null,
    };

    for (const item of items) {
      const fulfillment = this.normalizeJson(item.fulfillment_snapshot || item.fulfillmentSnapshot, {});
      const deal = this.normalizeJson(item.deal_snapshot || item.dealSnapshot, {});
      if (!result.dealId) result.dealId = item.deal_id || item.dealId || fulfillment.dealId || deal.dealId || null;
      if (!result.fulfillmentModel) result.fulfillmentModel = fulfillment.fulfillmentModel || deal.fulfillmentModel || null;
    }
    return result;
  }

  async clearPurchasedCartItems(orderId, buyerId, items = [], actor = {}, reason = "order_paid") {
    try {
      const purchasedItems = items.length ? items : await this.orderRepository.findItemsByOrderId(orderId);
      await this.cartRepository.removePurchasedItemsForUser(buyerId, purchasedItems, {
        checkoutOrderId: orderId,
        checkoutClearReason: reason,
        checkoutClearedBy: actor.userId || buyerId,
        checkoutClearedByRole: actor.role || "system",
      });
    } catch (error) {
      logger.warn({ orderId, buyerId, error: error.message }, "Cart cleanup after checkout failed");
    }
  }

  async syncShipmentsForOrderStatus(orderId, nextStatus, actor = {}, trackingInfo = null) {
    const shipmentStatus = this.orderStatusToShipmentStatus(nextStatus, actor.deliveryStatus);
    if (!shipmentStatus) return;

    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) return;

    const metadata = this.normalizeJson(order.metadata, {});
    const tracking = trackingInfo || metadata.tracking || {};
    const itemsBySeller = this.groupOrderItemsBySeller(order.items || []);
    const actorIsSeller = ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);
    const actorSellerId = String(actor.ownerSellerId || actor.sellerId || actor.userId || "");

    for (const group of itemsBySeller.values()) {
      const { sellerId, organizationId, items: sellerItems } = group;
      if (actorIsSeller && String(sellerId) !== actorSellerId) continue;
      const fulfillment = this.getFulfillmentSnapshotForItems(sellerItems);
      await this.orderRepository.createShipment({
        orderId,
        sellerId,
        status: shipmentStatus,
        orderStatus: nextStatus,
        trackingNumber: tracking.trackingNumber || null,
        carrierName: tracking.carrierName || null,
        carrierUrl: tracking.carrierUrl || null,
        cod: order.payment_provider === PAYMENT_PROVIDER.COD,
        provider: tracking.carrierName ? "manual" : undefined,
        shipToSnapshot: this.normalizeJson(order.shipping_address, {}),
        labelData: {
          type: "packing_box_label",
          orderId,
          orderNumber: order.order_number || null,
          barcodeValue: `${orderId}:${sellerId}:${organizationId || "default"}`,
        },
        dealId: fulfillment.dealId,
        fulfillmentModel: fulfillment.fulfillmentModel,
        metadata: {
          source: "order_status_sync",
          orderStatus: nextStatus,
          organizationId: organizationId || null,
          orderItemIds: sellerItems.map((item) => item.id).filter(Boolean),
        },
        idempotencyKey: `order-status:${orderId}:${sellerId}:${organizationId || "default"}`,
        createdBy: actor.userId || null,
        updatedBy: actor.userId || null,
        note: `Order moved to ${nextStatus}`,
      });
    }
  }

  async ensureShipmentsForOrder(orderId, actor = {}, reason = "order_created") {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order || [ORDER_STATUS.CANCELLED, ORDER_STATUS.PAYMENT_FAILED].includes(order.status)) return;

    const itemsBySeller = this.groupOrderItemsBySeller(order.items || []);
    for (const group of itemsBySeller.values()) {
      const { sellerId, organizationId, items: sellerItems } = group;
      const fulfillment = this.getFulfillmentSnapshotForItems(sellerItems);
      await this.orderRepository.createShipment({
        orderId,
        sellerId,
        status: "initiated",
        orderStatus: order.status,
        cod: order.payment_provider === PAYMENT_PROVIDER.COD,
        provider: "manual",
        shipToSnapshot: this.normalizeJson(order.shipping_address, {}),
        labelData: {
          type: "packing_box_label",
          orderId,
          orderNumber: order.order_number || null,
          barcodeValue: `${orderId}:${sellerId}:${organizationId || "default"}`,
        },
        dealId: fulfillment.dealId,
        fulfillmentModel: fulfillment.fulfillmentModel,
        metadata: {
          source: "order_auto_shipment",
          reason,
          organizationId: organizationId || null,
          orderItemIds: sellerItems.map((item) => item.id).filter(Boolean),
        },
        idempotencyKey: `order-shipment:${orderId}:${sellerId}:${organizationId || "default"}`,
        createdBy: actor.userId || order.buyer_id || null,
        updatedBy: actor.userId || order.buyer_id || null,
        note: `Shipment created for order ${reason}`,
      });
    }
  }

  async ensureShipmentsForConfirmedOrder(orderId, actor = {}, reason = "order_confirmed") {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order || order.status !== ORDER_STATUS.CONFIRMED) return;
    return this.ensureShipmentsForOrder(orderId, actor, reason);
  }

  async createOrder(payload, actor) {
    if (payload.idempotencyKey) {
      const existingOrder = await this.orderRepository.findByBuyerIdempotencyKey(
        actor.userId,
        payload.idempotencyKey,
      );
      if (existingOrder) {
        return existingOrder;
      }
    }

    const pricedOrder = await this.pricingService.priceOrder({
      items: payload.items,
      couponCode: payload.couponCode,
      walletAmount: payload.walletAmount,
      shippingAddress: payload.shippingAddress,
      userId: actor.userId,
      paymentProvider: payload.paymentProvider,
    });
    const orderId = uuidv4();
    const orderNumber = payload.orderNumber || this.orderRepository.generateOrderNumber();
    const payableAmount = pricedOrder.pricing.payableAmount;
    const buyerNotificationPayload = await this.getBuyerNotificationPayload(
      actor.userId,
      actor.email,
      payload.shippingAddress,
    );
    const orderEvent = makeEvent(
      DOMAIN_EVENTS.ORDER_CREATED_V1,
      {
        orderId,
        orderNumber,
        buyerId: actor.userId,
        ...buyerNotificationPayload,
        sellerIds: this.sellerIdsFromItems(pricedOrder.items),
        totalAmount: pricedOrder.pricing.totalAmount,
        payableAmount: pricedOrder.pricing.payableAmount,
        status: payableAmount > 0 ? ORDER_STATUS.PENDING_PAYMENT : ORDER_STATUS.CONFIRMED,
        paymentStatus: payableAmount > 0 ? PAYMENT_STATUS.INITIATED : PAYMENT_STATUS.CAPTURED,
        paymentProvider: pricedOrder.pricing.paymentProvider,
        platformFeeAmount: pricedOrder.pricing.platformFeeAmount,
        codChargeAmount: pricedOrder.pricing.codChargeAmount,
        shippingFeeAmount: pricedOrder.pricing.shippingFeeAmount,
        currency: payload.currency || "INR",
        itemCount: pricedOrder.items.length,
        items: this.notificationItemsFromOrderItems(pricedOrder.items),
      },
      {
        source: "order-module",
      },
    );

    try {
      await this.inventoryService.reserveForOrder(orderId, actor.userId, pricedOrder.items);
      await this.walletService.hold(
        actor.userId,
        pricedOrder.walletToReserveAmount,
        orderId,
        { reason: "order_checkout" },
      );

      const order = await this.orderRepository.createOrder(
        {
          id: orderId,
          orderNumber,
          currency: payload.currency || "INR",
          subtotalAmount: pricedOrder.pricing.subtotalAmount,
          discountAmount: pricedOrder.pricing.discountAmount,
          taxAmount: pricedOrder.pricing.taxAmount,
          totalAmount: pricedOrder.pricing.totalAmount,
          walletDiscountAmount: pricedOrder.pricing.walletAppliedAmount,
          payableAmount,
          couponCode: pricedOrder.pricing.appliedCouponCode,
          taxBreakup: pricedOrder.pricing.taxBreakup,
          platformFeeAmount: pricedOrder.pricing.platformFeeAmount,
          platformFeeBreakup: pricedOrder.pricing.platformFeeBreakup,
          paymentProvider: pricedOrder.pricing.paymentProvider,
          codChargeAmount: pricedOrder.pricing.codChargeAmount,
          shippingFeeAmount: pricedOrder.pricing.shippingFeeAmount,
          shippingAddress: payload.shippingAddress,
          metadata: {
            paymentProvider: pricedOrder.pricing.paymentProvider,
            codCharge: pricedOrder.pricing.codChargeBreakup,
            deliveryCharge: pricedOrder.pricing.deliveryChargeBreakup,
            commerceSettings: pricedOrder.pricing.commerceSettingsSnapshot,
            pricingSummary: {
              customerItemsAmount: pricedOrder.pricing.customerItemsAmount,
              discountAmount: pricedOrder.pricing.discountAmount,
              discountFundingType: pricedOrder.pricing.discountFundingType,
              sellerFundingPercent: pricedOrder.pricing.sellerFundingPercent,
              sellerFundedDiscountAmount: pricedOrder.pricing.sellerFundedDiscountAmount,
              marketplaceFundedDiscountAmount: pricedOrder.pricing.marketplaceFundedDiscountAmount,
              paymentPartnerFundedDiscountAmount: pricedOrder.pricing.paymentPartnerFundedDiscountAmount,
              taxIncludedAmount: pricedOrder.pricing.taxIncludedAmount,
              taxPayableAmount: pricedOrder.pricing.taxPayableAmount,
              deliveryChargeAmount: pricedOrder.pricing.deliveryChargeAmount,
              shippingFeeAmount: pricedOrder.pricing.shippingFeeAmount,
              sellerCommission: pricedOrder.pricing.sellerPlatformFeeAmount,
              sellerCommissionGST: pricedOrder.pricing.sellerPlatformFeeTaxAmount,
              totalSellerDeduction: pricedOrder.pricing.totalSellerDeduction,
              sellerReceivable: pricedOrder.pricing.sellerPayoutAmount,
              customerPlatformFee: pricedOrder.pricing.customerPlatformFeeAmount,
              customerPlatformFeeGST: pricedOrder.pricing.customerPlatformFeeTaxAmount,
              totalPaid: pricedOrder.pricing.payableAmount,
              sellerPlatformFeeAmount: pricedOrder.pricing.sellerPlatformFeeAmount,
              sellerPlatformFeeTaxAmount: pricedOrder.pricing.sellerPlatformFeeTaxAmount,
              customerPlatformFeeAmount: pricedOrder.pricing.customerPlatformFeeAmount,
              customerPlatformFeeTaxAmount: pricedOrder.pricing.customerPlatformFeeTaxAmount,
              sellerCommissionAmount: pricedOrder.pricing.sellerPlatformFeeAmount,
              totalSellerDeductionAmount: pricedOrder.pricing.totalSellerDeduction,
              customerPaid: pricedOrder.pricing.payableAmount,
              platformFeeChargedToCustomer: Number(pricedOrder.pricing.customerPlatformFeeAmount || 0) > 0,
              sellerPayoutAmount: pricedOrder.pricing.sellerPayoutAmount,
              sellerSettlementBreakup: pricedOrder.pricing.sellerSettlementBreakup,
            },
            idempotencyKey: payload.idempotencyKey || undefined,
            referral: pricedOrder.referralContext
              ? {
                  code: pricedOrder.referralContext.code,
                  influencerId: pricedOrder.referralContext.influencerId,
                  referralPoolAmount: pricedOrder.referralContext.referralPoolAmount,
                  customerDiscountAmount: pricedOrder.referralContext.customerDiscountAmount,
                  itemDistributions: pricedOrder.referralContext.itemDistributions,
                }
              : undefined,
          },
          items: pricedOrder.items,
          buyerId: actor.userId,
          status: payableAmount > 0 ? ORDER_STATUS.PENDING_PAYMENT : ORDER_STATUS.CONFIRMED,
          paymentStatus: payableAmount > 0 ? PAYMENT_STATUS.INITIATED : PAYMENT_STATUS.CAPTURED,
          deliveryStatus: null,
          createdBy: actor.userId,
          actorRole: actor.role,
        },
        orderEvent,
      );
      const hydratedOrder = await this.orderRepository.findByIdWithItems(order.id);
      await this.dealService.reserveOrderSales(hydratedOrder, {
        userId: actor.userId,
        role: actor.role || "buyer",
      });
      // Create one forward shipment per seller as soon as the order exists.
      // Confirmation later reuses the same shipment through repository
      // idempotency rather than inserting a duplicate.
      await this.ensureShipmentsForOrder(order.id, actor, "order_created");

      await this.referralService.recordInfluencerReferralOrder({
        orderId: order.id,
        customerId: actor.userId,
        orderStatus: order.status,
        paymentStatus: order.payment_status || order.paymentStatus,
        referralContext: pricedOrder.referralContext,
      });

      await this.pricingService.finalizeCouponUsage(pricedOrder.couponToConsume);
      if (payableAmount <= 0) {
        await this.walletService.capture(actor.userId, orderId);
        await this.inventoryService.commitForOrder(orderId);
        await this.dealService.commitOrderSales(orderId, {
          userId: actor.userId,
          role: actor.role || "buyer",
        });
        await this.ensureOrderTaxDocuments(orderId);
        await this.clearPurchasedCartItems(orderId, actor.userId, pricedOrder.items, actor, "zero_payable_order_confirmed");
        const notificationSellerPayload = await this.getOrderNotificationSellerPayload(orderId);
        const statusBuyerNotificationPayload = await this.getBuyerNotificationPayload(
          actor.userId,
          actor.email,
          payload.shippingAddress,
        );
        await eventPublisher.publish(
          makeEvent(
            DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
            {
              orderId,
              orderNumber,
              buyerId: actor.userId,
              ...statusBuyerNotificationPayload,
              ...notificationSellerPayload,
              previousStatus: ORDER_STATUS.PENDING_PAYMENT,
              status: ORDER_STATUS.CONFIRMED,
              paymentStatus: PAYMENT_STATUS.CAPTURED,
              paymentProvider: pricedOrder.pricing.paymentProvider,
              totalAmount: pricedOrder.pricing.totalAmount,
              payableAmount: pricedOrder.pricing.payableAmount,
              currency: payload.currency || "INR",
              updatedBy: actor.userId,
            },
            {
              source: "order-module",
              aggregateId: orderId,
            },
          ),
        );
        await this.ensureShipmentsForConfirmedOrder(orderId, actor, "zero_payable_order_confirmed");
      }
      return this.filterOrderForBuyer(await this.orderRepository.findByIdWithItems(order.id));
    } catch (error) {
      await this.inventoryService.releaseForOrder(orderId);
      await this.walletService.release(actor.userId, orderId);
      await this.dealService.releaseOrderSales(orderId, {
        userId: actor.userId,
        role: actor.role || "buyer",
      }).catch(() => null);
      await this.orderRepository.deleteById(orderId);
      throw error;
    }
  }

  async quoteOrder(payload, actor, options = {}) {
    const quoteUserId = options.buyerId || actor.userId;
    const pricedOrder = await this.pricingService.priceOrder({
      items: payload.items,
      couponCode: payload.couponCode,
      walletAmount: payload.walletAmount,
      shippingAddress: payload.shippingAddress,
      userId: quoteUserId,
      paymentProvider: payload.paymentProvider,
    });
    const pricing = pricedOrder.pricing;

    return {
      quote: {
        currency: payload.currency || "INR",
        paymentProvider: pricing.paymentProvider,
        appliedCouponCode: pricing.appliedCouponCode,
        discountSource: pricing.discountSource || null,
        referralDiscountAmount: pricing.referralDiscountAmount || 0,
        subtotalAmount: pricing.subtotalAmount,
        discountAmount: pricing.discountAmount,
        discountFundingType: pricing.discountFundingType,
        sellerFundedDiscountAmount: pricing.sellerFundedDiscountAmount,
        marketplaceFundedDiscountAmount: pricing.marketplaceFundedDiscountAmount,
        paymentPartnerFundedDiscountAmount: pricing.paymentPartnerFundedDiscountAmount,
        walletAppliedAmount: pricing.walletAppliedAmount,
        taxAmount: pricing.taxAmount,
        taxIncludedAmount: pricing.taxIncludedAmount,
        taxPayableAmount: pricing.taxPayableAmount,
        platformFeeAmount: pricing.platformFeeAmount,
        sellerCommission: pricing.sellerPlatformFeeAmount,
        sellerCommissionGST: pricing.sellerPlatformFeeTaxAmount,
        totalSellerDeduction: pricing.totalSellerDeduction,
        sellerReceivable: pricing.sellerPayoutAmount,
        customerPlatformFee: pricing.customerPlatformFeeAmount,
        customerPlatformFeeGST: pricing.customerPlatformFeeTaxAmount,
        totalPaid: pricing.payableAmount,
        sellerPlatformFeeAmount: pricing.sellerPlatformFeeAmount,
        sellerPlatformFeeTaxAmount: pricing.sellerPlatformFeeTaxAmount,
        customerPlatformFeeAmount: pricing.customerPlatformFeeAmount,
        customerPlatformFeeTaxAmount: pricing.customerPlatformFeeTaxAmount,
        codChargeAmount: pricing.codChargeAmount,
        deliveryChargeAmount: pricing.deliveryChargeAmount,
        shippingFeeAmount: pricing.shippingFeeAmount,
        totalAmount: pricing.totalAmount,
        payableAmount: pricing.payableAmount,
      },
      items: pricedOrder.items,
      taxBreakup: pricing.taxBreakup,
      platformFeeBreakup: pricing.platformFeeBreakup,
      codChargeBreakup: pricing.codChargeBreakup,
      deliveryChargeBreakup: pricing.deliveryChargeBreakup,
      sellerSettlements: pricing.sellerSettlementBreakup,
      context: {
        buyerId: quoteUserId,
        quotedBy: actor.userId,
        quotedByRole: actor.role,
        referral: pricedOrder.referralContext
          ? {
              code: pricedOrder.referralContext.code,
              influencerId: pricedOrder.referralContext.influencerId,
              referralPoolAmount: pricedOrder.referralContext.referralPoolAmount,
              customerDiscountAmount: pricedOrder.referralContext.customerDiscountAmount,
              itemDistributions: pricedOrder.referralContext.itemDistributions,
            }
          : null,
      },
      summary: {
        itemAmount: pricing.subtotalAmount,
        customerItemsAmount: pricing.customerItemsAmount,
        discountAmount: pricing.discountAmount,
        discountFundingType: pricing.discountFundingType,
        sellerFundedDiscountAmount: pricing.sellerFundedDiscountAmount,
        marketplaceFundedDiscountAmount: pricing.marketplaceFundedDiscountAmount,
        paymentPartnerFundedDiscountAmount: pricing.paymentPartnerFundedDiscountAmount,
        walletDiscountAmount: pricing.walletAppliedAmount,
        taxAmount: pricing.taxAmount,
        taxIncludedAmount: pricing.taxIncludedAmount,
        taxPayableAmount: pricing.taxPayableAmount,
        platformFeeAmount: pricing.platformFeeAmount,
        sellerCommission: pricing.sellerPlatformFeeAmount,
        sellerCommissionGST: pricing.sellerPlatformFeeTaxAmount,
        totalSellerDeduction: pricing.totalSellerDeduction,
        sellerReceivable: pricing.sellerPayoutAmount,
        customerPlatformFee: pricing.customerPlatformFeeAmount,
        customerPlatformFeeGST: pricing.customerPlatformFeeTaxAmount,
        totalPaid: pricing.payableAmount,
        sellerPlatformFeeAmount: pricing.sellerPlatformFeeAmount,
        sellerPlatformFeeTaxAmount: pricing.sellerPlatformFeeTaxAmount,
        customerPlatformFeeAmount: pricing.customerPlatformFeeAmount,
        customerPlatformFeeTaxAmount: pricing.customerPlatformFeeTaxAmount,
        codChargeAmount: pricing.codChargeAmount,
        deliveryChargeAmount: pricing.deliveryChargeAmount,
        shippingFeeAmount: pricing.shippingFeeAmount,
        customerTotalAmount: pricing.totalAmount,
        customerPayableAmount: pricing.payableAmount,
        sellerPayoutAmount: pricing.sellerPayoutAmount,
        platformFeeChargedToCustomer: Number(pricing.customerPlatformFeeAmount || 0) > 0,
      },
    };
  }

  async listMyOrders(actor, filters = {}) {
    const orders = await this.orderRepository.listOrdersByBuyer(actor.userId, filters);
    const returns = orders.length
      ? await ReturnModel.find({ orderId: { $in: orders.map((order) => String(order.id)) } }).lean()
      : [];
    const returnsByOrder = returns.reduce((map, returnRequest) => {
      const key = String(returnRequest.orderId || "");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(returnRequest);
      return map;
    }, new Map());
    return orders.map((order) => this.filterOrderForBuyer(
      order,
      null,
      returnsByOrder.get(String(order.id)) || [],
    ));
  }

  async listSellerOrders(actor, filters = {}) {
      const sellerId = actor.ownerSellerId || actor.sellerId || actor.userId;
    const scopedFilters = {
      ...filters,
      organizationId: filters.organizationId || actor.organizationId || null,
    };
    let orders;
    if (["seller-admin", "seller-sub-admin"].includes(actor.role)) {
      const products = await ProductModel.find({ sellerId, createdBy: actor.userId }).select("_id");
      const productIds = products.map((product) => String(product._id));
      if (!productIds.length) return [];
      orders = await withTransientDatabaseRetry(
        () => this.orderRepository.listOrdersBySeller(sellerId, productIds, scopedFilters),
        { attempts: 3, delayMs: 150 },
      );
      return orders.map((order) => this.filterOrderForSeller(order, sellerId, scopedFilters.organizationId));
    }
    orders = await withTransientDatabaseRetry(
      () => this.orderRepository.listOrdersBySeller(sellerId, null, scopedFilters),
      { attempts: 3, delayMs: 150 },
    );
    return orders.map((order) => this.filterOrderForSeller(order, sellerId, scopedFilters.organizationId));
  }

  async listAdminOrders(actor, filters = {}) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can list all orders", 403);
    }
    return withTransientDatabaseRetry(
      () => this.orderRepository.listOrdersForAdmin(filters),
      { attempts: 3, delayMs: 150 },
    );
  }

  async getOrder(orderId, actor) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) {
      throw AppError.notFound("Order");
    }

    const isOwner = order.buyer_id === actor.userId;
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
      const sellerId = actor.ownerSellerId || actor.sellerId || actor.userId;
    const isSeller = ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role)
      ? await this.orderRepository.isSellerInOrder(orderId, sellerId)
      : false;

    if (!isOwner && !isAdmin && !isSeller) {
      throw new AppError("You are not allowed to view this order", 403);
    }

    if (isAdmin) {
      return order;
    }

    const activeCommerceSettings = isOwner ? await commerceSettingsService.getSettings().catch(() => null) : null;
    const buyerReturns = isOwner
      ? await ReturnModel.find({ orderId: String(order.id) }).lean()
      : [];
    const scopedOrder = isOwner
      ? this.filterOrderForBuyer(
        order,
        activeCommerceSettings?.returns?.refundPolicy || null,
        buyerReturns,
      )
      : !isOwner && isSeller
        ? this.filterOrderForSeller(order, sellerId, actor.organizationId)
        : order;

    if (!isOwner && isSeller && actor.organizationId && !scopedOrder.items?.length) {
      throw new AppError("Order does not belong to the selected organization", 403);
    }

    const visibleNotes = (scopedOrder.notes || []).filter((note) => {
      if (isOwner) return note.visibility === "buyer";
      if (isSeller) return ["seller", "internal"].includes(note.visibility);
      return false;
    });

    return { ...scopedOrder, notes: visibleNotes };
  }

  isBoxLabelAllowed(order = {}) {
    const blocked = new Set([
      ORDER_STATUS.PENDING_PAYMENT,
      ORDER_STATUS.PAYMENT_FAILED,
      ORDER_STATUS.CANCELLED,
    ]);
    return order?.status && !blocked.has(order.status);
  }

  getAddressLines(address = {}) {
    return [
      address.fullName || address.name,
      address.line1 || address.addressLine1 || address.address,
      address.line2 || address.addressLine2,
      [address.city, address.state, address.postalCode || address.pincode].filter(Boolean).join(", "),
      address.country,
      address.phone ? `Phone: ${address.phone}` : null,
    ].filter(Boolean);
  }

  getSellerAddressLines(seller = {}, shipment = {}) {
    const sellerProfile = seller.sellerProfile || {};
    const pickup = shipment.pickup_address_snapshot || shipment.pickupAddressSnapshot ||
      sellerProfile.pickupAddress || sellerProfile.businessAddress || {};
    return [
      sellerProfile.businessName || sellerProfile.displayName || seller.profile?.firstName || seller.email || "Seller",
      ...this.getAddressLines(pickup).filter((line, index) => index !== 0),
      sellerProfile.supportPhone ? `Contact: ${sellerProfile.supportPhone}` : null,
      sellerProfile.supportEmail ? `Email: ${sellerProfile.supportEmail}` : null,
    ].filter(Boolean);
  }

buildBoxLabelDocument(order = {}, shipment = {}) {
  const relations = order.relations || {};
  const shipmentRelations = shipment.relations || {};

  const customer =
    relations.customer ||
    relations.buyer ||
    order.customer ||
    order.buyer ||
    {};

  const seller =
    shipmentRelations.seller ||
    shipment.seller ||
    relations.seller ||
    order.seller ||
    {};

  const shippingAddress =
    shipment.shippingAddress ||
    shipment.shipping_address ||
    order.shippingAddress ||
    order.shipping_address ||
    relations.shippingAddress ||
    relations.shipping_address ||
    {};

  const pickupAddress =
    shipment.pickupAddress ||
    shipment.pickup_address ||
    seller.pickupAddress ||
    seller.pickup_address ||
    seller.businessAddress ||
    seller.business_address ||
    seller.billingAddress ||
    seller.billing_address ||
    {};

  const shipmentItems =
    shipmentRelations.items ||
    shipment.items ||
    shipment.shipmentItems ||
    shipment.shipment_items ||
    [];

  const orderItems =
    relations.items ||
    order.items ||
    order.orderItems ||
    order.order_items ||
    [];

  const items = shipmentItems.length ? shipmentItems : orderItems;

  const orderNumber =
    order.orderNumber ||
    order.order_number ||
    order.number ||
    order.displayId ||
    order.display_id ||
    order.id;

  const shipmentNumber =
    shipment.shipmentNumber ||
    shipment.shipment_number ||
    shipment.number ||
    shipment.id;

  const trackingNumber =
    shipment.trackingNumber ||
    shipment.tracking_number ||
    shipment.awbNumber ||
    shipment.awb_number ||
    shipment.awb ||
    shipment.trackingId ||
    shipment.tracking_id ||
    shipmentNumber;

  const paymentMethod =
    order.paymentMethod ||
    order.payment_method ||
    order.payment?.method ||
    order.payment?.paymentMethod ||
    "PREPAID";

  const isCod =
    String(paymentMethod).toLowerCase() === "cod" ||
    String(paymentMethod).toLowerCase().includes("cash_on_delivery") ||
    order.isCod === true ||
    order.is_cod === true;

  const collectAmount = isCod
    ? Number(
        order.codAmount ??
        order.cod_amount ??
        order.amountToCollect ??
        order.amount_to_collect ??
        order.finalPayableAmount ??
        order.final_payable_amount ??
        order.totalAmount ??
        order.total_amount ??
        0,
      )
    : 0;

  const mappedItems = items.map((item) => ({
    productTitle:
      item.productTitle ||
      item.product_title ||
      item.title ||
      item.name ||
      item.product?.title ||
      item.product?.name ||
      item.orderItem?.productTitle ||
      item.order_item?.product_title ||
      "Product",

    sku:
      item.productSku ||
      item.product_sku ||
      item.variantSku ||
      item.variant_sku ||
      item.sku ||
      item.variant?.sku ||
      item.orderItem?.productSku ||
      item.order_item?.product_sku ||
      "",

    quantity: Number(
      item.quantity ??
      item.shippedQuantity ??
      item.shipped_quantity ??
      item.orderItem?.quantity ??
      item.order_item?.quantity ??
      1,
    ),
  }));

  const totalPieces = mappedItems.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0,
  );

  const document = {
    layout: "box_label",
    title: "Box Label",
    subtitle: `Order ${orderNumber}`,
    fileBaseName: `box-label-${orderNumber}-${shipmentNumber}`,
    generatedAt: new Date().toISOString(),

    data: {
      brand: {
        name: process.env.INVOICE_BRAND_NAME || "Sam Global",
        logoUrl: process.env.INVOICE_LOGO_URL || "",
        support:
          process.env.INVOICE_CONTACT ||
          process.env.SUPPORT_EMAIL ||
          "support@samglobal.com",
      },

      order: {
        id: order.id,
        number: orderNumber,
        placedAt:
          order.placedAt ||
          order.placed_at ||
          order.createdAt ||
          order.created_at,
      },

      shipment: {
        id: shipment.id,
        number: shipmentNumber,
        trackingNumber,
        carrier:
          shipment.carrierName ||
          shipment.carrier_name ||
          shipment.courierName ||
          shipment.courier_name ||
          shipment.provider ||
          "Self Shipping",

        service:
          shipment.serviceName ||
          shipment.service_name ||
          shipment.shippingMethod ||
          shipment.shipping_method ||
          "Standard Delivery",
      },

      recipient: {
        ...shippingAddress,
        fullName:
          shippingAddress.fullName ||
          shippingAddress.full_name ||
          shippingAddress.name ||
          customer.profile?.displayName ||
          [
            customer.profile?.firstName,
            customer.profile?.lastName,
          ].filter(Boolean).join(" ") ||
          customer.name ||
          "Customer",

        phone:
          shippingAddress.phone ||
          shippingAddress.phoneNumber ||
          shippingAddress.phone_number ||
          shippingAddress.mobile ||
          customer.phone ||
          customer.mobile ||
          "",
      },

      sender: {
        ...pickupAddress,
        fullName:
          seller.legalBusinessName ||
          seller.legal_business_name ||
          seller.displayName ||
          seller.display_name ||
          seller.businessName ||
          seller.business_name ||
          seller.name ||
          "Seller",

        phone:
          pickupAddress.phone ||
          pickupAddress.mobile ||
          seller.phone ||
          seller.mobile ||
          "",
      },

      payment: {
        method: isCod ? "COD" : String(paymentMethod).toUpperCase(),
        isCod,
        amountToCollect: collectAmount,
      },

      package: {
        weight:
          shipment.weight ||
          shipment.weightKg ||
          shipment.weight_kg ||
          shipment.packageWeight ||
          shipment.package_weight ||
          null,

        length:
          shipment.length ||
          shipment.lengthCm ||
          shipment.length_cm ||
          null,

        width:
          shipment.width ||
          shipment.widthCm ||
          shipment.width_cm ||
          null,

        height:
          shipment.height ||
          shipment.heightCm ||
          shipment.height_cm ||
          null,

        itemCount: totalPieces,
      },

      items: mappedItems,
    },

    // Keeps TXT and CSV output useful.
    sections: [
      {
        title: "Shipment",
        rows: [
          { label: "Order Number", value: orderNumber },
          { label: "Shipment Number", value: shipmentNumber },
          { label: "Tracking Number", value: trackingNumber },
          {
            label: "Carrier",
            value:
              shipment.carrierName ||
              shipment.carrier_name ||
              shipment.provider ||
              "Self Shipping",
          },
          {
            label: "Payment",
            value: isCod ? `COD - Collect INR ${collectAmount.toFixed(2)}` : "Prepaid",
          },
        ],
      },
      {
        title: "Package",
        rows: [
          { label: "Total Pieces", value: totalPieces },
          {
            label: "Weight",
            value:
              shipment.weight ||
              shipment.weightKg ||
              shipment.weight_kg ||
              "-",
          },
        ],
      },
    ],
  };

  return document;
}

  async downloadBoxLabel(orderId, shipmentId, actor, format = "pdf") {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) throw AppError.notFound("Order");
    await this.getOrder(orderId, actor);

    if (!this.isBoxLabelAllowed(order)) {
      throw new AppError("Box label is available only after order is confirmed or COD order is accepted", 409);
    }

    const shipment = (order.relations?.shipments || []).find((item) => String(item.id) === String(shipmentId));
    if (!shipment || String(shipment.direction || "forward") === "reverse") {
      throw AppError.notFound("Shipment");
    }

    const document = this.buildBoxLabelDocument(order, shipment);
    return documentRendererService.render(document, {
      format,
      fileBaseName: document.fileBaseName,
    });
  }

  filterOrderForBuyer(order = {}, fallbackRefundPolicy = null, returnRequests = []) {
    const relations = order.relations || {};
    const sanitizeTrackingEvent = (event = {}) => {
      const { raw_payload, rawPayload, actor_id, actorId, ...visible } = event;
      return visible;
    };
    const sanitizeShipment = (shipment = {}) => {
      const {
        delivery_proof_snapshot,
        raw_payload,
        metadata,
        created_by,
        updated_by,
        buyer_id,
        ...visible
      } = shipment;
      const shipmentMetadata = this.normalizeJson(metadata, {});
      return {
        ...visible,
        seller_id: shipment.seller_id || null,
        sellerId: shipment.seller_id || null,
        organizationId: shipment.organization_id || shipmentMetadata.organizationId || null,
        orderItemIds: Array.isArray(shipmentMetadata.orderItemIds) ? shipmentMetadata.orderItemIds : [],
        seller: shipment.seller ? {
          displayName: shipment.seller.displayName || shipment.seller.businessName || shipment.seller.email || "Seller",
          businessName: shipment.seller.businessName || shipment.seller.sellerProfile?.businessName || null,
          supportEmail: shipment.seller.sellerProfile?.supportEmail || null,
          supportPhone: shipment.seller.sellerProfile?.supportPhone || null,
        } : null,
        trackingEvents: (shipment.trackingEvents || []).map(sanitizeTrackingEvent),
      };
    };
    const orderTimeline = Array.isArray(order.timeline) ? order.timeline : [];
    const cancellationMatchesItem = (cancellation = {}, itemId) =>
      (Array.isArray(cancellation.items) ? cancellation.items : []).some((entry) =>
        String(entry.orderItemId || entry.order_item_id || entry.id || "") === String(itemId),
      );
    const returnMatchesItem = (returnRequest = {}, item = {}) =>
      (Array.isArray(returnRequest.items) ? returnRequest.items : []).some((entry) => {
        const entryItemId = entry.orderItemId || entry.order_item_id;
        if (entryItemId) return String(entryItemId) === String(item.id);
        return String(entry.productId || entry.product_id || "") === String(item.product_id || "") &&
          String(entry.variantSku || entry.variant_sku || entry.variantId || entry.variant_id || "") ===
            String(item.variant_sku || item.variant_id || "");
      });
    const resolveReturnDisplayStatus = (returnRequest = {}) => {
      const returnStatus = String(returnRequest.status || "").toLowerCase();
      const refundStatus = String(returnRequest.refund?.status || "").toLowerCase();
      if (refundStatus === "completed" || returnStatus === "refunded") return "refunded";
      if (returnStatus === "partially_refunded") return "partially_refunded";
      if (["pending", "provider_pending", "manual_review"].includes(refundStatus) || returnStatus === "refund_pending") {
        return "refund_pending";
      }
      if (refundStatus === "failed" || returnStatus === "refund_failed") return "refund_failed";
      if (returnStatus === "requested") return "return_requested";
      if (returnStatus === "approved") return "return_approved";
      return returnStatus || null;
    };
    const sanitizeReturn = (returnRequest = {}) => ({
      id: String(returnRequest._id || returnRequest.id || ""),
      _id: String(returnRequest._id || returnRequest.id || ""),
      orderId: returnRequest.orderId,
      returnNumber: returnRequest.returnNumber || null,
      status: returnRequest.status,
      resolution: returnRequest.resolution,
      refund: returnRequest.refund ? {
        status: returnRequest.refund.status || null,
        refundedAmount: Number(returnRequest.refund.refundedAmount || 0),
      } : null,
      items: (returnRequest.items || []).map((entry) => ({
        orderItemId: entry.orderItemId || null,
        productId: entry.productId || null,
        variantId: entry.variantId || null,
        variantSku: entry.variantSku || null,
        quantity: Number(entry.quantity || 0),
        requestedQuantity: Number(entry.requestedQuantity || entry.quantity || 0),
        approvedQuantity: Number(entry.approvedQuantity || 0),
        receivedQuantity: Number(entry.receivedQuantity || 0),
      })),
    });
    const shipmentMatchesItem = (shipment = {}, item = {}) => {
      const shipmentMetadata = this.normalizeJson(shipment.metadata, {});
      const shipmentItemIds = Array.isArray(shipmentMetadata.orderItemIds)
        ? shipmentMetadata.orderItemIds.map(String)
        : [];
      if (shipmentItemIds.length) return shipmentItemIds.includes(String(item.id));
      return (
        String(shipment.seller_id || "") === String(item.seller_id || "") &&
        String(shipment.organization_id || "default") === String(item.organization_id || "default")
      );
    };
    const items = (order.items || []).map((item) => {
      const {
        pricing_snapshot,
        platform_fee_amount,
        seller_snapshot,
        organization_snapshot,
        ...visible
      } = item;
      const sellerSnapshot = this.normalizeJson(seller_snapshot, {});
      const organizationSnapshot = this.normalizeJson(organization_snapshot, {});
      const itemShipments = (relations.shipments || []).filter((shipment) =>
        shipmentMatchesItem(shipment, item),
      );
      const itemCancellations = (relations.cancellations || []).filter((cancellation) =>
        cancellationMatchesItem(cancellation, item.id),
      );
      const itemReturn = returnRequests.find((returnRequest) => returnMatchesItem(returnRequest, item));
      const itemReturnStatus = itemReturn ? resolveReturnDisplayStatus(itemReturn) : null;
      const itemTimeline = [
        ...orderTimeline.map((entry) => ({ ...entry, source: entry.source || "order" })),
        ...itemShipments.flatMap((shipment) =>
          (shipment.trackingEvents || []).map((entry) => ({
            ...sanitizeTrackingEvent(entry),
            source: entry.source || "shipment",
            shipment_id: shipment.id,
          })),
        ),
        ...itemCancellations.map((cancellation) => ({
          id: `cancellation:${cancellation.id}:${item.id}`,
          status: item.cancellation_status || "cancelled",
          to_status: item.cancellation_status || "cancelled",
          note: cancellation.reason || "Item cancellation processed",
          source: "cancellation",
          cancellation_id: cancellation.id,
          created_at: cancellation.completed_at || cancellation.updated_at || cancellation.created_at,
        })),
      ].sort((left, right) =>
        new Date(left.event_time || left.created_at || left.at || 0) -
        new Date(right.event_time || right.created_at || right.at || 0),
      );
      const orderedQuantity = Number(item.quantity || 0);
      const cancelledQuantity = Number(item.cancelled_quantity || 0);
      const cancellationAdjustedReturnableQuantity = Math.max(
        orderedQuantity - cancelledQuantity,
        0,
      );
      const storedReturnable =
        item.returnable ??
        item.return_policy_snapshot?.returnable ??
        item.product_snapshot?.returnPolicy?.returnable ??
        true;
      return {
        ...visible,
        returnable: Boolean(storedReturnable) && cancellationAdjustedReturnableQuantity > 0,
        returnable_quantity: cancellationAdjustedReturnableQuantity,
        return_status: itemReturnStatus,
        returnStatus: itemReturnStatus,
        return_lifecycle: itemReturn ? {
          id: String(itemReturn._id || itemReturn.id || ""),
          status: itemReturn.status || null,
          refundStatus: itemReturn.refund?.status || null,
          refundAmount: Number(itemReturn.refund?.refundedAmount || itemReturn.refundAmount || 0),
        } : null,
        effective_status:
          item.cancellation_status ||
          itemReturnStatus ||
          item.return_status ||
          item.delivery_status ||
          itemShipments[0]?.status ||
          order.status,
        timeline: itemTimeline,
        seller: {
          name: sellerSnapshot.displayName || sellerSnapshot.businessName || organizationSnapshot.storeDisplayName || "Seller",
        },
      };
    });
    const orderMetadata = this.normalizeJson(order.metadata, {});
    const refundPolicySnapshot =
      orderMetadata.commerceSettings?.returns?.refundPolicy ||
      orderMetadata.settings?.returns?.refundPolicy ||
      order.summary?.refundPolicySnapshot ||
      fallbackRefundPolicy ||
      null;
    const { metadata: hiddenMetadata, platform_fee_breakup, ...visibleOrder } = order;

    return {
      ...visibleOrder,
      summary: {
        ...(visibleOrder.summary || {}),
        ...(refundPolicySnapshot ? { refundPolicySnapshot } : {}),
      },
      items,
      relations: {
        buyer: relations.buyer || null,
        sellers: (relations.sellers || []).map((seller) => ({
          displayName: seller.displayName || seller.businessName || seller.email || "Seller",
          businessName: seller.businessName || seller.sellerProfile?.businessName || null,
          supportEmail: seller.sellerProfile?.supportEmail || null,
          supportPhone: seller.sellerProfile?.supportPhone || null,
        })),
        payments: (relations.payments || []).map((payment) => ({
          provider: payment.provider,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          created_at: payment.created_at,
        })),
        invoice: relations.invoice || null,
        invoices: relations.invoices || [],
        shipments: (relations.shipments || []).map(sanitizeShipment),
        sellerFulfillmentGroups: (relations.sellerFulfillmentGroups || []).map((group) => ({
          sellerId: group.sellerId,
          organizationId: group.organizationId,
          sellerName: group.sellerName,
          organizationName: group.organizationName,
          organizationSnapshot: group.organizationSnapshot,
          itemIds: group.itemIds || group.orderItemIds,
          orderItemIds: group.orderItemIds || group.itemIds,
          shipmentIds: group.shipmentIds,
          itemCount: group.itemCount,
          quantity: group.quantity,
          deliveryStatus: group.deliveryStatus,
          shipmentStatus: group.shipmentStatus,
          expectedDeliveryAt: group.expectedDeliveryAt,
          latestTrackingEvent: group.latestTrackingEvent ? sanitizeTrackingEvent(group.latestTrackingEvent) : null,
          requiresVerification: group.requiresVerification,
          verificationComplete: group.verificationComplete,
          returnLifecycle: group.returnLifecycle,
          payoutStatus: group.payoutStatus,
          payoutEligibleAt: group.payoutEligibleAt,
        })),
        cancellations: relations.cancellations || [],
        returns: returnRequests.map(sanitizeReturn),
      },
    };
  }

  filterOrderForSeller(order = {}, sellerId, organizationId = null) {
    const sellerKey = String(sellerId || "");
    const organizationKey = organizationId ? String(organizationId) : null;
    const items = (order.items || []).filter((item) =>
      String(item.seller_id || item.sellerId || "") === sellerKey &&
      (!organizationKey || String(item.organization_id || item.organizationId || "") === organizationKey)
    );
    const productIds = new Set(items.map((item) => String(item.product_id || item.productId || "")));
    const relations = order.relations || {};
    const metadata = this.normalizeJson(order.metadata, {});
    const sellers = (relations.sellers || []).filter((seller) => String(seller.id || seller._id || "") === sellerKey);
  const pricingSummary = this.normalizeJson(
  metadata.pricingSummary,
  {},
);

const snapshotSettlements = Array.isArray(
  pricingSummary.sellerSettlementBreakup,
)
  ? pricingSummary.sellerSettlementBreakup
  : [];

const relationSettlements = Array.isArray(
  relations.sellerSettlements,
)
  ? relations.sellerSettlements
  : [];

const settlementSource = snapshotSettlements.length
  ? snapshotSettlements
  : relationSettlements;

const sellerSettlements = settlementSource.filter(
  (settlement) =>
    String(settlement.sellerId || "") === sellerKey &&
    (
      !organizationKey ||
      String(settlement.organizationId || "") === organizationKey
    ),
);

const sellerPayoutAmount = Number(
  sellerSettlements.reduce(
    (sum, settlement) =>
      sum + Number(settlement.sellerPayoutAmount || 0),
    0,
  ).toFixed(2),
);
    const sellerShipments = (relations.shipments || []).filter((shipment) => String(shipment.seller_id || shipment.sellerId || "") === sellerKey);
    const sellerFulfillmentGroups = (relations.sellerFulfillmentGroups || [])
      .filter((group) => String(group.sellerId || group.seller_id || "") === sellerKey);
    const taxBreakup = this.normalizeJson(order.tax_breakup, {});
    const taxItems = Array.isArray(taxBreakup.items)
      ? taxBreakup.items.filter((item) => productIds.has(String(item.productId || item.product_id || "")))
      : [];
    const sellerTaxBreakup = this.buildScopedTaxBreakup(taxBreakup, taxItems);
    const subtotalAmount = Number(items.reduce((sum, item) => sum + Number(item.line_total || item.lineTotal || 0), 0).toFixed(2));
    const platformFeeAmount = Number(items.reduce((sum, item) => sum + Number(item.platform_fee_amount || item.platformFeeAmount || 0), 0).toFixed(2));
 
    const sellerDeliveryCharge = Array.isArray(metadata.deliveryCharge?.sellers)
      ? metadata.deliveryCharge.sellers.find((entry) => String(entry.sellerId) === sellerKey)
      : null;
    const deliveryChargeAmount = Number(sellerDeliveryCharge?.chargeAmount || 0);
    const customerTotalAmount = Number((subtotalAmount + Number(sellerTaxBreakup.taxPayableAmount || 0) + deliveryChargeAmount).toFixed(2));

    return {
      ...order,
      subtotal_amount: subtotalAmount,
      tax_amount: Number(sellerTaxBreakup.totalTaxAmount || 0),
      total_amount: customerTotalAmount,
      payable_amount: customerTotalAmount,
      platform_fee_amount: platformFeeAmount,
      shipping_fee_amount: deliveryChargeAmount,
      tax_breakup: sellerTaxBreakup,
      platform_fee_breakup: this.filterPlatformFeeBreakup(order.platform_fee_breakup, productIds),
      items,
      summary: {
        ...(order.summary || {}),
        itemAmount: subtotalAmount,
        subtotalAmount,
        taxAmount: Number(sellerTaxBreakup.totalTaxAmount || 0),
        taxIncludedAmount: Number(sellerTaxBreakup.taxIncludedAmount || 0),
        taxPayableAmount: Number(sellerTaxBreakup.taxPayableAmount || 0),
        platformFeeAmount,
        deliveryChargeAmount,
        shippingFeeAmount: deliveryChargeAmount,
        customerTotalAmount,
        customerPayableAmount: customerTotalAmount,
        sellerPayoutAmount,
        platformFeeChargedToCustomer: false,
      },
      relations: {
        ...relations,
        sellers,
        sellerSettlements,
        shipments: sellerShipments,
        sellerFulfillmentGroups,
      },
    };
  }

  buildScopedTaxBreakup(original = {}, items = []) {
    const totals = items.reduce(
      (acc, item) => {
        const taxAmount = Number(item.taxAmount || item.tax_amount || 0);
        const cessAmount = Number(item.cessAmount || item.cess_amount || 0);
        const totalItemTax = taxAmount + cessAmount;
        const mode = item.taxMode || item.tax_mode;
        acc.taxableAmount += Number(item.taxableAmount || item.taxable_amount || 0);
        acc.totalTaxAmount += totalItemTax;
        acc.taxIncludedAmount += Number(item.taxIncludedAmount || item.tax_included_amount || 0);
        acc.taxPayableAmount += Number(item.taxPayableAmount || item.tax_payable_amount || 0);
        acc.cessAmount += cessAmount;
        if (mode === "cgst_sgst") {
          acc.cgstAmount += taxAmount / 2;
          acc.sgstAmount += taxAmount / 2;
        } else if (mode === "igst") {
          acc.igstAmount += taxAmount;
        }
        return acc;
      },
      {
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        cessAmount: 0,
        totalTaxAmount: 0,
        taxIncludedAmount: 0,
        taxPayableAmount: 0,
      },
    );

    return {
      ...original,
      taxableAmount: Number(totals.taxableAmount.toFixed(2)),
      cgstAmount: Number(totals.cgstAmount.toFixed(2)),
      sgstAmount: Number(totals.sgstAmount.toFixed(2)),
      igstAmount: Number(totals.igstAmount.toFixed(2)),
      cessAmount: Number(totals.cessAmount.toFixed(2)),
      totalTaxAmount: Number(totals.totalTaxAmount.toFixed(2)),
      taxIncludedAmount: Number(totals.taxIncludedAmount.toFixed(2)),
      taxPayableAmount: Number(totals.taxPayableAmount.toFixed(2)),
      items,
    };
  }

  filterPlatformFeeBreakup(value, productIds) {
    const breakup = this.normalizeJson(value, []);
    if (!Array.isArray(breakup)) return [];
    return breakup.filter((item) => productIds.has(String(item.productId || item.product_id || "")));
  }

  async cancelOrder(orderId, payload, actor) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const cancellation = await this.prepareCancellation(orderId, order, payload, actor);
    return this.updateOrderStatus(orderId, ORDER_STATUS.CANCELLED, {
      ...actor,
      cancellationReason: cancellation.reason,
      reason: cancellation.reason,
      paymentStatus: cancellation.orderPaymentStatus,
      metadata: cancellation.historyMetadata,
      orderMetadata: cancellation.orderMetadata,
    });
  }

  async updateOrderStatus(orderId, nextStatus, actor) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw AppError.notFound("Order");
    }

    if (order.status === nextStatus) {
      return this.orderRepository.findByIdWithItems(orderId);
    }

    await this.assertOrderTransitionAllowed(orderId, order, nextStatus, actor);

    const fulfillmentStatuses = [
      ORDER_STATUS.PACKED,
      ORDER_STATUS.READY_TO_SHIP,
      ORDER_STATUS.SHIPPED,
      ORDER_STATUS.OUT_FOR_DELIVERY,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.FULFILLED,
    ];

    if (fulfillmentStatuses.includes(nextStatus)) {
      await this.inventoryService.assertCommittedForFulfillment(orderId);
    }

    const trackingInfo = [ORDER_STATUS.READY_TO_SHIP, ORDER_STATUS.SHIPPED, ORDER_STATUS.OUT_FOR_DELIVERY].includes(nextStatus) && actor.trackingNumber
      ? { trackingNumber: actor.trackingNumber, carrierName: actor.carrierName, carrierUrl: actor.carrierUrl }
      : null;
    const deliveryStatus = actor.deliveryStatus ||
      this.orderStatusToDeliveryStatus(nextStatus, order.delivery_status) ||
      undefined;

    const statusMetadata = {
      actorId: actor.userId,
      actorRole: actor.role,
      reason: actor.reason || actor.cancellationReason || null,
      note: actor.note || null,
      paymentStatus: actor.paymentStatus || (nextStatus === ORDER_STATUS.REFUNDED ? PAYMENT_STATUS.REFUNDED : undefined),
      deliveryStatus,
      metadata: actor.metadata || {},
      orderMetadata: trackingInfo
        ? { ...(actor.orderMetadata || {}), tracking: trackingInfo }
        : actor.orderMetadata || undefined,
    };
    const updatedOrder = await this.orderRepository.updateStatus(orderId, nextStatus, statusMetadata);

    if (fulfillmentStatuses.includes(nextStatus) || nextStatus === ORDER_STATUS.FAILED_DELIVERY) {
      try {
        await this.syncShipmentsForOrderStatus(orderId, nextStatus, actor, trackingInfo);
      } catch (error) {
        logger.error({ orderId, status: nextStatus, error: error.message }, "Shipment sync from order status failed");
      }
    }

    if (nextStatus === ORDER_STATUS.CONFIRMED) {
      await this.inventoryService.commitForOrder(orderId);
      await this.dealService.commitOrderSales(orderId, actor).catch((error) =>
        logger.error({ orderId, error: error.message }, "Deal sale commit failed"),
      );
      await this.ensureShipmentsForConfirmedOrder(orderId, actor, actor.reason || "order_confirmed");
    }

    if (nextStatus === ORDER_STATUS.PAYMENT_FAILED) {
      await this.inventoryService.releaseForOrder(orderId);
      await this.walletService.release(order.buyer_id, orderId);
      await this.dealService.releaseOrderSales(orderId, actor).catch((error) =>
        logger.error({ orderId, error: error.message }, "Deal sale release failed"),
      );
    }

    if (nextStatus === ORDER_STATUS.CANCELLED) {
      await this.applyCancellationInventorySideEffects(orderId, order, actor);
      await this.dealService.releaseOrderSales(orderId, actor).catch((error) =>
        logger.error({ orderId, error: error.message }, "Deal sale cancellation release failed"),
      );
      await this.walletService.release(order.buyer_id, orderId);
      if (Number(order.wallet_discount_amount || 0) > 0 && [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING, ORDER_STATUS.PACKED, ORDER_STATUS.READY_TO_SHIP].includes(order.status)) {
        await this.walletService.credit(order.buyer_id, Number(order.wallet_discount_amount), {
          referenceType: "order_cancellation",
          referenceId: orderId,
          metadata: {
            reason: actor.reason || "order_cancelled",
            originalReferenceType: "order",
            originalReferenceId: orderId,
          },
        });
      }
      await this.applyCancellationPaymentSideEffects(orderId, order, actor);
    }

    if (nextStatus === ORDER_STATUS.RETURNED) {
      await this.inventoryService.restockForOrder(orderId);
    }

    if ([ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED].includes(nextStatus)) {
      try {
        await this.commissionService.calculateCommission(orderId, {
          actor,
          sourceStatus: nextStatus,
        });
      } catch (error) {
        logger.error({ orderId, status: nextStatus, error: error.message }, "Seller commission sync failed");
      }
    }

    try {
      await this.referralService.syncInfluencerReferralOrderStatus(
        orderId,
        nextStatus,
        actor.paymentStatus || updatedOrder.payment_status || updatedOrder.paymentStatus || null,
      );
    } catch (error) {
      logger.error(
        { orderId, status: nextStatus, error: error.message },
        "Influencer referral order status sync failed",
      );
    }

    const notificationSellerPayload = await this.getOrderNotificationSellerPayload(orderId);
    const buyerNotificationPayload = await this.getBuyerNotificationPayload(
      order.buyer_id,
      null,
      this.normalizeJson(order.shipping_address, {}),
    );
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
        {
          orderId,
          orderNumber: updatedOrder.order_number || order.order_number,
          buyerId: order.buyer_id,
          ...buyerNotificationPayload,
          ...notificationSellerPayload,
          previousStatus: order.status,
          status: nextStatus,
          paymentStatus: updatedOrder.payment_status || order.payment_status,
          paymentProvider: updatedOrder.payment_provider || order.payment_provider,
          reason: actor.reason || actor.cancellationReason || null,
          trackingNumber: trackingInfo?.trackingNumber || null,
          carrierName: trackingInfo?.carrierName || null,
          carrierUrl: trackingInfo?.carrierUrl || null,
          totalAmount: updatedOrder.total_amount ?? order.total_amount,
          payableAmount: updatedOrder.payable_amount ?? order.payable_amount,
          currency: updatedOrder.currency || order.currency,
          updatedBy: actor.userId,
        },
        {
          source: "order-module",
          aggregateId: orderId,
        },
      ),
    );

    if (nextStatus === ORDER_STATUS.CANCELLED) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.ORDER_CANCELLED_V1 || DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
          {
            orderId,
            orderNumber: updatedOrder.order_number || order.order_number,
            buyerId: order.buyer_id,
            ...buyerNotificationPayload,
            ...notificationSellerPayload,
            previousStatus: order.status,
            status: nextStatus,
            paymentStatus: updatedOrder.payment_status || order.payment_status,
            paymentProvider: updatedOrder.payment_provider || order.payment_provider,
            trackingNumber: trackingInfo?.trackingNumber || null,
            carrierName: trackingInfo?.carrierName || null,
            carrierUrl: trackingInfo?.carrierUrl || null,
            totalAmount: updatedOrder.total_amount ?? order.total_amount,
            payableAmount: updatedOrder.payable_amount ?? order.payable_amount,
            currency: updatedOrder.currency || order.currency,
            reason: actor.cancellationReason || actor.reason || null,
            updatedBy: actor.userId,
          },
          {
            source: "order-module",
            aggregateId: orderId,
          },
        ),
      );
    }

    return this.orderRepository.findByIdWithItems(updatedOrder.id);
  }

  async assertOrderTransitionAllowed(orderId, order, nextStatus, actor) {
    const isOwner = order.buyer_id === actor.userId;
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    const isSeller = ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);
    const sellerId = actor.ownerSellerId || actor.sellerId || actor.userId;
    const isOrderSeller = isSeller
      ? await this.orderRepository.isSellerInOrder(orderId, sellerId)
      : false;

    // Validate the status transition is structurally allowed before checking roles
    validateStatusTransition("order", order.status, nextStatus);
    const transitionKey = `${order.status}->${nextStatus}`;
    const allowedTransitions = new Set([
      `${ORDER_STATUS.PENDING_PAYMENT}->${ORDER_STATUS.CONFIRMED}`,
      `${ORDER_STATUS.PENDING_PAYMENT}->${ORDER_STATUS.PAYMENT_FAILED}`,
      `${ORDER_STATUS.PENDING_PAYMENT}->${ORDER_STATUS.ON_HOLD}`,
      `${ORDER_STATUS.PAYMENT_FAILED}->${ORDER_STATUS.PENDING_PAYMENT}`,
      `${ORDER_STATUS.PAYMENT_FAILED}->${ORDER_STATUS.ON_HOLD}`,
      `${ORDER_STATUS.ON_HOLD}->${ORDER_STATUS.PENDING_PAYMENT}`,
      `${ORDER_STATUS.ON_HOLD}->${ORDER_STATUS.CONFIRMED}`,
      `${ORDER_STATUS.ON_HOLD}->${ORDER_STATUS.PROCESSING}`,
      `${ORDER_STATUS.ON_HOLD}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.CONFIRMED}->${ORDER_STATUS.PROCESSING}`,
      `${ORDER_STATUS.CONFIRMED}->${ORDER_STATUS.PACKED}`,
      `${ORDER_STATUS.CONFIRMED}->${ORDER_STATUS.ON_HOLD}`,
      `${ORDER_STATUS.PROCESSING}->${ORDER_STATUS.PACKED}`,
      `${ORDER_STATUS.PROCESSING}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.PROCESSING}->${ORDER_STATUS.ON_HOLD}`,
      `${ORDER_STATUS.PACKED}->${ORDER_STATUS.READY_TO_SHIP}`,
      `${ORDER_STATUS.PACKED}->${ORDER_STATUS.ON_HOLD}`,
      `${ORDER_STATUS.READY_TO_SHIP}->${ORDER_STATUS.SHIPPED}`,
      `${ORDER_STATUS.READY_TO_SHIP}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.READY_TO_SHIP}->${ORDER_STATUS.ON_HOLD}`,
      `${ORDER_STATUS.SHIPPED}->${ORDER_STATUS.OUT_FOR_DELIVERY}`,
      `${ORDER_STATUS.SHIPPED}->${ORDER_STATUS.DELIVERED}`,
      `${ORDER_STATUS.SHIPPED}->${ORDER_STATUS.FAILED_DELIVERY}`,
      `${ORDER_STATUS.SHIPPED}->${ORDER_STATUS.RETURN_REQUESTED}`,
      `${ORDER_STATUS.OUT_FOR_DELIVERY}->${ORDER_STATUS.DELIVERED}`,
      `${ORDER_STATUS.OUT_FOR_DELIVERY}->${ORDER_STATUS.FAILED_DELIVERY}`,
      `${ORDER_STATUS.OUT_FOR_DELIVERY}->${ORDER_STATUS.RETURN_REQUESTED}`,
      `${ORDER_STATUS.FAILED_DELIVERY}->${ORDER_STATUS.OUT_FOR_DELIVERY}`,
      `${ORDER_STATUS.FAILED_DELIVERY}->${ORDER_STATUS.RETURNED}`,
      `${ORDER_STATUS.FAILED_DELIVERY}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.DELIVERED}->${ORDER_STATUS.FULFILLED}`,
      `${ORDER_STATUS.FULFILLED}->${ORDER_STATUS.RETURN_REQUESTED}`,
      `${ORDER_STATUS.CONFIRMED}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.PENDING_PAYMENT}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.PAYMENT_FAILED}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.PACKED}->${ORDER_STATUS.CANCELLED}`,
      `${ORDER_STATUS.DELIVERED}->${ORDER_STATUS.RETURN_REQUESTED}`,
      `${ORDER_STATUS.RETURN_REQUESTED}->${ORDER_STATUS.PARTIALLY_RETURNED}`,
      `${ORDER_STATUS.PARTIALLY_RETURNED}->${ORDER_STATUS.RETURN_REQUESTED}`,
      `${ORDER_STATUS.PARTIALLY_RETURNED}->${ORDER_STATUS.FULFILLED}`,
      `${ORDER_STATUS.PARTIALLY_RETURNED}->${ORDER_STATUS.REFUNDED}`,
      `${ORDER_STATUS.RETURN_REQUESTED}->${ORDER_STATUS.RETURNED}`,
      `${ORDER_STATUS.RETURNED}->${ORDER_STATUS.REFUNDED}`,
      `${ORDER_STATUS.RETURNED}->${ORDER_STATUS.FULFILLED}`,
      `${ORDER_STATUS.REFUNDED}->${ORDER_STATUS.FULFILLED}`,
    ]);

    if (!allowedTransitions.has(transitionKey)) {
      throw new AppError(`Invalid order status transition from ${order.status} to ${nextStatus}`, 409);
    }

    if (nextStatus === ORDER_STATUS.CANCELLED) {
      if (!isOwner && !isAdmin) {
        throw new AppError("Only the buyer or admin can cancel this order", 403);
      }
      if ([ORDER_STATUS.PACKED, ORDER_STATUS.READY_TO_SHIP].includes(order.status)) {
        const blockedByDeliveryStatus = order.delivery_status && !["initiated", "cancelled", "failed"].includes(order.delivery_status);
        const blockedByShipment = await this.orderRepository.hasNonCancellableShipment(orderId);
        if (blockedByDeliveryStatus || blockedByShipment) {
          throw new AppError("Order cannot be cancelled after shipment handover. Please request a return after delivery.", 409);
        }
      }
      return;
    }

    if (nextStatus === ORDER_STATUS.PENDING_PAYMENT && order.status === ORDER_STATUS.PAYMENT_FAILED) {
      if (!isOwner && !isAdmin && actor.source !== "payment-module") {
        throw new AppError("Only the buyer, admin, or payment flow can retry payment", 403);
      }
      return;
    }

    if ([ORDER_STATUS.CONFIRMED, ORDER_STATUS.PAYMENT_FAILED].includes(nextStatus)) {
      if (!isAdmin && actor.source !== "payment-module") {
        throw new AppError("Only admin or payment flow can update payment states", 403);
      }
      return;
    }

    if ([ORDER_STATUS.PROCESSING, ORDER_STATUS.PACKED, ORDER_STATUS.READY_TO_SHIP, ORDER_STATUS.SHIPPED, ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.FAILED_DELIVERY, ORDER_STATUS.FULFILLED, ORDER_STATUS.ON_HOLD].includes(nextStatus)) {
      if (!isSeller && !isAdmin) {
        throw new AppError("Only seller or admin can update fulfillment states", 403);
      }
      if (isSeller && !isOrderSeller) {
        throw new AppError("You are not allowed to manage this order", 403);
      }
      if (isSeller) {
        const items = await this.orderRepository.findItemsByOrderId(orderId);
        const sellerIds = new Set((items || []).map((item) => String(item.seller_id || "")).filter(Boolean));
        if (sellerIds.size > 1) {
          throw new AppError("Multi-seller order fulfillment must be managed from Seller Shipments, not aggregate order status", 409);
        }
        if (actor.organizationId) {
          const sellerOrgMatch = (items || []).some((item) =>
            String(item.seller_id || "") === String(sellerId) &&
            String(item.organization_id || "") === String(actor.organizationId),
          );
          if (!sellerOrgMatch) {
            throw new AppError("You are not allowed to manage this seller organization order", 403);
          }
        }
      }
      return;
    }

    if (nextStatus === ORDER_STATUS.DELIVERED) {
      if (!isAdmin) {
        throw new AppError("Only admin can mark an order delivered from order status", 403);
      }
      const fullOrder = await this.orderRepository.findByIdWithItems(orderId);
      const sellerIds = new Set((fullOrder?.items || []).map((item) => String(item.seller_id || "")).filter(Boolean));
      const forwardShipments = (fullOrder?.relations?.shipments || [])
        .filter((shipment) => String(shipment.direction || "forward") !== "reverse" && String(shipment.shipment_type || "forward") !== "return");
      const deliveredSellerIds = new Set(
        forwardShipments
          .filter((shipment) => shipment.status === "delivered")
          .map((shipment) => String(shipment.seller_id || ""))
          .filter(Boolean),
      );
      const allDelivered = sellerIds.size > 0 && Array.from(sellerIds).every((sellerId) => deliveredSellerIds.has(sellerId));
      if (!allDelivered) {
        throw new AppError("Order can be marked delivered only after all seller shipments are delivered", 409);
      }
      return;
    }

    if ([ORDER_STATUS.RETURN_REQUESTED, ORDER_STATUS.PARTIALLY_RETURNED, ORDER_STATUS.RETURNED, ORDER_STATUS.REFUNDED].includes(nextStatus)) {
      if (!isOwner && !isSeller && !isAdmin) {
        throw new AppError("You are not allowed to update this order", 403);
      }
      if (isSeller && !isOrderSeller) {
        throw new AppError("You are not allowed to manage this order", 403);
      }
    }
  }

  async prepareCancellation(orderId, order, payload = {}, actor = {}) {
    const reason = payload?.reason || "Requested by customer";
    const latestPayment = await this.orderRepository.findLatestPaymentByOrderId(orderId);
    const paymentProvider = latestPayment?.provider || order.payment_provider || this.normalizeJson(order.metadata)?.paymentProvider || null;
    const paymentStatus = latestPayment?.status || order.payment_status;
    const isCaptured = paymentStatus === PAYMENT_STATUS.CAPTURED;
    const isAuthorized = paymentStatus === PAYMENT_STATUS.AUTHORIZED;
    const isCod = paymentProvider === PAYMENT_PROVIDER.COD;
    const refundRequired = isCaptured && Number(order.payable_amount || order.total_amount || 0) > 0 && !isCod;

    const cancellation = {
      reason,
      cancelledBy: actor.userId || null,
      cancelledByRole: actor.role || null,
      cancelledAt: new Date().toISOString(),
      sourceOrderStatus: order.status,
      paymentProvider,
      paymentId: latestPayment?.id || null,
      paymentStatus,
      refundRequired,
      refundStatus: refundRequired ? "pending" : "not_required",
    };

    return {
      reason,
      orderPaymentStatus: refundRequired
        ? order.payment_status
        : isCaptured && isCod
          ? PAYMENT_STATUS.CANCELLED
          : isAuthorized || paymentStatus === PAYMENT_STATUS.INITIATED || paymentStatus === PAYMENT_STATUS.FAILED
            ? PAYMENT_STATUS.CANCELLED
            : order.payment_status,
      historyMetadata: { cancellation },
      orderMetadata: { cancellation },
    };
  }

  async applyCancellationInventorySideEffects(orderId, order, actor = {}) {
    const reason = actor.reason || actor.cancellationReason || "order_cancelled";
    const options = {
      actor,
      reason: "order_cancelled",
      metadata: {
        source: "order_cancellation",
        orderStatus: order.status,
        cancellationReason: reason,
      },
    };

    if ([ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAYMENT_FAILED].includes(order.status)) {
      return this.inventoryService.releaseForOrder(orderId, options);
    }

    if ([ORDER_STATUS.CONFIRMED, ORDER_STATUS.PACKED].includes(order.status)) {
      return this.inventoryService.restockForOrder(orderId, options);
    }

    return null;
  }

  async applyCancellationPaymentSideEffects(orderId, order, actor = {}) {
    const cancellation = actor.orderMetadata?.cancellation || {};
    if (cancellation.refundRequired) {
      await this.orderRepository.updatePaymentsForOrderCancellation(orderId, {
        status: PAYMENT_STATUS.CAPTURED,
        metadata: {
          ...cancellation,
          refundStatus: "pending",
          actionRequired: "refund_payment",
        },
      });
      return;
    }

    await this.orderRepository.updatePaymentsForOrderCancellation(orderId, {
      status: PAYMENT_STATUS.CANCELLED,
      failedReason: cancellation.reason || "order_cancelled",
      metadata: {
        ...cancellation,
        refundStatus: "not_required",
      },
    });
  }

  normalizeJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value;
  }

  async markPaymentCaptured(orderId, actor = {}) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
      if (order.payment_status === PAYMENT_STATUS.CAPTURED) {
        await this.publishOrderPaidNotification(orderId, order, order, actor);
        await this.clearPurchasedCartItems(orderId, order.buyer_id, [], actor, "payment_already_captured");
        return this.orderRepository.findByIdWithItems(orderId);
      }
      if (order.status === ORDER_STATUS.CONFIRMED && order.payment_status === PAYMENT_STATUS.AUTHORIZED) {
        const updatedOrder = await this.orderRepository.updateStatus(orderId, order.status, {
          actorId: actor.userId || order.buyer_id,
          actorRole: actor.role || "system",
          paymentStatus: PAYMENT_STATUS.CAPTURED,
          reason: actor.reason || "payment_captured",
          metadata: actor.metadata || {},
        });
        await this.dealService.commitOrderSales(orderId, actor).catch((error) =>
          logger.error({ orderId, error: error.message }, "Deal sale capture commit failed"),
        );
        const invoice = await this.ensureOrderTaxDocuments(orderId);
        await this.publishOrderPaidNotification(orderId, order, updatedOrder, actor, invoice);
        await this.clearPurchasedCartItems(orderId, order.buyer_id, [], actor, "payment_captured");
        await this.ensureShipmentsForConfirmedOrder(orderId, actor, "payment_captured");
        return this.orderRepository.findByIdWithItems(updatedOrder.id);
      }
      throw new AppError(`Cannot capture payment for order in ${order.status} status`, 409);
    }

    await this.walletService.capture(order.buyer_id, orderId);
    await this.inventoryService.commitForOrder(orderId);
    await this.dealService.commitOrderSales(orderId, actor).catch((error) =>
      logger.error({ orderId, error: error.message }, "Deal sale capture commit failed"),
    );
    const updatedOrder = await this.updateOrderStatus(orderId, ORDER_STATUS.CONFIRMED, {
      userId: actor.userId || order.buyer_id,
      role: actor.role || "system",
      source: "payment-module",
      paymentStatus: PAYMENT_STATUS.CAPTURED,
      reason: "payment_captured",
      metadata: actor.metadata || {},
    });
    const invoice = await this.ensureOrderTaxDocuments(orderId);

    await this.publishOrderPaidNotification(orderId, order, updatedOrder, actor, invoice);

    await this.clearPurchasedCartItems(orderId, order.buyer_id, [], actor, "payment_captured");
    return this.orderRepository.findByIdWithItems(updatedOrder.id);
  }

  async markPaymentAuthorized(orderId, actor = {}) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
      if (order.status === ORDER_STATUS.CONFIRMED || order.payment_status === PAYMENT_STATUS.AUTHORIZED) {
        await this.ensureOrderTaxDocuments(orderId);
        await this.clearPurchasedCartItems(orderId, order.buyer_id, [], actor, "payment_authorized");
        await this.ensureShipmentsForConfirmedOrder(orderId, actor, "payment_authorized");
        return this.orderRepository.findByIdWithItems(orderId);
      }
      throw new AppError(`Cannot authorize payment for order in ${order.status} status`, 409);
    }

    await this.walletService.capture(order.buyer_id, orderId);
    await this.inventoryService.commitForOrder(orderId);
    await this.dealService.commitOrderSales(orderId, actor).catch((error) =>
      logger.error({ orderId, error: error.message }, "Deal sale authorization commit failed"),
    );
    const updatedOrder = await this.updateOrderStatus(orderId, ORDER_STATUS.CONFIRMED, {
      userId: actor.userId || order.buyer_id,
      role: actor.role || "system",
      source: "payment-module",
      paymentStatus: PAYMENT_STATUS.AUTHORIZED,
      reason: actor.reason || "payment_authorized",
      metadata: actor.metadata || {},
    });
    await this.ensureOrderTaxDocuments(orderId);
    await this.clearPurchasedCartItems(orderId, order.buyer_id, [], actor, "payment_authorized");

    return updatedOrder;
  }

  async markPaymentFailed(orderId, actor = {}) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
      if (order.status === ORDER_STATUS.PAYMENT_FAILED || order.payment_status === PAYMENT_STATUS.FAILED) {
        return this.orderRepository.findByIdWithItems(orderId);
      }
      throw new AppError(`Cannot fail payment for order in ${order.status} status`, 409);
    }

    const updatedOrder = await this.updateOrderStatus(orderId, ORDER_STATUS.PAYMENT_FAILED, {
      userId: actor.userId || order.buyer_id,
      role: actor.role || "system",
      source: "payment-module",
      paymentStatus: PAYMENT_STATUS.FAILED,
      reason: actor.reason || "payment_failed",
      metadata: actor.metadata || {},
    });

    const notificationSellerPayload = await this.getOrderNotificationSellerPayload(orderId);
    const buyerNotificationPayload = await this.getBuyerNotificationPayload(
      order.buyer_id,
      null,
      this.normalizeJson(order.shipping_address, {}),
    );
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1 || DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
        {
          orderId,
          orderNumber: updatedOrder.order_number || order.order_number,
          buyerId: order.buyer_id,
          ...buyerNotificationPayload,
          ...notificationSellerPayload,
          status: ORDER_STATUS.PAYMENT_FAILED,
          paymentStatus: PAYMENT_STATUS.FAILED,
          paymentProvider: updatedOrder.payment_provider || order.payment_provider,
          totalAmount: updatedOrder.total_amount ?? order.total_amount,
          payableAmount: updatedOrder.payable_amount ?? order.payable_amount,
          currency: updatedOrder.currency || order.currency,
          reason: actor.reason || "payment_failed",
        },
        { source: "order-module", aggregateId: orderId },
      ),
    );

    return updatedOrder;
  }

  async reopenPayment(orderId, actor = {}) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    await this.inventoryService.reserveForOrder(
      orderId,
      order.buyer_id,
      (order.items || []).map((item) => ({
        productId: item.product_id,
        variantId: item.variant_id || "",
        variantSku: item.variant_sku || "",
        variantTitle: item.variant_title || "",
        attributes: item.attributes || {},
        sellerId: item.seller_id,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unit_price || 0),
      })),
    );
    await this.dealService.reserveOrderSales(order, actor).catch((error) =>
      logger.error({ orderId, error: error.message }, "Deal sale retry reserve failed"),
    );

    return this.updateOrderStatus(orderId, ORDER_STATUS.PENDING_PAYMENT, {
      userId: actor.userId || order.buyer_id,
      role: actor.role || "buyer",
      source: actor.source || "order-module",
      paymentStatus: PAYMENT_STATUS.INITIATED,
      reason: "payment_retry",
    });
  }

  async addNote(orderId, payload, actor) {
    const order = await this.getOrder(orderId, actor);
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    const isSeller = ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);

    if (!isAdmin && !isSeller) {
      throw new AppError("Only admin or seller users can add order notes", 403);
    }

    const note = await this.orderRepository.addNote(order.id, {
      actorId: actor.userId,
      actorRole: actor.role,
      visibility: payload.visibility || "internal",
      note: payload.note,
    });

    return note;
  }
}

module.exports = { OrderService };
