# Product Flow Backend Implementation Report

Date: 2026-06-03
Scope completed in this pass: Backend Phase 1, Phase 2, and Phase 3 compliance-lockdown foundation.
Status: Implemented in backend. Frontend wiring is still pending.

## 1. What Changed Now

Implemented the first three backend foundations for the product flow:

- Public product list now always enforces active/public product visibility.
- Public product detail now returns only active/public products by ID.
- Public product search now enforces active/public product visibility in Elasticsearch.
- Mongo text-search fallback now enforces the same active/public rule.
- Shared `/api/v1/search` now enforces active/public product visibility.
- Shared `/api/v1/search/autocomplete` now suggests only active/public products.
- Product indexing now indexes only products that are safe for customer display.
- Product indexing now deletes products from Elasticsearch when they become non-public.
- Bulk visibility updates now refresh or remove products from the search index.
- Shared search index-all and rebuild endpoints now have backend service methods.
- Seller-created products can now stay as `draft` when submitted as draft.
- Seller-created non-draft products still go to `pending_approval`.
- Seller draft/rejected products cannot jump directly to `active` from update payloads.
- Rejected seller products resubmit to `pending_approval` after seller edit.
- Active seller product edits now create a pending product revision instead of changing the live product.
- Live active products remain unchanged while a seller revision is pending.
- Admin can list product revisions and review revision changes.
- Admin revision approval publishes only the draft changed fields.
- Admin revision rejection keeps the live product unchanged.
- Product documents now keep `revisionStatus`, `pendingRevisionId`, and `statusHistory`.
- Admin moderation queue can filter products with pending active-product changes using `change_pending`.
- Scheduled publishing now has a backend cron job.
- Product routes were ordered so static routes are not swallowed by `/:productId`.
- Admin reject product validation now has the missing backend schema.
- Seller-sent GST/platform-fee/commission/tax-rule fields are stripped by backend service logic.
- Product HSN selection is validated against active HSN master records.
- Product GST rate is derived from the active HSN master record when HSN is selected.
- Product now stores a compliance snapshot with HSN/GST/tax metadata for audit.
- Seller updates cannot clear existing HSN compliance by sending an empty HSN code.
- Request validation no longer defaults `gstRate` to `18`, preventing unrelated updates from overwriting tax data.

## 2. Files Changed

Backend files changed:

- `src/shared/catalog/public-product-filter.js`
- `src/shared/domain/commerce-constants.js`
- `src/shared/services/advanced-search.service.js`
- `src/shared/routes/search.routes.js`
- `src/modules/product/models/product.model.js`
- `src/modules/product/models/product-revision.model.js`
- `src/modules/product/repositories/product.repository.js`
- `src/modules/product/services/product.service.js`
- `src/modules/product/controllers/product.controller.js`
- `src/modules/product/routes/product.routes.js`
- `src/modules/product/validation/product.validation.js`
- `src/modules/admin/repositories/admin.repository.js`
- `src/modules/admin/routes/admin.routes.js`
- `src/modules/admin/validation/admin.validation.js`
- `src/infrastructure/cron/register-cron.js`

Workspace planning file added:

- `/home/user/Projects/Ecommerce/PRODUCT_FLOW_ALL_PHASES_AND_USECASES.md`

## 3. Public Catalog Rule

Customer-visible products must satisfy all rules:

- `status = active`
- `visibility = public`
- `publishedAt` is empty or not in the future
- `scheduledAt` is empty or not in the future

This guard is now reusable for:

- Mongo queries
- Elasticsearch filters
- Search indexing checks
- Product visibility checks before exposing detail pages

## 4. Product Lifecycle Flow

### 4.1 Seller Product Creation

Flow:

1. Seller submits product payload.
2. Backend validates category, attributes, variants, media, product type, pricing, stock, and metadata.
3. If seller sends `status=draft`, backend saves product as `draft`.
4. If seller sends any non-draft status, backend saves product as `pending_approval`.
5. Product is not indexed until it becomes active, public, and publishable.

Use cases covered:

- Seller can save work-in-progress product as draft.
- Seller cannot create an active public product directly.
- Seller-created pending products stay hidden from customers.

### 4.2 Seller Draft Submit And Rejected Resubmit

Flow:

1. Seller edits own draft or rejected product.
2. Backend checks seller ownership and seller-sub-admin scope.
3. If seller requests a non-draft status, backend normalizes it to `pending_approval`.
4. If seller edits a rejected product, backend clears rejection fields and resubmits it to `pending_approval`.
5. Status history records the transition.

Use cases covered:

- Seller can submit draft product for review.
- Seller can fix rejected product and resubmit.
- Seller cannot update draft/rejected product directly into `active`.

### 4.3 Admin Initial Product Review

Flow:

1. Admin opens moderation queue.
2. Admin approves or rejects product.
3. Rejection requires a reason.
4. Approval sets `status=active`, `approvedAt`, `approvedBy`, and `publishedAt`.
5. Active/public products are indexed for customer search.
6. Rejected/inactive products are removed from search.
7. Status history records the review decision.

Use cases covered:

- Admin approves seller product.
- Admin rejects seller product with reason.
- Customer search/list/detail remains safe after status change.

### 4.4 Seller Active Product Revision

Flow:

1. Seller edits an already active product.
2. Backend validates the proposed changes.
3. Backend creates or updates a pending `ProductRevision`.
4. Backend stores changed fields and draft changes on the revision.
5. Live product remains active and unchanged.
6. Product gets `revisionStatus=change_pending` and `pendingRevisionId`.
7. Status history records revision submission.

Use cases covered:

- Seller can submit post-approval edits.
- Customer continues to see the last approved live product.
- Admin can review only the changed fields.
- Existing pending revision can be updated instead of creating duplicate pending revisions.

### 4.5 Admin Revision Review

Endpoints:

- `GET /api/v1/products/:productId/revisions`
- `PATCH /api/v1/products/:productId/revisions/:revisionId/review`
- `GET /api/v1/admin/products/:productId/revisions`
- `PATCH /api/v1/admin/products/:productId/revisions/:revisionId/review`

Approval flow:

1. Admin reviews pending revision.
2. Admin approves with `status=active`.
3. Backend applies `draftChanges` to the live product.
4. Backend increments product `version`.
5. Backend clears `pendingRevisionId` and resets `revisionStatus=none`.
6. Backend marks revision as `approved`.
7. Backend indexes the updated product only if it is public-safe.

Rejection flow:

1. Admin rejects with `status=rejected`.
2. `rejectionReason` is required.
3. Backend marks revision as `rejected`.
4. Live product stays active and unchanged.
5. Backend clears `pendingRevisionId` and resets `revisionStatus=none`.
6. Status history records rejection with changed fields and revision ID.

Use cases covered:

- Admin approves seller active-product edit.
- Admin rejects seller active-product edit.
- Live product is protected from unapproved seller changes.
- Revision diff data is available through `changedFields` and `draftChanges`.

### 4.6 Scheduled Publishing

Flow:

1. Cron runs `product-scheduled-publish`.
2. Backend finds due products with `status=scheduled`, or active products with `visibility=scheduled`.
3. Backend publishes them as `active/public`.
4. Backend clears `scheduledAt`.
5. Backend records status history.
6. Backend indexes the product only if public-safe.

Use cases covered:

- Admin can schedule product publishing.
- Future products do not appear early.
- Scheduled products become searchable after publish job runs.

## 5. Public Customer Flow

### 5.1 Product Listing

Endpoint:

- `GET /api/v1/products`

Now enforced:

- Client cannot expose non-public products by sending `status`, `visibility`, or `includeAllStatuses`.
- Filters such as category, brand, price, tags, stock, rating, attributes, and origin still work.
- Final result is always customer-safe.

### 5.2 Product Detail

Endpoint:

- `GET /api/v1/products/:productId`

Now enforced:

- Direct product ID access returns `404` for non-public products.
- Draft, pending approval, rejected, inactive, private, hidden, archived, scheduled, and future-published products are not exposed.
- View tracking happens only after the public-safe product is found by the controller flow.

### 5.3 Product Search

Endpoint:

- `GET /api/v1/products/search`

Now enforced:

- Elasticsearch search filters active/public products.
- Mongo fallback filters active/public products.
- Price, category, brand, product type, pagination, and sorting still work.

### 5.4 Shared Search

Endpoints:

- `GET /api/v1/search`
- `GET /api/v1/search/autocomplete`

Now enforced:

- Search results only include active/public products.
- Autocomplete only suggests active/public product titles.
- In-stock filtering uses `availableStock > 0`.
- Facets expose both `facets.category` and `facets.categories` for customer UI compatibility.

### 5.5 Search Index Management

Endpoints:

- `POST /api/v1/search/index-all`
- `POST /api/v1/search/rebuild`

Now supported:

- Index-all indexes only active/public products.
- Rebuild deletes the product index, then re-indexes only active/public products.
- Non-public products are not intentionally written back into Elasticsearch.

## 6. Admin And Seller Management Flow

### Admin

Admin can now:

- List all products through admin product routes.
- Review pending seller products.
- Filter moderation queue for `pending_approval`, `rejected`, `active`, `inactive`, `draft`, and `change_pending`.
- Open product management detail with pending revision included.
- List product revisions.
- Approve or reject product revisions.
- Approve or reject products through existing admin product status routes.

### Seller

Seller can now:

- Create draft products.
- Submit products for approval.
- Update pending products while they remain pending.
- Edit rejected products and resubmit them.
- Edit active products without changing the live version.
- Track pending revision state through product `revisionStatus` and `pendingRevisionId`.

## 7. Use Cases Covered

Customer use cases:

- Customer opens product list and sees only active public products.
- Customer opens category page and sees only active public products.
- Customer opens brand page and sees only active public products.
- Customer opens product detail with a direct product ID and cannot see draft/private/rejected products.
- Customer searches products and sees only active public products.
- Customer uses autocomplete and receives only active public product suggestions.
- Customer filters by price, rating, stock, category, brand, product type, and attributes without bypassing visibility rules.

Admin and seller safety use cases:

- Seller can save a product as draft.
- Seller can submit a product for approval.
- Seller cannot publish a product directly.
- Seller can correct rejected products.
- Seller active-product edits create pending revisions.
- Admin can approve or reject initial products.
- Admin can approve or reject active-product revisions.
- Rejected revisions do not change the live product.
- Product status and revision decisions are recorded in `statusHistory`.
- Admin can schedule product publishing.

Search and index use cases:

- Elasticsearch outage fallback still applies public filters.
- Search rebuild no longer indexes draft/private products.
- Search autocomplete no longer leaks private product names.
- Hiding, privatizing, rejecting, or deactivating a product removes it from public search.

## 8. Required Next Backend Use Cases

### Phase 3: Master Data And Compliance Lockdown

Implemented foundation now:

- Seller-controlled GST values are not trusted.
- Seller-controlled platform fee and commission-like fields are stripped.
- Active HSN master validation runs when `hsnCode` is submitted.
- Product `gstRate` is derived from active HSN master data.
- Product compliance snapshot is stored.
- Seller updates cannot clear existing HSN by sending an empty value.

Still required:

Required use cases:

- Admin owns categories, brands, attributes, product options, option values, families, HSN, GST, tax classes, commission rules, platform fees, badges, tags, and collections.
- Seller selects approved master data.
- Seller cannot send free-form platform fee or commission values.
- Inline HSN/category/brand creation is role-restricted.
- Product validation rejects invalid compliance references.
- Product stores references to tax class, platform fee, and commission rules when those models are selected as canonical product-level references.
- Admin/Seller UI hides or locks compliance-sensitive fields correctly.

### Phase 4: Product Model Consolidation

Required use cases:

- One canonical variant model is chosen.
- Product variants, option axes, option values, category attributes, and family rules do not conflict.
- Product quality/completeness score is calculated.
- SEO slug and metadata are governed consistently.
- Product badges, tags, and collections have master lifecycle.

### Phase 5: Customer Discovery And Product Detail

Required use cases:

- Home hero and product sections come from CMS/catalog config.
- Featured, new arrivals, trending, best sellers, collections, related products, cross-sell, and up-sell are backend-driven.
- Product detail returns related/cross-sell/up-sell sections.
- Search supports facets, suggestions, pinned products, redirects, blocked terms, and synonyms.
- Recommendation weightage screens affect recommendation engine behavior.

### Phase 6: Inventory Ledger Completion

Required use cases:

- Manual stock changes go through `InventoryService`.
- Every stock add/remove/adjustment creates inventory transactions.
- Product stock becomes a projection from inventory and reservations.
- Warehouse stock is connected to availability.
- Low-stock notifications are emitted and handled.
- Inventory audit history is available for Admin/Seller.

### Phase 7: Pricing, Tax, Commission, Settlement, And Payout

Required use cases:

- Checkout creates immutable pricing snapshot.
- Tax invoice is created from order snapshot.
- Commission is created automatically after payment or delivery event.
- Seller payable records are generated from commission rules.
- Refunds and returns adjust payable and tax credit notes.
- Payout batches close seller payable records.
- Vendor payout, seller payout, settlement, and order snapshot concepts are unified.

### Phase 8: Reviews, Ratings, Analytics, And Jobs

Required use cases:

- Customer can create verified-purchase reviews.
- Admin can moderate reviews.
- Approved reviews update product rating and review count.
- Best seller and trending rollups are generated from real order/analytics data.
- Recommendation refresh job runs.
- Product approval/rejection and low-stock notifications are emitted.

## 9. Backend Validation Commands

Run syntax and backend check:

```bash
cd /home/user/Projects/Ecommerce/backend
node --check src/shared/catalog/public-product-filter.js
node --check src/shared/domain/commerce-constants.js
node --check src/modules/product/models/product.model.js
node --check src/modules/product/models/product-revision.model.js
node --check src/modules/product/repositories/product.repository.js
node --check src/modules/product/services/product.service.js
node --check src/modules/product/controllers/product.controller.js
node --check src/modules/product/routes/product.routes.js
node --check src/modules/product/validation/product.validation.js
node --check src/modules/admin/routes/admin.routes.js
node --check src/modules/admin/repositories/admin.repository.js
node --check src/modules/admin/validation/admin.validation.js
node --check src/shared/services/advanced-search.service.js
node --check src/shared/routes/search.routes.js
node --check src/infrastructure/cron/register-cron.js
npm run check
git diff --check
```

## 10. Notes For Frontend Follow-Up

Frontend should be touched next for:

- Admin revision diff UI using `changedFields` and `draftChanges`.
- Admin moderation queue tab/filter for `change_pending`.
- Seller product status messaging for `draft`, `pending_approval`, `rejected`, and `change_pending`.
- Customer not-found/private product state.
- Customer search facet display refinement if needed.
