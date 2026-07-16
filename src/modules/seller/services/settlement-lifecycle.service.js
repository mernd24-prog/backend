"use strict";

const { v4: uuidv4 } = require("uuid");
const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { AppError } = require("../../../shared/errors/app-error");
const { ORDER_STATUS, PAYMENT_PROVIDER, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");
const { ReturnModel } = require("../../returns/models/return.model");

const ADMIN_ROLES = new Set(["admin", "sub-admin", "super-admin"]);
const OPEN_RETURN_STATUSES = ["requested", "approved", "picked_up", "received", "qc_pending", "refund_pending"];
const FINAL_COLLECTION_STATUSES = ["verified", "remitted"];

class SettlementLifecycleService {
  isAdmin(actor = {}) {
    return Boolean(actor.isSuperAdmin || ADMIN_ROLES.has(actor.role));
  }

  number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
  }

  parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  addDays(value, days) {
    const date = new Date(value);
    date.setDate(date.getDate() + Number(days || 0));
    return date;
  }

  async getPolicy() {
    const settings = await commerceSettingsService.getSettings();
    return {
      returnWindowDays: Math.max(Number(settings.returns?.defaultWindowDays || 7), 1),
      payoutSchedule: settings.finance?.payoutSchedule || "manual",
      codCollectionMode: settings.cod?.collectionPolicy || "platform_or_courier",
      payoutRequiresCapture: settings.cod?.payoutRequiresCapture !== false,
    };
  }

  async ensureOrderDeliveryLifecycle(orderId, deliveredAt = new Date(), shipment = null) {
    const order = await knex("orders").where("id", orderId).first();
    if (!order) return null;
    const policy = await this.getPolicy();
    const allOrderItems = await knex("order_items").where("order_id", orderId);
    const shipmentMetadata = this.parseJson(shipment?.metadata, {});
    const shipmentItemIds = new Set((shipmentMetadata.orderItemIds || []).map(String));
    const shipmentOrganizationId = shipmentMetadata.organizationId || shipment?.organization_id || null;
    const orderItems = shipment
      ? allOrderItems.filter((item) => {
        if (shipmentItemIds.size) return shipmentItemIds.has(String(item.id));
        return String(item.seller_id) === String(shipment.seller_id) &&
          (!shipmentOrganizationId || String(item.organization_id || "") === String(shipmentOrganizationId));
      })
      : allOrderItems;
    if (!orderItems.length) return null;
    const itemSnapshots = orderItems.map((item) => {
      const productSnapshot = this.parseJson(item.product_snapshot, {});
      const existingSnapshot = this.parseJson(item.return_policy_snapshot, {});
      const productPolicy = productSnapshot.returnPolicy || productSnapshot.return_policy ||
        productSnapshot.commercialPolicy?.returnPolicy || existingSnapshot;
      const returnable = productPolicy.returnable ?? productPolicy.eligible ?? item.returnable ?? true;
      const returnWindowDays = returnable
        ? Math.max(Number(productPolicy.returnWindowDays ?? productPolicy.days ?? item.return_window_days ?? policy.returnWindowDays), 0)
        : 0;
      const itemDeliveredAt = item.delivered_at ? new Date(item.delivered_at) : new Date(deliveredAt);
      const returnEligibleUntil = item.return_eligible_until
        ? new Date(item.return_eligible_until)
        : this.addDays(itemDeliveredAt, returnWindowDays);
      return {
        item,
        returnable: Boolean(returnable),
        returnWindowDays,
        deliveredAt: itemDeliveredAt,
        returnEligibleUntil,
        snapshot: {
          ...productPolicy,
          returnable: Boolean(returnable),
          eligible: Boolean(returnable),
          returnWindowDays,
          days: returnWindowDays,
          deliveredAt: itemDeliveredAt.toISOString(),
          eligibleUntil: returnEligibleUntil.toISOString(),
          source: "product_snapshot",
          shipmentId: shipment?.id || null,
        },
      };
    });
    const returnableItems = itemSnapshots.filter((entry) => entry.returnable);
    const aggregateEligibleAt = (returnableItems.length ? returnableItems : itemSnapshots)
      .reduce((latest, entry) => latest > entry.returnEligibleUntil ? latest : entry.returnEligibleUntil, new Date(deliveredAt));
    const existingUntil = order.return_eligible_until ? new Date(order.return_eligible_until) : null;
    const returnEligibleUntil = existingUntil && existingUntil > aggregateEligibleAt
      ? existingUntil
      : aggregateEligibleAt;
    const aggregateWindowDays = itemSnapshots.reduce(
      (maximum, entry) => Math.max(maximum, entry.returnWindowDays),
      Number(order.return_window_days || 0),
    );
    const snapshot = {
      returnWindowDays: aggregateWindowDays,
      deliveredAt: new Date(deliveredAt).toISOString(),
      eligibleUntil: returnEligibleUntil.toISOString(),
      source: "product_item_policies",
      shipmentId: shipment?.id || null,
    };

    await knex.transaction(async (trx) => {
      await trx("orders").where("id", orderId).update({
        return_window_days: aggregateWindowDays,
        return_eligible_until: returnEligibleUntil,
        fulfillment_eligible_at: returnEligibleUntil,
        return_policy_snapshot: snapshot,
        metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify({ settlementLifecycle: snapshot })]),
        updated_at: knex.fn.now(),
      });
      for (const entry of itemSnapshots) {
        await trx("order_items").where("id", entry.item.id).update({
          delivered_at: entry.deliveredAt,
          returnable: entry.returnable,
          return_window_days: entry.returnWindowDays,
          return_eligible_until: entry.returnEligibleUntil,
          payout_eligible_at: entry.returnEligibleUntil,
          return_policy_snapshot: entry.snapshot,
        });
      }
    });

    if (shipment && order.payment_provider === PAYMENT_PROVIDER.COD) {
      await this.ensureCodCollectionForShipment(order, shipment, policy);
    }
    return { ...snapshot, orderId };
  }

  async ensureCodCollectionForShipment(order, shipment, policy) {
    const existing = await knex("cod_collections")
      .where({ order_id: order.id, shipment_id: shipment.id, seller_id: shipment.seller_id })
      .first();
    if (existing) return existing;

    const [items, sellerShipmentCount, payment] = await Promise.all([
      knex("order_items").select("seller_id", "line_total", "discount_amount").where("order_id", order.id),
      knex("shipments").where({ order_id: order.id, seller_id: shipment.seller_id }).whereNot("direction", "reverse").count("id as count").first(),
      knex("payments").where({ order_id: order.id, provider: PAYMENT_PROVIDER.COD }).orderBy("created_at", "desc").first(),
    ]);
    const totalBase = items.reduce((sum, item) => sum + this.number(item.line_total) - this.number(item.discount_amount), 0);
    const sellerBase = items
      .filter((item) => String(item.seller_id) === String(shipment.seller_id))
      .reduce((sum, item) => sum + this.number(item.line_total) - this.number(item.discount_amount), 0);
    const shipmentCount = Math.max(Number(sellerShipmentCount?.count || 1), 1);
    const expectedAmount = this.number((this.number(order.payable_amount || order.total_amount) * (sellerBase / Math.max(totalBase, 1))) / shipmentCount);
    const collectionMode = policy.codCollectionMode;

    const [collection] = await knex("cod_collections").insert({
      id: uuidv4(),
      order_id: order.id,
      shipment_id: shipment.id,
      seller_id: shipment.seller_id,
      organization_id: shipment.organization_id || null,
      payment_id: payment?.id || null,
      collection_mode: collectionMode,
      collected_by: collectionMode === "seller_direct" ? "seller" : "platform_or_courier",
      expected_amount: expectedAmount,
      collected_amount: payment?.status === PAYMENT_STATUS.CAPTURED && collectionMode !== "seller_direct" ? expectedAmount : 0,
      currency: order.currency || "INR",
      status: payment?.status === PAYMENT_STATUS.CAPTURED && collectionMode !== "seller_direct" ? "verified" : "pending",
      verified_at: payment?.status === PAYMENT_STATUS.CAPTURED && collectionMode !== "seller_direct" ? knex.fn.now() : null,
      metadata: { createdFrom: "delivery_verified", shipmentId: shipment.id, paymentAlreadyCaptured: payment?.status === PAYMENT_STATUS.CAPTURED },
    }).returning("*");
    return collection;
  }

  async submitSellerCodCollection(shipmentId, payload = {}, actor = {}) {
    const collection = await knex({ c: "cod_collections" })
      .leftJoin({ s: "shipments" }, "s.id", "c.shipment_id")
      .select("c.*", "s.seller_id as shipment_seller_id")
      .where("c.shipment_id", shipmentId)
      .first();
    if (!collection) throw new AppError("COD collection is not available for this shipment", 404);
    const sellerId = actor.ownerSellerId || actor.sellerId || actor.userId || actor.sub;
    if (!this.isAdmin(actor) && String(collection.seller_id || collection.shipment_seller_id) !== String(sellerId)) {
      throw new AppError("You can submit COD collection only for your shipment", 403);
    }
    if (!["seller_direct", "hybrid"].includes(collection.collection_mode) && !this.isAdmin(actor)) {
      throw new AppError("This shipment uses platform/courier COD collection", 409);
    }
    if (FINAL_COLLECTION_STATUSES.includes(collection.status)) return collection;
    const amount = this.number(payload.collectedAmount);
    if (amount <= 0) throw new AppError("Collected COD amount must be greater than zero", 400);
    if (amount > this.number(collection.expected_amount) + 0.01) {
      throw new AppError("Collected COD amount cannot exceed the expected COD amount", 400);
    }
    const [updated] = await knex("cod_collections").where("id", collection.id).update({
      collected_amount: amount,
      collection_date: payload.collectionDate || new Date(),
      reference_id: payload.referenceId || null,
      proof_url: payload.proofUrl || null,
      notes: payload.notes || null,
      status: "submitted",
      collected_by: "seller",
      submitted_by: actor.userId || actor.sub || null,
      submitted_at: knex.fn.now(),
      metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify({ submittedFrom: "seller" })]),
      updated_at: knex.fn.now(),
    }).returning("*");
    return updated;
  }

  async verifyCodCollection(collectionId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can verify COD collections", 403);
    const collection = await knex("cod_collections").where("id", collectionId).first();
    if (!collection) throw new AppError("COD collection not found", 404);
    if (collection.status === "remitted" || collection.status === "verified") return collection;
    const collectedAmount = this.number(payload.collectedAmount ?? collection.collected_amount ?? collection.expected_amount);
    if (collectedAmount <= 0) throw new AppError("A collected COD amount is required", 400);
    const [updated] = await knex("cod_collections").where("id", collectionId).update({
      collected_amount: collectedAmount,
      status: payload.markRemitted === true ? "remitted" : "verified",
      collection_date: payload.collectionDate || collection.collection_date || new Date(),
      reference_id: payload.referenceId || collection.reference_id || null,
      proof_url: payload.proofUrl || collection.proof_url || null,
      notes: payload.notes || collection.notes || null,
      verified_by: actor.userId || actor.sub || null,
      verified_at: knex.fn.now(),
      remitted_at: payload.markRemitted === true ? knex.fn.now() : collection.remitted_at,
      updated_at: knex.fn.now(),
    }).returning("*");
    await this.syncSettlementForVerifiedCollection(updated, actor);
    return updated;
  }

  async verifyPlatformCollectionsForPayment(payment, actor = {}) {
    if (payment.provider !== PAYMENT_PROVIDER.COD) return [];
    const rows = await knex("cod_collections")
      .where({ order_id: payment.order_id })
      .whereIn("collection_mode", ["platform_or_courier", "hybrid"])
      .whereIn("status", ["pending", "submitted"]);
    return Promise.all(rows.map((row) => this.verifyCodCollection(row.id, {
      collectedAmount: row.collected_amount || row.expected_amount,
      referenceId: payment.provider_payment_id || payment.transaction_reference,
      notes: "COD collection verified from payment approval",
    }, actor)));
  }

  async syncSettlementForVerifiedCollection(collection, actor = {}) {
    if (collection.collected_by !== "seller" || !FINAL_COLLECTION_STATUSES.includes(collection.status)) return null;
    const adjustmentAmount = -Math.abs(this.number(collection.collected_amount));
    const payload = {
      id: uuidv4(), seller_id: collection.seller_id, organization_id: collection.organization_id || null,
      order_id: collection.order_id, cod_collection_id: collection.id, type: "cod_recovery",
      amount: adjustmentAmount, currency: collection.currency || "INR", status: "pending",
      reference_id: collection.reference_id || null, notes: collection.notes || null,
      metadata: { source: "seller_direct_cod", collectedAmount: this.number(collection.collected_amount) },
      created_by: actor.userId || actor.sub || null,
    };
    await knex("seller_settlement_adjustments").insert(payload)
      .onConflict(["cod_collection_id", "type"])
      .merge({ amount: adjustmentAmount, reference_id: payload.reference_id, notes: payload.notes, metadata: payload.metadata, updated_at: knex.fn.now() });
    // seller_settlements is the existing finance recovery queue. Keep this projection so
    // the current Payout Operations and Negative Balances screens work without a second queue.
    const existingRecovery = await knex("seller_settlements")
      .whereRaw("COALESCE(metadata, '{}'::jsonb) ->> 'codCollectionId' = ?", [collection.id])
      .first();
    const recoveryMetadata = {
      source: "seller_direct_cod_recovery",
      codCollectionId: collection.id,
      orderId: collection.order_id,
      collectedAmount: this.number(collection.collected_amount),
      adjustmentType: "cod_recovery",
    };
    if (existingRecovery) {
      await knex("seller_settlements").where("id", existingRecovery.id).update({
        net_amount: adjustmentAmount,
        notes: "Seller-direct COD collection recovery",
        metadata: recoveryMetadata,
        updated_at: knex.fn.now(),
      });
    } else {
      await knex("seller_settlements").insert({
        id: uuidv4(), seller_id: collection.seller_id, organization_id: collection.organization_id || null,
        settlement_date: new Date().toISOString().slice(0, 10), gross_amount: 0,
        commission_amount: 0, tax_amount: 0, refund_amount: 0, adjustment_amount: adjustmentAmount,
        net_amount: adjustmentAmount, currency: collection.currency || "INR", status: "pending",
        notes: "Seller-direct COD collection recovery", metadata: recoveryMetadata,
        created_at: knex.fn.now(), updated_at: knex.fn.now(),
      });
    }
    return payload;
  }

  async listCodCollections(query = {}, actor = {}) {
    const sellerId = actor.ownerSellerId || actor.sellerId || actor.userId || actor.sub;
    const builder = knex({ c: "cod_collections" })
      .leftJoin({ o: "orders" }, "o.id", "c.order_id")
      .leftJoin({ s: "shipments" }, "s.id", "c.shipment_id")
      .select("c.*", "o.order_number", "o.status as order_status", "s.awb_number", "s.courier_name");
    if (!this.isAdmin(actor)) builder.where("c.seller_id", sellerId);
    if (query.status) builder.where("c.status", query.status);
    if (query.orderId) builder.where("c.order_id", query.orderId);
    if (query.sellerId && this.isAdmin(actor)) builder.where("c.seller_id", query.sellerId);
    return builder.orderBy("c.created_at", "desc").limit(Math.min(Math.max(Number(query.limit || 100), 1), 500));
  }

  async finalizeEligibleOrders() {
    const now = new Date();
    const orders = await knex("orders")
      .where("status", ORDER_STATUS.DELIVERED)
      .whereNotNull("fulfillment_eligible_at")
      .where("fulfillment_eligible_at", "<=", now)
      .limit(500);
    const results = [];
    for (const order of orders) {
      const openReturn = await ReturnModel.exists({ orderId: String(order.id), status: { $in: OPEN_RETURN_STATUSES } }).catch(() => null);
      if (openReturn) {
        results.push({ orderId: order.id, fulfilled: false, reason: "open_return" });
        continue;
      }
      await knex("orders").where({ id: order.id, status: ORDER_STATUS.DELIVERED }).update({
        status: ORDER_STATUS.FULFILLED,
        metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify({ settlementLifecycle: { fulfilledAt: now.toISOString(), reason: "return_window_closed" } })]),
        updated_at: knex.fn.now(),
      });
      await knex("order_status_history").insert({
        id: uuidv4(), order_id: order.id, from_status: ORDER_STATUS.DELIVERED,
        to_status: ORDER_STATUS.FULFILLED, reason: "return_window_closed", actor_id: "system", actor_role: "system",
        metadata: { automated: true, returnEligibleUntil: order.fulfillment_eligible_at }, created_at: knex.fn.now(),
      }).catch(() => {});
      results.push({ orderId: order.id, fulfilled: true });
    }
    return results;
  }

  async markEligibleOrderItems(limit = 500) {
    const now = new Date();
    const claimedItems = await knex.transaction(async (trx) => trx("order_items")
      .where("payout_status", "pending")
      .whereNotNull("payout_eligible_at")
      .where("payout_eligible_at", "<=", now)
      .orderBy("payout_eligible_at", "asc")
      .limit(limit)
      .forUpdate()
      .skipLocked());
    const results = [];
    for (const item of claimedItems) {
      const openReturn = await ReturnModel.exists({
        orderId: String(item.order_id),
        status: { $in: OPEN_RETURN_STATUSES },
        items: { $elemMatch: { orderItemId: String(item.id) } },
      }).catch(() => null);
      if (openReturn) {
        results.push({ orderItemId: item.id, eligible: false, reason: "open_return" });
        continue;
      }
      await knex.transaction(async (trx) => {
        const updated = await trx("order_items")
          .where({ id: item.id, payout_status: "pending" })
          .update({ payout_status: "eligible" });
        if (!updated) return;
        await trx("seller_commissions")
          .where("order_item_id", item.id)
          .whereIn("status", ["pending", "approved"])
          .update({ eligible_at: item.payout_eligible_at, updated_at: trx.fn.now() });
        await trx("payout_status_history").insert({
          id: uuidv4(), seller_id: item.seller_id, order_id: item.order_id,
          order_item_id: item.id, commission_id: item.commission_id || null,
          from_status: "pending", to_status: "eligible", reason: "return_window_closed",
          actor_id: "system", actor_role: "system",
          metadata: { payoutEligibleAt: item.payout_eligible_at },
        });
      });
      results.push({ orderItemId: item.id, eligible: true });
    }
    return results;
  }
}

const settlementLifecycleService = new SettlementLifecycleService();
module.exports = { SettlementLifecycleService, settlementLifecycleService, FINAL_COLLECTION_STATUSES };
