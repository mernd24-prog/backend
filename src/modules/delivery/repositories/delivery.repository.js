"use strict";

const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class DeliveryRepository {
  async getServiceability(pincode) {
    const [serviceability] = await knex("pincode_serviceability")
      .where({ pincode })
      .limit(1);
    const exclusions = await knex("delivery_exclusions")
      .where({ pincode, active: true })
      .orderBy("created_at", "desc");

    return { serviceability: serviceability || null, exclusions };
  }

  async createEWayBill(payload) {
    const [record] = await knex("e_way_bill_details")
      .insert({
        id: uuidv4(),
        order_id: payload.orderId,
        invoice_id: payload.invoiceId || null,
        e_way_bill_number: payload.eWayBillNumber || null,
        status: payload.status || "initiated",
        valid_from: payload.validFrom || null,
        valid_until: payload.validUntil || null,
        transporter_name: payload.transporterName || null,
        vehicle_number: payload.vehicleNumber || null,
        distance_km: payload.distanceKm || null,
        payload_snapshot: payload.payloadSnapshot || {},
        created_by: payload.createdBy || null,
        updated_by: payload.updatedBy || payload.createdBy || null,
      })
      .returning("*");

    return record;
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
          status: payload.status || "initiated",
          shipping_mode: payload.shippingMode || "standard",
          cod: Boolean(payload.cod),
          package_snapshot: payload.packageSnapshot || {},
          pickup_address_snapshot: payload.pickupAddressSnapshot || {},
          ship_to_snapshot: payload.shipToSnapshot || {},
          rate_snapshot: payload.rateSnapshot || {},
          label_data: payload.labelData || {},
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
    const query = knex("shipments");
    if (orderId) query.where("order_id", orderId);
    if (sellerId) query.where("seller_id", sellerId);
    if (status) query.where("status", status);
    if (courierName) query.whereILike("courier_name", `%${courierName}%`);
    if (awbNumber) query.where((builder) => builder.whereILike("awb_number", `%${awbNumber}%`).orWhereILike("tracking_number", `%${awbNumber}%`));
    if (search) {
      query.where((builder) => builder
        .whereILike("awb_number", `%${search}%`)
        .orWhereILike("tracking_number", `%${search}%`)
        .orWhereILike("courier_name", `%${search}%`)
        .orWhereRaw("order_id::text ILIKE ?", [`%${search}%`])
        .orWhereRaw("id::text ILIKE ?", [`%${search}%`]));
    }
    if (cod !== null && cod !== undefined) query.where("cod", cod === true || cod === "true");
    if (fromDate) query.where("created_at", ">=", fromDate);
    if (toDate) query.where("created_at", "<=", toDate);

    const sortColumns = {
      createdAt: "created_at",
      created_at: "created_at",
      status: "status",
      sellerId: "seller_id",
      seller_id: "seller_id",
      courierName: "courier_name",
      courier_name: "courier_name",
      expectedDeliveryAt: "expected_delivery_at",
      expected_delivery_at: "expected_delivery_at",
      cod: "cod",
    };
    const orderColumn = sortColumns[sortBy] || "created_at";
    const direction = String(sortDir).toLowerCase() === "asc" ? "asc" : "desc";
    const [{ count }] = await query.clone().clearSelect().clearOrder().count({ count: "*" });
    const items = await query.clone()
      .orderBy(orderColumn, direction)
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset);
    return { items, total: Number(count || 0), limit: Number(limit), offset: Number(offset) };
  }

  async findShipmentsByIds(shipmentIds = []) {
    if (!shipmentIds.length) return [];
    return knex("shipments").whereIn("id", shipmentIds);
  }

  async findShipmentById(shipmentId) {
    const [shipment] = await knex("shipments").where("id", shipmentId).limit(1);
    if (!shipment) return null;
    const trackingEvents = await knex("shipment_tracking_events")
      .where("shipment_id", shipmentId)
      .orderBy("event_time", "asc");
    return { ...shipment, trackingEvents };
  }

  async addTrackingEvent(shipmentId, payload) {
    const trx = await knex.transaction();

    try {
      const [shipment] = await trx("shipments").where("id", shipmentId).limit(1).forUpdate();
      if (!shipment) {
        await trx.commit();
        return null;
      }

      const [updated] = await trx("shipments")
        .where("id", shipmentId)
        .update({
          status: payload.status,
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
        })
        .returning("*");

      await trx.commit();
      return { shipment: updated, event };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async createManifest(payload) {
    const trx = await knex.transaction();

    try {
      const [manifest] = await trx("shipment_manifests")
        .insert({
          id: uuidv4(),
          manifest_number: payload.manifestNumber || `MAN-${Date.now()}`,
          courier_name: payload.courierName || null,
          shipment_ids: payload.shipmentIds || [],
          status: payload.status || "created",
          metadata: payload.metadata || {},
          created_by: payload.createdBy || null,
        })
        .returning("*");

      await trx("shipments")
        .whereIn("id", payload.shipmentIds || [])
        .update({
          manifest_id: manifest.id,
          status: "manifested",
          updated_by: payload.createdBy || null,
          updated_at: knex.fn.now(),
        });

      if (payload.shipmentIds?.length) {
        const shipments = await trx("shipments")
          .select("id", "order_id")
          .whereIn("id", payload.shipmentIds);
        await trx("shipment_tracking_events").insert(shipments.map((shipment) => ({
          id: uuidv4(),
          shipment_id: shipment.id,
          order_id: shipment.order_id,
          status: "manifested",
          event_time: new Date(),
          note: `Added to manifest ${manifest.manifest_number}`,
          source: "manual",
          raw_payload: { manifestId: manifest.id, manifestNumber: manifest.manifest_number },
          actor_id: payload.createdBy || null,
        })));
      }

      await trx.commit();
      return manifest;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async claimWebhookEvent(payload) {
    const id = uuidv4();
    const result = await knex.raw(
      `INSERT INTO delivery_webhook_events
        (id, provider, provider_event_id, shipment_id, status, payload)
       VALUES (?, ?, ?, ?, 'processing', ?::jsonb)
       ON CONFLICT (provider, provider_event_id)
       DO UPDATE SET
         status = 'processing',
         shipment_id = EXCLUDED.shipment_id,
         payload = EXCLUDED.payload,
         updated_at = NOW()
       WHERE delivery_webhook_events.status = 'failed'
       RETURNING *`,
      [
        id,
        payload.provider,
        payload.providerEventId,
        payload.shipmentId || null,
        JSON.stringify(payload.payload || {}),
      ],
    );
    return result.rows?.[0] || null;
  }

  async completeWebhookEvent(provider, providerEventId, status, errorMessage = null) {
    const [event] = await knex("delivery_webhook_events")
      .where({ provider, provider_event_id: providerEventId })
      .update({
        status,
        payload: knex.raw(
          "COALESCE(payload, '{}'::jsonb) || ?::jsonb",
          [JSON.stringify(errorMessage ? { processingError: errorMessage } : {})],
        ),
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return event || null;
  }

  async findEWayBillByOrderId(orderId) {
    const [record] = await knex("e_way_bill_details")
      .where("order_id", orderId)
      .orderBy("created_at", "desc")
      .limit(1);
    return record || null;
  }

  async findEWayBillById(ewayBillId) {
    const [record] = await knex("e_way_bill_details")
      .where("id", ewayBillId)
      .limit(1);
    return record || null;
  }

  async updateEWayBillStatus(ewayBillId, payload) {
    const [record] = await knex("e_way_bill_details")
      .where("id", ewayBillId)
      .update({
        status: payload.status,
        transporter_name: payload.transporterName,
        vehicle_number: payload.vehicleNumber,
        updated_by: payload.updatedBy || null,
        updated_at: knex.fn.now(),
      })
      .returning("*");

    return record || null;
  }
}

module.exports = { DeliveryRepository };
