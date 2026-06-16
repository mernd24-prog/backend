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
- Invoice metadata captures seller, issuer, recipient, reference, and parent invoice linkage.
- Invoice bundle reads are scoped:
  - admin sees all invoice documents,
  - seller sees own seller and commission invoices,
  - buyer sees only customer-facing invoices.
- Credit notes exist through returns.
- E-way bill records can be created and status-updated.

Remaining:

- Return/cancellation credit notes still create one refund reference document by default; Admin can target a seller invoice by passing `invoiceId`, but automatic per-seller credit-note splitting should be added if the business needs separate credit notes for multi-seller partial refunds.
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

- Export/report endpoints for all new wallet/delivery-agent use cases should be added if Admin expects CSV.
- Admin/customer UI updates are outside this backend-only writable scope.

## Critical Remaining Gaps Before Production Sign-Off

1. Add automatic per-seller credit-note splitting if required by finance:
   - one seller credit note per seller invoice for multi-seller cancellations/returns,
   - one commission reversal note per platform commission invoice when fee tax is reversed,
   - PDF/email dispatch for generated seller invoice and credit-note documents.

2. Add payout operational follow-ups:
   - payout retry alerts,
   - Admin workflow for negative balance recovery,
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

5. Confirm deleted script/doc drift:
   - `package.json` still references deleted script paths in the current worktree.
   - Existing deletions were pre-existing and were not reverted in this pass.

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
node --check sequelize/migrations/032-tax-marketplace-invoices.js
npm run check
git diff --check
npm run db:migrate
```
