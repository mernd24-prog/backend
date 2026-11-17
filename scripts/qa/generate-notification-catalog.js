const fs = require("node:fs");
const path = require("node:path");
const { inventory } = require("../../src/modules/notification/services/use-case-message-catalog");
const { renderEmailTemplate } = require("../../src/modules/notification/services/email-template-catalog");
const { DOMAIN_EVENTS } = require("../../src/contracts/events/domain-events");

const outputDir = path.resolve(__dirname, "../../../docs/notifications");
const escapeHtml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const labels = {
  implemented_path: "Existing path (delivery unverified)",
  partial: "Partial / needs correction",
  pending: "Pending trigger or channel integration",
  intentionally_quiet: "Intentionally quiet / detail screen only",
};
const count = entries => Object.fromEntries(Object.keys(labels).map(status => [status, entries.filter(item => item.status === status).length]));
const references = {
  "Authentication and security": "backend/src/modules/auth/services/auth.service.js; backend/templates/otp-email.ejs",
  "Account and KYC": "backend/src/modules/notification/services/notification.service.js:195; email-template-catalog.js:eventTemplateMap",
  "Seller catalog and deals": "backend/src/modules/notification/services/notification.service.js:61,617; shouldQueueEmail",
  "Orders and payments": "backend/src/modules/notification/services/notification.service.js:61; notification-policy.js; order-email-template.service.js",
  "Shipping and delivery": "backend/src/modules/notification/services/notification.service.js:61; backend/src/infrastructure/realtime/register-realtime.js; notification-policy.js",
  "Cancellation, returns, and refunds": "backend/src/modules/notification/services/notification.service.js:61; notification-policy.js; backend/src/modules/returns/services/return.service.js",
  "Inventory and stock": "backend/src/modules/notification/services/notification.service.js:563; backend/src/modules/stock-notification/services/stock-notification.service.js",
  "Seller finance and tax": "backend/src/modules/notification/services/notification.service.js:415; backend/src/workers/register-workers.js; backend/src/modules/tax/services/tax.service.js",
  "Support and warranty": "backend/src/modules/support/services/support.service.js; backend/src/modules/warranty/services/warranty.service.js; backend/src/infrastructure/events/event-publisher.js",
  "Growth and marketing": "backend/src/modules/notification/services/notification.service.js:450; notification-campaign.service.js; backend/src/modules/referral/services/referral.service.js",
  "Delivery-agent operations": "backend/src/modules/delivery/services/delivery.service.js; backend/src/modules/auth/services/auth.service.js; backend/src/contracts/events/domain-events.js",
  "Detailed lifecycle extensions": "backend/src/modules/returns/services/return.service.js; backend/src/modules/notification/services/notification-policy.js; notification.service.js; backend/src/modules/referral/services/referral.service.js",
};
const csvRows = [["id", "category", "case", "source_status", "delivery_verified", "recipient", "recommended_channels_not_implemented_counts", "subject", "message", "action", "template_key", "placement", "remaining_work", "source"]];
let markdown = `# Notification coverage, messages and templates\n\nReviewed: ${inventory.reviewedAt}.\n\n` +
  `**87 baseline grouped cases: 34 existing paths, 20 partial, 29 pending, 4 intentionally quiet.** Thus 49 baseline cases need notification work; 34 have an existing path, not verified delivery. **Live delivery verified in this review: 0.**\n\n` +
  `There are also 24 detailed lifecycle templates, overlapping the baseline. Total: **111 templates** (35 existing paths, 27 partial, 45 pending, 4 quiet). Do not add the extensions to the baseline as 111 independent business requirements. Counts are per grouped case, not per channel, recipient or individual send. Every decision variant such as approved/rejected must still be acceptance-tested independently.\n\n` +
  `The baseline preserves all 87 entries in backend/NOTIFICATION_AUDIT_TASK_SHEET.md. Status is based on the current source, not the older audit's completion claims. Templates do not establish that a missing business capability exists.\n\n` +
  `## What changed\n\n111 explicit usecase_* keys render through the existing navy/gold/white email layout. Pending cases are prepared copy only: no events, recipients, channel switches, preferences, schedules, permissions, order/payment/refund decisions or database records were changed. Existing messages were clarified for failed payment, refund status, pending referral rewards and OTP purpose/expiry. Buyer OTP copy now matches its existing 600-second expiry; the expiry itself is unchanged.\n\n` +
  `The catalog is data for existing/future callers, not a new dispatcher. Existing event mappings remain in place. A caller must explicitly select a new template key to use one. Email templates for in-app-only or quiet cases are review artifacts and must not cause an email to be sent.\n\n` +
  `## Channel and recipient rules\n\nI = in-app; W = web realtime; E = email; O = SMS OTP; S = optional transactional SMS; P = proposed mobile push. These are baseline recommendations, not working-channel claims. No FCM sender exists. Local transactional SMS is disabled and its preference lookup is defective. Preferences, DND and frequency are not consistently enforced. Email configuration is live locally, but no message was sent in this review.\n\n` +
  `Use the existing authenticated detail link; a CTA below is label copy, not a new route. Show only the actor's own orders, seller organization and permitted review queue. Rows include available public references, status, reason, amount or coins. Do not invent dates, response times, refund arrival deadlines, approvals, bank credit, payout eligibility or reward availability. INR and referral coins are separate units. Do not reveal OTPs, bank details, KYC values or private IDs in subjects/toasts.\n\n` +
  `Examples address the named account owner unless the text explicitly requests operator review. Existing seller/admin templates remain authoritative for routed operational messages. Before using a new key for a different role, verify recipient wording, authorization and payload projection; template availability does not authorize sending. Marketing copy must remain pending until consent, preferences and unsubscribe behavior are implemented.\n\n` +
  `## Counts by category\n\n| Category | Existing path | Partial | Pending | Quiet | Total |\n|---|---:|---:|---:|---:|---:|\n`;
for (const category of [...new Set(inventory.cases.map(row => row.category))]) {
  const entries = inventory.cases.filter(row => row.category === category);
  const c = count(entries);
  markdown += `| ${category} | ${c.implemented_path} | ${c.partial} | ${c.pending} | ${c.intentionally_quiet} | ${entries.length} |\n`;
}
markdown += "\n## Full use-case list\n\n";
const previews = [];
for (const entry of inventory.cases) {
  markdown += `### ${entry.id}: ${entry.name}\n\n` +
    `- Status: **${labels[entry.status]}**.\n- Recipient: ${entry.recipients}.\n- Proposed channels: ${entry.recommendedChannels}.\n- Placement: ${entry.placement}.\n- Subject / heading: **${entry.subject}**\n- In-app / email message: ${entry.message}\n- Action label: **${entry.ctaText}**\n- Explicit template key: \`${entry.key}\`\n- Remaining work / evidence: ${entry.assessment}\n- Source: ${references[entry.category]}\n\n`;
  csvRows.push([entry.id, entry.category, entry.name, entry.status, "false", entry.recipients, entry.recommendedChannels, entry.subject, entry.message, entry.ctaText, entry.key, entry.placement, entry.assessment, references[entry.category]]);
  const template = renderEmailTemplate({ templateKey: entry.key, payload: {
    firstName: "Sample Customer", purpose: entry.name, otp: "246810", validityMinutes: 10,
    orderNumber: "SG-2026-001", returnNumber: "RET-2026-001", payoutNumber: "PAY-2026-001",
    ticketNumber: "TKT-2026-001", productName: "Sample product", reason: "Sample reason for preview only",
  }, ctaUrl: "https://example.com/account" });
  previews.push({ id: entry.id, name: entry.name, status: labels[entry.status], key: entry.key, html: template.html, text: template.text });
}
markdown += "## Domain-event contract cross-check\n\nEvery declared domain-event key is listed below to distinguish business notifications from internal telemetry. A source reference is not proof of subscription, permitted status, recipient routing or delivery. Events missing from this service may have a direct path elsewhere, such as OTP or back-in-stock. Support and warranty also have paths outside this contract and remain in the full inventory above.\n\n| Declared event | Referenced by NotificationService | Review note |\n|---|---|---|\n";
const notificationSource = fs.readFileSync(path.resolve(__dirname, "../../src/modules/notification/services/notification.service.js"), "utf8");
const internal = new Set(["OTP_SENT_V1", "OTP_VERIFIED_V1", "OTP_FAILED_V1", "PAYMENT_INITIATED_V1", "INVENTORY_RESERVED_V1", "INVENTORY_RELEASED_V1", "INVENTORY_COMMITTED_V1", "INVENTORY_ADJUSTED_V1", "WALLET_RESERVED_V1", "WALLET_CAPTURED_V1", "WALLET_RELEASED_V1", "NOTIFICATION_CREATED_V1", "DEAL_CREATED_V1", "DEAL_UPDATED_V1"]);
for (const [key, event] of Object.entries(DOMAIN_EVENTS)) {
  const referenced = new RegExp(`DOMAIN_EVENTS\\.${key}\\b`).test(notificationSource);
  const note = internal.has(key) ? "Internal/live-update event; no extra user message proposed by this catalog" : ["SHIPMENT_CREATED_V1", "INVOICE_GENERATED_V1"].includes(key) ? "Standalone notification intentionally suppressed; see detail/document flow" : key === "INVENTORY_RESTOCKED_V1" ? "Back-in-stock has a separate opt-in email subsystem" : "Check the corresponding inventory case, policy, emitted payload and recipient";
  markdown += `| ${event} | ${referenced ? "Yes" : "No"} | ${note} |\n`;
}
markdown += "\n## Acceptance required before marking working\n\nTest every applicable role, status variant and channel with known staging recipients. Record the emitted event, recipient, persisted record, job ID, provider receipt, inbox/device result, correct authorized link, opt-out behavior and retry/deduplication outcome. Include delayed/duplicate events, reconnect, failed queues, worker restart, partial refunds and partial shipments. Neither a saved record nor a successful queue operation proves delivery.\n\nRegenerate with `node backend/scripts/qa/generate-notification-catalog.js` from the workspace root. Preview HTML uses example data only and sends nothing.\n";
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "USE_CASES_AND_MESSAGES.md"), markdown);
fs.writeFileSync(path.join(outputDir, "notification-use-cases.csv"), csvRows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n");
// Escape '<' to keep serialized preview documents out of the script parser.
const serialized = JSON.stringify(previews).replace(/</g, "\\u003c");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sam Global notification templates</title>
<style>body{font:16px Arial;background:#f5f6fa;color:#0a1450;margin:0;padding:24px}main{max-width:1000px;margin:auto}select{width:100%;padding:12px;font-size:16px}iframe{width:100%;height:820px;border:1px solid #ddd;background:white}pre{white-space:pre-wrap;background:white;padding:16px}p{line-height:1.5}</style>
<main><h1>Notification template review</h1><p>111 templates using the existing email theme. Review only; nothing is sent. Sample references and links are fictional. A template marked pending does not have a working delivery flow.</p><label for="cases">Choose a use case</label><select id="cases">${previews.map(entry => `<option value="${entry.id}">${escapeHtml(entry.id + " — " + entry.name)}</option>`).join("")}</select><p id="state"></p><iframe id="preview" title="Email preview" sandbox=""></iframe><details><summary>Plain-text version</summary><pre id="text"></pre></details></main>
<script>const previews=${serialized};const select=document.getElementById('cases');function show(){const item=previews.find(row=>row.id===select.value);document.getElementById('state').textContent=item.status+' · '+item.key;document.getElementById('preview').srcdoc=item.html;document.getElementById('text').textContent=item.text}select.addEventListener('change',show);show();</script></html>`;
fs.writeFileSync(path.join(outputDir, "template-preview.html"), html);
console.log(JSON.stringify({ baselineCases: 87, lifecycleExtensions: 24, templates: previews.length, outputDir }));
