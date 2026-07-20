"use strict";

const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class DeliveryRepository {
  jsonb(value, fallback = {}) {
    let normalized = value;
    if (normalized === undefined || normalized === null || normalized === "") {
      normalized = fallback;
    }
    if (typeof normalized === "string") {
      try {
        normalized = JSON.parse(normalized);
      } catch {
        normalized = fallback;
      }
    }
    return knex.raw("?::jsonb", [JSON.stringify(normalized)]);
  }

  async getServiceability(pincode) {
    const [serviceability] = await knex("pincode_serviceability")
      .where({ pincode })
      .limit(1);
    const exclusions = await knex("delivery_exclusions")
      .where({ pincode, active: true })
      .orderBy("created_at", "desc");

    return { serviceability: serviceability || null, exclusions };
  }

  async calculateShippingRate({ pincode, weightGrams = 0, shippingMode = "standard", cod = false }) {
    const { serviceability } = await this.getServiceability(pincode);
    if (!serviceability || !serviceability.serviceable) {
      return null;
    }

    const [rate] = await knex("shipping_rates")
      .where({
        zone_code: serviceability.zone_code,
        shipping_mode: shippingMode,
        active: true,
      })
      .andWhere("weight_min_grams", "<=", weightGrams)
      .andWhere("weight_max_grams", ">=", weightGrams)
      .orderBy("weight_min_grams", "desc")
      .limit(1);

    if (!rate) {
      return {
        amount: 0,
        currency: "INR",
        zoneCode: serviceability.zone_code,
        serviceability,
        estimatedDeliveryDays: serviceability.estimated_delivery_days,
        rate: null,
      };
    }

    const weightKg = Math.max(Number(weightGrams || 0) / 1000, 0);
    const amount = Number(
      (
        Number(rate.base_fee || 0) +
        Number(rate.per_kg_fee || 0) * weightKg +
        (cod ? Number(rate.cod_fee || 0) : 0)
      ).toFixed(2),
    );

    return {
      amount,
      currency: rate.currency || "INR",
      zoneCode: serviceability.zone_code,
      serviceability,
      estimatedDeliveryDays: serviceability.estimated_delivery_days,
      rate,
    };
  }

  async createShipment(payload) {
    const trx = await knex.transaction();

    try {
      if (payload.idempotencyKey) {
        const [existing] = await trx("shipments")
          .where("idempotency_key", payload.idempotencyKey)
          .limit(1);
        if (existing) {
          const events = await trx("shipment_tracking_events")
            .where("shipment_id", existing.id)
            .orderBy("event_time", "asc");
          await trx.commit();
          return { ...existing, trackingEvents: events };
        }
      }

      const id = uuidv4();
      const [shipment] = await trx("shipments")
        .insert({
          id,
          order_id: payload.orderId,
          seller_id: payload.sellerId,
          provider: payload.provider || "manual",
          courier_name: payload.courierName || null,
          awb_number: payload.awbNumber || null,
          tracking_number: payload.trackingNumber || payload.awbNumber || null,
          tracking_url: payload.trackingUrl || null,
          shipped_at: payload.shippedAt || null,
          delivered_at: payload.deliveredAt || null,
          status: payload.status || "initiated",
          shipping_mode: payload.shippingMode || "standard",
          cod: Boolean(payload.cod),
          package_snapshot: payload.packageSnapshot || {},
          pickup_address_snapshot: payload.pickupAddressSnapshot || {},
          ship_to_snapshot: payload.shipToSnapshot || {},
          rate_snapshot: payload.rateSnapshot || {},
          label_data: payload.labelData || {},
          shipment_type: payload.shipmentType || "forward",
          direction: payload.direction || "forward",
          return_id: payload.returnId || null,
          deal_id: payload.dealId || null,
          fulfillment_model: payload.fulfillmentModel || null,
          delivery_proof_snapshot: payload.deliveryProofSnapshot || {},
          manifest_id: payload.manifestId || null,
          expected_delivery_at: payload.expectedDeliveryAt || null,
          idempotency_key: payload.idempotencyKey || null,
          metadata: payload.metadata || {},
          created_by: payload.createdBy || null,
          updated_by: payload.updatedBy || payload.createdBy || null,
        })
        .returning("*");

      await trx("shipment_tracking_events").insert({
        id: uuidv4(),
        shipment_id: id,
        order_id: payload.orderId,
        status: shipment.status,
        event_time: payload.eventTime || new Date(),
        location: payload.location || null,
        note: payload.note || "Shipment created",
        source: payload.source || "manual",
        raw_payload: payload.rawPayload || {},
        actor_id: payload.createdBy || null,
      });

      await trx.commit();
      return { ...shipment, trackingEvents: [] };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async listShipments({
    orderId = null,
    returnId = null,
    shipmentType = null,
    direction = null,
    dealId = null,
    sellerId = null,
    status = null,
    courierName = null,
    awbNumber = null,
    search = null,
    cod = null,
    fromDate = null,
    toDate = null,
    sortBy = "created_at",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = {}) {
    const query = knex({ s: "shipments" })
      .leftJoin({ o: "orders" }, "o.id", "s.order_id")
      .select("s.*", "o.order_number", "o.buyer_id", "o.payment_provider", "o.payment_status");
    if (orderId) query.where("s.order_id", orderId);
    if (returnId) query.where("s.return_id", returnId);
    if (shipmentType) query.where("s.shipment_type", shipmentType);
    if (direction) query.where("s.direction", direction);
    if (dealId) query.where("s.deal_id", dealId);
    if (sellerId) query.where("s.seller_id", sellerId);
    if (status) query.where("s.status", status);
    if (courierName) query.whereILike("s.courier_name", `%${courierName}%`);
    if (awbNumber) query.where((builder) => builder.whereILike("s.awb_number", `%${awbNumber}%`).orWhereILike("s.tracking_number", `%${awbNumber}%`));
    if (search) {
      query.where((builder) => builder
        .whereILike("s.awb_number", `%${search}%`)
        .orWhereILike("s.tracking_number", `%${search}%`)
        .orWhereILike("s.courier_name", `%${search}%`)
        .orWhereILike("o.order_number", `%${search}%`)
        .orWhereRaw("s.order_id::text ILIKE ?", [`%${search}%`])
        .orWhereRaw("s.id::text ILIKE ?", [`%${search}%`]));
    }
    if (cod !== null && cod !== undefined) query.where("s.cod", cod === true || cod === "true");
    if (fromDate) query.where("s.created_at", ">=", fromDate);
    if (toDate) query.where("s.created_at", "<=", toDate);

    const sortColumns = {
      createdAt: "s.created_at",
      created_at: "s.created_at",
      status: "s.status",
      sellerId: "s.seller_id",
      seller_id: "s.seller_id",
      courierName: "s.courier_name",
      courier_name: "s.courier_name",
      expectedDeliveryAt: "s.expected_delivery_at",
      expected_delivery_at: "s.expected_delivery_at",
      cod: "s.cod",
    };
    const orderColumn = sortColumns[sortBy] || "s.created_at";
    const sortDirection = String(sortDir).toLowerCase() === "asc" ? "asc" : "desc";
    const [{ count }] = await query.clone().clearSelect().clearOrder().countDistinct({ count: "s.id" });
    const items = await query.clone()
      .orderBy(orderColumn, sortDirection)
      .orderBy("s.created_at", "desc")
      .limit(limit)
      .offset(offset);
    return { items, total: Number(count || 0), limit: Number(limit), offset: Number(offset) };
  }

  async findShipmentsByIds(shipmentIds = []) {
    if (!shipmentIds.length) return [];
    return knex("shipments").whereIn("id", shipmentIds);
  }

  async findShipmentById(shipmentId) {
    const [shipment] = await knex("shipments as s")
      .leftJoin("orders as o", "o.id", "s.order_id")
      .select(
        "s.*",
        "o.order_number",
        "o.buyer_id",
        "o.payment_provider",
        "o.payment_status",
        "o.status as order_status",
      )
      .where("s.id", shipmentId)
      .limit(1);
    if (!shipment) return null;
    const trackingEvents = await knex("shipment_tracking_events")
      .where("shipment_id", shipmentId)
      .orderBy("event_time", "asc");
    return { ...shipment, trackingEvents };
  }

  async findOrderDeliveryProgress(orderId) {
    const [order, items, shipments] = await Promise.all([
      knex("orders").where("id", orderId).first(),
      knex("order_items")
        .where("order_id", orderId)
        .select("id", "seller_id", "organization_id"),
      knex("shipments")
        .where("order_id", orderId)
        .where((builder) => builder.where("direction", "forward").orWhereNull("direction"))
        .where((builder) => builder.where("shipment_type", "forward").orWhereNull("shipment_type")),
    ]);
    return { order: order || null, items, shipments };
  }

  async addTrackingEvent(shipmentId, payload) {
    const trx = await knex.transaction();

    try {
      if (payload.idempotencyKey) {
        const existingEvent = await trx("shipment_tracking_events")
          .where("idempotency_key", payload.idempotencyKey)
          .first();
        if (existingEvent) {
          const shipment = await trx("shipments").where("id", existingEvent.shipment_id).first();
          await trx.commit();
          return { shipment, event: existingEvent, duplicate: true };
        }
      }
      const [shipment] = await trx("shipments").where("id", shipmentId).limit(1).forUpdate();
      if (!shipment) {
        await trx.commit();
        return null;
      }

      const [updated] = await trx("shipments")
        .where("id", shipmentId)
        .update({
          status: payload.status,
          courier_name: payload.courierName || shipment.courier_name,
          awb_number: payload.awbNumber || payload.trackingNumber || shipment.awb_number,
          tracking_number: payload.trackingNumber || payload.awbNumber || shipment.tracking_number,
          tracking_url: payload.trackingUrl || shipment.tracking_url,
          shipped_at: payload.status === "in_transit" ? (payload.shippedAt || shipment.shipped_at || new Date()) : shipment.shipped_at,
          delivered_at: payload.status === "delivered" ? (payload.eventTime || shipment.delivered_at || new Date()) : shipment.delivered_at,
          delivery_exception: payload.deliveryException || shipment.delivery_exception,
          updated_by: payload.actorId || shipment.updated_by,
          updated_at: knex.fn.now(),
        })
        .returning("*");

      const [event] = await trx("shipment_tracking_events")
        .insert({
          id: uuidv4(),
          shipment_id: shipmentId,
          order_id: shipment.order_id,
          status: payload.status,
          event_time: payload.eventTime || new Date(),
          location: payload.location || null,
          note: payload.note || null,
          source: payload.source || "manual",
          raw_payload: payload.rawPayload || {},
          actor_id: payload.actorId || null,
          idempotency_key: payload.idempotencyKey || null,
        })
        .returning("*");

      await trx.commit();
      return { shipment: updated, event };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }
}

module.exports = { DeliveryRepository };
