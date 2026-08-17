const { knex } = require("./postgres-client");

class OutboxRepository {
  async enqueue(client, event) {
    await client("outbox_events").insert({
      id: event.id,
      event_name: event.eventName,
      aggregate_id: event.aggregateId,
      version: event.version,
      payload: JSON.stringify(event.payload),
      occurred_at: event.occurredAt,
      status: "pending",
    });
  }

  async pullPending(limit = 50) {
    const trx = await knex.transaction();

    try {
      const rows = await trx("outbox_events")
        .select("id", "event_name", "aggregate_id", "version", "payload", "occurred_at")
        .where((builder) => builder
          .where("status", "pending")
          .orWhere((retry) => retry.where("status", "failed").where((due) => due.whereNull("next_attempt_at").orWhere("next_attempt_at", "<=", trx.fn.now())))
          .orWhere((stale) => stale.where("status", "processing").where("processing_started_at", "<", trx.raw("NOW() - INTERVAL '5 minutes'"))))
        .orderBy("occurred_at", "asc")
        .limit(limit)
        .forUpdate()
        .skipLocked();

      if (rows.length) {
        await trx("outbox_events")
          .whereIn(
            "id",
            rows.map((row) => row.id),
          )
          .update({
            status: "processing",
            processing_started_at: trx.fn.now(),
            attempt_count: trx.raw("COALESCE(attempt_count, 0) + 1"),
          });
      }

      await trx.commit();
      return rows;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async markPublished(eventId) {
    await knex("outbox_events").where("id", eventId).update({
      status: "published",
      processed_at: knex.fn.now(),
      processing_started_at: null,
    });
  }

  async markFailed(eventId, errorMessage) {
    const row = await knex("outbox_events").where("id", eventId).first();
    const attempts = Number(row?.attempt_count || 1);
    const terminal = attempts >= 10;
    await knex("outbox_events").where("id", eventId).update({
      status: terminal ? "dead_letter" : "failed",
      last_error: errorMessage?.slice(0, 500) || "Unknown outbox failure",
      next_attempt_at: terminal ? null : new Date(Date.now() + Math.min(300000, 1000 * (2 ** Math.min(attempts, 8)))),
      processing_started_at: null,
    });
  }
}

module.exports = { OutboxRepository };
