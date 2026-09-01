"use strict";

const { AppError } = require("../../../shared/errors/app-error");
const { DeliveryRepository } = require("../repositories/delivery.repository");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { UserModel } = require("../../user/models/user.model");
const { DealService } = require("../../deal/services/deal.service");
const { CommissionService } = require("../../seller/services/commission.service");
const { ORDER_STATUS, PAYMENT_PROVIDER, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { DELIVERY_STATUS } = require("../models/delivery.model");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { logger } = require("../../../shared/logger/logger");
const { ProductModel } = require("../../product/models/product.model");
const { sellerChargeSettingsService } = require("../../seller/services/seller-charge-settings.service");
const { ShippingProfilesService } = require("./shipping-profiles.service");
const { settlementLifecycleService } = require("../../seller/services/settlement-lifecycle.service");
const { ReturnModel } = require("../../returns/models/return.model");
const { knex } = require("../../../infrastructure/postgres/postgres-client");

const shippingProfilesService = new ShippingProfilesService();

const SHIPMENT_TRANSITIONS = {
  initiated: ["in_transit", "failed"],
  manifested: ["in_transit", "failed"],
  picked_up: ["in_transit", "failed", "rto"],
  in_transit: ["delivered", "failed", "rto"],
  out_for_delivery: ["delivered", "failed", "rto"],
  failed: ["in_transit", "rto"],
  delivered: [],
  cancelled: [],
  rto: [],
  lost: [],
  damaged: [],
};

class DeliveryService {
  constructor({
    deliveryRepository = new DeliveryRepository(),
    orderRepository = new OrderRepository(),
    dealService = new DealService(),
    commissionService = CommissionService,
  } = {}) {
    this.deliveryRepository = deliveryRepository;
    this.orderRepository = orderRepository;
    this.dealService = dealService;
    this.commissionService = commissionService;
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

  async getServiceability(pincode, options = {}) {
    const result = await this.deliveryRepository.getServiceability(pincode);
    const platformServiceable = Boolean(result.serviceability?.serviceable) && result.exclusions.length === 0;
    const response = {
      pincode,
      serviceable: platformServiceable,
      platformServiceable,
      codAvailable: Boolean(result.serviceability?.cod_available),
      estimatedDeliveryDays: result.serviceability?.estimated_delivery_days || null,
      city: result.serviceability?.city || null,
      state: result.serviceability?.state || null,
      zoneCode: result.serviceability?.zone_code || null,
      exclusions: result.exclusions,
    };

    if (!options.productId) return response;

    const product = await ProductModel.findById(options.productId)
      .select("_id title sellerId organizationId category sku price salePrice shipping")
      .lean()
      .catch(() => null);
    if (!product?.sellerId) return response;

    // Apply shipping profile rules when the product has one assigned
    const profileId = product.shipping?.shippingProfileId;
    if (profileId) {
      try {
        const profile = await shippingProfilesService.getById(profileId);
        if (profile) {
          shippingProfilesService.assertProfileBelongsToSeller(profile, {
            sellerId: product.sellerId,
            organizationId: product.organizationId || null,
          });
          const check = shippingProfilesService.checkPincodeAgainstProfile(
            profile,
            pincode,
            response.city,
            response.state
          );

          if (!check.allowed) {
            return {
              ...response,
              serviceable: false,
              sellerRuleBlocked: true,
              shippingProfileId: profileId,
              shippingProfileName: profile.name,
              exclusions: [
                ...(response.exclusions || []),
                { reason: check.reason || "Not in seller's delivery area" },
              ],
            };
          }

          // Profile-level COD override
          const codAvailable = (result.serviceability ? response.codAvailable : true) && profile.codAvailable !== false;

          // Use profile's ETA over pincode table value
          const etaMin = profile.etaMin ?? null;
          const etaMax = profile.etaMax ?? null;

          // Shipping charge: free threshold check
          const lineTotal = Number(product.salePrice ?? product.price ?? 0);
          let shippingCharge = Number(profile.shippingCharge ?? 0);
          if (profile.freeShippingThreshold != null && lineTotal >= Number(profile.freeShippingThreshold)) {
            shippingCharge = 0;
          }

          return {
            ...response,
            serviceable: true,
            codAvailable,
            shippingProfileId: profileId,
            shippingProfileName: profile.name,
            shippingMethod: profile.shippingMethod,
            sellerDeliveryChargeAmount: shippingCharge,
            estimatedDeliveryDays: etaMin != null || etaMax != null
              ? { minDays: etaMin, maxDays: etaMax }
              : response.estimatedDeliveryDays,
            deliveryChargeBreakup: {
              sellers: [{
                sellerId: product.sellerId,
                shippingProfileId: profileId,
                shippingProfileName: profile.name,
                shippingMethod: profile.shippingMethod || "standard",
                chargeAmount: shippingCharge,
                isFree: shippingCharge === 0,
                estimatedDeliveryDays: { minDays: etaMin, maxDays: etaMax },
              }],
            },
          };
        }
      } catch (error) {
        return {
          ...response,
          serviceable: false,
          sellerRuleBlocked: true,
          shippingProfileId: profileId,
          exclusions: [
            ...(response.exclusions || []),
            { reason: error.message || "Shipping profile is not valid for this product" },
          ],
        };
      }
    }

    try {
      const pricedItem = {
        productId: String(product._id),
        title: product.title,
        sku: product.sku || "",
        sellerId: product.sellerId,
        organizationId: product.organizationId || null,
        category: product.category,
        quantity: 1,
        lineTotal: Number(product.salePrice ?? product.price ?? 0),
        discountedLineTotal: Number(product.salePrice ?? product.price ?? 0),
        shipping: product.shipping || {},
      };
      const delivery = await sellerChargeSettingsService.calculateDeliveryCharges([
        pricedItem,
      ], {
        postalCode: pincode,
        pincode,
        city: response.city,
        state: response.state,
        region: response.zoneCode,
        country: "India",
      });
      const sellerCod = await sellerChargeSettingsService.evaluateCodForItems([
        pricedItem,
      ], {
        postalCode: pincode,
        pincode,
        city: response.city,
        state: response.state,
        region: response.zoneCode,
        country: "India",
      }).catch(() => ({ allowed: response.codAvailable }));
      return {
        ...response,
        serviceable: delivery.amount >= 0,
        codAvailable: Boolean((result.serviceability ? response.codAvailable : true) && sellerCod.allowed),
        sellerDeliveryChargeAmount: delivery.amount,
        deliveryChargeBreakup: delivery.breakup,
      };
    } catch (error) {
      return {
        ...response,
        serviceable: false,
        sellerRuleBlocked: true,
        exclusions: [
          ...(response.exclusions || []),
          { reason: error.message || "Seller delivery rule blocked this pincode" },
        ],
      };
    }
  }

  async calculateRate(payload) {
    const rate = await this.deliveryRepository.calculateShippingRate(payload);
    if (!rate) {
      throw new AppError("Pincode is not serviceable", 400);
    }
    return rate;
  }

  isAdmin(actor = {}) {
    return ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
  }

  getActorSellerId(actor = {}) {
    return actor.ownerSellerId || actor.sellerId || actor.userId;
  }

  async getForwardFulfillmentItems(order, sellerId, organizationId = null) {
    const [cancellations, returns] = await Promise.all([
      knex("order_cancellations").where("order_id", order.id),
      ReturnModel.find({ orderId: order.id, status: { $nin: ["rejected", "qc_failure_upheld"] } }).lean(),
    ]);
    const blocked = new Map();
    const addBlocked = (itemId, quantity) => {
      const key = String(itemId || "");
      if (!key) return;
      blocked.set(key, (blocked.get(key) || 0) + Math.max(Number(quantity || 0), 0));
    };

    cancellations
      .filter((request) => !["completed", "failed", "rejected"].includes(String(request.status || "").toLowerCase()))
      .forEach((request) => (request.items || []).forEach((item) => addBlocked(
        item.orderItemId || item.order_item_id,
        item.requestedQuantity || item.requested_quantity || item.quantity,
      )));
    returns.forEach((request) => {
      const status = String(request.status || "").toLowerCase();
      const refundStatus = String(request.refund?.status || "").toLowerCase();
      if (status === "closed" && !["completed", "not_required"].includes(refundStatus)) return;
      const hasApprovalDecision = !["requested", "pending", "under_review"].includes(status);
      (request.items || []).forEach((item) => {
        const quantity = hasApprovalDecision && item.approvedQuantity !== undefined
          ? item.approvedQuantity
          : item.requestedQuantity ?? item.quantity;
        addBlocked(item.orderItemId, quantity);
      });
    });

    return (order.items || [])
      .filter((item) => String(item.seller_id || item.sellerId || "") === String(sellerId || ""))
      .filter((item) => !organizationId || String(item.organization_id || item.organizationId || "") === String(organizationId))
      .map((item) => {
        const ordered = Math.max(Number(item.quantity || 0), 0);
        const alreadyCancelled = Math.max(Number(item.cancelled_quantity || item.cancelledQuantity || 0), 0);
        const blockedByRequest = Math.max(Number(blocked.get(String(item.id)) || 0), 0);
        return {
          orderItemId: item.id,
          productId: item.product_id || item.productId,
          variantId: item.variant_id || item.variantId || null,
          orderedQuantity: ordered,
          excludedQuantity: Math.min(alreadyCancelled + blockedByRequest, ordered),
          quantity: Math.max(ordered - alreadyCancelled - blockedByRequest, 0),
        };
      });
  }

  assertHasFulfillableQuantity(items = []) {
    if (!items.some((item) => Number(item.quantity || 0) > 0)) {
      throw new AppError("All item quantities in this shipment have an active cancellation or return request and cannot move to transit", 409);
    }
  }

  async createShipment(payload, actor) {
    const order = await this.orderRepository.findByIdWithItems(payload.orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    await this.assertCanManageOrder(payload.orderId, actor);
    if (![ORDER_STATUS.CONFIRMED, ORDER_STATUS.PACKED, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED].includes(order.status)) {
      throw new AppError("Shipment can be created only after order is confirmed", 409);
    }
    const paidForFulfillment = order.payment_status === PAYMENT_STATUS.CAPTURED ||
      (order.payment_provider === PAYMENT_PROVIDER.COD && order.payment_status === PAYMENT_STATUS.AUTHORIZED);
    if (!paidForFulfillment) {
      throw new AppError("Payment must be completed before a shipment can be created", 409);
    }

    const orderSellerIds = Array.from(new Set(
      (order.items || []).map((item) => String(item.seller_id || item.sellerId || "")).filter(Boolean),
    ));
    const actorSellerId = this.getActorSellerId(actor);
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
    const organizationId = this.resolveShipmentOrganizationId(order, sellerId, payload, actor);
    const fulfillmentItems = await this.getForwardFulfillmentItems(order, sellerId, organizationId);
    this.assertHasFulfillableQuantity(fulfillmentItems);
    const dealFulfillment = this.resolveDealFulfillment(order, sellerId, payload);
    const initialStatus = this.resolveInitialShipmentStatus(payload.status, order.status);
    const shipment = await this.deliveryRepository.createShipment({
      ...payload,
      sellerId,
      organizationId,
      cod: order.payment_provider === PAYMENT_PROVIDER.COD || Boolean(payload.cod),
      provider: "manual",
      awbNumber: payload.awbNumber,
      trackingNumber: payload.trackingNumber || payload.awbNumber,
      trackingUrl: payload.trackingUrl,
      shippedAt: payload.shippedAt,
      status: initialStatus,
      labelData: payload.labelData || {},
      shipToSnapshot: payload.shipToSnapshot || order.shipping_address || {},
      dealId: dealFulfillment.dealId || payload.dealId || null,
      fulfillmentModel: dealFulfillment.fulfillmentModel || payload.fulfillmentModel || null,
      deliveryProofSnapshot: payload.deliveryProofSnapshot || {},
      packageSnapshot: { ...(payload.packageSnapshot || {}), items: fulfillmentItems.filter((item) => item.quantity > 0) },
      metadata: { ...(payload.metadata || {}), fulfillmentItems, excludedRequestedQuantities: fulfillmentItems.filter((item) => item.excludedQuantity > 0) },
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
          organizationId: shipment.organization_id || organizationId || null,
          status: shipment.status,
          trackingNumber: shipment.tracking_number,
          updatedBy: actor.userId,
        },
        { source: "delivery-module", aggregateId: shipment.order_id },
      ),
    );

    return shipment;
  }

  resolveShipmentOrganizationId(order = {}, sellerId, payload = {}, actor = {}) {
    const sellerItemOrgIds = Array.from(new Set(
      (order.items || [])
        .filter((item) => String(item.seller_id || item.sellerId || "") === String(sellerId))
        .map((item) => item.organization_id || item.organizationId || null),
    ));
    let organizationId = payload.organizationId || payload.organization_id || actor.organizationId || null;
    if (!organizationId && sellerItemOrgIds.length === 1) {
      organizationId = sellerItemOrgIds[0] || null;
    }
    if (sellerItemOrgIds.length > 1 && !organizationId) {
      throw new AppError("Organization ID is required for this seller shipment", 400);
    }
    if (
      organizationId &&
      !sellerItemOrgIds.some((itemOrganizationId) => String(itemOrganizationId || "") === String(organizationId))
    ) {
      throw new AppError("Selected organization does not own items in this order", 400);
    }
    return organizationId || null;
  }

  resolveInitialShipmentStatus(requestedStatus, orderStatus) {
    if (requestedStatus && requestedStatus !== DELIVERY_STATUS.INITIATED) {
      return requestedStatus;
    }
    if ([ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED].includes(orderStatus)) {
      return DELIVERY_STATUS.DELIVERED;
    }
    if (orderStatus === ORDER_STATUS.SHIPPED) {
      return DELIVERY_STATUS.IN_TRANSIT;
    }
    return DELIVERY_STATUS.INITIATED;
  }

  resolveDealFulfillment(order = {}, sellerId, payload = {}) {
    if (payload.dealId || payload.fulfillmentModel) {
      return {
        dealId: payload.dealId || null,
        fulfillmentModel: payload.fulfillmentModel || null,
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
    };
  }

  async listShipments(query, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      query.sellerId = this.getActorSellerId(actor);
    }
    const result = await this.deliveryRepository.listShipments(query);
    return { ...result, items: await this.enrichShipmentRecords(result.items || []) };
  }

  async getShipment(shipmentId, actor) {
    const shipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!shipment) {
      throw new AppError("Shipment not found", 404);
    }
    await this.assertCanViewShipment(shipment, actor);
    return (await this.enrichShipmentRecords([shipment]))[0] || shipment;
  }

  userDisplayName(user = {}) {
    return [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ") ||
      user.sellerProfile?.displayName || user.sellerProfile?.businessName || user.email || "User";
  }

  async loadUserSummaries(ids = []) {
    const uniqueIds = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))]
      .filter((id) => UserModel.db.base.Types.ObjectId.isValid(id));
    if (!uniqueIds.length) return new Map();
    const users = await UserModel.find({ _id: { $in: uniqueIds } })
      .select("email phone profile sellerProfile role accountStatus")
      .lean()
      .catch(() => []);
    return new Map(users.map((user) => [String(user._id), {
      id: String(user._id),
      displayName: this.userDisplayName(user),
      email: user.email || null,
      phone: user.phone || null,
      role: user.role || null,
      accountStatus: user.accountStatus || null,
      businessName: user.sellerProfile?.businessName || user.sellerProfile?.displayName || null,
      supportEmail: user.sellerProfile?.supportEmail || null,
      supportPhone: user.sellerProfile?.supportPhone || null,
    }]));
  }

  async enrichSellerRecords(records = []) {
    const users = await this.loadUserSummaries(records.map((record) => record.seller_id || record.sellerId));
    return records.map((record) => {
      const seller = users.get(String(record.seller_id || record.sellerId || "")) || null;
      return {
        ...record,
        seller,
        sellerName: seller?.businessName || seller?.displayName || null,
      };
    });
  }

  async enrichShipmentRecords(records = []) {
    const ids = records.flatMap((record) => [
      record.seller_id || record.sellerId,
      record.buyer_id || record.buyerId,
      ...(record.trackingEvents || []).map((event) => event.actor_id || event.actorId),
    ]);
    const users = await this.loadUserSummaries(ids);
    return records.map((record) => {
      const seller = users.get(String(record.seller_id || record.sellerId || "")) || null;
      const buyer = users.get(String(record.buyer_id || record.buyerId || "")) || null;
      const withActor = (event = {}) => ({
        ...event,
        actor: users.get(String(event.actor_id || event.actorId || "")) || null,
      });
      return {
        ...record,
        seller,
        sellerName: seller?.businessName || seller?.displayName || null,
        buyer,
        buyerName: buyer?.displayName || null,
        trackingEvents: (record.trackingEvents || []).map(withActor),
      };
    });
  }

  async addTrackingEvent(shipmentId, payload, actor) {
    const shipment = await this.deliveryRepository.findShipmentById(shipmentId);
    if (!shipment) {
      throw new AppError("Shipment not found", 404);
    }

    await this.assertCanManageShipment(shipment, actor);
    const order = await this.orderRepository.findById(shipment.order_id);
    if (!order) throw new AppError("Order not found", 404);
    const paidForFulfillment = order.payment_status === PAYMENT_STATUS.CAPTURED ||
      (order.payment_provider === PAYMENT_PROVIDER.COD && order.payment_status === PAYMENT_STATUS.AUTHORIZED);
    if (this.isForwardShipment(shipment) && payload.status !== DELIVERY_STATUS.CANCELLED && !paidForFulfillment) {
      throw new AppError("Payment must be completed before shipment processing can begin", 409);
    }
    if (payload.status === DELIVERY_STATUS.CANCELLED) {
      throw new AppError(
        "Cancel the order items through the Cancellations workflow so inventory and refunds are processed correctly",
        409,
      );
    }
    const automaticEventTime = payload.eventTime || new Date().toISOString();
    payload.eventTime = automaticEventTime;
    if (
      payload.status === DELIVERY_STATUS.IN_TRANSIT &&
      !payload.shippedAt &&
      !shipment.shipped_at
    ) {
      payload.shippedAt = automaticEventTime;
    }
    if (payload.status === DELIVERY_STATUS.IN_TRANSIT) {
      const orderWithItems = await this.orderRepository.findByIdWithItems(shipment.order_id);
      const organizationId = shipment.organization_id || shipment.metadata?.organizationId || null;
      const fulfillmentItems = await this.getForwardFulfillmentItems(orderWithItems, shipment.seller_id, organizationId);
      this.assertHasFulfillableQuantity(fulfillmentItems);
      await this.deliveryRepository.updateShipmentFulfillmentSnapshot(shipmentId, fulfillmentItems);
      if (!String(payload.courierName || shipment.courier_name || "").trim()) throw new AppError("Courier name is required when shipping", 400);
      if (!String(payload.awbNumber || payload.trackingNumber || shipment.awb_number || shipment.tracking_number || "").trim()) {
        throw new AppError("AWB or tracking number is required when shipping", 400);
      }
      if (!payload.shippedAt && !shipment.shipped_at) throw new AppError("Shipment date is required when shipping", 400);
      const expectedDeliveryAt = payload.expectedDeliveryAt || shipment.expected_delivery_at;
      if (!expectedDeliveryAt) throw new AppError("Expected delivery date is required when shipping", 400);
      if (new Date(expectedDeliveryAt).getTime() <= new Date(payload.shippedAt || shipment.shipped_at || automaticEventTime).getTime()) {
        throw new AppError("Expected delivery date must be after the shipment date", 400);
      }
      payload.expectedDeliveryAt = new Date(expectedDeliveryAt).toISOString();
    }
    this.assertTrackingTransition(shipment.status, payload.status, payload);
    const result = await this.deliveryRepository.addTrackingEvent(shipmentId, {
      ...payload,
      actorId: actor.userId,
      source: payload.source || "manual",
    });

    await this.syncOrderForTracking(result.shipment, actor);
    await this.syncReplacementReturnForTracking(result.shipment, actor);
    await this.syncDealDeliveryForShipment(result.shipment, actor);
    await this.publishShipmentTrackingEvent(result.shipment, actor);
    return result;
  }

  async syncReplacementReturnForTracking(shipment, actor = {}) {
    if (String(shipment.shipment_type || "") !== "replacement" || !shipment.return_id) return;
    const returnRequest = await ReturnModel.findById(shipment.return_id);
    if (!returnRequest || String(returnRequest.replacementShipmentId || "") !== String(shipment.id || "")) return;

    const delivered = shipment.status === DELIVERY_STATUS.DELIVERED;
    const nextStatus = delivered ? "replacement_delivered" : "replacement_shipped";
    if (returnRequest.status === nextStatus || returnRequest.status === "replaced") return;
    if (!delivered && returnRequest.status !== "replacement_created") return;
    if (delivered && returnRequest.status !== "replacement_shipped") return;

    returnRequest.status = nextStatus;
    returnRequest.updatedBy = actor.userId || returnRequest.updatedBy || null;
    returnRequest.replacement.status = delivered ? "delivered" : "shipped";
    if (delivered) returnRequest.replacement.deliveredAt = shipment.delivered_at || new Date();
    returnRequest.timeline.push({
      status: nextStatus,
      actorId: actor.userId || null,
      actorRole: actor.role || null,
      note: delivered ? "Replacement shipment delivered" : "Replacement shipment updated",
      metadata: { shipmentId: shipment.id, shipmentStatus: shipment.status },
      at: new Date(),
    });
    await returnRequest.save();
    await eventPublisher.publish(makeEvent(
      DOMAIN_EVENTS.RETURN_STATUS_UPDATED_V1,
      {
        returnId: String(returnRequest._id),
        returnNumber: returnRequest.returnNumber || null,
        orderId: returnRequest.orderId,
        buyerId: returnRequest.buyerId,
        sellerId: returnRequest.sellerId || null,
        status: nextStatus,
        replacementOrderId: returnRequest.replacementOrderId || null,
        replacementShipmentId: shipment.id,
        updatedBy: actor.userId || null,
        actorRole: actor.role || null,
      },
      { source: "delivery-module", aggregateId: returnRequest.orderId },
    ));
  }
  async syncOrderForTracking(shipment, actor) {
    if (!this.isForwardShipment(shipment)) {
      return;
    }
    let aggregateDeliveryStatus = shipment.status;
    let progress = null;
    if (shipment.status === DELIVERY_STATUS.DELIVERED) {
      progress = await this.getForwardDeliveryProgress(shipment.order_id);
      aggregateDeliveryStatus = progress.aggregateDeliveryStatus;
      await settlementLifecycleService.ensureOrderDeliveryLifecycle(
        shipment.order_id,
        shipment.delivered_at || new Date(),
        shipment,
      );
      await this.syncSellerFinanceForDeliveredOrder(shipment.order_id, actor);
    }
    if (
      progress?.allDelivered &&
      ![ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED].includes(progress.order?.status)
    ) {
      await this.orderRepository.updateStatus(shipment.order_id, ORDER_STATUS.DELIVERED, {
        actorId: actor.userId,
        actorRole: actor.role,
        reason: "seller_marked_delivered",
        deliveryStatus: DELIVERY_STATUS.DELIVERED,
        metadata: {
          shipmentId: shipment.id,
          deliveredAt: shipment.delivered_at || new Date().toISOString(),
        },
      });
      return;
    }
    await this.updateOrderDeliveryStatusOnly(shipment.order_id, aggregateDeliveryStatus, actor, shipment.id);
  }

  isForwardShipment(shipment = {}) {
    return String(shipment.direction || "forward") !== "reverse" &&
      String(shipment.shipment_type || "forward") !== "return";
  }

  isDeliveredShipmentStatus(status) {
    return status === DELIVERY_STATUS.DELIVERED;
  }

  async getForwardDeliveryProgress(orderId) {
    const { order, items, shipments: forwardShipments } =
      await this.deliveryRepository.findOrderDeliveryProgress(orderId);
    const [pendingCancellations, pendingReturns] = await Promise.all([
      knex("order_cancellations")
        .where("order_id", orderId)
        .whereNotIn("status", ["completed", "failed", "rejected"]),
      ReturnModel.find({
        orderId: String(orderId),
        status: { $in: ["requested", "pending", "under_review"] },
      }).select("_id").lean(),
    ]);
    const hasPendingItemRequests = pendingCancellations.length > 0 || pendingReturns.length > 0;
    const groupKey = (sellerId, organizationId = null) => `${String(sellerId)}:${organizationId || "default"}`;
    const sellerIds = new Set(
      (items || [])
        .map((item) => {
          const sellerId = item.seller_id || item.sellerId || "";
          if (!sellerId) return "";
          return groupKey(sellerId, item.organization_id || item.organizationId || null);
        })
        .filter(Boolean),
    );
    const deliveredSellerIds = new Set(
      forwardShipments
        .filter((item) => this.isDeliveredShipmentStatus(item.status))
        .map((item) => {
          const metadata = this.normalizeJson(item.metadata, {});
          return groupKey(
            item.seller_id || item.sellerId || "",
            item.organization_id || item.organizationId || metadata.organizationId || null,
          );
        })
        .filter(Boolean),
    );
    const allDelivered = !hasPendingItemRequests && sellerIds.size > 0 && Array.from(sellerIds).every((sellerId) => deliveredSellerIds.has(sellerId));
    return {
      order,
      allDelivered,
      hasPendingItemRequests,
      aggregateDeliveryStatus: allDelivered
        ? DELIVERY_STATUS.DELIVERED
        : "partially_delivered",
    };
  }

  async syncDealDeliveryForShipment(shipment, actor = {}) {
    if (!this.isForwardShipment(shipment) || !this.isDeliveredShipmentStatus(shipment.status)) return;
    const progress = await this.getForwardDeliveryProgress(shipment.order_id);
    if (!progress.allDelivered) return;
    await this.dealService.markOrderDeliveryVerified(shipment.order_id, actor).catch(() => null);
  }

  async syncSellerFinanceForDeliveredOrder(orderId, actor = {}) {
    try {
      await this.commissionService.calculateCommission(orderId, {
        actor,
        sourceStatus: ORDER_STATUS.DELIVERED,
      });
    } catch (error) {
      logger.error({ orderId, error: error.message }, "Seller commission sync from delivery failed");
    }
  }

  async updateOrderDeliveryStatusOnly(orderId, deliveryStatus, actor, shipmentId) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) return null;
    const nextOrderStatus = [DELIVERY_STATUS.IN_TRANSIT, DELIVERY_STATUS.OUT_FOR_DELIVERY, "partially_delivered"].includes(deliveryStatus) &&
      ![ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED, ORDER_STATUS.CANCELLED].includes(order.status)
      ? ORDER_STATUS.SHIPPED
      : order.status;
    return this.orderRepository.updateStatus(orderId, nextOrderStatus, {
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
          organizationId: shipment.organization_id || null,
          status: shipment.status,
          trackingNumber: shipment.tracking_number,
          updatedBy: actor.userId || null,
          actorRole: actor.role || null,
        },
        { source: "delivery-module", aggregateId: shipment.order_id },
      ),
    );
  }

  async assertCanViewOrder(order, orderId, actor) {
    if (["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin || order.buyer_id === actor.userId) {
      return;
    }

    await this.assertCanManageOrder(orderId, actor);
  }

  async assertCanViewShipment(shipment, actor = {}) {
    if (this.isAdmin(actor) || shipment.buyer_id === actor.userId) return;
    await this.assertCanManageShipment(shipment, actor);
  }

  async assertCanManageShipment(shipment, actor = {}) {
    if (this.isAdmin(actor)) return;

    if (!["seller", "seller-admin", "seller-sub-admin"].includes(actor.role)) {
      throw new AppError("You are not allowed to manage delivery for this shipment", 403);
    }

    const sellerId = String(this.getActorSellerId(actor) || "");
    if (!sellerId || String(shipment.seller_id || shipment.sellerId || "") !== sellerId) {
      throw new AppError("You are not allowed to manage delivery for this shipment", 403);
    }

    if (actor.organizationId) {
      const order = await this.orderRepository.findByIdWithItems(shipment.order_id);
      const sellerOrgMatches = (order?.items || []).some((item) =>
        String(item.seller_id || item.sellerId || "") === sellerId &&
        String(item.organization_id || item.organizationId || "") === String(actor.organizationId),
      );
      if (!sellerOrgMatches) {
        throw new AppError("You are not allowed to manage delivery for this seller organization", 403);
      }
    }
  }

  async assertCanManageOrder(orderId, actor) {
    if (["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin) {
      return;
    }

    if (!["seller", "seller-admin", "seller-sub-admin"].includes(actor.role)) {
      throw new AppError("You are not allowed to manage delivery for this order", 403);
    }

    const sellerId = this.getActorSellerId(actor);
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

}

module.exports = { DeliveryService };
