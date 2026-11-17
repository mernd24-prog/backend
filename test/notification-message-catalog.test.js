const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inventory, getUseCaseMessage } = require("../src/modules/notification/services/use-case-message-catalog");
const { renderEmailTemplate, resolveTemplateKey } = require("../src/modules/notification/services/email-template-catalog");
const { buildOrderEmailTemplate } = require("../src/modules/notification/services/order-email-template.service");
const otpEmailTemplate = require("../templates/otp-email.ejs");
const { DOMAIN_EVENTS: E } = require("../src/contracts/events/domain-events");

test("inventory retains every historical use case, with separate lifecycle extensions", () => {
  const source = fs.readFileSync(path.join(__dirname, "../NOTIFICATION_AUDIT_TASK_SHEET.md"), "utf8").split("## 5. Use-case matrix")[1].split("## 6.")[0];
  const names = source.split("\n").filter(line => line.startsWith("| ") && !line.startsWith("| Use case")).map(line => line.split("|")[1].trim());
  assert.equal(names.length, 87);
  assert.deepEqual(inventory.cases.slice(0, 87).map(entry => entry.name), names);
  assert.equal(inventory.cases.length, 111);
  assert.equal(new Set(inventory.cases.map(entry => entry.key)).size, 111);
  for (const [field, entries] of [["baselineCounts", inventory.cases.slice(0, 87)], ["counts", inventory.cases]]) {
    for (const [status, expected] of Object.entries(inventory[field])) {
      assert.equal(entries.filter(entry => entry.status === status).length, expected);
    }
  }
});

test("every explicit template renders HTML and text without leaking missing fields or executing payload markup", () => {
  for (const entry of inventory.cases) {
    assert.equal(entry.deliveryVerified, false);
    for (const payload of [{}, { orderNumber: "SG-100", reason: '<script>alert("x")</script>', otp: "246810", validityMinutes: 10, amount: 0 }]) {
      const rendered = renderEmailTemplate({ templateKey: entry.key, payload });
      assert.equal(rendered.templateKey, entry.key);
      assert.ok(rendered.html.includes("#0a1450"), entry.key);
      assert.ok(rendered.text.includes(getUseCaseMessage(entry.key).title), entry.key);
      assert.doesNotMatch(rendered.html, /<script>|undefined|\[object Object\]/);
      assert.doesNotMatch(rendered.text, /undefined|\[object Object\]/);
      assert.equal(rendered.subject, entry.subject);
      assert.doesNotMatch(rendered.subject, /246810/);
    }
  }
  assert.throws(() => getUseCaseMessage("missing-key"), /Unknown notification use case/);
});

test("private database references are omitted from new email detail rows", () => {
  const rendered = renderEmailTemplate({ templateKey: inventory.cases[27].key, payload: { orderNumber: "0123456789abcdef01234567", returnNumber: "1b671a64-40d5-491e-99b0-da01ff1f3341" } });
  assert.doesNotMatch(rendered.html, /0123456789abcdef01234567|1b671a64-40d5-491e-99b0-da01ff1f3341/);
});

test("new templates remain explicit; established event routing still selects established keys", () => {
  assert.equal(resolveTemplateKey({ eventName: E.ORDER_PAID_V1, recipientType: "customer" }), "order_paid_customer");
  assert.equal(resolveTemplateKey({ eventName: E.ORDER_PAID_V1, recipientType: "seller" }), "order_received_seller");
  assert.equal(resolveTemplateKey({ eventName: E.REFUND_FAILED_V1 }), "refund_failed");
  assert.equal(resolveTemplateKey({ eventName: "new.unregistered.event" }), null);
});

test("OTP copy matches supplied expiry and purpose, and does not invent a fixed lifetime", () => {
  const rendered = renderEmailTemplate({ templateKey: "auth_otp", payload: { otp: "246810", purpose: "password reset", validityMinutes: 10 } });
  assert.match(rendered.html, /expires in 10 minutes/);
  assert.doesNotMatch(rendered.html, /15 minutes|complete your account setup/);
  assert.match(rendered.text, /password reset/);
  const generic = otpEmailTemplate({ otp: "246810", purpose: "sign in" });
  assert.match(generic, /complete sign in/);
  assert.doesNotMatch(generic, /15 minutes|10 minutes/);
  assert.match(otpEmailTemplate({ otp: "246810", purpose: "sign in", validityMinutes: 10 }), /expires in 10 minutes/);
  const body = fs.readFileSync(path.join(__dirname, "../src/modules/auth/services/auth.service.js"), "utf8");
  assert.match(body, /BUYER_OTP_TTL_SECONDS = 600/);
  assert.doesNotMatch(body, /expire in 15 minutes/);
});

test("critical payment and refund messages distinguish retry checks from receipt of money", () => {
  const payment = buildOrderEmailTemplate({ eventName: E.ORDER_PAYMENT_FAILED_V1, recipientType: "customer", payload: { orderNumber: "SG-100" } });
  assert.match(payment.text, /before retrying/);
  const refund = buildOrderEmailTemplate({ eventName: E.REFUND_PROCESSED_V1, recipientType: "customer", payload: { orderNumber: "SG-100" } });
  assert.match(refund.text, /bank posting time depends/);
  const failure = buildOrderEmailTemplate({ eventName: E.REFUND_FAILED_V1, recipientType: "customer", payload: { orderNumber: "SG-100" } });
  assert.match(failure.text, /Do not assume the amount was credited/);
});
