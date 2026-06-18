# Admin Backend Alignment Checklist

This checklist records the Admin cleanup pass for backend-supported marketplace operations.

## Core Rules Applied

- No visible Admin page/action should call a missing backend API.
- No visible Admin filter should be left decorative when the backend can support it.
- Backend-supported operations must be reachable through a real route, guarded by the matching module permission.
- Unsupported placeholder components/routes are removed instead of hidden behind dummy UI.

## Backend API Families Mapped To Admin

| Backend capability | API family | Permission/module | Admin route/page |
| --- | --- | --- | --- |
| Orders list/detail/status/notes/cancel | `/admin/orders`, `/orders/:orderId`, `/orders/:orderId/status`, `/orders/:orderId/notes`, `/orders/:orderId/cancel` | `orders` | `/orders`, order detail modal/page |
| Checkout/admin quote | `/orders/checkout/admin-quote` | `orders` | `/checkout-quote` |
| Returns and refund workflow | `/returns`, `/returns/:id/*` | `returns`, `orders` | `/returns`, `/refunds` |
| Cancellations and manual retry/refund | `/cancellations`, `/cancellations/:id/*` | `orders`, `cancellations` | `/cancellations` |
| Payments and COD config | `/payments/admin`, `/payments/admin/cod-config`, `/payments/:id/approve`, `/payments/:id/reject` | `payments` | `/payments` |
| Wallet transaction audit | `/wallets/admin/transactions` | `wallets:view` | `/wallet-transactions`, `/wallet-management` |
| Seller commissions and payouts | `/sellers/commissions`, `/sellers/commissions/payouts`, `/sellers/commissions/process-payouts` | `sellers/commissions` | `/seller-finance` |
| Payout operations | `/sellers/commissions/payout-ops/queue`, `/payouts/:id/approve`, `/hold`, `/release-hold`, `/retry`, `/process`, `/fail` | `sellers/commissions:update` | `/payout-ops-queue` |
| Negative balance recovery | `/sellers/commissions/negative-balances`, `/negative-balances/:id/resolve` | `sellers/commissions:update` | `/negative-balances` |
| Seller finance settings | `/admin/finance/*`, `/admin/commerce-settings/*` | `sellers/commissions`, `admin` | `/commission-rules`, `/platform-fee-config`, `/commerce-settings` |
| Delivery agents | `/delivery/agents`, `/delivery/agents/:id` | `delivery` | `/delivery-agents` |
| Shipments/tracking/delivery confirmation | `/delivery/shipments`, `/delivery/shipments/:id/*` | `delivery` | `/shipment-tracking` |
| Shipping packages/pickup addresses | `/admin/shipping/packages`, `/admin/shipping/pickup-addresses` | `delivery` | `/shipping-packages`, `/pickup-addresses` |
| Inventory stats/stock/transactions/warehouses | `/admin/inventory/*` | `inventory` | `/inventory-overview`, `/variant-inventory`, `/inventory-adjustment`, `/inventory-transactions` |
| Product catalog/moderation/media/inventory | `/admin/products/*`, `/products/*` | `products` | `/product-catalog`, `/add-product`, moderation routes |
| Categories, brands, options, reviews | Common/product admin APIs | `products`, `categories`, `brands` | catalog management routes |
| Tax/GST invoices/credit notes/reports | `/tax/*` | `tax` | `/tax`, `/tax-rule`, `/tax-invoices`, `/credit-notes`, reports |
| Analytics/reports | `/analytics/*`, `/admin/reports/*` | `analytics`, module-specific exports | reports dashboard/routes |
| Fraud cases | `/fraud/*` | `fraud` | `/fraud-cases` |
| Referral commerce | `/admin/referral/*` | `referral` | referral commerce routes |
| Deals | `/deals/*` | `deals` | `/deal-management` |
| CMS/notifications/platform/admin users/RBAC | `/cms/*`, `/notifications/*`, `/platform/*`, `/admin/*`, `/rbac/*` | matching module permissions | corresponding Admin management routes |

## Removed Unsupported Or Dead Admin Surfaces

- Removed fake shipping profile page and route because backend has shipping packages and pickup addresses, not shipping profiles.
- Removed fake tax structure/category/category-rule pages that duplicated real tax/tax-rule APIs.
- Removed placeholder promotion weightage/PPC pages without backend APIs.
- Removed hardcoded subscription order detail route/component with dummy data.
- Removed unused dummy order/gift-card view components.
- Removed pickup-address add/edit placeholder that only contained alert/console placeholder behavior.
- Removed duplicate `/refunds` route that incorrectly pointed to wallet transactions.

## Corrected Functional Mismatches

- Payout ops queue now supports backend states `pending`, `processing`, `on_hold`, and `failed`.
- Payout ops filters now send `sellerId`, `status`, `search`, `fromDate`, `toDate`, `limit`, and `offset`.
- Payout ops table now flattens grouped backend response keys: `pendingApproval`, `processing`, `onHold`, and `failed`.
- Negative balance page now uses backend-valid statuses: `pending`, `processing`, `on_hold`, `completed`.
- Negative balance actions now use backend-valid action values: `offset_future_payout`, `collected_from_seller`, `platform_write_off`.
- Negative balance reference IDs are persisted by the backend as recovery metadata.
- Delivery agent create/update now requires a seller in Admin, matching backend service rules.
- Wallet transactions page now uses real `credit`/`debit` types only and the shared table/filter props correctly.
- Seller Finance initiate payout now supports backend `autoProcess`, stores payment reference on payout creation, and forwards admin notes.
- Status badges include payout/wallet states such as `on_hold`, `held`, and `released`.

## Current Validation Targets

- Backend syntax checks for changed services/routes/validation.
- Admin build after route, sidebar, finance, wallet, and delivery-agent changes.
- Customer build after order/return lifecycle changes.
- Search for removed placeholder route/component references.
