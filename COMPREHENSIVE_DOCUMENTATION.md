# Ecommerce Backend Documentation

This is the single maintained backend document for the current codebase. Older scattered Markdown notes were removed to avoid stale setup, API, and RBAC instructions.

## Overview

The backend is a CommonJS Node.js modular monolith for a marketplace ecommerce platform. It exposes REST APIs under `API_PREFIX` and uses:

- Express for HTTP routing.
- MongoDB/Mongoose for user, product, catalog-like document, CMS, marketing, recommendation, referral, loyalty, and notification data.
- PostgreSQL via Sequelize, Knex, and `pg` for orders, payments, wallets, RBAC, tax ledgers, marketplace operations, subscriptions, logistics, and advanced operational tables.
- Redis where available for caching and async infrastructure.
- Socket.IO for realtime events.
- JWT authentication with role and RBAC-aware access middleware.

Default base URL:

```txt
http://localhost:4000/api/v1
```

Health routes:

```txt
GET /
GET /health
```

## Runtime

Required engine:

```txt
Node.js >= 20
```

Main scripts:

```bash
npm run dev
npm start
npm run check
npm run db:migrate
npm run db:migrate:undo
npm run db:seed:commerce
npm run db:seed:commerce:append
npm run db:seed:rbac
npm run db:create-super-admin
npm run postman:sync
```

`db:seed:commerce` runs the new commerce fixture seed with reset enabled. It refreshes product, order, and marketing fixtures only.

`db:seed:commerce:append` adds another set of demo orders while upserting users/products and preserving existing commerce data.

## Environment

Important environment variables:

```txt
NODE_ENV=development
PORT=4000
APP_NAME=ecommerce
API_PREFIX=/api/v1
MONGO_URI=mongodb://localhost:27017/ecommerce
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/ecommerce
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=access-secret
JWT_REFRESH_SECRET=refresh-secret
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
BUSINESS_STATE=KARNATAKA
GSTIN_MARKETPLACE=
MAX_WALLET_USAGE_PER_ORDER_PERCENT=30
EMAIL_HOST=localhost
EMAIL_PORT=1025
STATIC_OTP=123456
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
JSON_BODY_LIMIT=50mb
ENABLE_CRON=true
PRODUCTION=false
```

## Application Boot

Entrypoint:

```txt
src/server.js
```

App factory:

```txt
src/app/create-app.js
```

Boot sequence:

1. Connect MongoDB.
2. Connect PostgreSQL through `pg` and Knex.
3. Register global middleware: logging, helmet, CORS, JSON/urlencoded parsing, uploads, audit log, metrics.
4. Register API routes.
5. Register workers, cron jobs, realtime subscribers, and domain event handlers.
6. Attach 404 and error middleware.
7. Attach Socket.IO and start HTTP server.

## Data Stores

MongoDB is used for:

- Users and seller profiles.
- Products and product review-like document data.
- Platform catalog documents such as categories, brands, options, variants, dimensions, finishes, batches, warranties, content pages.
- Coupons and dynamic pricing documents.
- CMS/static pages.
- Recommendation, loyalty, referral, notification, fraud, delivery documents.

PostgreSQL is used for:

- Orders, order items, payments, wallets, wallet transactions, outbox events.
- Seller KYC, user KYC, seller documents.
- Marketplace operations such as platform fee config, penalties, cancellation reasons, returns, shipments, NDR, e-way bills.
- Subscription plans/orders and platform fees.
- RBAC modules, permissions, roles, assignments, audit logs, templates.
- Tax invoices, ledgers, filings.

## Core Relationships

Product relationship:

```txt
users._id -> products.sellerId
users._id -> products.createdBy
products._id -> products.relatedProducts[]
products._id -> products.crossSellProducts[]
products._id -> products.upSellProducts[]
```

Order relationship:

```txt
users._id -> orders.buyer_id
orders.id -> order_items.order_id
products._id -> order_items.product_id
products.variants._id -> order_items.variant_id
products.variants.sku -> order_items.variant_sku
products.sellerId -> order_items.seller_id
orders.id -> payments.order_id
users._id -> payments.buyer_id
```

Marketing relationship:

```txt
users._id -> coupons.sellerId
users._id -> coupons.createdBy
products._id -> dynamic_pricings.productId
users._id -> recommendations.userId
products._id -> recommendations.recommendedProducts[].productId
users._id -> loyalties.userId
orders.id -> loyalties.pointsHistory[].transactionId
users._id -> influencer_profiles.userId
influencer_profiles._id -> referral_codes.influencerId
orders.id -> referral_orders.orderId
referral_orders._id -> referral_commission_ledgers.referralOrderId
```

RBAC relationship:

```txt
modules.id -> permissions.module_id
roles.id -> role_permissions.role_id
permissions.id -> role_permissions.permission_id
users._id -> user_roles.user_id
roles.id -> user_roles.role_id
users._id -> user_permissions.user_id
permissions.id -> user_permissions.permission_id
```

## New Commerce Seed Script

The replacement seed script is:

```txt
scripts/db/seed-commerce-demo.js
```

Run full commerce refresh:

```bash
npm run db:migrate
npm run db:seed:commerce
```

Append another demo order set without resetting:

```bash
npm run db:seed:commerce:append
```

The reset mode deletes and rebuilds only:

- Mongo products.
- Mongo coupons.
- Mongo dynamic pricing.
- Mongo recommendation data.
- Mongo loyalty data.
- Mongo referral/influencer marketing data.
- Seed-tagged promotion content pages.
- PostgreSQL payments.
- PostgreSQL order items.
- PostgreSQL orders.
- Seeded PostgreSQL platform fee rows for `default`, `electronics`, and `apparel`.

The reset mode deliberately does not touch:

- RBAC modules, permissions, roles, user-role assignments, or user-permission assignments.
- Tax management tables or ledgers.
- Location/geography/country/state/city/zip code data.
- Migrations.
- Super admin setup.

Demo users:

```txt
demo.techseller@example.com
demo.styleseller@example.com
demo.buyer@example.com
demo.influencer@example.com
```

Default seed password:

```txt
Password@123
```

Override password:

```bash
SEED_PASSWORD='YourPassword@123' npm run db:seed:commerce
```

Seeded product management data:

- Seller-linked active products.
- Variant and simple products.
- SKU, barcode, pricing, inventory, images, moderation status, analytics.
- Product relationships: related, cross-sell, upsell.

Seeded order management data:

- Orders with buyer IDs.
- Order items linked to product IDs, seller IDs, and variant IDs/SKUs.
- Payments linked to orders and buyers.
- Multiple statuses: confirmed, pending payment, delivered.

Seeded marketing data:

- Platform and seller-scoped coupons.
- Dynamic pricing rules.
- Recommendation and trending records.
- Loyalty points and tier history.
- Influencer profile, referral code, referral order, commission ledger, wallet, commission rule.
- Promotion banner content pages tagged by `metadata.seedTag`.

## Scripts Kept

Only backend-necessary scripts remain:

```txt
scripts/db/run-sequelize-migrations.js
scripts/db/rollback-sequelize-migration.js
scripts/db/create-super-admin.js
scripts/db/seed-rbac.js
scripts/db/seed-commerce-demo.js
scripts/postman/sync-postman-collection.js
```

Old dev/catalog/CMS/location/reset seeders were removed because the new seed flow is scoped and should not reset RBAC, tax, or location data.

## API Route Registry

Routes are registered in:

```txt
src/api/register-routes.js
```

Mounted route prefixes:

```txt
/auth
/global
/users
/products
/carts
/orders
/payments
/platform
/cms
/sellers
/notifications
/analytics
/pricing
/coupons
/wallets
/admin
/tax
/subscriptions
/rbac
/warranty
/loyalty
/recommendations
/returns
/fraud
/dynamic-pricing
/sellers/commissions
/delivery
/file-uploader
/meta
```

All prefixes are mounted under `API_PREFIX`, which defaults to `/api/v1`.

## Authentication

Auth routes are under:

```txt
/api/v1/auth
```

The auth module supports login/session behavior through JWT access/refresh secrets. Authenticated requests use:

```txt
Authorization: Bearer <access_token>
```

The middleware enriches `req.auth` with:

- `userId`
- `role`
- `roles`
- `isSuperAdmin`
- `allowedModules`
- `permissions`
- owner IDs for admin/seller hierarchy where relevant

## RBAC Rules

Canonical actions:

```txt
view
create
update
delete
status_change
approve
reject
assign
export
import
restore
bulk_action
```

Old aliases normalize as:

```txt
add -> create
edit -> update
status -> status_change
approval -> approve
action -> status_change
review -> approve
manage -> status_change
```

Effective permission rules:

- `module:view` allows sidebar visibility, route access, list/detail views, and GET APIs.
- `module:create` allows Add/POST actions and implicitly adds view.
- `module:update` allows Edit/PATCH/PUT actions and implicitly adds view.
- `module:delete` allows Delete actions and implicitly adds view.
- `module:status_change` allows status toggles and implicitly adds view.
- `module:approve` and `module:reject` allow moderation actions and implicitly add view.
- `module:export` and `module:import` allow import/export controls and implicitly add view.
- `module:assign` allows role/permission/module assignment and implicitly adds view.
- Denied permissions override grants after alias normalization.

Request action inference:

```txt
GET -> view
POST -> create
PUT/PATCH -> update
DELETE -> delete
/status -> status_change
/approve -> approve
/reject -> reject
/export -> export
/import -> import
/users/:id/permissions -> assign for writes
/roles/:id/permissions -> assign for writes
/users/:id/roles -> assign for writes
/bulk -> bulk_action for writes
```

Important RBAC files:

```txt
src/shared/middleware/access.js
src/shared/auth/rbac-permissions.js
src/shared/auth/module-access.js
src/modules/rbac/routes/rbac.routes.js
src/modules/rbac/services/rbac.service.js
src/modules/rbac/repositories/rbac.repository.js
```

## Product Management

Primary route prefix:

```txt
/api/v1/products
```

Important routes:

```txt
GET    /products
GET    /products/search
GET    /products/:productId
GET    /products/seller/me
POST   /products
PATCH  /products/:productId
DELETE /products/:productId
PATCH  /products/:productId/review
POST   /products/bulk/update
PATCH  /products/:productId/inventory
GET    /products/inventory/stats
GET    /products/analytics/top
```

Product model highlights:

- Seller ownership through `sellerId`.
- Product type: simple, variable, digital, bundle, subscription.
- Visibility: public, private, hidden, scheduled.
- Category, brand, family, tags, badges.
- Price, MRP, sale price, GST, HSN.
- SKU/barcode/color.
- Variant axes, variants, product options.
- Stock/reserved stock and inventory settings.
- Shipping, warranty, SEO, analytics.
- Related/cross-sell/upsell product IDs.
- Moderation fields and approval status.

## Order Management

Primary route prefix:

```txt
/api/v1/orders
```

Important routes:

```txt
POST  /orders
GET   /orders/my
GET   /orders/seller
GET   /orders/:orderId
POST  /orders/:orderId/cancel
PATCH /orders/:orderId/status
```

Order service flow:

1. Price order items.
2. Apply coupon and wallet usage.
3. Calculate tax and platform fees.
4. Reserve inventory.
5. Hold wallet amount.
6. Create order, order items, and outbox event.
7. Finalize coupon usage.
8. Capture wallet and commit inventory for zero-payable orders.
9. Publish order status events.

Order data lives in PostgreSQL:

```txt
orders
order_items
payments
wallets
wallet_transactions
outbox_events
```

## Marketing

Pricing/coupon routes:

```txt
/api/v1/pricing
/api/v1/coupons
```

Dynamic pricing routes:

```txt
/api/v1/dynamic-pricing
```

Referral admin routes are nested under:

```txt
/api/v1/admin/referral
```

Loyalty routes:

```txt
/api/v1/loyalty
```

Recommendation routes:

```txt
/api/v1/recommendations
```

Marketing models:

```txt
CouponModel
DynamicPricingModel
RecommendationModel
LoyaltyModel
ReferralModel
InfluencerProfileModel
ReferralCodeModel
ReferralOrderModel
ReferralCommissionLedgerModel
InfluencerWalletModel
InfluencerPayoutRequestModel
ReferralCommissionRuleModel
ReferralFraudReviewModel
ContentPageModel for promotion banners
```

## Admin And Seller Management

Admin route prefix:

```txt
/api/v1/admin
```

Admin areas include:

- Dashboard/overview.
- Admin and sub-admin management.
- Seller/vendor management.
- Seller KYC, bank, onboarding, go-live.
- Product moderation and catalog operations.
- Order, payment, payout, returns, chargeback views.
- Platform catalog management.
- CMS content pages.
- Tax and reports.
- Feature flags, API keys, webhooks, queue status.
- Access modules and RBAC-adjacent management.

Seller route prefix:

```txt
/api/v1/sellers
```

Seller areas include:

- Seller registration/profile/status.
- KYC and document upload.
- Seller dashboard.
- Seller sub-admin management.
- Seller tracking.
- Seller commissions through `/api/v1/sellers/commissions`.

Seller product relation:

```txt
product.sellerId = seller user _id
```

Seller order relation:

```txt
order_items.seller_id = seller user _id
```

## Platform Catalog

Platform route prefix:

```txt
/api/v1/platform
```

Admin catalog routes also expose many platform resources under:

```txt
/api/v1/admin/platform
```

Platform resources include:

- Categories and category attributes.
- Product families.
- Product variants.
- Product reviews.
- Brands.
- Warranty templates.
- Finishes.
- Dimensions.
- Batches.
- Product options.
- Product option values.
- Content pages.
- HSN codes.
- Geography.

The new commerce seed intentionally does not reset platform catalog, HSN, tax, or geography/location data.

## CMS

CMS route prefix:

```txt
/api/v1/cms
```

CMS content page data is stored in Mongo. The commerce seed only writes seed-tagged promotion banner content pages and only deletes those seed-tagged pages during reset.

## Inventory

Inventory is represented in both product stock fields and supporting inventory modules.

Important concepts:

- `products.stock`
- `products.reservedStock`
- variant stock/reserved stock
- inventory reservations
- warehouses
- admin inventory routes

Order creation reserves stock before writing the order.

## Payments And Wallets

Payment route prefix:

```txt
/api/v1/payments
```

Wallet route prefix:

```txt
/api/v1/wallets
```

Payment and wallet data are stored in PostgreSQL. Orders reference payment records through `payments.order_id`.

## Tax Management

Tax route prefix:

```txt
/api/v1/tax
```

Tax tables include invoices, ledgers, GST filings, and HSN-aware tax behavior. The commerce seed does not reset tax data.

## Location Management

Location/common management route prefixes:

```txt
/api/v1/global
/api/v1/admin/common
```

Location data includes countries, states, cities, and zip codes. The commerce seed does not reset location data.

## Subscriptions And Fees

Subscription route prefix:

```txt
/api/v1/subscriptions
```

Platform fee config is used by pricing. The commerce seed refreshes only three demo fee categories:

```txt
default
electronics
apparel
```

## Notifications

Notification route prefix:

```txt
/api/v1/notifications
```

Notification preferences are also mounted under the same prefix.

## Delivery And Logistics

Delivery route prefix:

```txt
/api/v1/delivery
```

Admin shipping routes are mounted through admin routes. Logistics tables cover shipments, NDR, e-way bills, pickup addresses, shipping packages, and related operational data.

## Returns, Fraud, Analytics

Route prefixes:

```txt
/api/v1/returns
/api/v1/fraud
/api/v1/analytics
```

These modules support post-order operations, risk workflows, and dashboards.

## Postman

Postman assets:

```txt
postman_collection.json
postman_environment.json
scripts/postman/sync-postman-collection.js
```

Run:

```bash
npm run postman:sync
```

The commerce seed did not introduce or remove API endpoints, so the Postman collection does not require a route update for this change.

## Suggested Local Setup

Fresh local setup:

```bash
npm install
npm run db:migrate
npm run db:seed:rbac
npm run db:create-super-admin
npm run db:seed:commerce
npm run dev
```

Commerce-only refresh after migrations already exist:

```bash
npm run db:seed:commerce
```

Append demo orders:

```bash
npm run db:seed:commerce:append
```

## Safety Notes

- `db:seed:commerce` deletes product/order/marketing fixture areas and rebuilds them.
- It does not drop databases.
- It does not run `DROP SCHEMA`.
- It does not reset MongoDB wholesale.
- It does not delete RBAC, tax management, or location management data.
- It creates or updates demo users but does not delete all users.
- It requires PostgreSQL migrations to have already created `orders`, `order_items`, and `payments`.

## Maintained Source Of Truth

For route behavior, trust:

```txt
src/api/register-routes.js
src/modules/*/routes/*.js
```

For models, trust:

```txt
src/modules/*/models/*.js
src/infrastructure/sequelize/models/index.js
sequelize/migrations/*.js
```

For RBAC and permissions, trust:

```txt
src/shared/middleware/access.js
src/shared/auth/rbac-permissions.js
src/shared/auth/module-access.js
src/modules/rbac
```

For seed behavior, trust:

```txt
scripts/db/seed-commerce-demo.js
```
