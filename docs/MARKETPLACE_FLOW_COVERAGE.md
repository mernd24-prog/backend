# Marketplace Flow Coverage Audit

Date: 2026-06-16
Scope: backend repository only. Admin and customer repositories were not writable in this sandbox, so UI work is listed as a follow-up gate instead of marked complete.

## Current Backend Shape

The backend already uses one parent order with seller-owned `order_items` and derives seller splits from the order item seller grouping. There is no physical `seller_orders` table today. That is acceptable for the current backend contract as long as every downstream process continues to use item and seller grouping consistently.

Core modules present:

- Product and catalog: products, variants, media, inventory, seller ownership, moderation, compliance fields, HSN/GST metadata.
- Cart and checkout: cart items, pricing service, wallet usage, GST-inclusive pricing support, shipping/COD policies.
- Orders: parent order, item snapshots, status history, payment and delivery status columns, cancellation protections.
- Payments: Razorpay initiation/verification, COD authorization path, pending payment retry flow.
- Delivery: shipments, tracking events, webhook audit, manifests, e-way bills, OTP/proof based delivery verification.
- Returns and cancellations: item-aware cancellation, reverse shipment handling, QC, refund allocation, wallet/original/manual refund handling, seller commission refund adjustments.
- Finance: seller commissions, seller payouts, seller settlements, platform fee/tax deductions.
- Admin policy: commerce settings for checkout, payment, COD, wallet, and seller finance policy.

## Added In This Pass

- Seller return address support:
  - Seller profile schema now stores `sellerProfile.returnAddress`.
  - Seller update validation accepts `returnAddress`.
  - Seller route now exposes `PATCH /sellers/me/return-address`.
  - KYC rejection cleanup clears return address with pickup and business addresses.

- Delivery agent management:
  - New `delivery_agents` table.
  - Shipments can store `delivery_agent_id` and `delivery_agent_snapshot`.
  - New delivery APIs:
    - `GET /delivery/agents`
    - `POST /delivery/agents`
    - `GET /delivery/agents/:deliveryAgentId`
    - `PATCH /delivery/agents/:deliveryAgentId`
    - `POST /delivery/shipments/:shipmentId/assign-agent`
  - Shipment creation accepts `deliveryAgentId`.
  - Assignment validates seller ownership, active state, and rejected verification state.

- Seller wallet and payout release policy:
  - Commerce finance settings now include:
    - `payoutReleaseMilestone`: `confirmed`, `delivered_or_fulfilled`, `return_window_closed`
    - `payoutReleaseDaysAfterDelivery`
    - `payoutSchedule`: `manual`, `daily`, `weekly`, `monthly`
    - `payoutManualApprovalRequired`
    - `minimumPayoutAmount`
  - Payout initiation now pays only released commissions.
  - Payout initiation enforces minimum payout amount.
  - Manual approval can keep generated payouts in `pending`.
  - `autoProcess: true` can explicitly continue to immediate processing.
  - New wallet summary APIs:
    - Seller: `GET /sellers/commissions/my-wallet`
    - Admin: `GET /sellers/commissions/wallet/:sellerId`

- Marketplace analytics:
  - New seller analytics API: `GET /analytics/seller-dashboard`.
  - New admin analytics API: `GET /analytics/admin-dashboard`.
  - Seller analytics include sales, orders, GST, commission, return rate, delivery success rate, recent orders, and wallet/payout balances.
  - Admin analytics include GMV, order statistics, payment capture, platform revenue, payout state, refunds/returns, delivery success, and top seller performance.

- Marketplace invoice bundle:
  - New invoice metadata columns: `invoice_type`, `seller_id`, issuer/recipient, reference, and parent invoice linkage.
  - New bundle APIs:
    - `GET /tax/orders/:orderId/marketplace-invoices`
    - `POST /tax/orders/:orderId/marketplace-invoices`
  - Seller customer invoices are generated per seller.
  - Platform commission GST invoices are generated per seller.
  - Bundle generation is idempotent by order, seller, invoice type, and reference.
  - Invoice list filters now support `invoiceType`, `referenceType`, and `referenceId`.

- Payout scheduler:
  - Cron now runs `seller-payout-scheduler`.
  - Scheduler respects `payoutSchedule`: manual skips automatic batches, daily runs each scheduler tick, weekly runs on Monday, monthly runs on the first day of the month.
  - Scheduler sweeps all unpaid eligible commissions up to the run date so delayed delivery/return-window release policies do not strand older commissions.
  - Scheduler reuses existing payout eligibility, minimum threshold, manual approval, and auto-process rules.

- Marketplace credit-note splitting:
  - Return and cancellation refund completion now create the existing aggregate credit note plus seller-level credit notes.
  - Seller credit notes target each seller customer invoice using unique seller references.
  - Platform commission reversal credit notes target each seller platform commission invoice using proportional reversal amounts.
  - Existing cancellation and return metadata still keep a primary `creditNoteId` for backward compatibility.

## Marketplace Build Checklist: Done, Pending, Upcoming

Use this as the product control checklist. Backend Done means the backend API/code path exists and has local syntax/smoke verification. Product sign-off still requires the Pending UI, RBAC, integration, live UAT, and operational gates.

### Done / Backend Covered

- [x] Seller one-store profile foundation in `UserModel.sellerProfile`.
- [x] Seller GST, bank, pickup address, and return address backend support.
- [x] Seller-owned product, variant, catalog, media, moderation, and inventory foundations.
- [x] HSN/GST metadata, GST-inclusive price snapshots, platform fee fields, and seller payout base snapshots.
- [x] Multi-seller cart checkout into one parent order with seller-owned item grouping.
- [x] Razorpay initiation/verification, COD authorization path, wallet reserve/capture/release, and payment retry metadata.
- [x] Order status history, item snapshots, cancellation protections, and item-aware order operations.
- [x] Shipment creation, tracking events, webhook audit, manifests, e-way bill fields, OTP/proof delivery verification, and delivery-agent assignment backend.
- [x] Return and cancellation refund flows with seller commission reversal adjustments.
- [x] Seller commissions, seller settlements, seller payout ledger, seller wallet summary, and payout release policy backend.
- [x] Payout scheduler for daily, weekly, monthly, and manual release policies.
- [x] Marketplace invoice bundle generation with seller customer invoices and platform commission GST invoices.
- [x] Marketplace credit-note splitting for seller customer invoice reversals and platform commission invoice reversals.
- [x] Seller analytics dashboard API with sales, order, GST, commission, return, delivery, recent order, and wallet metrics.
- [x] Admin analytics dashboard API with GMV, payment capture, revenue, payout, refund, return, delivery, and top-seller metrics.
- [x] Restored package script drift for commerce demo seed, QA seed, seller finance seed, Postman sync, and missing master seed modules.
- [x] Downloadable invoice, credit-note, and seller settlement statement documents in `pdf`, `html`, `text`, and `json` formats.
- [x] CSV/PDF/HTML/text/JSON backend exports for tax invoices, credit notes, tax ledger reports, seller commissions, seller payouts, and seller settlements.
- [x] Postman sync now discovers registered backend routes and added the new marketplace document/export requests.
- [x] Admin payout operations backend for pending approval, hold, release hold, failed payout retry, and operations queue.
- [x] Negative seller balance recovery backend with future payout offset, seller collection, and platform write-off actions.
- [x] Return-window backend policy uses product snapshot `returnPolicy.days`, seller `returnWindowDays`, and order fallback before approving return creation.
- [x] Tax document dispatch backend for invoice/credit-note email, WhatsApp audit placeholder, retry queue, and dispatch audit listing.
- [x] Admin operations exports for orders, products, inventory snapshots/transactions, shipments, delivery agents, returns, cancellations, refunds, and seller scorecards.

### Pending / Needed Before Product Sign-Off

- [ ] Complete Admin UI for seller KYC, store profile, product moderation, catalog state, inventory, delivery agents, invoices, credit notes, wallet, payout, recovery, and analytics.
- [ ] Complete seller UI for profile, GST, bank, pickup/return address, product create/edit, inventory, shipment, delivery-agent assignment, invoice downloads, wallet, payouts, returns, and analytics.
- [ ] Complete customer UI for seller-split cart/checkout, seller shipment tracking, invoice/credit-note downloads, cancellation, return, refund, and wallet timelines.
- [ ] Verify product moderation states, seller product resubmission, catalog search/index refresh, and stale catalog cache invalidation in a running environment.
- [ ] Run live Razorpay sandbox/UAT for popup, callback verification, webhook capture, failed payment, retry payment, partial wallet plus online payment, and refund paths.
- [ ] Confirm COD receivable tracking and reconciliation if seller self-delivery COD is allowed.
- [ ] Smoke-test cancellation from every important state: before payment, after payment before shipment, after invoice, after partial shipment, and after seller payout.
- [ ] Smoke-test returns with pickup/reverse shipment, QC pass/fail, wallet/original/manual refund, restock, damaged stock, and post-payout seller recovery.
- [ ] Configure live email/WhatsApp providers and build Admin UI for tax document dispatch monitoring.
- [ ] Add Admin UI and notification alerts for payout approval, payout hold/release, failed payout retry, and negative balance recovery actions.
- [ ] Wire Admin UI download buttons and filters to the completed tax, finance, and operations export endpoints.
- [ ] Confirm RBAC seed/repair and button-route permission checks for every Admin and seller UI surface.
- [ ] Run full live E2E UAT using a multi-seller order through product creation, approval, checkout, payment/COD, delivery, invoice, return/refund, credit note, payout, and settlement.

### Upcoming / Advanced Features

- [ ] Add a physical `seller_orders` table or seller-order read model if UI, reporting, or seller operations need explicit sub-order records.
- [ ] Extend seller scorecards with deeper SLA, customer issue, NDR/RTO, and support-escalation metrics.
- [ ] Add funnel analytics from product view -> cart -> checkout -> payment -> delivery -> return/refund.
- [ ] Add scheduled analytics and finance reports for Admin, sellers, and operations teams.
- [ ] Add GST/TCS/TDS/tax filing reports and gateway-fee accounting.
- [ ] Add immutable seller wallet snapshot table if finance needs historical balance reconstruction.
- [ ] Add delivery-boy mobile login/app flow, route assignment, proof upload, cash collection, and shift summary if delivery is handled in-house.
- [ ] Add courier reconciliation, webhook retry/failure queue, NDR, RTO, lost shipment, damaged shipment, and claim workflows.
- [ ] Add notification automation for product review, KYC, order, payment, shipment, OTP, return, refund, invoice, credit note, payout, and settlement events.
- [ ] Add SLA alerts for delayed shipment, stuck refund, late payout, stale KYC, product review aging, and failed webhook recovery.
- [ ] Add audit timeline views for seller profile, bank, GST, address, inventory, payout, invoice, refund, RBAC, and support actions.
- [ ] Add abuse controls for suspicious sellers, fake returns, high refund rate, payment retry abuse, COD abuse, and inventory manipulation.
- [ ] Add production observability, backup/restore drills, data-retention policy, rollback plan, and operational runbooks.

## End-To-End Use Case Coverage

### 1. Seller Store, KYC, Addresses

Covered:

- Single seller store profile lives on `UserModel.sellerProfile`.
- Seller profile includes business, bank, pickup, and return addresses.
- Seller and admin KYC rejection paths clear operational addresses.

Remaining:

- No multi-store-per-seller model.
- Admin/customer UI must expose return address and delivery-agent management.

### 2. Product Creation, GST, Inventory

Covered:

- Seller-owned products and variants.
- HSN/GST metadata and item-level pricing snapshots.
- Inventory reservation, commit, release, and restock side effects.
- Moderation and compliance metadata exist.

Remaining:

- Verify Admin product moderation UI covers all seller update and revision states.
- Verify catalog search/index refresh after moderation in the running environment.

### 3. Cart, Checkout, Pricing

Covered:

- Multi-seller cart is converted to one parent order with seller item groups.
- Pricing snapshots include seller payout base, GST split, platform fee, and wallet usage.
- Wallet reservation/capture/release paths exist.
- COD policy is configurable.

Remaining:

- `checkout.multiSellerOrderMode` supports policy config, but current runtime is still a single parent order.
- UI must clearly display split shipment/seller totals before payment.

### 4. Order Split And Status Lifecycle

Covered:

- `order_items.seller_id` is the source of seller split.
- Order status history records transitions.
- Seller commissions calculate per seller from grouped order items.
- Delivery status is tracked separately from order status.

Remaining:

- If the product requirement mandates visible seller sub-orders, add a read model or physical `seller_orders` table.
- Seller-level partial delivery status should be exposed through an API response contract if Admin/customer screens need it.

### 5. Payments, COD, Wallet

Covered:

- `pending_payment` / `paymentStatus: initiated` before capture is expected.
- Razorpay flow supports initiate, callback/verify, confirm, retry.
- COD can authorize order flow without online capture.
- Wallet partial payment and refund credit paths exist.

Remaining:

- Live Razorpay keys and sandbox confirmation are environment tasks.
- Payment gateway fee settlement policy is stored, but deeper gateway-fee accounting still needs reporting surface.

### 6. Shipment, Delivery Agent, OTP, Proof

Covered:

- Shipment creation after confirmed/packed/shipped status.
- Seller and admin permission checks.
- Courier/manual provider abstraction.
- Shipment tracking and webhook audit.
- Delivery OTP generation and confirmation.
- Delivery proof snapshots and manual override.
- Delivery agents can be created, verified/rejected, activated/deactivated, listed, and assigned to shipments.

Remaining:

- Delivery-agent mobile login/app is not implemented.
- Delivery assignment UI is not implemented in Admin/customer repos in this pass.
- Background courier reconciliation depends on provider integration.

### 7. Invoice, Tax, E-Way Bill

Covered:

- Tax invoice creation exists.
- Marketplace invoice bundle generation exists.
- Customer-facing seller invoices are generated separately per seller.
- Platform commission/service charge GST invoices are generated separately per seller.
- Seller-level credit notes are generated automatically for cancellation and return refunds.
- Platform commission reversal credit notes are generated automatically for proportional commission tax reversal.
- Invoice metadata captures seller, issuer, recipient, reference, and parent invoice linkage.
- Invoice bundle reads are scoped:
  - admin sees all invoice documents,
  - seller sees own seller and commission invoices,
  - buyer sees only customer-facing invoices.
- Credit notes exist through returns.
- E-way bill records can be created and status-updated.

Remaining:

- Invoice PDF/email dispatch should be verified in the actual runtime.

### 8. Cancellation, Return, Refund

Covered:

- Cancellations are item-aware.
- Cancellations block after shipment handover where appropriate.
- Return requests support item quantities, seller grouping, reverse logistics, receive/QC, replacement, close.
- Refunds support wallet, store credit, original payment, split, and manual modes.
- Seller commission refund adjustments are recorded after return refund.

Remaining:

- Cancellation flow needs a full live smoke because earlier work marked it sensitive and only partially verified end to end.
- Return-window policy must be aligned with product/category return windows if they differ by item.

### 9. Seller Wallet, Payout, Settlement

Covered:

- Seller wallet summary is derived from seller commission and payout ledger.
- Balances returned:
  - `pendingBalance`
  - `availableBalance`
  - `inProcessBalance`
  - `paidBalance`
  - `blockedBalance`
  - `refundAdjustmentBalance`
- Release rules support confirmed, delivered/fulfilled, and return-window-closed timing.
- Payouts use only eligible released commissions.
- Manual approval and minimum payout threshold are enforced.
- Failed payouts release commissions back to pending.
- Scheduled payout batches exist for daily, weekly, and monthly policies.
- Manual payout policy intentionally skips automatic batches.

Remaining:

- There is no separate persistent seller wallet table; the summary is ledger-derived.
- Negative post-payout refund recovery needs Admin workflow for collecting or offsetting future payouts.

### 10. Admin, Analytics, Reporting

Covered:

- Admin commerce settings exist.
- Finance summary, commissions, payouts, settlements exist.
- Analytics event tracking exists.
- Seller dashboard analytics exist for sales, orders, GST, commission, returns, delivery, and wallet/payout state.
- Admin marketplace analytics exist for GMV, platform revenue, seller performance, payouts, refunds/returns, delivery, and order/payment statistics.

Remaining:

- Export/report endpoints for tax invoices, credit notes, tax reports, commissions, payouts, settlements, orders, products, inventory, shipments, delivery agents, returns, cancellations, refunds, and seller scorecards exist.
- Scheduled report generation and Admin UI download wiring are still pending.
- Admin/customer UI updates are outside this backend-only writable scope.

## Critical Remaining Gaps Before Production Sign-Off

1. Add production notification delivery:
   - configure live SMTP/WhatsApp providers,
   - build Admin UI for tax document dispatch queue, retries, and audit,
   - extend dispatch to settlement statements if operations needs automatic settlement delivery.

2. Add payout operational follow-ups:
   - Admin UI for payout retry/hold/approval/recovery queues,
   - payout retry and recovery notification alerts,
   - optional separate wallet snapshot table if reporting needs immutable balance snapshots.

3. Finish UI surfaces:
   - seller return address,
   - delivery-agent CRUD and assignment,
   - seller wallet summary,
   - payout approval,
   - split shipment/order display.

4. Run live end-to-end smoke:
   - seller creates product,
   - customer checks out multi-seller cart,
   - payment verifies,
   - seller shipment created with delivery agent,
   - OTP delivery confirmation,
   - invoice/e-way bill generation,
   - return and refund,
   - seller payout after release policy.

5. Run live seed/tooling smoke in the real DB environment:
   - `npm run db:seed:commerce`,
   - scoped seeds such as `npm run seed:sellers` and `npm run seed:orders`,
   - `npm run postman:sync`.

## Completed Implementation Log

### 2026-06-17: Marketplace Documents, Exports, And Seed Drift

Completed:

- Consolidated commerce seed execution through `scripts/seed/master-seed.js`.
- Retained `scripts/postman/sync-postman-collection.js` as the route-driven API collection generator.
- Added missing master seed modules:
  - `scripts/seed/modules/sellers.seed.js`
  - `scripts/seed/modules/customers.seed.js`
  - `scripts/seed/modules/products.seed.js`
  - `scripts/seed/modules/analytics.seed.js`
- Fixed seed query drift for lowercase product/user statuses in order, inventory, review, recommendation, and variant seeds.
- Added dependency-free document renderer with `pdf`, `html`, `text`, `csv`, and `json` output.
- Added invoice download endpoint: `GET /tax/invoices/:invoiceId/download`.
- Added credit-note download endpoint: `GET /tax/credit-notes/:creditNoteId/download`.
- Added seller/Admin settlement statement endpoints:
  - `GET /sellers/commissions/my-settlements/:settlementId/statement`
  - `GET /sellers/commissions/settlements/:settlementId/statement`
- Added export endpoints:
  - `GET /tax/invoices/export`
  - `GET /tax/credit-notes/export`
  - `GET /tax/reports/export`
  - `GET /sellers/commissions/my-commissions/export`
  - `GET /sellers/commissions/my-payouts/export`
  - `GET /sellers/commissions/my-settlements/export`
  - `GET /sellers/commissions/export`
  - `GET /sellers/commissions/payouts/export`
  - `GET /sellers/commissions/settlements/export`
- Added payout operations endpoints:
  - `GET /sellers/commissions/payout-ops/queue`
  - `POST /sellers/commissions/payouts/:payoutId/approve`
  - `POST /sellers/commissions/payouts/:payoutId/hold`
  - `POST /sellers/commissions/payouts/:payoutId/release-hold`
  - `POST /sellers/commissions/payouts/:payoutId/retry`
  - `GET /sellers/commissions/negative-balances`
  - `POST /sellers/commissions/negative-balances/:settlementId/resolve`
- Tightened return policy resolution to include product `returnPolicy.days` and seller `sellerSettings.returnWindowDays`.
- Added tax document dispatch endpoints:
  - `POST /tax/invoices/:invoiceId/dispatch`
  - `POST /tax/credit-notes/:creditNoteId/dispatch`
  - `GET /tax/document-dispatches`
  - `POST /tax/document-dispatches/:dispatchId/retry`
- Added Admin operations export endpoints:
  - `GET /admin/reports/orders/export`
  - `GET /admin/reports/products/export`
  - `GET /admin/reports/inventory/export`
  - `GET /admin/reports/shipments/export`
  - `GET /admin/reports/delivery-agents/export`
  - `GET /admin/reports/returns/export`
  - `GET /admin/reports/cancellations/export`
  - `GET /admin/reports/refunds/export`
  - `GET /admin/reports/seller-scorecards/export`
- Synced Postman collection; nested routers are now followed and 695 registered backend requests are discovered.

Verification:

- `node --check` on new/touched seed, tax, seller finance, and renderer files.
- `node --check` on Admin operations report service, controller, route, and validation files.
- Renderer smoke for PDF/HTML/CSV output.
- Live report-service smoke for all nine Admin operations exports with `format=json&limit=1`.
- `npm run postman:sync`

### 2026-06-17: Marketplace Credit Notes

Completed:

- Added `TaxService.createMarketplaceCreditNotes`.
- Added automatic seller-level credit notes for return refunds.
- Added automatic seller-level credit notes for cancellation refunds.
- Added proportional platform commission reversal credit notes.
- Added marketplace invoice auto-ensure before seller credit notes are generated.
- Kept aggregate order credit-note creation for backward compatibility.
- Kept existing return/cancellation `creditNoteId` metadata shape stable by returning a primary note id from the bundle.

Updated files:

- `src/modules/tax/services/tax.service.js`
- `src/modules/cancellation/services/cancellation.service.js`
- `src/modules/returns/services/return.service.js`
- `docs/MARKETPLACE_FLOW_COVERAGE.md`

Verification:

- `node --check src/modules/tax/services/tax.service.js`
- `node --check src/modules/cancellation/services/cancellation.service.js`
- `node --check src/modules/returns/services/return.service.js`

## Product Readiness Backlog: Scratch To Advanced

This list is the remaining product roadmap from foundation to advanced marketplace operations. Backend items marked covered still need Admin/customer UI and live UAT before product sign-off.

### Phase 0: Project Hygiene And Release Gate

- Package script/doc drift has backend compatibility scripts restored; run live DB seed smoke before production sign-off.
- Freeze the module order: Product and Inventory -> Cart -> Checkout -> Order -> Payment -> Delivery -> Invoice -> Return -> Cancellation -> Settlement.
- Define completion gates for every phase: backend API, Admin UI, seller/customer UI, RBAC, seed/migration, integration tests, UAT, docs, deployment notes.
- Create a live smoke checklist with one multi-seller order that passes payment, delivery, invoice, return/refund, and payout.

### Phase 1: Seller Store Foundation

- Enforce one store per seller across backend, Admin, and seller UI.
- Complete store profile, GST, PAN, bank, pickup address, return address, delivery settings, and KYC review UI.
- Add Admin controls for seller go-live, blocked state, verification history, and re-review.
- Add seller audit timeline for profile, bank, GST, address, and delivery-setting changes.

### Phase 2: Product, Catalog, Pricing, GST

- Finish seller product create/edit/revision workflow in Admin and seller UI.
- Verify product approval/rejection/versioning and seller resubmission states.
- Lock variant/SKU uniqueness, images/media, categories, HSN/GST, dimensions, shipping profile, and inventory requirements before publishing.
- Confirm catalog search/index refresh after approval and product updates.
- Add clear Admin reports for products stuck in draft, review, rejected, inactive, or out-of-stock states.

### Phase 3: Inventory And Reservation

- Verify stock reservation, payment capture commit, payment failure release, cancellation release, return restock, damaged stock, and manual adjustment.
- Add Admin/seller UI for inventory adjustments with reason, evidence, and audit history.
- Add low-stock, oversell-risk, and reservation-timeout reports.
- Add warehouse/location support only if the product needs multi-location fulfillment.

### Phase 4: Cart, Checkout, Multi-Seller Pricing

- Customer UI must show seller split, seller delivery charge, GST, discount, wallet usage, COD charges, and final payable before payment.
- Backend already supports one parent order with seller-owned item grouping; decide whether UI requires a physical `seller_orders` table or a seller-order read model.
- Add checkout blocking when seller KYC, address, shipping profile, inventory, GST, or commission settings are incomplete.
- Add gateway-fee policy display and reporting if gateway fee is charged, absorbed, or deducted later.

### Phase 5: Payment, COD, Wallet

- Complete live Razorpay sandbox/UAT with real popup, verify callback, webhook capture, retry payment, and failed payment recovery.
- Confirm COD authorization and COD receivable tracking for seller self-delivery, if allowed.
- Add Admin payment reconciliation for captured, failed, refunded, COD pending, and manual-review payments.
- Verify wallet reserve, capture, release, refund, and partial wallet plus online payment edge cases.

### Phase 6: Order Split And Seller Operations

- Keep parent order plus seller item groups unless product requires physical seller sub-orders.
- If needed, add seller-order read model with seller-level amount, status, shipment, return, invoice, and payout state.
- Add seller-level status visibility for packed, shipped, delivered, partial delivery, return requested, refunded, and cancelled.
- Add Admin recovery queue for stuck orders, payment mismatch, inventory mismatch, shipment mismatch, and refund mismatch.

### Phase 7: Shipment, Delivery Agent, Proof

- Backend delivery-agent CRUD and assignment exist; Admin/seller UI must expose them.
- Add delivery-agent login/mobile workflow if delivery boys need direct access.
- Verify OTP delivery, proof image, timestamp, manual override, and audit trail in live flow.
- Add courier reconciliation and webhook retry/failure queue for courier providers.
- Add delivery SLA, failed delivery, RTO, lost, damaged, and NDR handling if required.

### Phase 8: Invoice, Tax, E-Way Bill, Credit Notes

- Backend marketplace invoice bundle exists: seller customer invoices and platform commission invoices per seller.
- Backend marketplace credit-note split exists for return and cancellation refunds.
- Backend PDF/download APIs exist for invoices and credit notes.
- Backend invoice/credit-note email dispatch, WhatsApp dispatch audit placeholder, retry queue, and delivery audit listing exist; live providers and Admin/seller/customer UI are pending.
- Verify e-way bill creation/update for seller shipment flows.
- Add GST/TCS/TDS/tax filing reports if required for production finance.

### Phase 9: Return, Cancellation, Refund

- Run full live smoke for item-aware cancellation across inventory, payment, refund, tax credit note, and seller finance.
- Backend return-window policy now uses product snapshot and seller settings; verify the live UI/UAT scenarios against category/product/seller configuration before sign-off.
- Add customer/seller/Admin UI for return request, approval, pickup, receive, QC, refund, replacement, and close.
- Add reverse logistics courier integration and manual ship-back flow.
- Add dispute/manual review path for damaged, missing, rejected QC, refund failure, and partial refund.

### Phase 10: Seller Wallet, Settlement, Payout

- Backend wallet summary, payout release policy, and payout scheduler exist.
- Backend Admin payout approval queue, payout hold/release, failed payout retry, failed payout reason capture, and operations queue exist.
- Backend negative balance recovery workflow exists for post-payout refunds: offset future payouts, collect from seller, or platform write-off.
- Add Admin UI, notification alerts, and payout proof upload for payout operations.
- Backend settlement statement PDF/download and export exist for current settlement, payout, commission, refund, adjustment, and final payout ledger fields.
- Add immutable wallet snapshot table only if finance needs historical balance snapshots independent of ledger recalculation.

### Phase 11: Admin, Seller, Customer UI

- Admin UI pending:
  - seller profile/KYC/address/delivery settings,
  - delivery-agent management,
  - split order/seller-order view,
  - invoice bundle and credit notes,
  - seller wallet, payout approval, settlement reports,
  - analytics dashboard and exports,
  - stuck flow recovery queues.
- Seller UI pending:
  - store profile, GST, bank, pickup/return address,
  - product/revision flow,
  - inventory adjustment,
  - shipment, delivery agent, proof/OTP,
  - invoices, wallet, payouts, settlement statements,
  - returns/cancellations.
- Customer UI pending:
  - checkout seller split,
  - split shipment tracking,
  - invoice downloads per seller,
  - return/cancellation/refund timeline.

### Phase 12: Analytics, Reports, Export

- Backend admin/seller analytics exist; UI dashboards and filters are pending.
- Backend CSV/PDF/HTML/text/JSON exports exist for invoices, credit notes, tax reports, commissions, payouts, settlements, orders, products, inventory snapshots/transactions, shipments, delivery agents, returns, refunds, cancellations, and seller scorecards.
- Add Admin UI wiring for report downloads and saved report filters.
- Add scheduled reports for Admin and seller.
- Add funnel analytics: product view -> cart -> checkout -> payment success -> delivery -> return/refund.
- Extend seller scorecards with SLA, customer issue, NDR/RTO, and payout aging details.

### Phase 13: Notifications And Automation

- Add notifications for product approval, order assigned, payment success/failure, shipment updates, OTP, delivery proof, return status, refund, invoice, payout, and KYC status.
- Add retry queues for payment webhook, courier webhook, invoice dispatch, email/SMS/WhatsApp, and payout processing.
- Add SLA alerts for pending shipment, pickup failure, delayed delivery, pending refund, payout failure, and stuck KYC.

### Phase 14: Security, RBAC, Audit, Compliance

- Re-run RBAC seed and repair checks after every new Admin/seller module.
- Ensure every button and route has matching module/action permission.
- Add audit logs for finance, tax, payout, refund, delivery override, product approval, and seller KYC decisions.
- Add PII controls for GST, PAN, bank, address, delivery proof, and customer contact data.
- Add rate limits and abuse checks for OTP, login, checkout, payment retry, return creation, and refund actions.

### Phase 15: Production Go-Live

- Run live end-to-end UAT for at least:
  - one single-seller prepaid order,
  - one multi-seller prepaid order,
  - one COD order,
  - one wallet plus online payment order,
  - one cancellation before shipment,
  - one return after delivery,
  - one refund after payout,
  - one payout with manual approval,
  - one failed payout retry,
  - one invoice and credit-note export.
- Confirm production env, Razorpay keys/webhooks, SMTP/SMS/WhatsApp, storage, DB backup, cron, queues, logs, and monitoring.
- Add rollback plan for migrations, payment webhook failures, payout mistakes, and invoice numbering mistakes.

## Verification Commands

Use these from `backend/`:

```bash
node --check src/modules/admin/services/commerce-settings.service.js
node --check src/modules/seller/services/commission.service.js
node --check src/modules/seller/routes/commission.routes.js
node --check src/infrastructure/cron/register-cron.js
node --check src/modules/validation.js
node --check src/modules/delivery/validation/delivery.validation.js
node --check src/modules/delivery/routes/delivery.routes.js
node --check src/modules/delivery/controllers/delivery.controller.js
node --check src/modules/delivery/services/delivery.service.js
node --check src/modules/delivery/repositories/delivery.repository.js
node --check sequelize/migrations/031-delivery-agents.js
node --check src/modules/analytics/repositories/analytics.repository.js
node --check src/modules/analytics/services/analytics.service.js
node --check src/modules/analytics/controllers/analytics.controller.js
node --check src/modules/analytics/routes/analytics.routes.js
node --check src/modules/analytics/validation/analytics.validation.js
node --check src/modules/tax/repositories/tax.repository.js
node --check src/modules/tax/services/tax.service.js
node --check src/modules/tax/controllers/tax.controller.js
node --check src/modules/tax/routes/tax.routes.js
node --check src/modules/tax/validation/tax.validation.js
node --check src/modules/admin/services/operations-report.service.js
node --check src/modules/admin/controllers/operations-report.controller.js
node --check src/modules/admin/routes/operations-report.routes.js
node --check src/modules/admin/validation/operations-report.validation.js
node --check src/modules/cancellation/services/cancellation.service.js
node --check src/modules/returns/services/return.service.js
node --check sequelize/migrations/032-tax-marketplace-invoices.js
npm run check
git diff --check
npm run db:migrate
```
