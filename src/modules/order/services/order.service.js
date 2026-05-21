const { OrderRepository } = require("../repositories/order.repository");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { ORDER_STATUS } = require("../../../shared/domain/commerce-constants");
const { PricingService } = require("../../pricing/services/pricing.service");
const { InventoryService } = require("../../inventory/services/inventory.service");
const { AppError } = require("../../../shared/errors/app-error");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { v4: uuidv4 } = require("uuid");
const { WalletService } = require("../../wallet/services/wallet.service");
const { ProductModel } = require("../../product/models/product.model");

class OrderService {
  constructor({
    orderRepository = new OrderRepository(),
    pricingService = new PricingService(),
    inventoryService = new InventoryService(),
    walletService = new WalletService(),
  } = {}) {
    this.orderRepository = orderRepository;
    this.pricingService = pricingService;
    this.inventoryService = inventoryService;
    this.walletService = walletService;
  }

  async createOrder(payload, actor) {
    const pricedOrder = await this.pricingService.priceOrder({
      items: payload.items,
      couponCode: payload.couponCode,
      walletAmount: payload.walletAmount,
      shippingAddress: payload.shippingAddress,
      userId: actor.userId,
    });
    const orderId = uuidv4();
    const orderEvent = makeEvent(
      DOMAIN_EVENTS.ORDER_CREATED_V1,
      {
        orderId,
        buyerId: actor.userId,
        totalAmount: pricedOrder.pricing.totalAmount,
        payableAmount: pricedOrder.pricing.payableAmount,
        platformFeeAmount: pricedOrder.pricing.platformFeeAmount,
        currency: payload.currency || "INR",
        itemCount: pricedOrder.items.length,
      },
      {
        source: "order-module",
      },
    );

    await this.inventoryService.reserveForOrder(orderId, actor.userId, pricedOrder.items);
    await this.walletService.hold(
      actor.userId,
      pricedOrder.walletToReserveAmount,
      orderId,
      { reason: "order_checkout" },
    );

    try {
      const payableAmount = pricedOrder.pricing.payableAmount;

      const order = await this.orderRepository.createOrder(
        {
          id: orderId,
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
          shippingAddress: payload.shippingAddress,
          items: pricedOrder.items,
          buyerId: actor.userId,
          status: payableAmount > 0 ? ORDER_STATUS.PENDING_PAYMENT : ORDER_STATUS.CONFIRMED,
        },
        orderEvent,
      );

      await this.pricingService.finalizeCouponUsage(pricedOrder.couponToConsume);
      if (payableAmount <= 0) {
        await this.walletService.capture(actor.userId, orderId);
        await this.inventoryService.commitForOrder(orderId);
        await eventPublisher.publish(
          makeEvent(
            DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
            {
              orderId,
              buyerId: actor.userId,
              previousStatus: ORDER_STATUS.PENDING_PAYMENT,
              status: ORDER_STATUS.CONFIRMED,
              updatedBy: actor.userId,
            },
            {
              source: "order-module",
              aggregateId: orderId,
            },
          ),
        );
      }
      return order;
    } catch (error) {
      await this.inventoryService.releaseForOrder(orderId);
      await this.walletService.release(actor.userId, orderId);
      await this.orderRepository.deleteById(orderId);
      throw error;
    }
  }

  async listMyOrders(actor) {
    return this.orderRepository.listOrdersByBuyer(actor.userId);
  }

  async listSellerOrders(actor) {
    const sellerId = actor.ownerSellerId || actor.userId;
    if (["seller-admin", "seller-sub-admin"].includes(actor.role)) {
      const products = await ProductModel.find({ sellerId, createdBy: actor.userId }).select("_id");
      const productIds = products.map((product) => String(product._id));
      if (!productIds.length) return [];
      return this.orderRepository.listOrdersBySeller(sellerId, productIds);
    }
    return this.orderRepository.listOrdersBySeller(sellerId);
  }

  async getOrder(orderId, actor) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const isOwner = order.buyer_id === actor.userId;
    const isAdmin = ["admin", "super-admin"].includes(actor.role);
    const sellerId = actor.ownerSellerId || actor.userId;
    const isSeller = ["seller", "seller-sub-admin"].includes(actor.role)
      ? await this.orderRepository.isSellerInOrder(orderId, sellerId)
      : false;

    if (!isOwner && !isAdmin && !isSeller) {
      throw new AppError("You are not allowed to view this order", 403);
    }

    return order;
  }

  async cancelOrder(orderId, payload, actor) {
    return this.updateOrderStatus(orderId, ORDER_STATUS.CANCELLED, {
      ...actor,
      cancellationReason: payload?.reason || null,
    });
  }

  async updateOrderStatus(orderId, nextStatus, actor) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    await this.assertOrderTransitionAllowed(orderId, order, nextStatus, actor);

    const updatedOrder = await this.orderRepository.updateStatus(orderId, nextStatus);

    if (nextStatus === ORDER_STATUS.CANCELLED) {
      await this.inventoryService.releaseForOrder(orderId);
      await this.walletService.release(order.buyer_id, orderId);
    }

    if (nextStatus === ORDER_STATUS.RETURNED) {
      await this.inventoryService.restockForOrder(orderId);
    }

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
        {
          orderId,
          buyerId: order.buyer_id,
          previousStatus: order.status,
          status: nextStatus,
          updatedBy: actor.userId,
        },
        {
          source: "order-module",
          aggregateId: orderId,
        },
      ),
    );

    return updatedOrder;
  }

  async assertOrderTransitionAllowed(orderId, order, nextStatus, actor) {
    const isOwner = order.buyer_id === actor.userId;
    const isAdmin = ["admin", "super-admin"].includes(actor.role);
    const isSeller = ["seller", "seller-sub-admin"].includes(actor.role);
    const sellerId = actor.ownerSellerId || actor.userId;
    const isOrderSeller = isSeller
      ? await this.orderRepository.isSellerInOrder(orderId, sellerId)
      : false;

    if (nextStatus === ORDER_STATUS.CANCELLED) {
      if (!isOwner && !isAdmin) {
        throw new AppError("Only the buyer or admin can cancel this order", 403);
      }

      if (![ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAYMENT_FAILED, ORDER_STATUS.CONFIRMED].includes(order.status)) {
        throw new AppError("Order can no longer be cancelled", 409);
      }
      return;
    }

    if ([ORDER_STATUS.PACKED, ORDER_STATUS.SHIPPED, ORDER_STATUS.FULFILLED].includes(nextStatus)) {
      if (!isSeller && !isAdmin) {
        throw new AppError("Only seller or admin can update fulfillment states", 403);
      }
      if (isSeller && !isOrderSeller) {
        throw new AppError("You are not allowed to manage this order", 403);
      }
      return;
    }

    if ([ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURN_REQUESTED, ORDER_STATUS.RETURNED].includes(nextStatus)) {
      if (!isOwner && !isSeller && !isAdmin) {
        throw new AppError("You are not allowed to update this order", 403);
      }
      if (isSeller && !isOrderSeller) {
        throw new AppError("You are not allowed to manage this order", 403);
      }
    }
  }
}

module.exports = { OrderService };
