const { eventBus } = require("./event-bus");
const { logger } = require("../../shared/logger/logger");
const { domainEventLogService } = require("../../shared/logger/domain-event-log.service");

class EventPublisher {
  async publish(event) {
    logger.info({ eventName: event.eventName, eventId: event.id }, "Publishing domain event");
    try {
      await domainEventLogService.record(event);
    } catch (error) {
      logger.error(
        { err: error, eventName: event.eventName, eventId: event.id },
        "Domain event log persistence failed",
      );
    }
    return eventBus.publish(event.eventName, event);
  }
}

const eventPublisher = new EventPublisher();

module.exports = { EventPublisher, eventPublisher };
