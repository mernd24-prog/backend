const inventory = require("../templates/notification-use-cases.json");

// Template availability is separate from dispatch. Nothing in this registry
// registers an event, changes preferences, or enables a notification channel.
const byKey = new Map(inventory.cases.map((entry) => [entry.key, entry]));

function getUseCaseMessage(key) {
  const entry = byKey.get(key);
  if (!entry) throw new Error(`Unknown notification use case: ${key}`);
  return {
    subject: entry.subject,
    title: entry.title,
    message: entry.message,
    ctaText: entry.ctaText,
  };
}

function buildUseCaseEmailDefinitions(rowsForPayload) {
  return Object.fromEntries(inventory.cases.map((entry) => [entry.key, {
    subject: entry.subject,
    title: entry.title,
    intro: () => entry.message,
    rows: payload => rowsForPayload(payload, entry),
    ctaText: entry.ctaText,
    isOtp: ["N001", "N002", "N003", "N004", "N005", "N006", "N007", "N081"].includes(entry.id),
  }]));
}

module.exports = { inventory, getUseCaseMessage, buildUseCaseEmailDefinitions };
