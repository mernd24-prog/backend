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
          shipment_type: payload.shipmentType || "forward",
          direction: payload.direction || "forward",
          return_id: payload.returnId || null,
          deal_id: payload.dealId || null,
          fulfillment_model: payload.fulfillmentModel || null,
          verification_required: Boolean(payload.verificationRequired),
          verification_methods: payload.verificationMethods || [],
          delivery_proof_snapshot: payload.deliveryProofSnapshot || {},
          delivery_agent_id: payload.deliveryAgentId || null,
          delivery_agent_snapshot: payload.deliveryAgentSnapshot || {},
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
    deliveryAgentId = null,
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
    if (returnId) query.where("return_id", returnId);
    if (shipmentType) query.where("shipment_type", shipmentType);
    if (direction) query.where("direction", direction);
    if (dealId) query.where("deal_id", dealId);
    if (sellerId) query.where("seller_id", sellerId);
    if (deliveryAgentId) query.where("delivery_agent_id", deliveryAgentId);
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
    direction = String(sortDir).toLowerCase() === "asc" ? "asc" : "desc";
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
    const verificationEvents = await knex("delivery_verification_events")
      .where("shipment_id", shipmentId)
      .orderBy("created_at", "asc")
      .catch(() => []);
    return { ...shipment, trackingEvents, verificationEvents };
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

  async storeDeliveryOtp(shipmentId, payload) {
    const trx = await knex.transaction();

    try {
      const [shipment] = await trx("shipments").where("id", shipmentId).limit(1).forUpdate();
      if (!shipment) {
        await trx.commit();
        return null;
      }

      const currentMethods = Array.isArray(shipment.verification_methods)
        ? shipment.verification_methods
        : [];
      const verificationMethods = Array.from(new Set([...currentMethods, "otp"]));

      const [updated] = await trx("shipments")
        .where("id", shipmentId)
        .update({
          verification_required: true,
          verification_methods: verificationMethods,
          delivery_otp_hash: payload.otpHash,
          delivery_otp_expires_at: payload.expiresAt,
          delivery_otp_attempts: 0,
          updated_by: payload.actorId || shipment.updated_by,
          updated_at: knex.fn.now(),
        })
        .returning("*");

      const [event] = await trx("delivery_verification_events")
        .insert({
          id: uuidv4(),
          shipment_id: shipmentId,
          order_id: shipment.order_id,
          method: "otp",
          status: "sent",
          proof_snapshot: payload.proofSnapshot || {},
          attempts: 0,
          expires_at: payload.expiresAt,
          source: payload.source || "manual",
          raw_payload: payload.rawPayload || {},
          actor_id: payload.actorId || null,
          actor_role: payload.actorRole || null,
        })
        .returning("*");

      await trx.commit();
      return { shipment: updated, event };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async recordDeliveryVerificationFailure(shipmentId, payload) {
    const trx = await knex.transaction();

    try {
      const [shipment] = await trx("shipments").where("id", shipmentId).limit(1).forUpdate();
      if (!shipment) {
        await trx.commit();
        return null;
      }

      const attempts = Number(shipment.delivery_otp_attempts || 0) + (payload.incrementAttempts ? 1 : 0);
      const [updated] = await trx("shipments")
        .where("id", shipmentId)
        .update({
          delivery_otp_attempts: attempts,
          updated_by: payload.actorId || shipment.updated_by,
          updated_at: knex.fn.now(),
        })
        .returning("*");

      const [event] = await trx("delivery_verification_events")
        .insert({
          id: uuidv4(),
          shipment_id: shipmentId,
          order_id: shipment.order_id,
          method: payload.method,
          status: "failed",
          proof_snapshot: payload.proofSnapshot || {},
          failure_reason: payload.failureReason || null,
          attempts,
          source: payload.source || "manual",
          raw_payload: payload.rawPayload || {},
          actor_id: payload.actorId || null,
          actor_role: payload.actorRole || null,
        })
        .returning("*");

      await trx.commit();
      return { shipment: updated, event };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async markDeliveryVerified(shipmentId, payload) {
    const trx = await knex.transaction();

    try {
      const [shipment] = await trx("shipments").where("id", shipmentId).limit(1).forUpdate();
      if (!shipment) {
        await trx.commit();
        return null;
      }

      if (shipment.status === "delivered_verified") {
        const trackingEvents = await trx("shipment_tracking_events")
          .where("shipment_id", shipmentId)
          .orderBy("event_time", "asc");
        await trx.commit();
        return { shipment: { ...shipment, trackingEvents }, event: null, alreadyVerified: true };
      }

      const verifiedAt = payload.verifiedAt || new Date();
      const proofSnapshot = {
        method: payload.method,
        verifiedAt,
        ...(payload.proofSnapshot || {}),
      };

      const [updated] = await trx("shipments")
        .where("id", shipmentId)
        .update({
          status: "delivered_verified",
          verification_required: true,
          delivery_otp_hash: null,
          delivery_otp_expires_at: null,
          delivery_proof_snapshot: proofSnapshot,
          delivered_verified_at: verifiedAt,
          verified_by: payload.actorId || null,
          updated_by: payload.actorId || shipment.updated_by,
          updated_at: knex.fn.now(),
        })
        .returning("*");

      const [event] = await trx("delivery_verification_events")
        .insert({
          id: uuidv4(),
          shipment_id: shipmentId,
          order_id: shipment.order_id,
          method: payload.method,
          status: payload.method === "manual_override" ? "overridden" : "verified",
          proof_snapshot: proofSnapshot,
          attempts: Number(shipment.delivery_otp_attempts || 0),
          verified_at: verifiedAt,
          source: payload.source || "manual",
          raw_payload: payload.rawPayload || {},
          actor_id: payload.actorId || null,
          actor_role: payload.actorRole || null,
        })
        .returning("*");

      await trx("shipment_tracking_events")
        .insert({
          id: uuidv4(),
          shipment_id: shipmentId,
          order_id: shipment.order_id,
          status: "delivered_verified",
          event_time: verifiedAt,
          location: payload.location || null,
          note: payload.note || "Delivery verified",
          source: payload.source || "manual",
          raw_payload: {
            method: payload.method,
            proofSnapshot,
            ...(payload.rawPayload || {}),
          },
          actor_id: payload.actorId || null,
        });

      await trx.commit();
      return { shipment: updated, event, alreadyVerified: false };
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

  async listDeliveryAgents({
    sellerId = null,
    active = null,
    verificationStatus = null,
    search = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const query = knex("delivery_agents");
    if (sellerId) query.where("seller_id", sellerId);
    if (active !== null && active !== undefined) query.where("active", active === true || active === "true");
    if (verificationStatus) query.where("verification_status", verificationStatus);
    if (search) {
      const term = `%${String(search).trim()}%`;
      query.where((builder) => {
        builder
          .whereILike("name", term)
          .orWhereILike("phone", term)
          .orWhereILike("email", term)
          .orWhereILike("vehicle_number", term)
          .orWhereILike("license_number", term);
      });
    }

    const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
    const safeOffset = Math.max(Number(offset || 0), 0);
    const [{ count }] = await query.clone().clearSelect().clearOrder().count({ count: "*" });
    const items = await query
      .clone()
      .orderBy("created_at", "desc")
      .limit(safeLimit)
      .offset(safeOffset);

    return { items, total: Number(count || 0), limit: safeLimit, offset: safeOffset };
  }

  async findDeliveryAgentById(agentId) {
    const [agent] = await knex("delivery_agents").where("id", agentId).limit(1);
    return agent || null;
  }

  async createDeliveryAgent(payload = {}) {
    const [agent] = await knex("delivery_agents")
      .insert({
        id: uuidv4(),
        seller_id: payload.sellerId,
        name: payload.name,
        phone: payload.phone,
        email: payload.email || null,
        vehicle_type: payload.vehicleType || null,
        vehicle_number: payload.vehicleNumber || null,
        license_number: payload.licenseNumber || null,
        documents: payload.documents || {},
        verification_status: payload.verificationStatus || "pending",
        active: payload.active !== false,
        metadata: payload.metadata || {},
        created_by: payload.createdBy || null,
        updated_by: payload.updatedBy || payload.createdBy || null,
      })
      .returning("*");
    return agent;
  }

  async updateDeliveryAgent(agentId, payload = {}) {
    const next = {};
    if (payload.sellerId !== undefined) next.seller_id = payload.sellerId;
    if (payload.name !== undefined) next.name = payload.name;
    if (payload.phone !== undefined) next.phone = payload.phone;
    if (payload.email !== undefined) next.email = payload.email || null;
    if (payload.vehicleType !== undefined) next.vehicle_type = payload.vehicleType || null;
    if (payload.vehicleNumber !== undefined) next.vehicle_number = payload.vehicleNumber || null;
    if (payload.licenseNumber !== undefined) next.license_number = payload.licenseNumber || null;
    if (payload.documents !== undefined) next.documents = payload.documents || {};
    if (payload.verificationStatus !== undefined) next.verification_status = payload.verificationStatus;
    if (payload.active !== undefined) next.active = Boolean(payload.active);
    if (payload.metadata !== undefined) next.metadata = payload.metadata || {};
    next.updated_by = payload.updatedBy || null;
    next.updated_at = knex.fn.now();

    const [agent] = await knex("delivery_agents")
      .where("id", agentId)
      .update(next)
      .returning("*");
    return agent || null;
  }

  async assignDeliveryAgentToShipment(shipmentId, agent, payload = {}) {
    const [shipment] = await knex("shipments")
      .where("id", shipmentId)
      .update({
        delivery_agent_id: agent.id,
        delivery_agent_snapshot: payload.deliveryAgentSnapshot || {},
        updated_by: payload.updatedBy || null,
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return shipment || null;
  }
}

module.exports = { DeliveryRepository };
