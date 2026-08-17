const { eventPublisher } = require("./event-publisher");
const { OutboxRepository } = require("../postgres/outbox.repository");
const { logger } = require("../../shared/logger/logger");

class OutboxProcessor {
  constructor({ outboxRepository = new OutboxRepository() } = {}) {
    this.outboxRepository = outboxRepository;
    this.isRunning = false;
  }

  async flushPending(limit = 50) {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const events = await this.outboxRepository.pullPending(limit);

      for (const event of events) {
        try {
          const delivery = await eventPublisher.publish({
            id: event.id,
            eventName: event.event_name,
            aggregateId: event.aggregate_id,
            version: event.version,
            payload: event.payload,
            occurredAt: event.occurred_at,
          });
          if (delivery?.failures?.length) {
            throw new Error(`${delivery.failures.length} domain event handler(s) failed`);
          }
          await this.outboxRepository.markPublished(event.id);
        } catch (error) {
          logger.error({ err: error, eventId: event.id }, "Outbox publish failed");
          await this.outboxRepository.markFailed(event.id, error.message);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}

const outboxProcessor = new OutboxProcessor();

module.exports = { OutboxProcessor, outboxProcessor };
