"use strict";

const { AppError } = require("../../../shared/errors/app-error");
const { DeliveryRepository } = require("../repositories/delivery.repository");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { shippingProviderRegistry } = require("../../../infrastructure/shipping/provider-registry");
const { ORDER_STATUS } = require("../../../shared/domain/commerce-constants");
const { DELIVERY_STATUS } = require("../models/delivery.model");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");

class DeliveryService {
  constructor({
    deliveryRepository = new DeliveryRepository(),
    orderRepository = new OrderRepository(),
  } = {}) {
    this.deliveryRepository = deliveryRepository;
    this.orderRepository = orderRepository;
  }

  async getServiceability(pincode) {
    const result = await this.deliveryRepository.getServiceability(pincode);
    return {
      pincode,
      serviceable: Boolean(result.serviceability?.serviceable) && result.exclusions.length === 0,
      codAvailable: Boolean(result.serviceability?.cod_available),
      estimatedDeliveryDays: result.serviceability?.estimated_delivery_days || null,
      city: result.serviceability?.city || null,
      state: result.serviceability?.state || null,
      zoneCode: result.serviceability?.zone_code || null,
      exclusions: result.exclusions,
    };
  }

  async calculateRate(payload) {
    const rate = await this.deliveryRepository.calculateShippingRate(payload);
    if (!rate) {
      throw new AppError("Pincode is not serviceable", 400);
    }
    const provider = shippingProviderRegistry.get(payload.provider || "manual");
    return provider.rate({
      ...payload,
      amount: rate.amount,
      currency: rate.currency,
      estimatedDeliveryDays: rate.estimatedDeliveryDays,
    });
  }

  async createShipment(payload, actor) {
    const order = await this.orderRepository.findByIdWithItems(payload.orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    await this.assertCanManageOrder(payload.orderId, actor);
    if (![ORDER_STATUS.CONFIRMED, ORDER_STATUS.PACKED, ORDER_STATUS.SHIPPED].includes(order.status)) {
      throw new AppError("Shipment can be created only after order is confirmed", 409);
    }

    const sellerId = payload.sellerId || actor.ownerSellerId || actor.userId;
    const provider = shippingProviderRegistry.get(payload.provider || "manual");
    const providerResult = await provider.createShipment(payload);
    const shipment = await this.deliveryRepository.createShipment({
      ...payload,
      sellerId,
      provider: payload.provider || providerResult.provider || "manual",
      awbNumber: providerResult.awbNumber || payload.awbNumber,
      trackingNumber: providerResult.trackingNumber || payload.trackingNumber || payload.awbNumber,
      labelData: providerResult.labelData || payload.labelData || {},
      shipToSnapshot: payload.shipToSnapshot || order.shipping_address || {},
      createdBy: actor.userId,
      updatedBy: actor.userId,
    });

    const nextOrderStatus = order.status === ORDER_STATUS.CONFIRMED ? ORDER_STATUS.PACKED : order.status;
    await this.orderRepository.updateStatus(payload.orderId, nextOrderStatus, {
      actorId: actor.userId,
      actorRole: actor.role,
      reason: "shipment_created",
      deliveryStatus: shipment.status,
      metadata: { shipmentId: shipment.id },
    }).catch(async () => {
      await this.updateOrderDeliveryStatusOnly(payload.orderId, shipment.status, actor, shipment.id);
    });

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.SHIPMENT_CREATED_V1,
        {
          shipmentId: shipment.id,
          orderId: shipment.order_id,
          buyerId: order.buyer_id,
          sellerId: shipment.seller_id,
          status: shipment.status,
          trackingNumber: shipment.tracking_number,
          updatedBy: actor.userId,
        },
        { source: "delivery-module", aggregateId: shipment.order_id },
      ),
    );

    return shipment;
  }

  async listShipments(query, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      query.sellerId = actor.ownerSellerId || actor.userId;
    }
    return this.deliveryRepository.listShipments(query);
  }

  async getShipment(shipmentId, actor) {
    const shipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!shipment) {
      throw new AppError("Shipment not found", 404);
    }
    await this.assertCanViewOrder({ buyer_id: null }, shipment.order_id, actor);
    return shipment;
  }

  async addTrackingEvent(shipmentId, payload, actor) {
    const shipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!shipment) {
      throw new AppError("Shipment not found", 404);
    }

    await this.assertCanManageOrder(shipment.order_id, actor);
    const result = await this.deliveryRepository.addTrackingEvent(shipmentId, {
      ...payload,
      actorId: actor.userId,
      source: payload.source || "manual",
    });

    await this.syncOrderForTracking(result.shipment, actor);
    await this.publishShipmentTrackingEvent(result.shipment, actor);
    return result;
  }

  async handleTrackingWebhook(payload = {}) {
    const shipment = payload.shipmentId
      ? await this.deliveryRepository.findShipmentById(payload.shipmentId)
      : null;
    if (!shipment) {
      return { acknowledged: true, ignored: true };
    }

    const result = await this.deliveryRepository.addTrackingEvent(shipment.id, {
      status: payload.status,
      eventTime: payload.eventTime,
      location: payload.location,
      note: payload.note,
      source: payload.provider || "webhook",
      rawPayload: payload,
      actorId: "webhook",
    });
    await this.syncOrderForTracking(result.shipment, { userId: "webhook", role: "system" });
    await this.publishShipmentTrackingEvent(result.shipment, { userId: "webhook", role: "system" });
    return { acknowledged: true, shipment: result.shipment };
  }

  async createManifest(payload, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can create manifests", 403);
    }
    return this.deliveryRepository.createManifest({
      ...payload,
      createdBy: actor.userId,
    });
  }

  async syncOrderForTracking(shipment, actor) {
    let nextOrderStatus = null;
    if (shipment.status === DELIVERY_STATUS.DELIVERED) {
      nextOrderStatus = ORDER_STATUS.DELIVERED;
    } else if ([DELIVERY_STATUS.IN_TRANSIT, DELIVERY_STATUS.OUT_FOR_DELIVERY].includes(shipment.status)) {
      nextOrderStatus = ORDER_STATUS.SHIPPED;
    }

    if (nextOrderStatus) {
      await this.orderRepository.updateStatus(shipment.order_id, nextOrderStatus, {
        actorId: actor.userId,
        actorRole: actor.role,
        reason: `delivery_${shipment.status}`,
        deliveryStatus: shipment.status,
        metadata: { shipmentId: shipment.id },
      }).catch(async () => {
        await this.updateOrderDeliveryStatusOnly(shipment.order_id, shipment.status, actor, shipment.id);
      });
      return;
    }

    await this.updateOrderDeliveryStatusOnly(shipment.order_id, shipment.status, actor, shipment.id);
  }

  async updateOrderDeliveryStatusOnly(orderId, deliveryStatus, actor, shipmentId) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) return null;
    return this.orderRepository.updateStatus(orderId, order.status, {
      actorId: actor.userId,
      actorRole: actor.role,
      reason: `delivery_${deliveryStatus}`,
      deliveryStatus,
      metadata: { shipmentId },
    });
  }

  async publishShipmentTrackingEvent(shipment, actor = {}) {
    const order = await this.orderRepository.findById(shipment.order_id);
    const eventByStatus = {
      [DELIVERY_STATUS.DELIVERED]: DOMAIN_EVENTS.SHIPMENT_DELIVERED_V1,
      [DELIVERY_STATUS.FAILED]: DOMAIN_EVENTS.SHIPMENT_FAILED_V1,
      [DELIVERY_STATUS.RTO]: DOMAIN_EVENTS.SHIPMENT_RTO_V1,
    };
    const eventName = eventByStatus[shipment.status] || DOMAIN_EVENTS.SHIPMENT_TRACKING_UPDATED_V1;
    await eventPublisher.publish(
      makeEvent(
        eventName,
        {
          shipmentId: shipment.id,
          orderId: shipment.order_id,
          buyerId: order?.buyer_id || null,
          sellerId: shipment.seller_id,
          status: shipment.status,
          trackingNumber: shipment.tracking_number,
          updatedBy: actor.userId || null,
          actorRole: actor.role || null,
        },
        { source: "delivery-module", aggregateId: shipment.order_id },
      ),
    );
  }

  async createEWayBill(orderId, payload, actor) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    await this.assertCanManageOrder(orderId, actor);

    return this.deliveryRepository.createEWayBill({
      ...payload,
      orderId,
    });
  }

  async getEWayBill(orderId, actor) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    await this.assertCanViewOrder(order, orderId, actor);
    return this.deliveryRepository.findEWayBillByOrderId(orderId);
  }

  async updateEWayBillStatus(ewayBillId, payload, actor) {
    const existing = await this.deliveryRepository.findEWayBillById(ewayBillId);
    if (!existing) {
      throw new AppError("Delivery record not found", 404);
    }

    await this.assertCanManageOrder(existing.order_id, actor);

    const record = await this.deliveryRepository.updateEWayBillStatus(ewayBillId, payload);
    if (!record) {
      throw new AppError("Delivery record not found", 404);
    }
    return record;
  }

  async assertCanViewOrder(order, orderId, actor) {
    if (["admin", "super-admin"].includes(actor.role) || order.buyer_id === actor.userId) {
      return;
    }

    await this.assertCanManageOrder(orderId, actor);
  }

  async assertCanManageOrder(orderId, actor) {
    if (["admin", "super-admin"].includes(actor.role)) {
      return;
    }

    if (!["seller", "seller-sub-admin"].includes(actor.role)) {
      throw new AppError("You are not allowed to manage delivery for this order", 403);
    }

    const sellerId = actor.ownerSellerId || actor.userId;
    const isSellerInOrder = await this.orderRepository.isSellerInOrder(orderId, sellerId);
    if (!isSellerInOrder) {
      throw new AppError("You are not allowed to manage delivery for this order", 403);
    }
  }
}

module.exports = { DeliveryService };
