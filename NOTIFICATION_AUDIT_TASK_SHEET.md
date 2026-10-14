# Notification audit and implementation task sheet

Audit date: 2026-10-14  
Scope: backend notification, email, SMS/OTP, Firebase/push, Socket.IO, customer, seller, admin, delivery, growth partner, and stock-alert flows.

## Read this first: simple count summary

### Final totals

| What is being counted | Count | Meaning |
|---|---:|---|
| Business notification use cases | **87** | 87 different situations can require a notification |
| In-app notification use cases | **80** | Saved in the notification bell/history |
| Mobile Firebase push use cases | **67** | Sent to customer, seller, or delivery mobile apps |
| Email use cases | **59** | Sent when a receipt, document, security message, approval, rejection, or money record is important |
| Mobile SMS OTP use cases | **5** | Only mobile verification/login/recovery cases where phone possession is required |
| Optional transactional SMS use cases | **6** | Expensive fallback or user opt-in; keep disabled by default |
| Web live update use cases | **75** | Socket.IO screen refresh/live event; this is not a separate saved notification |

**Overall count is 87 use cases, not 292 notifications.** The channel numbers overlap. For example, “order delivered” is one use case but may create one in-app notification, one mobile push, and one email.

### Category totals

| No. | Notification category | Use cases | Main recipient |
|---:|---|---:|---|
| 1 | Authentication and security | **10** | Customer, seller, admin, delivery agent |
| 2 | Account and KYC | **8** | Customer, seller, admin reviewer |
| 3 | Seller catalog and deals | **9** | Seller and catalog admin |
| 4 | Orders and payments | **11** | Customer and involved seller |
| 5 | Shipping and delivery | **8** | Customer, seller, admin |
| 6 | Cancellation, return and refund | **10** | Customer, seller, admin |
| 7 | Inventory and stock | **4** | Seller, admin, stock-alert customer |
| 8 | Seller finance and tax | **7** | Seller and finance admin |
| 9 | Support and warranty | **7** | Customer, seller, support admin |
| 10 | Growth and marketing | **6** | Consented customer or growth partner |
| 11 | Delivery-agent operations | **7** | Delivery agent and operations admin |
|  | **Total** | **87** |  |

### Which notification is needed where

| User/application | In-app bell | Web live | Firebase mobile push | Email | SMS OTP | Normal SMS |
|---|---|---|---|---|---|---|
| Customer web | Yes | Yes | No | Important records only | Only required phone verification | Off by default |
| Customer mobile | Yes | When app open | Yes | Important records only | Only required phone verification | Off by default |
| Seller web | Yes | Yes | No | Approval, rejection, order, payout, tax and security | Avoid for routine login | Off by default |
| Seller mobile | Yes | When app open | Yes | Approval, rejection, order, payout, tax and security | Only required phone verification | Off by default |
| Admin web | Yes | Yes | No | High-priority review/failure/security only | Admin email/authenticator preferred | No |
| Admin mobile, if created | Yes | When app open | High-priority only | High-priority record | Avoid; use authenticator/email | No |
| Delivery-agent mobile | Yes | When app open | Yes, operational events | Only serious finance/security record | Yes for mobile-first identity | Emergency fallback only |
| Growth partner web/mobile | Yes | Yes | Yes for reward changes | Reward record | No | No |

### Send email for these cases

Email is required for:

- registration/email verification, password recovery, password/security changes;
- KYC or seller onboarding approval/rejection;
- product/deal rejection or approval when a permanent record is useful;
- order confirmation, successful payment receipt and payment failure requiring action;
- delivery completion/failure when an external record is useful;
- cancellation, return approval/rejection, refund completed/failed;
- payout completed/failed, settlement problem, invoice, credit note and tax report;
- support/warranty confirmation and final decision;
- consented marketing only after unsubscribe and preference support exists.

Do not email every tracking scan, inventory reservation, internal payment state, draft deal update, or admin realtime event.

### Send Firebase mobile push for these cases

Firebase push is required for time-sensitive events:

- suspicious login, account locked, password changed;
- KYC/onboarding decision;
- product/deal decision requiring seller action;
- order placed/confirmed, payment failed, order rejected or item unavailable;
- dispatched, out for delivery, delivered, delivery failed or rescheduled;
- cancellation/return/refund state requiring attention;
- low stock/out of stock and opted-in back-in-stock;
- payout failure/hold and important settlement issues;
- support reply, warranty decision and reward credited/reversed;
- every delivery-agent assignment, schedule change, exception and COD issue.

Firebase push is **currently missing in the backend**. Firebase authentication does not mean push notifications are implemented.

### Create an in-app notification for these cases

Use the notification bell/history for almost every user-visible final state or action-required event. Do not create one for noisy internal events such as payment initiated, inventory reserved/released, every in-transit scan, draft deal edits, or OTP sent/verified telemetry.

### Use SMS OTP only for these 5 cases

1. Mobile-first customer or seller registration when the phone is the login identity.
2. Verify a mobile number.
3. Change a mobile number.
4. Account recovery when verified email/authenticator is unavailable.
5. Delivery-agent mobile-first login or verification.

Routine customer login, seller login and forgot password should use email OTP/password/social login wherever possible. This is the main SMS cost-saving rule.

### Keep normal transactional SMS off by default

Allow it only as opt-in or emergency fallback for these six situations:

1. Order placed/payment successful — optional user opt-in.
2. Shipment dispatched/out for delivery — optional user opt-in.
3. Delivery failed/address action required — fallback when push/email cannot reach the customer.
4. Order cancelled — optional user opt-in.
5. Refund failed or urgent refund action — fallback only.
6. Delivery-agent/customer operational emergency — fallback only.

### Work count

| Priority | Number of tasks | Meaning |
|---|---:|---|
| P0 | **6** | Must fix before claiming a complete notification system |
| P1 | **9** | Required for correct production routing and lifecycle |
| P2 | **4** | Preference, scheduling, delivery feedback and analytics improvements |
| Implementation checklist items | **39** | Engineering tasks across phases 0–5 |

The first implementation target should be the **P0 six tasks** listed in section 3.

## 1. Executive decision

Use one internal notification orchestration API for every business event. Business services must publish a domain event; they must not decide how to send email, push, SMS, or in-app messages. The orchestrator resolves recipients, mandatory versus optional delivery, preferences, templates, deduplication, queueing, and delivery status.

Recommended channel order:

1. **In-app database notification** for durable notification-center history.
2. **Socket.IO** for live web updates while a user is online. This is transport, not durable notification storage.
3. **FCM push** for customer and seller mobile apps when the event is timely/actionable.
4. **Email** for receipts, documents, security events, approvals/rejections, money movement, and events requiring a durable external record.
5. **SMS OTP only** when proof of possession of a mobile number is required or no verified email/password/social-auth alternative is usable.
6. **Transactional SMS** for non-OTP commerce updates only as explicit opt-in or exceptional fallback. It should be disabled by default to control cost.

Do not send the same event as both a generic Socket.IO update and a separate user-visible web toast unless the client deduplicates by notification/event ID.

## 2. Current backend inventory

| Area | Current state | Audit result |
|---|---|---|
| Domain events | 53 declared events | 38 are referenced by `NotificationService`; 15 are intentionally internal or currently uncovered |
| Durable in-app | Mongo `NotificationModel`, `GET /notifications/me` | Working foundation; no read/unread fields or mark-read API found |
| Web realtime | Socket.IO domain-event subscribers | Present; broad admin fan-out exists, but this is not a mobile push implementation |
| Email | Nodemailer + BullMQ + template catalog | Good foundation, but auth, support, tax, commission, stock, and campaigns still have direct/special send paths |
| SMS OTP | APITXT, DLT-aware templates | Implemented; channel policy needs to be enforced from one registry |
| Commerce SMS | Template queue, disabled unless configured and opted in | Preference lookup defect means it reads the wrong field |
| Firebase | Firebase Admin used for authentication token verification | **No FCM device-token registry or push worker exists** |
| Push enum | `push` is accepted by model/API/campaign | Data can be stored as `push`, but nothing actually delivers FCM push |
| Preferences | channel/event/frequency/DND schema and GET/PUT API | Mostly stored only; email, in-app, push, event type, frequency, and DND are not consistently applied |
| Campaigns | Admin audience expansion and email/in-app delivery | Operational controls exist; push channel still has no real provider |
| Back in stock | Separate stock-notification table and email queue | Works as a separate subsystem; should call the common dispatcher |

### Declared events not handled by the notification service

These should not all create customer notifications. Classify them explicitly so future developers do not accidentally notify internal state changes.

| Events | Decision |
|---|---|
| `OTP_SENT`, `OTP_VERIFIED`, `OTP_FAILED` | Audit/security telemetry only; OTP delivery itself is the message |
| `PAYMENT_INITIATED` | No outbound message; show live UI state only |
| `PAYMENT_VERIFIED` | Map to one canonical payment/order-confirmed message; avoid duplicate `ORDER_PAID` |
| `DEAL_CREATED`, `DEAL_UPDATED` | Internal/draft events; no user notification until submitted/approved/rejected/cancelled |
| Inventory reserved/released/committed/restocked/adjusted | Internal operations; notify only low-stock and back-in-stock subscribers |
| Wallet reserved/captured/released | Usually internal; add a user message only for visible wallet debit/credit/reversal, with new explicit events |

## 3. Confirmed defects and gaps

| Priority | Finding | Where to update | Required action |
|---|---|---|---|
| P0 | Commerce SMS checks `preference.sms`, but schema stores `channels.sms` | `notification.service.js` | Read `channels.sms`; add regression test |
| P0 | `push` can be requested but no provider delivers it | notification service, campaign service, workers | Implement FCM token registry and push worker, or reject `push` until ready |
| P0 | Firebase configuration currently represents auth, not push readiness | `firebase-admin.js`, `env.js` | Split auth verification readiness from FCM-send readiness |
| P0 | Preference enforcement is incomplete | notification orchestration | Apply channel, event category, mandatory override, frequency, timezone, and DND before queueing |
| P0 | No device-token lifecycle | new model/repository/routes | Register, refresh, revoke, logout-disable, platform/app/device metadata, invalid-token cleanup |
| P0 | No canonical event-to-recipient-to-channel registry | new policy/registry | Put every use case below in code with versioned templates |
| P1 | Direct `sendMail` paths bypass a single dispatcher | auth, support, tax, seller commission, stock, campaign | Move behind orchestration/delivery adapter; keep OTP synchronous enough to report delivery failure |
| P1 | Notification record lacks read state | notification model/routes | Add `readAt`, mark-one/all-read, unread count, archive/delete policy |
| P1 | Queue delivery and in-app record statuses are not one lifecycle | models/workers | Track queued/sent/failed/delivery_unknown per channel attempt |
| P1 | Socket events and notification records can duplicate client alerts | web/mobile clients | Include stable `eventId`, `notificationId`, category, action URL and dedupe on clients |
| P1 | Seller sub-users may need organization-scoped routing | recipient resolver | Route operational events to owner and permitted staff, not every seller account blindly |
| P1 | Admin fan-out targets all active admins | admin recipient resolver | Route by permission/on-call responsibility and organization; avoid notifying every admin |
| P1 | Delivery-agent notification policy is missing | delivery domain + resolver | Add assignment, pickup, route, COD, failure, and escalation events |
| P1 | Warranty events use string names outside the event contract | warranty service/contracts | Add versioned constants and subscribers |
| P1 | Support email sends directly | support service | Add ticket lifecycle events, requester and assigned-agent routing |
| P2 | Preference categories are too narrow | preference model/validation | Add security, account, returns, inventory, payout, support, warranty, system; separate marketing consent |
| P2 | Frequency/DND are stored but not scheduled | dispatcher/queues | Implement digest scheduling or remove unsupported options from API/UI |
| P2 | Email provider delivery/bounce integration incomplete | mail provider/webhook | Add signed webhook, bounce/suppression list, complaint/unsubscribe handling |
| P2 | No end-to-end delivery analytics | metrics/admin | Track attempted, accepted, delivered, failed, opened where lawful, cost by provider/template |

## 4. Category-wise recommended use cases and counts

Counts are business use cases, not number of recipients or delivery attempts.

| Category | Use cases | In-app | Web live | FCM push | Email | SMS OTP | Transactional SMS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Authentication and security | 10 | 4 | 2 | 4 | 8 | 4 | 0 |
| Account and KYC | 8 | 8 | 6 | 6 | 7 | 0 | 0 |
| Seller catalog and deals | 9 | 9 | 9 | 7 | 5 | 0 | 0 |
| Orders and payments | 11 | 11 | 11 | 9 | 7 | 0 | 2 optional |
| Shipping and delivery | 8 | 8 | 8 | 7 | 3 | 0 | 2 optional |
| Cancellation, returns, refunds | 10 | 10 | 10 | 8 | 7 | 0 | 1 optional |
| Inventory and stock | 4 | 3 | 3 | 3 | 3 | 0 | 0 |
| Seller finance and tax | 7 | 7 | 7 | 5 | 7 | 0 | 0 |
| Support and warranty | 7 | 7 | 7 | 6 | 6 | 0 | 0 |
| Growth and marketing | 6 | 6 | 5 | 5 opt-in | 5 opt-in | 0 | 0 |
| Delivery-agent operations | 7 | 7 | 7 | 7 | 1 | 1 | 1 fallback |
| **Total** | **87** | **80** | **75** | **67** | **59** | **5** | **6 optional/fallback** |

The channel counts indicate recommended eligibility. A single event can use multiple channels. Marketing counts require explicit consent. Mandatory security/financial/document messages may override ordinary notification preferences where legally and operationally appropriate, but never override marketing opt-out.

## 5. Use-case matrix

Legend: **I** durable in-app, **W** web realtime, **P** FCM mobile push, **E** email, **O** SMS OTP, **S** optional/fallback transactional SMS, **-** do not send.

### Authentication and security (10)

| Use case | Recipient | Channels | Mandatory | Current / task |
|---|---|---|---|---|
| Email registration verification | customer/seller | E | Yes | Existing OTP email; standardize template and purpose |
| Mobile registration verification | customer/seller | O | Yes when mobile is identity | Existing SMS OTP; retain only for mobile-first registration |
| Email passwordless login | customer/seller/admin | E | Yes | Existing generic OTP flow; preferred paid-channel alternative |
| Mobile passwordless login | customer/seller | O | Yes when enabled | Disable UI/API by default to save SMS cost |
| Forgot password | all users | E; O only without verified email | Yes | Enforce email-first routing |
| Verify/change mobile | all users | O | Yes | SMS is justified proof of mobile possession |
| Account recovery | all users | E; O only recovery fallback | Yes | Risk-based, rate limited, audit every attempt |
| Password changed | account owner | I/P/E | Yes | Add explicit security event |
| New device or suspicious login | account owner | I/P/E | Yes | Add device/risk event and revoke action |
| Account locked/session revoked | account owner | I/P/E | Yes | Add explicit event; do not depend on marketing preferences |

### Account and KYC (8)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Customer KYC submitted | admin reviewers | I/W/E | Present, narrow admins by permission |
| Customer KYC approved/rejected | customer | I/W/P/E | Partial; ensure customer status events route correctly |
| Seller onboarding submitted | admin reviewers | I/W/E | Present |
| Seller organization created | admin reviewers | I/W/E | Present; dedupe with onboarding submitted |
| Seller KYC approved/rejected | seller | I/W/P/E | Present |
| Seller organization active/suspended | seller staff | I/W/P/E | Approval exists; add suspended/reactivated events |
| Profile/email/mobile changed | account owner | I/P/E | Add security/account-change event |
| Account deletion/export completed | account owner | I/P/E | Add lifecycle event and retention-safe template |

### Seller catalog and deals (9)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Product submitted for approval | seller + catalog reviewer | I/W | Add explicit submitted event |
| Product approved | seller | I/W/P/E | Present |
| Product rejected/changes requested | seller | I/W/P/E | Present; include safe reason/action URL |
| Product suspended/unpublished | seller | I/W/P/E | Add event |
| Deal submitted | seller + reviewer | I/W/P | Present generic commerce path |
| Deal approved | seller | I/W/P/E | Present |
| Deal rejected | seller | I/W/P/E | Present |
| Deal cancelled/expired | seller | I/W/P | Cancelled present; add expiry |
| Price/special-price approval or conflict | seller/reviewer | I/W/P/E | Add events around special-price workflow |

### Orders and payments (11)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Order placed | customer and involved sellers | I/W/P/E; S opt-in | Present |
| COD order confirmed | customer and sellers | I/W/P/E | Ensure only one confirmation event |
| Online payment successful | customer and sellers | I/W/P/E; S opt-in | Present through order-paid/payment events; canonicalize |
| Payment failed | customer | I/W/P/E | Present; seller only if an order was actually created |
| Payment pending/timeout | customer | I/W/P | Add explicit actionable event, no email unless unresolved |
| Order accepted by seller | customer | I/W/P | Add explicit event if business flow supports it |
| Order rejected by seller | customer/admin | I/W/P/E | Add event and refund expectation |
| Order item partially unavailable | customer/seller/admin | I/W/P/E | Add item-level event |
| Order modified/address issue | affected actor | I/W/P/E | Add event with action deadline |
| Invoice ready | customer | I/W/E | Currently suppressed as a standalone message; expose in order UI, email only when legally needed |
| Duplicate/risk hold requiring action | customer/admin | I/W/P/E | Add fraud-review event without revealing risk rules |

### Shipping and delivery (8)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Shipment created | seller/admin only if actionable | I/W | Customer message intentionally suppressed |
| Dispatched/shipped | customer | I/W/P/E; S opt-in | Current status policy allows shipped/dispatched |
| In transit | customer | W only in tracking UI | Do not create noisy durable notifications |
| Out for delivery | customer | I/W/P; S opt-in | Present |
| Delivered | customer and seller | I/W/P/E | Present |
| Delivery failed/action needed | customer/seller/admin | I/W/P/E; S fallback | Present |
| RTO initiated/completed | customer/seller/admin | I/W/P/E | RTO present; split final completion if needed |
| Delivery rescheduled/address correction | customer/agent | I/W/P | Add explicit event |

### Cancellation, returns, and refunds (10)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Cancellation requested | customer/seller | I/W/P | Add requested event if approval is asynchronous |
| Order cancelled | customer and sellers | I/W/P/E; S opt-in | Present |
| Return requested | customer/seller/admin | I/W/P/E | Present |
| Return approved | customer/seller | I/W/P/E | Present |
| Return rejected | customer/seller | I/W/P/E | Present; include reason/action |
| Pickup scheduled | customer | I/W/P | Present through filtered status event |
| Pickup completed | customer/seller | I/W/P | Present through filtered status event |
| Pickup failed/action required | customer/seller | I/W/P | Present through filtered status event |
| Return received/quality decision | customer/seller | I/W/P/E | Received present; add quality decision if separate |
| Refund processed or failed | customer/seller/admin | I/W/P/E; S fallback for failure | Present; preserve refund-reference dedupe |

### Inventory and stock (4)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Low stock threshold | seller inventory staff | I/W/P/E | Present seller + admin; avoid notifying all admins |
| Out of stock | seller inventory staff | I/W/P/E | Add distinct event or threshold severity |
| Back in stock | opted-in customer | I/P/E | Separate email subsystem exists; move through dispatcher |
| Inventory adjustment anomaly | seller/admin | I/W/P | Use explicit anomaly event, not every adjustment |

### Seller finance and tax (7)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Payout initiated | seller | I/W | Intermediate update currently suppressed; keep quiet unless actionable |
| Payout completed | seller | I/W/P/E | Present |
| Payout failed/rejected/cancelled | seller/finance ops | I/W/P/E | Present; include next action |
| Settlement discrepancy/hold | seller/finance ops | I/W/P/E | Add explicit event |
| COD collection due/received/overdue | seller/finance ops | I/W/P/E | Add explicit events |
| Credit note generated | affected customer/seller | I/W/E | Present event; confirm correct legal recipient |
| Tax invoice/report ready | seller/admin | I/W/E | Existing tax direct-send path; migrate to dispatcher |

### Support and warranty (7)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Support ticket created | requester/assigned queue | I/W/P/E | Support currently emails directly; add events |
| Agent replied | requester | I/W/P/E | Add event |
| Ticket assigned/escalated | agent/admin | I/W/P | Add event |
| Ticket resolved/reopened | requester/agent | I/W/P/E | Add event |
| Warranty registered | customer/seller | I/W/P/E | Event exists outside contract; normalize |
| Warranty claim submitted | customer/seller/admin | I/W/P/E | Event exists outside contract; normalize |
| Warranty claim approved/rejected/closed | customer/seller | I/W/P/E | Add versioned lifecycle events |

### Growth and marketing (6)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Referral/reward pending | growth partner | I/W/P/E | Present |
| Reward credited | partner/customer | I/W/P/E | Present |
| Reward reversed/expired | partner/customer | I/W/P/E | Add event |
| Price drop/watchlist | opted-in customer | I/P/E | Add subscription and consent |
| Promotional campaign | consented audience | I/W/P/E | Campaign exists; add real push and unsubscribe enforcement |
| Abandoned cart reminder | consented customer | I/P/E | Add capped scheduler; never SMS by default |

### Delivery-agent operations (7)

| Use case | Recipient | Channels | Current / task |
|---|---|---|---|
| Agent mobile verification/login | delivery agent | O | Use SMS only because field agent identity is mobile-first |
| Shipment assigned/reassigned | delivery agent | I/W/P | Add device push and acknowledgement |
| Pickup ready/window changed | delivery agent | I/W/P | Add event |
| Delivery route/slot changed | delivery agent | I/W/P | Add event |
| Customer unavailable/address issue | agent + ops + customer | I/W/P; S fallback to customer | Add structured exception event |
| COD collection/deposit exception | agent + finance ops | I/W/P/E | Add high-severity event |
| Emergency account suspension | agent + ops | I/W/P/E | Add mandatory event and revoke sessions |

## 6. OTP cost-control policy

### SMS OTP is justified only for

- mobile number verification or change;
- mobile-first registration where the phone number is the account identity;
- delivery-agent mobile-first login/verification;
- account recovery only when there is no usable verified email/authenticator path;
- high-risk step-up verification when policy explicitly requires possession of the registered phone.

### Do not use SMS OTP for

- routine seller login when verified email/password, email OTP, social auth, or passkey is available;
- routine customer login if the product can offer email/social authentication;
- every checkout, payment, return, or COD order—the payment provider/bank owns payment OTP;
- email verification;
- password change when the user has a valid authenticated session plus email confirmation;
- marketing, order status, stock, payout, or support messages.

### Required controls

- Default `AUTH_PRIMARY_OTP_CHANNEL=email`.
- Keep mobile-login UI hidden unless the business explicitly accepts per-login SMS cost.
- Keep seller registration SMS override only if seller phone verification is mandatory; otherwise use email and verify phone later when operationally needed.
- Apply per-identity, per-IP, per-device, and global provider rate limits.
- Reuse an unexpired OTP on resend where security policy permits; do not generate/provider-send on every click.
- Add exponential resend cooldown, daily caps, CAPTCHA/risk checks, and provider-cost metrics by purpose.
- Never silently fall back from free email to paid SMS. Fallback must be policy-driven and observable.
- Keep exact DLT template mapping per purpose and fail closed when configuration/template IDs are missing.

## 7. Target single API and data contract

### Internal application API

Business modules should call one method or publish one outbox event:

```js
await notificationOrchestrator.dispatch({
  eventName: "order.paid.v1",
  eventId,
  aggregate: { type: "order", id: orderId },
  actor: { type: "system", id: null },
  recipients: [
    { type: "user", id: buyerId, role: "buyer" },
    { type: "seller_organization", id: sellerOrganizationId },
  ],
  data: { orderNumber, amount, currency, paymentReference },
  urgency: "transactional",
  idempotencyKey: `order-paid:${orderId}:${paymentReference}`,
});
```

The caller must not pass arbitrary HTML, provider template IDs, phone numbers, or channel choices for normal domain events. Those belong to the central registry and recipient/contact resolver.

### Public APIs

Keep/read APIs under `/api/.../notifications`:

- `GET /notifications/me` — paginated durable feed, category and unread filters.
- `GET /notifications/unread-count`.
- `PATCH /notifications/:id/read`.
- `POST /notifications/read-all`.
- `GET /notifications/preferences`.
- `PUT /notifications/preferences`.
- `POST /notifications/devices` — register FCM token with platform/app/device metadata.
- `DELETE /notifications/devices/:deviceId` — logout/revoke token.
- Admin campaign endpoints remain permission-protected.

Do not expose the generic direct notification creation endpoint to ordinary clients. Admin campaigns and tightly authorized operational sends may use it.

### Core records

- `Notification`: one logical user-visible notification, category, event identity, action/deep link, read/archive state.
- `NotificationDelivery`: one row per notification/channel/address/device, provider message ID, attempts and final status.
- `DeviceToken`: user, token hash/encrypted token, platform, app, device ID, last seen, disabled reason.
- `NotificationPreference`: category-by-channel choices, marketing consent source/time, locale, timezone, DND.
- `TemplateVersion`: event + recipient role + channel + locale + version; provider template/DLT identifiers.

## 8. Delivery rules

1. Persist/publish the business event transactionally through the outbox.
2. Resolve logical recipients, including seller organization roles and admin permissions.
3. Map event and recipient role to category, mandatory flag, channels, template, urgency, and action link.
4. Collapse semantically duplicate events (`PAYMENT_VERIFIED`/`ORDER_PAID`, tracking/delivery status, refund aliases).
5. Apply consent and preferences. Mandatory security/legal messages bypass only the appropriate preferences.
6. Apply quiet hours to non-urgent push; email can queue; in-app can persist silently.
7. Persist notification and channel delivery attempts using a stable idempotency identity.
8. Enqueue provider jobs. Never call SMTP/FCM/SMS inside the business transaction.
9. Remove invalid FCM tokens; suppress bounced/complained email addresses; record SMS provider failures.
10. Emit Socket.IO `notification:new` with the persisted notification ID after creation.

## 9. Implementation task sheet

### Phase 0 — policy and immediate correctness

- [ ] Fix `channels.sms` preference lookup and test opt-in/opt-out.
- [ ] Reject or clearly return `not_configured` for push sends until FCM exists.
- [ ] Add a machine-readable event/channel registry covering all 87 rows above.
- [ ] Mark each declared event as `notify`, `realtime_only`, `audit_only`, or `internal`.
- [ ] Define mandatory versus optional categories and obtain product/legal approval for marketing and transactional communications.
- [ ] Disable customer/seller mobile-login SMS OTP in UI and API configuration unless explicitly approved.

### Phase 1 — common orchestrator

- [ ] Introduce `NotificationOrchestrator.dispatch()` and recipient resolvers.
- [ ] Add `NotificationDelivery` and a stable cross-channel idempotency key.
- [ ] Route notification module email/SMS workers through channel adapters.
- [ ] Migrate support, tax, commission, stock, auth email, and campaign sends to adapters.
- [ ] Preserve synchronous OTP request response while recording provider delivery/audit result.
- [ ] Add category, severity, action URL/deep link, event ID and aggregate identity to records.

### Phase 2 — FCM for customer, seller, and delivery mobile apps

- [ ] Add device register/revoke/refresh APIs and database indexes.
- [ ] Support separate app identifiers for customer, seller, and delivery apps.
- [ ] Add FCM worker with multicast batching, retries, invalid-token cleanup, TTL, collapse key, Android channel and APNs settings.
- [ ] Use data payloads with route/deep-link identifiers; keep sensitive data out of lock-screen text.
- [ ] Add foreground/background/terminated-state client handling and notification-ID dedupe.
- [ ] Test logout, multi-device accounts, token rotation, uninstalled apps, revoked users, and seller sub-users.

### Phase 3 — durable feed and preferences

- [ ] Add `readAt`, archive state, unread-count and mark-read APIs.
- [ ] Enforce channel and event-category preferences for all optional sends.
- [ ] Split transactional preferences from marketing consent.
- [ ] Implement DND/timezone and real daily/weekly digests, or remove unsupported frequency settings.
- [ ] Add preference screens in customer web/mobile and seller web/mobile.
- [ ] Define mandatory defaults separately for buyer, seller, admin, growth partner, and delivery agent.

### Phase 4 — missing domain coverage

- [ ] Add security/account-change events.
- [ ] Add product submitted/suspended, deal expired, and special-price review events.
- [ ] Canonicalize order/payment confirmation and add pending/action-required cases.
- [ ] Add delivery assignment/reschedule/exception/COD events.
- [ ] Add cancellation-requested, return quality-decision, and refund-failed action events.
- [ ] Add payout hold/discrepancy and COD settlement events.
- [ ] Normalize support and warranty events into `DOMAIN_EVENTS`.
- [ ] Add wallet visible credit/debit/reversal events instead of notifying internal reserve/capture mechanics.

### Phase 5 — reliability, security, and operations

- [ ] Signed provider callbacks for delivered/bounced/complained status.
- [ ] Per-provider circuit breaker, retry policy, dead-letter handling and replay tooling.
- [ ] Encrypt or tightly protect device tokens and contact snapshots; redact OTP and secrets from logs/events.
- [ ] Metrics by event, recipient role, channel, provider, template, success, latency and cost.
- [ ] Alerts for queue lag, failure spikes, FCM invalid-token spike, email bounce rate and SMS spend.
- [ ] Retention and deletion policy for notification content and delivery metadata.
- [ ] Load tests for order spikes, campaigns and push multicast batches.

## 10. Acceptance checklist per use case

Every row is complete only when all applicable items pass:

- [ ] Versioned domain event is emitted from every relevant transition, after successful commit/outbox write.
- [ ] Recipient resolver includes the right buyer/seller staff/admin permission group and excludes unrelated users.
- [ ] Each channel has an approved localized template and valid action/deep link.
- [ ] Mandatory/optional classification and preference behavior are tested.
- [ ] Event-level idempotency prevents duplicate email, push, SMS, and feed rows.
- [ ] Web/mobile clients deduplicate Socket.IO and FCM using notification/event ID.
- [ ] Provider failure does not roll back the business action.
- [ ] Retry, terminal failure, invalid address/token and delivery-unknown states are visible to operations.
- [ ] No secret, OTP, full payment data, or unnecessary personal data appears in logs or lock-screen push.
- [ ] Automated tests cover recipient, channel, template, preference, DND and dedupe decisions.

## 11. Suggested first delivery milestone

The safest first milestone is: fix preference enforcement, define the registry, add durable read/unread APIs, implement device-token registration plus FCM, and migrate order/payment/shipping/return/payout/security flows to the common orchestrator. Leave marketing automation and optional transactional SMS disabled until consent, caps, analytics, and unsubscribe behavior are verified.
