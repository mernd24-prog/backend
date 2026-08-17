const { logger } = require("../../shared/logger/logger");

class InMemoryEventBus {
  constructor() {
    this.handlers = new Map();
  }

  subscribe(eventName, handler) {
    const currentHandlers = this.handlers.get(eventName) || [];
    currentHandlers.push(handler);
    this.handlers.set(eventName, currentHandlers);
  }

  async publish(eventName, payload) {
    const handlers = this.handlers.get(eventName) || [];
    const results = await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(payload);
          return null;
        } catch (error) {
          logger.error({ err: error, eventName }, "Event handler failed");
          return error;
        }
      }),
    );
    return { failures: results.filter(Boolean), handlerCount: handlers.length };
  }
}

const eventBus = new InMemoryEventBus();

module.exports = { eventBus };
