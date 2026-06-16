"use strict";

const crypto = require("crypto");
const { AppError } = require("../../../shared/errors/app-error");
const { DeliveryRepository } = require("../repositories/delivery.repository");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { NotificationRepository } = require("../../notification/repositories/notification.repository");
const { DealService } = require("../../deal/services/deal.service");
const { shippingProviderRegistry } = require("../../../infrastructure/shipping/provider-registry");
const { ORDER_STATUS } = require("../../../shared/domain/commerce-constants");
const { createOtp } = require("../../../shared/tools/otp");
const { DELIVERY_STATUS, DELIVERY_VERIFICATION_METHODS } = require("../models/delivery.model");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { env } = require("../../../config/env");

const SHIPMENT_TRANSITIONS = {
  initiated: ["manifested", "picked_up", "in_transit", "cancelled", "failed"],
  manifested: ["picked_up", "in_transit", "cancelled", "failed"],
  picked_up: ["in_transit", "failed", "rto", "lost", "damaged"],
  in_transit: ["out_for_delivery", "failed", "rto", "lost", "damaged"],
  out_for_delivery: ["delivered", "delivered_verified", "failed", "rto", "lost", "damaged"],
  failed: ["in_transit", "out_for_delivery", "rto", "cancelled"],
  delivered: ["delivered_verified"],
  delivered_verified: [],
  cancelled: [],
  rto: [],
  lost: [],
  damaged: [],
};

const DELIVERY_OTP_TTL_MINUTES = 10;
const DELIVERY_OTP_MAX_ATTEMPTS = 5;

class DeliveryService {
  constructor({
    deliveryRepository = new DeliveryRepository(),
    orderRepository = new OrderRepository(),
    notificationRepository = new NotificationRepository(),
    dealService = new DealService(),
  } = {}) {
    this.deliveryRepository = deliveryRepository;
    this.orderRepository = orderRepository;
    this.notificationRepository = notificationRepository;
    this.dealService = dealService;
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

  isAdmin(actor = {}) {
    return ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
  }

  getActorSellerId(actor = {}) {
    return actor.ownerSellerId || actor.userId;
  }

  resolveSellerIdForAgent(payload = {}, actor = {}) {
    if (this.isAdmin(actor)) {
      const sellerId = payload.sellerId || payload.seller_id;
      if (!sellerId) throw new AppError("Seller ID is required for delivery agent management", 400);
      return String(sellerId);
    }
    if (!["seller", "seller-admin", "seller-sub-admin"].includes(actor.role)) {
      throw new AppError("Only seller or admin users can manage delivery agents", 403);
    }
    return String(this.getActorSellerId(actor));
  }

  assertCanManageDeliveryAgent(agent, actor = {}) {
    if (!agent) throw new AppError("Delivery agent not found", 404);
    if (this.isAdmin(actor)) return;
    const sellerId = String(this.getActorSellerId(actor));
    if (String(agent.seller_id) !== sellerId) {
      throw new AppError("You are not allowed to manage this delivery agent", 403);
    }
  }

  buildDeliveryAgentSnapshot(agent = {}) {
    return {
      id: agent.id,
      sellerId: agent.seller_id,
      name: agent.name,
      phone: agent.phone,
      email: agent.email || null,
      vehicleType: agent.vehicle_type || null,
      vehicleNumber: agent.vehicle_number || null,
      licenseNumber: agent.license_number || null,
      verificationStatus: agent.verification_status || null,
      assignedAt: new Date().toISOString(),
    };
  }

  async listDeliveryAgents(query = {}, actor = {}) {
    const filters = { ...query };
    if (!this.isAdmin(actor)) {
      filters.sellerId = this.resolveSellerIdForAgent({}, actor);
    }
    return this.deliveryRepository.listDeliveryAgents(filters);
  }

  async createDeliveryAgent(payload = {}, actor = {}) {
    const sellerId = this.resolveSellerIdForAgent(payload, actor);
    return this.deliveryRepository.createDeliveryAgent({
      ...payload,
      sellerId,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    });
  }

  async getDeliveryAgent(agentId, actor = {}) {
    const agent = await this.deliveryRepository.findDeliveryAgentById(agentId);
    this.assertCanManageDeliveryAgent(agent, actor);
    return agent;
  }

  async updateDeliveryAgent(agentId, payload = {}, actor = {}) {
    const agent = await this.deliveryRepository.findDeliveryAgentById(agentId);
    this.assertCanManageDeliveryAgent(agent, actor);
    if (payload.sellerId !== undefined) {
      if (!this.isAdmin(actor)) {
        throw new AppError("Seller users cannot move delivery agents between sellers", 403);
      }
      if (!payload.sellerId) {
        throw new AppError("Seller ID is required when moving a delivery agent", 400);
      }
    }
    const updated = await this.deliveryRepository.updateDeliveryAgent(agentId, {
      ...payload,
      updatedBy: actor.userId,
    });
    if (!updated) throw new AppError("Delivery agent not found", 404);
    return updated;
  }

  async resolveAssignableDeliveryAgent(agentId, sellerId, actor = {}) {
    if (!agentId) return null;
    const agent = await this.deliveryRepository.findDeliveryAgentById(agentId);
    this.assertCanManageDeliveryAgent(agent, actor);
    if (String(agent.seller_id) !== String(sellerId)) {
      throw new AppError("Delivery agent must belong to the shipment seller", 400);
    }
    if (agent.active === false) {
      throw new AppError("Inactive delivery agents cannot be assigned", 409);
    }
    if (agent.verification_status === "rejected") {
      throw new AppError("Rejected delivery agents cannot be assigned", 409);
    }
    return agent;
  }

  async assignDeliveryAgent(shipmentId, deliveryAgentId, actor = {}) {
    const shipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!shipment) throw new AppError("Shipment not found", 404);
    await this.assertCanManageOrder(shipment.order_id, actor);
    const agent = await this.resolveAssignableDeliveryAgent(deliveryAgentId, shipment.seller_id, actor);
    return this.deliveryRepository.assignDeliveryAgentToShipment(shipmentId, agent, {
      deliveryAgentSnapshot: this.buildDeliveryAgentSnapshot(agent),
      updatedBy: actor.userId,
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

    const orderSellerIds = Array.from(new Set(
      (order.items || []).map((item) => String(item.seller_id || item.sellerId || "")).filter(Boolean),
    ));
    const actorSellerId = actor.ownerSellerId || actor.userId;
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    let sellerId = payload.sellerId || (isAdmin ? null : actorSellerId);
    if (!sellerId && orderSellerIds.length === 1) sellerId = orderSellerIds[0];
    if (!sellerId) {
      throw new AppError("Seller ID is required for a multi-seller order shipment", 400);
    }
    if (!orderSellerIds.includes(String(sellerId))) {
      throw new AppError("Selected seller does not own items in this order", 400);
    }
    if (!isAdmin && String(sellerId) !== String(actorSellerId)) {
      throw new AppError("You can create shipments only for your seller account", 403);
    }
    const deliveryAgent = payload.deliveryAgentId
      ? await this.resolveAssignableDeliveryAgent(payload.deliveryAgentId, sellerId, actor)
      : null;
    const dealFulfillment = this.resolveDealFulfillment(order, sellerId, payload);
    const verificationRequired = Boolean(payload.verificationRequired || dealFulfillment.deliveryVerificationRequired);
    const verificationMethods = verificationRequired
      ? this.normalizeVerificationMethods(
          payload.verificationMethods?.length
            ? payload.verificationMethods
            : dealFulfillment.deliveryVerificationMethods,
        )
      : [];
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
      dealId: dealFulfillment.dealId || payload.dealId || null,
      fulfillmentModel: dealFulfillment.fulfillmentModel || payload.fulfillmentModel || null,
      verificationRequired,
      verificationMethods,
      deliveryProofSnapshot: payload.deliveryProofSnapshot || {},
      deliveryAgentId: deliveryAgent?.id || null,
      deliveryAgentSnapshot: deliveryAgent ? this.buildDeliveryAgentSnapshot(deliveryAgent) : {},
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

  resolveDealFulfillment(order = {}, sellerId, payload = {}) {
    if (payload.dealId || payload.fulfillmentModel) {
      return {
        dealId: payload.dealId || null,
        fulfillmentModel: payload.fulfillmentModel || null,
        deliveryVerificationRequired: Boolean(payload.verificationRequired),
        deliveryVerificationMethods: payload.verificationMethods || [],
      };
    }
    const sellerItems = (order.items || []).filter((item) => String(item.seller_id || item.sellerId || "") === String(sellerId || ""));
    const dealItem = sellerItems.find((item) => item.deal_id || item.dealId || item.fulfillment_snapshot?.dealId || item.deal_snapshot?.dealId);
    if (!dealItem) return {};
    const fulfillment = this.normalizeJson(dealItem.fulfillment_snapshot || dealItem.fulfillmentSnapshot, {});
    const dealSnapshot = this.normalizeJson(dealItem.deal_snapshot || dealItem.dealSnapshot, {});
    return {
      dealId: dealItem.deal_id || dealItem.dealId || fulfillment.dealId || dealSnapshot.dealId || null,
      fulfillmentModel: fulfillment.fulfillmentModel || dealSnapshot.fulfillmentModel || null,
      deliveryVerificationRequired: Boolean(fulfillment.deliveryVerificationRequired || dealSnapshot.deliveryVerificationRequired),
      deliveryVerificationMethods: fulfillment.deliveryVerificationMethods || dealSnapshot.deliveryVerificationMethods || [],
    };
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
    if (payload.status === DELIVERY_STATUS.DELIVERED && shipment.verification_required) {
      throw new AppError("Delivery verification is required. Use the delivery confirmation endpoint.", 409);
    }
    if (payload.status === DELIVERY_STATUS.DELIVERED_VERIFIED) {
      throw new AppError("Use the delivery confirmation endpoint to verify delivery", 409);
    }
    this.assertTrackingTransition(shipment.status, payload.status, payload);
    const result = await this.deliveryRepository.addTrackingEvent(shipmentId, {
      ...payload,
      actorId: actor.userId,
      source: payload.source || "manual",
    });

    await this.syncOrderForTracking(result.shipment, actor);
    await this.dealService.markOrderDeliveryVerified(result.shipment.order_id, actor).catch(() => null);
    await this.publishShipmentTrackingEvent(result.shipment, actor);
    return result;
  }

  async handleTrackingWebhook(payload = {}, context = {}) {
    this.verifyTrackingWebhook(context.signature, context.rawBody);
    const shipment = payload.shipmentId
      ? await this.deliveryRepository.findShipmentById(payload.shipmentId)
      : null;
    if (!shipment) {
      return { acknowledged: true, ignored: true };
    }
    if (payload.status === DELIVERY_STATUS.DELIVERED && shipment.verification_required) {
      return { acknowledged: true, ignored: true, reason: "delivery_verification_required" };
    }
    if (payload.status === DELIVERY_STATUS.DELIVERED_VERIFIED) {
      return { acknowledged: true, ignored: true, reason: "use_delivery_confirmation_endpoint" };
    }
    this.assertTrackingTransition(shipment.status, payload.status, payload);
    const provider = payload.provider || "manual";
    const providerEventId = payload.eventId || payload.providerEventId || crypto
      .createHash("sha256")
      .update(context.rawBody || JSON.stringify(payload))
      .digest("hex");
    const claimed = await this.deliveryRepository.claimWebhookEvent({
      provider,
      providerEventId,
      shipmentId: shipment.id,
      payload,
    });
    if (!claimed) return { acknowledged: true, duplicate: true };

    try {
      const result = await this.deliveryRepository.addTrackingEvent(shipment.id, {
        status: payload.status,
        eventTime: payload.eventTime,
        location: payload.location,
        note: payload.note,
        deliveryException: payload.deliveryException,
        source: provider,
        rawPayload: payload,
        actorId: "webhook",
      });
      await this.syncOrderForTracking(result.shipment, { userId: "webhook", role: "system" });
      await this.publishShipmentTrackingEvent(result.shipment, { userId: "webhook", role: "system" });
      await this.deliveryRepository.completeWebhookEvent(provider, providerEventId, "processed");
      return { acknowledged: true, shipment: result.shipment };
    } catch (error) {
      await this.deliveryRepository.completeWebhookEvent(
        provider,
        providerEventId,
        "failed",
        error?.message || "delivery_webhook_processing_failed",
      );
      throw error;
    }
  }

  async createManifest(payload, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can create manifests", 403);
    }
    const shipments = await this.deliveryRepository.findShipmentsByIds(payload.shipmentIds);
    if (shipments.length !== payload.shipmentIds.length) {
      throw new AppError("One or more selected shipments were not found", 404);
    }
    const invalid = shipments.find((shipment) =>
      shipment.manifest_id || shipment.status !== DELIVERY_STATUS.INITIATED);
    if (invalid) {
      throw new AppError(`Shipment ${invalid.id} cannot be added to a manifest`, 409);
    }
    return this.deliveryRepository.createManifest({
      ...payload,
      createdBy: actor.userId,
    });
  }

  async syncOrderForTracking(shipment, actor) {
    let nextOrderStatus = null;
    if ([DELIVERY_STATUS.DELIVERED, DELIVERY_STATUS.DELIVERED_VERIFIED].includes(shipment.status)) {
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
      [DELIVERY_STATUS.DELIVERED_VERIFIED]: DOMAIN_EVENTS.SHIPMENT_DELIVERY_VERIFIED_V1,
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

    const existing = await this.deliveryRepository.findEWayBillByOrderId(orderId);
    if (existing) {
      if (!payload.eWayBillNumber || payload.eWayBillNumber === existing.e_way_bill_number) {
        return existing;
      }
      throw new AppError("An e-way bill already exists for this order", 409);
    }

    return this.deliveryRepository.createEWayBill({
      ...payload,
      orderId,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    });
  }

  async generateDeliveryOtp(shipmentId, payload = {}, actor) {
    const shipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!shipment) {
      throw new AppError("Shipment not found", 404);
    }

    await this.assertCanManageOrder(shipment.order_id, actor);
    if (shipment.status !== DELIVERY_STATUS.OUT_FOR_DELIVERY) {
      throw new AppError("Delivery OTP can be generated only when shipment is out for delivery", 409);
    }

    const otp = createOtp(6);
    const expiresAt = new Date(Date.now() + Number(payload.ttlMinutes || DELIVERY_OTP_TTL_MINUTES) * 60 * 1000);
    const result = await this.deliveryRepository.storeDeliveryOtp(shipmentId, {
      otpHash: this.hashDeliveryOtp(shipmentId, otp),
      expiresAt,
      proofSnapshot: {
        channels: payload.channels || ["in_app"],
        requestedAt: new Date().toISOString(),
      },
      rawPayload: {
        channels: payload.channels || ["in_app"],
        ttlMinutes: payload.ttlMinutes || DELIVERY_OTP_TTL_MINUTES,
      },
      actorId: actor.userId,
      actorRole: actor.role,
      source: payload.source || "manual",
    });

    const order = await this.orderRepository.findById(shipment.order_id);
    await this.sendDeliveryOtpNotifications({
      order,
      shipment,
      otp,
      expiresAt,
      channels: payload.channels || ["in_app"],
    });
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.SHIPMENT_DELIVERY_OTP_GENERATED_V1,
        {
          shipmentId,
          orderId: shipment.order_id,
          buyerId: order?.buyer_id || null,
          sellerId: shipment.seller_id,
          expiresAt,
          channels: payload.channels || ["in_app"],
          generatedBy: actor.userId,
          otpQueued: true,
        },
        { source: "delivery-module", aggregateId: shipment.order_id },
      ),
    );

    return {
      shipment: result.shipment,
      verificationEvent: result.event,
      expiresAt,
      channels: payload.channels || ["in_app"],
      otp,
    };
  }

  async sendDeliveryOtpNotifications({ order, shipment, otp, expiresAt, channels = [] }) {
    const buyerId = order?.buyer_id;
    if (!buyerId) return;

    const uniqueChannels = Array.from(new Set(channels.length ? channels : ["in_app"]));
    await Promise.all(uniqueChannels.map(async (channel) => {
      const normalizedChannel = channel === "app" ? "push" : channel;
      const notification = await this.notificationRepository.create({
        userId: buyerId,
        channel: normalizedChannel,
        subject: "Delivery OTP",
        template: `Your delivery OTP for order ${order.order_number || shipment.order_id} is ${otp}. It expires at ${new Date(expiresAt).toISOString()}.`,
        payload: {
          shipmentId: shipment.id,
          orderId: shipment.order_id,
          expiresAt,
        },
        status: "queued",
        idempotencyKey: `delivery_otp:${shipment.id}:${normalizedChannel}:${new Date(expiresAt).getTime()}`,
      });

      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.NOTIFICATION_CREATED_V1,
          {
            userId: buyerId,
            channel: normalizedChannel,
            subject: notification.subject,
          },
          { source: "delivery-module", aggregateId: notification.id },
        ),
      );
    }));
  }

  async confirmDelivery(shipmentId, payload = {}, actor) {
    const shipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!shipment) {
      throw new AppError("Shipment not found", 404);
    }

    await this.assertCanManageOrder(shipment.order_id, actor);
    if (shipment.status === DELIVERY_STATUS.DELIVERED_VERIFIED) {
      return { shipment, alreadyVerified: true };
    }
    if (![DELIVERY_STATUS.OUT_FOR_DELIVERY, DELIVERY_STATUS.DELIVERED].includes(shipment.status)) {
      throw new AppError("Delivery can be verified only after shipment is out for delivery", 409);
    }

    const method = payload.method || "otp";
    if (!DELIVERY_VERIFICATION_METHODS.includes(method)) {
      throw new AppError("Unsupported delivery verification method", 400);
    }

    this.assertVerificationMethodAllowed(shipment, method, actor);
    await this.verifyDeliveryProof(shipment, payload, actor);

    const result = await this.deliveryRepository.markDeliveryVerified(shipmentId, {
      method,
      proofSnapshot: this.buildDeliveryProofSnapshot(payload, actor),
      rawPayload: payload.rawPayload || {},
      actorId: actor.userId,
      actorRole: actor.role,
      source: payload.source || "manual",
      location: payload.location || null,
      note: payload.note || null,
    });

    await this.syncOrderForTracking(result.shipment, actor);
    await this.publishShipmentTrackingEvent(result.shipment, actor);
    return result;
  }

  normalizeVerificationMethods(methods = []) {
    const list = Array.isArray(methods) ? methods : [];
    return Array.from(new Set(
      list.filter((method) => DELIVERY_VERIFICATION_METHODS.includes(method)),
    ));
  }

  normalizeJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  assertVerificationMethodAllowed(shipment, method, actor) {
    if (method === "manual_override") {
      if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
        throw new AppError("Only admin users can override delivery verification", 403);
      }
      return;
    }

    const requiredMethods = this.normalizeVerificationMethods(shipment.verification_methods);
    if (shipment.verification_required && requiredMethods.length && !requiredMethods.includes(method)) {
      throw new AppError(`Delivery verification requires one of: ${requiredMethods.join(", ")}`, 409);
    }
  }

  async verifyDeliveryProof(shipment, payload, actor) {
    const method = payload.method || "otp";
    if (method === "otp") {
      return this.verifyDeliveryOtp(shipment, payload, actor);
    }

    if (method === "manual_override") {
      if (!String(payload.note || payload.reason || "").trim()) {
        throw new AppError("Manual delivery override requires a reason", 400);
      }
      return;
    }

    const hasProof = Boolean(
      payload.verificationReference ||
      payload.proofUrl ||
      payload.qrCode ||
      Object.keys(payload.proofSnapshot || {}).length,
    );
    if (!hasProof) {
      await this.deliveryRepository.recordDeliveryVerificationFailure(shipment.id, {
        method,
        failureReason: "proof_required",
        proofSnapshot: this.buildDeliveryProofSnapshot(payload, actor),
        rawPayload: payload.rawPayload || {},
        actorId: actor.userId,
        actorRole: actor.role,
        source: payload.source || "manual",
      });
      throw new AppError("Delivery proof is required for this verification method", 400);
    }
  }

  async verifyDeliveryOtp(shipment, payload, actor) {
    const otp = String(payload.otp || "").trim();
    if (!otp) {
      throw new AppError("Delivery OTP is required", 400);
    }
    if (!shipment.delivery_otp_hash || !shipment.delivery_otp_expires_at) {
      throw new AppError("No active delivery OTP found. Generate a new OTP first.", 409);
    }
    if (Number(shipment.delivery_otp_attempts || 0) >= DELIVERY_OTP_MAX_ATTEMPTS) {
      throw new AppError("Delivery OTP attempts exceeded. Use manual override with proof.", 429);
    }
    if (new Date(shipment.delivery_otp_expires_at).getTime() < Date.now()) {
      await this.deliveryRepository.recordDeliveryVerificationFailure(shipment.id, {
        method: "otp",
        failureReason: "otp_expired",
        incrementAttempts: false,
        proofSnapshot: this.buildDeliveryProofSnapshot(payload, actor),
        rawPayload: payload.rawPayload || {},
        actorId: actor.userId,
        actorRole: actor.role,
        source: payload.source || "manual",
      });
      throw new AppError("Delivery OTP has expired", 410);
    }

    const expected = String(shipment.delivery_otp_hash);
    const provided = this.hashDeliveryOtp(shipment.id, otp);
    if (expected.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      await this.deliveryRepository.recordDeliveryVerificationFailure(shipment.id, {
        method: "otp",
        failureReason: "otp_mismatch",
        incrementAttempts: true,
        proofSnapshot: this.buildDeliveryProofSnapshot(payload, actor),
        rawPayload: payload.rawPayload || {},
        actorId: actor.userId,
        actorRole: actor.role,
        source: payload.source || "manual",
      });
      throw new AppError("Invalid delivery OTP", 400);
    }
  }

  buildDeliveryProofSnapshot(payload = {}, actor = {}) {
    return {
      method: payload.method || "otp",
      verificationReference: payload.verificationReference || null,
      proofUrl: payload.proofUrl || null,
      qrCode: payload.qrCode ? "provided" : null,
      note: payload.note || payload.reason || null,
      capturedAt: payload.capturedAt || new Date().toISOString(),
      actorId: actor.userId || null,
      actorRole: actor.role || null,
      ...(payload.proofSnapshot || {}),
    };
  }

  hashDeliveryOtp(shipmentId, otp) {
    return crypto.createHash("sha256").update(`${shipmentId}:${otp}`).digest("hex");
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

    const record = await this.deliveryRepository.updateEWayBillStatus(ewayBillId, {
      ...payload,
      updatedBy: actor.userId,
    });
    if (!record) {
      throw new AppError("Delivery record not found", 404);
    }
    return record;
  }

  async assertCanViewOrder(order, orderId, actor) {
    if (["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin || order.buyer_id === actor.userId) {
      return;
    }

    await this.assertCanManageOrder(orderId, actor);
  }

  async assertCanManageOrder(orderId, actor) {
    if (["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin) {
      return;
    }

    if (!["seller", "seller-admin", "seller-sub-admin"].includes(actor.role)) {
      throw new AppError("You are not allowed to manage delivery for this order", 403);
    }

    const sellerId = actor.ownerSellerId || actor.userId;
    const isSellerInOrder = await this.orderRepository.isSellerInOrder(orderId, sellerId);
    if (!isSellerInOrder) {
      throw new AppError("You are not allowed to manage delivery for this order", 403);
    }
  }

  assertTrackingTransition(currentStatus, nextStatus, payload = {}) {
    if (currentStatus === nextStatus) return;
    const allowed = SHIPMENT_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(`Shipment cannot move from '${currentStatus}' to '${nextStatus}'`, 409);
    }
    if (["failed", "cancelled", "rto", "lost", "damaged"].includes(nextStatus) && !String(payload.note || payload.deliveryException || "").trim()) {
      throw new AppError(`A note or exception reason is required for '${nextStatus}'`, 400);
    }
  }

  verifyTrackingWebhook(signature, rawBody) {
    const secret = env.delivery.webhookSecret;
    if (!secret && !env.delivery.requireWebhookSignature) return;
    if (!secret) throw new AppError("Delivery webhook secret is not configured", 503);
    if (!signature || !rawBody) throw new AppError("Invalid delivery webhook request", 400);
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = String(signature);
    if (expected.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      throw new AppError("Invalid delivery webhook signature", 401);
    }
  }
}

module.exports = { DeliveryService };
