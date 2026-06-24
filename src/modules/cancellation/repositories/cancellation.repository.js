const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class CancellationRepository {
  jsonb(value, fallback = {}) {
    return knex.raw("?::jsonb", [JSON.stringify(value ?? fallback)]);
  }

  async create(payload) {
    const [created] = await knex("order_cancellations").insert({
      id: payload.id || uuidv4(),
      cancellation_number: payload.cancellationNumber,
      order_id: payload.orderId,
      buyer_id: payload.buyerId,
      scope: payload.scope,
      status: payload.status || "processing",
      reason_code: payload.reasonCode || null,
      reason: payload.reason,
      source_order_status: payload.sourceOrderStatus,
      items: this.jsonb(payload.items, []),
      refund_amount: payload.refundAmount || 0,
      wallet_refund_amount: payload.walletRefundAmount || 0,
      provider_refund_amount: payload.providerRefundAmount || 0,
      refund_method: payload.refundMethod || null,
      refund_status: payload.refundStatus || "not_required",
      payment_id: payload.paymentId || null,
      payment_provider: payload.paymentProvider || null,
      inventory_status: "pending",
      shipment_status: "pending",
      finance_status: "pending",
      attempts: this.jsonb([], []),
      idempotency_key: payload.idempotencyKey,
      metadata: this.jsonb(payload.metadata || {}),
      requested_by: payload.requestedBy || null,
      requested_by_role: payload.requestedByRole || null,
    }).onConflict("idempotency_key").ignore().returning("*");
    return created || this.findByIdempotencyKey(payload.idempotencyKey);
  }

  async findById(id) {
    return knex("order_cancellations").where("id", id).first();
  }

  async findByIdempotencyKey(idempotencyKey) {
    return knex("order_cancellations").where("idempotency_key", idempotencyKey).first();
  }

  async findByProviderRefundId(providerRefundId) {
    if (!providerRefundId) return null;
    return knex("order_cancellations").where("provider_refund_id", providerRefundId).first();
  }

  async listByOrder(orderId) {
    return knex("order_cancellations").where("order_id", orderId).orderBy("created_at", "desc");
  }

  async update(id, payload = {}) {
    const values = { updated_at: knex.fn.now() };
    const map = {
      status: "status", refundStatus: "refund_status", inventoryStatus: "inventory_status",
      shipmentStatus: "shipment_status", financeStatus: "finance_status",
      providerRefundId: "provider_refund_id", creditNoteId: "credit_note_id",
      lastError: "last_error", completedAt: "completed_at",
    };
    Object.entries(map).forEach(([key, column]) => {
      if (payload[key] !== undefined) values[column] = payload[key];
    });
    if (payload.attempts !== undefined) values.attempts = this.jsonb(payload.attempts, []);
    if (payload.metadata !== undefined) {
      values.metadata = knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify(payload.metadata || {})]);
    }
    const [row] = await knex("order_cancellations").where("id", id).update(values).returning("*");
    return row || null;
  }

  async applyOrderProjection(cancellation, fullCancellation) {
    return knex.transaction(async (trx) => {
      let projectionChanged = false;
      for (const item of cancellation.items || []) {
        const orderItem = await trx("order_items").where("id", item.orderItemId).first().forUpdate();
        if (!orderItem) throw new Error(`Order item ${item.orderItemId} not found`);
        const snapshot = orderItem.cancellation_snapshot || {};
        const appliedCancellationIds = snapshot.appliedCancellationIds || [];
        if (appliedCancellationIds.includes(cancellation.id)) continue;
        const nextQuantity = Number(orderItem.cancelled_quantity || 0) + Number(item.quantity || 0);
        if (nextQuantity > Number(orderItem.quantity || 0)) {
          throw new Error(`Cancelled quantity exceeds ordered quantity for ${item.orderItemId}`);
        }
        await trx("order_items").where("id", item.orderItemId).update({
          cancelled_quantity: nextQuantity,
          cancellation_status: nextQuantity === Number(orderItem.quantity || 0) ? "cancelled" : "partially_cancelled",
          cancellation_snapshot: knex.raw("COALESCE(cancellation_snapshot, '{}'::jsonb) || ?::jsonb", [JSON.stringify({
            lastCancellationId: cancellation.id,
            cancellationNumber: cancellation.cancellation_number,
            cancelledQuantity: nextQuantity,
            reason: cancellation.reason,
            appliedCancellationIds: [...new Set([...appliedCancellationIds, cancellation.id])],
          })]),
        });
        projectionChanged = true;
      }
      if (!projectionChanged) return trx("orders").where("id", cancellation.order_id).first();
      const [updatedOrder] = await trx("orders").where("id", cancellation.order_id).update({
          cancellation_status: fullCancellation ? "cancelled" : "partially_cancelled",
          cancelled_amount: knex.raw("COALESCE(cancelled_amount, 0) + ?", [Number(cancellation.refund_amount || 0)]),
          metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify({
            lastCancellationId: cancellation.id,
            lastCancellationNumber: cancellation.cancellation_number,
          })]),
          updated_at: knex.fn.now(),
        }).returning("*");
      return updatedOrder;
    });
  }

  async list(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const base = () => knex("order_cancellations").modify((builder) => {
      if (query.orderId) builder.where("order_id", query.orderId);
      if (query.buyerId) builder.where("buyer_id", query.buyerId);
      if (query.sellerId) {
        builder.whereRaw("items @> ?::jsonb", [JSON.stringify([{ sellerId: String(query.sellerId) }])]);
      }
      if (query.organizationId) {
        builder.whereRaw("items @> ?::jsonb", [
          JSON.stringify([{ organizationId: String(query.organizationId) }]),
        ]);
      }
      if (query.status) builder.where("status", query.status);
      if (query.refundStatus) builder.where("refund_status", query.refundStatus);
      if (query.scope) builder.where("scope", query.scope);
      if (query.fromDate) builder.where("created_at", ">=", query.fromDate);
      if (query.toDate) builder.where("created_at", "<=", query.toDate);
      if (query.search) builder.where((q) => q
        .whereILike("cancellation_number", `%${query.search}%`)
        .orWhereRaw("order_id::text ILIKE ?", [`%${query.search}%`])
        .orWhereILike("reason", `%${query.search}%`));
    });
    const [items, [{ count }]] = await Promise.all([
      base().orderBy("created_at", "desc").limit(limit).offset(offset),
      base().count({ count: "*" }),
    ]);
    return { items, total: Number(count || 0), limit, offset };
  }
}

module.exports = { CancellationRepository };
