const { knex, postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { OutboxRepository } = require("../../../infrastructure/postgres/outbox.repository");

class PaymentRepository {
  constructor({ outboxRepository = new OutboxRepository() } = {}) {
    this.outboxRepository = outboxRepository;
  }

  async createPayment(payload, event) {
    const payment = {
      id: uuidv4(),
      order_id: payload.orderId,
      buyer_id: payload.buyerId,
      provider: payload.provider,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      transaction_reference: payload.transactionReference || uuidv4(),
      provider_order_id: payload.providerOrderId || null,
      provider_payment_id: payload.providerPaymentId || null,
      verification_method: payload.verificationMethod || null,
      metadata: JSON.stringify(payload.metadata || {}),
      verified_at: payload.verifiedAt || null,
        failed_reason: payload.failedReason || null,
        idempotency_key: payload.idempotencyKey || null,
        approved_by: payload.approvedBy || null,
        approved_at: payload.approvedAt || null,
      };

    const trx = await knex.transaction();

    try {
      await trx("payments").insert(payment);

      if (event) {
        await this.outboxRepository.enqueue(trx, {
          ...event,
          aggregateId: payment.id,
        });
      }

      await trx.commit();
    } catch (error) {
      await trx.rollback();
      if (error?.code === "23505" && payload.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(payload.idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }

    return {
      id: payment.id,
      orderId: payload.orderId,
      buyerId: payload.buyerId,
      provider: payload.provider,
      status: payload.status,
      amount: payload.amount,
      currency: payload.currency,
      transactionReference: payment.transaction_reference,
      providerOrderId: payload.providerOrderId || null,
      providerPaymentId: payload.providerPaymentId || null,
      verificationMethod: payload.verificationMethod || null,
      metadata: payload.metadata || {},
      verifiedAt: payload.verifiedAt || null,
      failedReason: payload.failedReason || null,
    };
  }

  async listPaymentsByBuyer(buyerId) {
    return knex("payments").where("buyer_id", buyerId).orderBy("created_at", "desc");
  }

  async findByOrderId(orderId, buyerId) {
    const [payment] = await knex("payments")
      .where({ order_id: orderId, buyer_id: buyerId })
      .orderBy("created_at", "desc")
      .limit(1);
    return payment || null;
  }

  async findByProviderOrderId(providerOrderId) {
    const [payment] = await knex("payments")
      .where("provider_order_id", providerOrderId)
      .orderBy("created_at", "desc")
      .limit(1);
    return payment || null;
  }

  async findByProviderPaymentId(providerPaymentId) {
    const [payment] = await knex("payments")
      .where("provider_payment_id", providerPaymentId)
      .orderBy("created_at", "desc")
      .limit(1);
    return payment || null;
  }

  async findById(paymentId) {
    const [payment] = await knex("payments").where("id", paymentId).limit(1);
    return payment || null;
  }

  async findByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    const [payment] = await knex("payments").where("idempotency_key", idempotencyKey).limit(1);
    return payment || null;
  }

  async findWebhookEvent(provider, eventId) {
    const [event] = await knex("payment_webhook_events")
      .where({ provider, provider_event_id: eventId })
      .limit(1);
    return event || null;
  }

  async recordWebhookEvent(payload) {
    const [event] = await knex("payment_webhook_events")
      .insert({
        id: uuidv4(),
        provider: payload.provider,
        provider_event_id: payload.providerEventId,
        event_type: payload.eventType,
        payment_id: payload.paymentId || null,
        order_id: payload.orderId || null,
        status: payload.status || "processed",
        payload: payload.payload || {},
      })
      .onConflict(["provider", "provider_event_id"])
      .ignore()
      .returning("*");
    return event || null;
  }

  async claimWebhookEvent(payload) {
    const id = uuidv4();
    const { rows } = await postgresPool.query(
      `INSERT INTO payment_webhook_events
        (id, provider, provider_event_id, event_type, payment_id, order_id, status, payload)
       VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7::jsonb)
       ON CONFLICT (provider, provider_event_id)
       DO UPDATE SET
         status = 'processing',
         payment_id = EXCLUDED.payment_id,
         order_id = EXCLUDED.order_id,
         payload = EXCLUDED.payload
       WHERE payment_webhook_events.status = 'failed'
       RETURNING *`,
      [
        id,
        payload.provider,
        payload.providerEventId,
        payload.eventType,
        payload.paymentId || null,
        payload.orderId || null,
        JSON.stringify(payload.payload || {}),
      ],
    );
    return rows[0] || null;
  }

  async completeWebhookEvent(provider, providerEventId, status, errorMessage = null) {
    const [event] = await knex("payment_webhook_events")
      .where({ provider, provider_event_id: providerEventId })
      .update({
        status,
        payload: knex.raw(
          "COALESCE(payload, '{}'::jsonb) || ?::jsonb",
          [JSON.stringify(errorMessage ? { processingError: errorMessage } : {})],
        ),
      })
      .returning("*");
    return event || null;
  }

  async updatePaymentStatus(paymentId, payload, event = null) {
    const trx = await knex.transaction();

    try {
      const [payment] = await trx("payments")
        .where("id", paymentId)
        .update({
          status: payload.status,
          provider_payment_id: payload.providerPaymentId || knex.raw("COALESCE(provider_payment_id, ?)", [null]),
          verification_method: payload.verificationMethod || knex.raw("COALESCE(verification_method, ?)", [null]),
          metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify(payload.metadata || {})]),
          verified_at: payload.verifiedAt || knex.raw("COALESCE(verified_at, ?)", [null]),
          failed_reason: payload.failedReason || knex.raw("COALESCE(failed_reason, ?)", [null]),
          approved_by: payload.approvedBy || knex.raw("COALESCE(approved_by, ?)", [null]),
          approved_at: payload.approvedAt || knex.raw("COALESCE(approved_at, ?)", [null]),
        })
        .returning("*");

      if (event) {
        await this.outboxRepository.enqueue(trx, {
          ...event,
          aggregateId: paymentId,
        });
      }

      await trx.commit();
      return payment || null;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async listPaymentsForAdmin({
    status = null,
    provider = null,
    buyerId = null,
    orderId = null,
    search = null,
    fromDate = null,
    toDate = null,
    sortBy = "created_at",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = {}) {
    const values = [];
    const clauses = [];
    let index = 1;

    if (status) {
      clauses.push(`status = $${index++}`);
      values.push(status);
    }
    if (provider) {
      clauses.push(`provider = $${index++}`);
      values.push(provider);
    }
    if (buyerId) {
      clauses.push(`buyer_id = $${index++}`);
      values.push(buyerId);
    }
    if (orderId) {
      clauses.push(`order_id = $${index++}`);
      values.push(orderId);
    }
    if (search) {
      clauses.push(`(transaction_reference ILIKE $${index} OR provider_order_id ILIKE $${index} OR provider_payment_id ILIKE $${index} OR order_id::text ILIKE $${index})`);
      values.push(`%${search}%`);
      index += 1;
    }
    if (fromDate) {
      clauses.push(`created_at >= $${index++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`created_at <= $${index++}`);
      values.push(toDate);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sortColumns = {
      createdAt: "created_at",
      created_at: "created_at",
      amount: "amount",
      status: "status",
      provider: "provider",
      buyerId: "buyer_id",
      buyer_id: "buyer_id",
      orderId: "order_id",
      order_id: "order_id",
      transactionReference: "transaction_reference",
      transaction_reference: "transaction_reference",
    };
    const orderColumn = sortColumns[sortBy] || "created_at";
    const orderDirection = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

    const countResult = await postgresPool.query(
      `SELECT COUNT(*)::int AS total FROM payments ${whereSql}`,
      values,
    );

    const rowValues = [...values, limit, offset];
    const { rows } = await postgresPool.query(
      `SELECT *
       FROM payments
       ${whereSql}
       ORDER BY ${orderColumn} ${orderDirection}, created_at DESC
       LIMIT $${index++}
       OFFSET $${index}`,
      rowValues,
    );
    return {
      items: rows,
      total: Number(countResult.rows[0]?.total || 0),
      limit: Number(limit),
      offset: Number(offset),
    };
  }
}

module.exports = { PaymentRepository };
