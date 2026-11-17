const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { DOMAIN_EVENTS: E } = require("../src/contracts/events/domain-events");
const { shouldNotify, notificationIdentity } = require("../src/modules/notification/services/notification-policy");
const { resolveNotificationContent, normalizeNotificationPayload, sellerNotificationPayload, specs } = require("../src/modules/notification/services/notification-content");
const { deliveryDecision } = require("../src/modules/notification/services/delivery-preferences");

test("actual return stages have individual messages; delivery labels never imply refund completion", () => {
  for (const [status, id] of Object.entries({ reverse_pickup_scheduled: "N052", in_reverse_transit: "N053", qc_passed: "N088", qc_failed: "N089", refund_pending: "N095", partially_refunded: "N097", replacement_created: "N102", replacement_shipped: "N103", replacement_delivered: "N104", replaced: "N105" })) {
    assert.equal(shouldNotify(E.RETURN_STATUS_UPDATED_V1, { status }), true);
    assert.equal(resolveNotificationContent(E.RETURN_STATUS_UPDATED_V1, { status }).useCaseId, id);
  }
  assert.equal(resolveNotificationContent(E.REFUND_FAILED_V1, { status: "refund_failed", refundStatus: "manual_review" }).useCaseId, "N099");
  assert.equal(shouldNotify(E.SHIPMENT_CREATED_V1, {}), false);
  assert.equal(shouldNotify(E.SHIPMENT_TRACKING_UPDATED_V1, { status: "in_transit" }), false);
  assert.equal(resolveNotificationContent(E.KYC_STATUS_UPDATED_V1, { verificationStatus: "pending" }), null);
  assert.match(resolveNotificationContent(E.KYC_STATUS_UPDATED_V1, { verificationStatus: "rejected" }).subject, /not approved/);
});

test("field contracts isolate payout, refund, order and coin meanings, including zero", () => {
  assert.equal(normalizeNotificationPayload(E.REFUND_PROCESSED_V1, { amount: 0 }).refundAmount, 0);
  assert.equal(normalizeNotificationPayload(E.ORDER_CREATED_V1, { amount: 900 }).refundAmount, undefined);
  assert.equal(normalizeNotificationPayload(E.REFERRAL_REWARDED_V1, { rewardAmount: 50, rewardCoins: 500 }).coinAmount, 500);
  assert.equal(normalizeNotificationPayload(E.REFERRAL_REWARDED_V1, { rewardAmount: 50 }).coinAmount, undefined);
  assert.ok(!specs.payout.some(row => row[1].includes("refund")));
  assert.ok(specs.refund.some(row => row[1] === "refundTotalAmount"));
  const scoped = sellerNotificationPayload({ items: [{ sellerId: "a" }, { sellerId: "b" }], sellerEmail: "wrong@example.test", totalAmount: 900 }, "a");
  assert.equal(scoped.items.length, 1);
  assert.equal(scoped.sellerEmail, undefined);
  assert.equal(scoped.totalAmount, undefined);
});

test("preferences enforce explicit marketing consent, opt-outs, SMS opt-in and crossing-midnight quiet hours", () => {
  assert.equal(deliveryDecision(null, { payload: { messageClass: "marketing" } }).allowed, false);
  assert.equal(deliveryDecision({ channels: { sms: true } }, { channel: "sms", eventName: E.ORDER_CREATED_V1 }).allowed, true);
  assert.equal(deliveryDecision({ sms: true }, { channel: "sms", eventName: E.ORDER_CREATED_V1 }).allowed, false);
  assert.equal(deliveryDecision({ channels: { email: false } }, { eventName: E.ORDER_CREATED_V1 }).allowed, false);
  assert.equal(deliveryDecision({ channels: { email: false }, frequency: "never" }, { eventName: E.REFUND_PROCESSED_V1 }).mandatory, true);
  const preference = { doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00", timezone: "Asia/Kolkata" };
  assert.ok(deliveryDecision(preference, { eventName: E.ORDER_CREATED_V1, now: new Date("2026-11-17T18:30:00Z") }).delay > 0);
  assert.equal(deliveryDecision(preference, { eventName: E.ORDER_CREATED_V1, now: new Date("2026-11-17T06:30:00Z") }).delay, 0);
});

test("equivalent refund events deduplicate by refund reference; separate refunds remain separate", () => {
  const first = notificationIdentity(E.RETURN_REFUNDED_V1, { orderId: "o", refundId: "r1" });
  assert.equal(first, notificationIdentity(E.REFUND_PROCESSED_V1, { orderId: "o", refundId: "r1" }));
  assert.notEqual(first, notificationIdentity(E.REFUND_PROCESSED_V1, { orderId: "o", refundId: "r2" }));
});

function fixture(preference = null) {
  const file = path.resolve(__dirname, "../src/modules/notification/services/notification.service.js");
  const realRequire = createRequire(file);
  const handlers = new Map();
  const records = [], jobs = [];
  const module = { exports: {} };
  const request = name => {
    if (name.startsWith("node:")) return realRequire(name);
    if (name.endsWith("notification.repository")) return { NotificationRepository: class { async create(payload) { const saved = { ...payload, id: `notification-${records.length}` }; records.push(saved); return saved; } } };
    if (name.endsWith("queue-factory")) return { createQueue: () => ({ add: async (...args) => jobs.push(args) }) };
    if (name.endsWith("event-bus")) return { eventBus: { subscribe: (name, handler) => handlers.set(name, [...(handlers.get(name) || []), handler]) } };
    if (name.endsWith("event-publisher")) return { eventPublisher: { publish: async () => ({}) } };
    if (name.endsWith("notification-preference.model")) return { NotificationPreferenceModel: { findOne: () => ({ lean: async () => preference }) }, NotificationQueueModel: { findOneAndUpdate: async () => ({ id: "dispatch-test" }) } };
    if (name.endsWith("/config/env")) return { env: { smtp: { queue: {} }, sms: { transactionalEnabled: false }, firebase: { configured: false } } };
    if (name.endsWith("/msg/sms")) return { SMS_TEMPLATE_KEYS: {} };
    if (["./notification-policy", "./notification-content", "./delivery-preferences", "./email-template-catalog"].includes(name) || name.includes("/contracts/events/") || name.endsWith("/roles") || name.endsWith("commerce-constants")) return realRequire(name);
    return {};
  };
  vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(file, "utf8")}\n})`, {})(request, module, module.exports);
  const service = new module.exports.NotificationService();
  service.findUserEmail = async () => "customer@example.test";
  return { service, handlers, records, jobs };
}

test("real subscriptions route a received return to the same buyer, status, template and email without SMTP", async () => {
  const { handlers, records, jobs } = fixture();
  const event = { id: "evt", eventName: E.RETURN_STATUS_UPDATED_V1, payload: { buyerId: "customer-a", orderId: "order-a", returnId: "return-a", returnNumber: "RET-100", status: "received" } };
  for (const handler of handlers.get(event.eventName)) await handler(event);
  assert.equal(records.length, 1);
  assert.equal(records[0].userId, "customer-a");
  assert.equal(records[0].payload.status, "received");
  assert.equal(records[0].payload.templateKey, "usecase_return_received_quality_decision");
  const mail = jobs.find(job => job[0] === "templated-email");
  assert.ok(mail);
  assert.equal(mail[1].payload.templateKey, records[0].payload.templateKey);
  assert.equal(mail[1].to, "customer@example.test");
});

test("opted-out optional deliveries do not save records or enqueue jobs", async () => {
  const { service, records, jobs } = fixture({ channels: { inApp: false, email: false } });
  await service.createNotification({ userId: "u", channel: "in_app", subject: "test", template: "test", payload: { eventName: E.ORDER_CREATED_V1 } });
  await service.queueEmailForUser("u", { eventName: E.ORDER_CREATED_V1, recipientType: "buyer", payload: {} });
  assert.equal(records.length, 0);
  assert.equal(jobs.length, 0);
});
