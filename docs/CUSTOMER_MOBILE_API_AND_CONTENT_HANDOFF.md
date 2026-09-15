# Customer Mobile App — API and Content Handoff

**Product:** Sam Global customer marketplace  
**Audience:** Android/iOS/React Native/Flutter developers  
**Contract source:** current `backend` and `customer` applications  
**Last audited:** 14 September 2026

> This is the mobile team's implementation map. The backend is the source of truth for request validation and response fields. Use the supplied Postman collection for executable examples: `backend/postman_collection.json` with `backend/postman_environment.json`.

## 1. Environment and transport

| Setting | Value |
|---|---|
| API origin | Supplied separately for development, staging, and production |
| API prefix | `/api/v1` |
| Health check | `GET /health` (no `/api/v1` prefix) |
| JSON header | `Content-Type: application/json` |
| Authentication | `Authorization: Bearer <accessToken>` |
| Image upload | `multipart/form-data`; let the HTTP library create the boundary |
| Default web timeout | 30 seconds |
| Currency/locale | INR / `en_IN` unless returned otherwise |

Never embed a production host, API secret, Razorpay secret, OTP, or bearer token in the app. Keep only public mobile configuration in build-time environment files. Razorpay verification happens on the server.

### Standard envelopes

```json
{
  "success": true,
  "message": "Optional message",
  "data": {},
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 },
  "meta": {}
}
```

```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {},
    "fields": [{ "field": "email", "message": "Email is required" }]
  }
}
```

Do not assume every list uses the same nesting. Normalize `data.items`, `data`, `pagination`, and `meta` in one API layer and preserve unknown response properties for forward compatibility.

### HTTP handling

- `400/422`: invalid input; render field errors when provided.
- `401`: try one refresh, then clear the session and open Login.
- `403`: authenticated but not allowed/account state prevents the action.
- `404`: show a resource-specific empty/not-found state.
- `409`: duplicate or invalid state transition; display the backend message.
- `429`: rate limited; respect `Retry-After` if present.
- `5xx` or network failure: show Retry; automatically retry idempotent GET once only.

## 2. Authentication and secure session

Store tokens in Keychain/Keystore-backed storage (`react-native-keychain`, Expo SecureStore, or platform equivalent), never AsyncStorage/plain preferences. Attach the access token to protected requests.

Refresh algorithm:

1. On an eligible `401`, pause failed protected calls.
2. Make one shared `POST /api/v1/auth/refresh` request with `{ "refreshToken": "..." }`.
3. Save returned tokens and retry each original request once.
4. If refresh fails, clear tokens/user/cache and route to Login.
5. Do not refresh failures from public auth endpoints or retry recursively.

Force logout when the API reports: `USER_NOT_FOUND`, `USER_INACTIVE`, `USER_BLOCKED`, `USER_DELETED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `ROLE_CHANGED`, `ROLE_INACTIVE`, `PERMISSION_REMOVED`, `SESSION_INVALID`, or `FORCE_LOGOUT`.

### Authentication endpoints

| Method and path | Auth | Purpose / request |
|---|---:|---|
| `POST /auth/register` | Public | Email/password buyer registration |
| `POST /auth/register-otp` | Public | Start OTP-based registration |
| `POST /auth/verify-registration` | Public | Complete pending registration |
| `POST /auth/login` | Public | `{ email, password }` |
| `POST /auth/social` | Public | Social identity login; send provider credential required by backend |
| `POST /auth/refresh` | Refresh token | `{ refreshToken }` |
| `POST /auth/send-otp` | Public | Send purpose-specific OTP |
| `POST /auth/resend-otp` | Public | Resend OTP |
| `POST /auth/verify-otp` | Public | Verify OTP and purpose |
| `POST /auth/otp-auth` | Public | OTP login flow |
| `POST /auth/forgot-password` | Public | Start reset flow |
| `POST /auth/reset-password` | Public | Complete reset with OTP/token and new password |
| `POST /auth/change-password` | Bearer | Current and new password |
| `GET /auth/status` | Optional/expired bearer accepted | Validate current session/account status |

Representative registration:

```json
{
  "email": "buyer@example.com",
  "phone": "9876543210",
  "password": "MyPass@123",
  "profile": { "firstName": "Rahul", "lastName": "Sharma" }
}
```

OTP values and test credentials must be obtained from the backend owner for the target environment. Do not ship the historical development OTP shown in old task documents.

## 3. Customer endpoint catalogue

Paths below are relative to `/api/v1`. **Bearer** means login is required; **Optional** means a guest response is supported and may improve when a token is present.

### Home, navigation, catalogue, search and deals

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /home/collection-collages` | Public | Home collection/collage sections |
| `GET /products` | Public | Product listing, filters, sort and pagination |
| `GET /products/discover` | Public | Discovery feed/new/trending-style queries |
| `GET /products/search` | Public | Legacy/direct product search |
| `GET /products/:productId` | Public | Product detail |
| `GET /products/:productId/related` | Public | Related products |
| `GET /products/:productId/cross-sell` | Public | Cross-sell suggestions |
| `GET /products/:productId/up-sell` | Public | Up-sell suggestions |
| `GET /search` | Public | Advanced search, filters and facets |
| `GET /search/autocomplete` | Public | Debounced search suggestions; backend caps results |
| `GET /platform/categories` | Optional | Active category tree/menu |
| `GET /platform/categories/:categoryKey` | Optional | Category detail |
| `GET /platform/categories/:categoryKey/attributes` | Optional | Dynamic category filters |
| `GET /platform/brands` | Optional | Active brands |
| `GET /platform/brands/:brandId` | Optional | Brand detail |
| `GET /platform/collections` | Public | Public collections |
| `GET /platform/collections/:collectionId` | Public | Collection detail |
| `GET /deals/public/placements` | Public | Active promotion placements/banners |
| `GET /deals/public/products` | Public | Products attached to active deals |
| `GET /recommendations` | Optional | Personalized/guest recommendations |
| `GET /recommendations/trending` | Public | Trending products |
| `POST /recommendations/:productId/interact` | Bearer | Record recommendation interaction |

Common listing query keys include `page`, `limit`, `q`, `category`, `brand`, `minPrice`, `maxPrice`, `minRating`, `inStock`, `productType`, `productFamilyCode`, `sort`, and category attributes such as `color`, `size`, `material`, or `attr_<key>`. Send only supported non-empty values. Use stable backend IDs/keys, not display labels.

### Product reviews and media

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /products/:productId/reviews` | Public | Paginated published reviews |
| `GET /products/:productId/my-review` | Bearer | Current customer's review |
| `POST /products/:productId/reviews` | Bearer | Create review after eligible purchase |
| `PATCH /products/:productId/reviews/:reviewId/helpful` | Bearer | Toggle/mark helpful |
| `DELETE /products/:productId/reviews/:reviewId` | Bearer | Delete own review |
| `POST /file-uploader/upload` | Bearer | One image; profile/review evidence |

Upload form fields: binary `file`, `module` (profile currently uses `PROFILES`), and `imageType`/`type`. Images are limited to 10 MB and supported MIME types are enforced by the server. Use the returned `data.url`/`data.imageURL` in the subsequent JSON request.

### Customer profile and addresses

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /users/me` | Bearer | Profile, role and account state |
| `PATCH /users/me` | Bearer | Update editable profile fields |
| `POST /users/me/addresses` | Bearer | Add address |
| `PATCH /users/me/addresses/:addressId` | Bearer | Edit owned address |
| `DELETE /users/me/addresses/:addressId` | Bearer | Delete owned address |
| `GET /global/countries` | Public | Country selection |
| `GET /global/states` | Public | States, filtered by country |
| `GET /global/cities` | Public | Cities, filtered by state |
| `GET /meta/dropdowns/pincodes?cityId=...` | Public | Pincode/area options |

`GET /users/me/addresses` is **not a registered backend route**. Addresses currently arrive inside `GET /users/me`; the web endpoint constant suggesting a separate GET must not be copied into mobile. Add/edit/delete use the routes above.

Representative address:

```json
{
  "label": "home",
  "fullName": "Rahul Sharma",
  "phone": "9876543210",
  "line1": "Flat 4B, Sunrise Apartments",
  "line2": "MG Road",
  "city": "Bengaluru",
  "state": "Karnataka",
  "country": "India",
  "postalCode": "560001",
  "isDefault": true
}
```

### Cart, wishlist and recently viewed

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /carts/me` | Bearer | Server cart and server-backed saved items if returned |
| `PUT /carts/me` | Bearer | Replace/upsert customer cart payload |

Cart example:

```json
{
  "items": [
    {
      "productId": "<mongo-product-id>",
      "variantId": "<optional-mongo-variant-id>",
      "variantSku": "<optional-sku>",
      "quantity": 2
    }
  ]
}
```

The update replaces the submitted item set; remove an item by omitting it, not by sending quantity zero. Always re-render totals, availability and prices returned by the server.

Important parity limitation: guest cart, buy-now selection, checkout selection, recently viewed products, and parts of saved-for-later/watchlist are browser-local in the current customer app. Mobile may store these locally for the same device, but true cross-device wishlist/recent-history sync requires new backend contracts. Do not invent API paths.

### Delivery, quote, checkout and payment

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /delivery/serviceability` | Public | Pincode/product serviceability |
| `GET /delivery/rates` | Public | Delivery rate estimate when needed |
| `POST /orders/quote` | Bearer | Authoritative subtotal, discount, tax, shipping and total |
| `GET /payments/options` | Public | Allowed methods for amount/postal code |
| `POST /orders` | Bearer | Place order |
| `POST /payments/initiate` | Bearer | Create provider payment/order |
| `POST /payments/verify` | Bearer | Server-side verification after SDK success |
| `GET /payments/me` | Bearer | Customer payment history |
| `POST /orders/:orderId/payment/retry` | Bearer | Re-open a failed/pending payment |

Quote/order request shape:

```json
{
  "items": [{ "productId": "<id>", "variantId": "<optional-id>", "quantity": 1 }],
  "shippingAddress": {
    "line1": "Flat 4B",
    "line2": "MG Road",
    "city": "Bengaluru",
    "state": "Karnataka",
    "postalCode": "560001",
    "country": "India"
  },
  "couponCode": "SAVE10",
  "paymentProvider": "razorpay",
  "walletAmount": 0,
  "currency": "INR"
}
```

The quote response—not a client calculation—is authoritative. Re-quote after changing item quantity, variant, address, coupon, wallet amount, or payment method. Payment providers supported by order validation currently include `razorpay`, `cod`, `manual_bank_transfer`, `manual_upi`, and `wallet_only`; display only options returned by `/payments/options`.

Razorpay sequence: place order → initiate payment → open native SDK with the public key/order data returned by the API → send SDK IDs/signature to `/payments/verify` → fetch order again. Treat dismissal and verification failure as payment failure, never as order success.

### Orders, cancellations, returns and documents

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /orders/me` | Bearer | Customer orders with pagination/status/date filters |
| `GET /orders/:orderId` | Bearer | Owned order detail, items, shipments, timeline and documents |
| `POST /orders/:orderId/cancel` | Bearer | Request/carry out eligible cancellation |
| `GET /cancellations` | Bearer | Customer-visible cancellation records (ownership enforced) |
| `GET /cancellations/:cancellationId` | Bearer | Cancellation detail |
| `POST /cancellations/:cancellationId/retry` | Bearer | Retry eligible cancellation processing |
| `POST /returns` | Bearer | Request a return for eligible delivered items |
| `GET /returns/my-returns` | Bearer | Customer return list |
| `GET /returns/order/:orderId` | Bearer | Returns associated with an order |
| `GET /returns/:returnId` | Bearer | Owned return detail/tracking |
| `POST /returns/:returnId/ship-back` | Bearer | Submit manual ship-back details when instructed |
| `GET /returns/:returnId/reverse-shipment/tracking` | Bearer | Reverse logistics tracking |
| `POST /returns/:returnId/qc/dispute` | Bearer | Dispute eligible failed QC |
| `GET /tax/orders/:orderId/invoice` | Bearer | Order receipt/invoice response or download |
| `GET /tax/orders/:orderId/marketplace-invoices` | Bearer | Seller-wise marketplace invoices |
| `GET /tax/invoices/:invoiceId/download` | Bearer | Authenticated PDF download |
| `GET /tax/credit-notes/:creditNoteId/download` | Bearer | Authenticated credit-note PDF |

Cancellation example:

```json
{
  "reason": "I ordered this by mistake",
  "reasonCode": "ordered_by_mistake",
  "refundMethod": "auto"
}
```

Return example:

```json
{
  "orderId": "<order-id>",
  "items": [{
    "productId": "<product-id>",
    "orderItemId": "<order-item-id>",
    "variantId": "<optional-variant-id>",
    "quantity": 1
  }],
  "reason": "defective",
  "resolution": "refund",
  "description": "Item is damaged",
  "photos": ["https://returned-upload-url"]
}
```

Do not decide eligibility from hardcoded status alone. Use actions/eligibility/timestamps returned with the order/return where present, and handle a `409` because another actor may change state between display and submission. Admin-only return routes such as approve, reject, receive, QC, refund, replacement and close are deliberately excluded from customer mobile.

For PDF downloads, send the bearer header, write binary bytes to app-private storage, then use the native share/viewer flow. A plain unauthenticated browser URL may fail.

### Coupon, wallet, loyalty, subscription and warranty

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /wallets/me` | Bearer | Balance and transactions |
| `GET /loyalty/profile` | Bearer | Tier/points profile |
| `GET /loyalty/benefits` | Bearer | Dynamic tier benefits |
| `GET /loyalty/history` | Bearer | Points history |
| `POST /loyalty/redeem` | Bearer | Redeem points |
| `GET /subscriptions/plans` | Public | Available plans |
| `POST /subscriptions/purchase` | Bearer | Buy a plan |
| `GET /subscriptions/me` | Bearer | Customer subscriptions |
| `PUT /subscriptions/:id/pause` | Bearer | Pause eligible subscription |
| `PUT /subscriptions/:id/resume` | Bearer | Resume eligible subscription |
| `PUT /subscriptions/:id/cancel` | Bearer | Cancel eligible subscription |
| `GET /warranty/products/:productId/warranty` | Public | Product warranty terms |
| `POST /warranty/register` | Bearer | Register eligible purchase |
| `GET /warranty/:warrantyId` | Bearer | Warranty detail |
| `GET /warranty/orders/:orderId` | Bearer | Warranties for an order |
| `POST /warranty/:warrantyId/claims` | Bearer | Create claim |

The loyalty `POST /points` endpoint is an internal points-award operation and must not be exposed as a customer control. Do not include admin plan/status endpoints in the app.

Coupon listing under `/pricing/coupons` is protected by order-management permission and is not a buyer discovery endpoint. Customers may enter a coupon code, but eligibility and value must be accepted only from the order quote response.

### Notifications and stock alerts

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /notifications/me` | Bearer | Notification inbox |
| `GET /notifications/preferences` | Bearer | Channel/frequency preferences |
| `PUT /notifications/preferences` | Bearer | Save preferences |
| `POST /stock-notifications` | Optional | Notify-me request for an out-of-stock product/variant |

Notification UI mapping (icons, colors and target screen) is static mobile presentation. Notification title/body, event type, entity ID, read state and created time are dynamic. Deep-link by event/entity metadata and fall back safely to the inbox if an entity no longer exists.

There is currently no customer API to mark an inbox notification read. The web app stores read IDs in browser local storage; mobile can mirror that locally, but cross-device read state needs a new backend endpoint.

Push-token registration is not visible in the current customer endpoint map. Inbox APIs do not by themselves enable APNs/FCM. Backend and mobile owners must agree a device-token lifecycle contract before claiming push support.

### Support and CMS

| Method and path | Auth | Mobile usage |
|---|---:|---|
| `GET /cms` | Public | Published CMS pages |
| `GET /cms/:slug` | Public | Published page by slug |
| `POST /support/ai-chat` | Optional | AI support message/history |
| `GET /support/queries` | Bearer | My tickets |
| `POST /support/queries` | Bearer | Create `{ category, subject, message }` |
| `GET /support/queries/:queryId` | Bearer | Owned ticket detail |
| `POST /support/queries/:queryId/replies` | Bearer | Reply to owned ticket |

CMS slugs should drive policy/information pages where records exist. Render server content defensively: sanitize supported rich text, reject executable HTML, support loading/error/empty states, and cache with revalidation.

## 4. Static versus dynamic ownership

Definitions:

- **Static/app-owned:** bundled visual behavior or copy that needs an app release to change.
- **Dynamic/API-owned:** commerce/account/content data that can change without an app release.
- **Hybrid:** stable component/layout in the app, data supplied by API, with a clearly identified fallback if desired.

| Customer area | Static/app-owned | Dynamic/API-owned | Current status / rule |
|---|---|---|---|
| Splash/onboarding | Layout, animations, permission explanation | Remote maintenance/version flags are not currently contracted | Static until a config API exists |
| Header/bottom tabs | Tab icons, screen routes, interaction | Category menu, unread count, cart count, login state | Hybrid |
| Home hero/deal banners | Carousel component, aspect ratio, placeholder | `/deals/public/placements` | Dynamic; never hardcode active offers |
| Home categories | Card style and fallback image | Category IDs, names, hierarchy, images | Dynamic via platform API |
| Home collections/collages | Layout templates | Collection/collage records and products | Dynamic via home/platform APIs |
| Seasonal block | Component and optional fallback | No dedicated campaign contract found | Currently static (`special.js`); migrate to deals/CMS |
| Product grid/detail | Card/gallery/selector UI | Product, variants, stock, media, price, tax hints, reviews | Dynamic |
| Sort/filter controls | Control UI and generic labels | Category attributes/facets and available values | Hybrid; do not hardcode category filters |
| Cart/checkout | Screen layout and validation UX | Cart, stock, prices, quote, coupon, tax, shipping, methods | Dynamic; totals always server-owned |
| Guest cart/buy now | Local model/expiry rules | No guest sync API | Currently local-only |
| Wishlist/watchlist | Icons and empty state | No complete dedicated backend contract found | Currently local/partial; backend work needed for cross-device |
| Recently viewed | Section UI | No history endpoint found | Currently local-only |
| Profile/addresses | Form layout and labels | User and address values | Dynamic |
| Orders/returns | Timeline presentation and status color map | Status, allowed actions, shipments, totals, documents | Hybrid; state is server-owned |
| Cancellation reasons | Presentation | No customer reason lookup wired | Currently static; backend supports validated codes |
| Return reasons/statuses | Presentation | `GET /meta/dropdowns/return-reasons` and `return-statuses` are available | Prefer dynamic dropdowns |
| Notifications | Event-to-icon/navigation map | Inbox payload/read state/time | Hybrid |
| Wallet/loyalty | Layout, formatting | Balance, tier, benefits, transactions | Dynamic |
| Support topics/FAQ | Topic icons and fallback UI | CMS/support records where configured | Hybrid; web contains fallback copy |
| Policy pages | Native renderer/navigation | `/cms/:slug` content | Dynamic; CMS is source of truth |
| About/contact/download app | Layout/icons | No single public settings contract found | Mostly static today; contact/app links need approved values |
| Footer/about links | Navigation presentation | CMS record key `footer-links` may override some data | Hybrid; web currently has static fallbacks/placeholders |
| SEO metadata | Not relevant to native presentation | Optional deep-link/share metadata | Web-only unless used for sharing |

### Static values the mobile team may safely own

- Navigation structure, icons, spacing, typography, theme tokens and accessibility labels.
- Loading skeletons, empty/error/offline states and generic button labels.
- Mapping of backend status/event keys to localized display labels, colors and icons, with an unknown/default case.
- Page-size defaults, debounce duration and local cache duration within backend limits.
- Image placeholders and fallback illustrations.
- Local validation that mirrors server rules, while the server remains authoritative.

### Values that must never be hardcoded as business truth

- Product/category/brand/collection IDs or names.
- Product price, discount, availability, inventory, delivery date, shipping charge, tax or final total.
- Active deal/banner/coupon and its dates or eligibility.
- Wallet balance, loyalty points/tier/benefits, subscription state or warranty entitlement.
- Order/return/refund status or which actions are currently allowed.
- Customer profile, addresses, notifications and support tickets.
- Policy/legal/FAQ text when a published CMS record exists.
- Payment availability, COD eligibility, Razorpay order ID or payment success.

### Known placeholder/fallback content requiring product approval

The web app currently contains values that mobile must not present as confirmed production facts without approval:

- Support phone `+91 1234567890`.
- Support email `support@samglobal.com`.
- App Store, Play Store and social links using `#`.
- Seller dashboard using a raw IP URL.
- Static seasonal Navratri/Mother's Day-style cards.
- Static support FAQs and topic fallbacks.
- Footer benefit wording such as a fixed `10 days` return promise.
- Site title contains the apparent typo `rewardsffff` (web SEO only).

Obtain approved contact, store and social URLs from the product owner or expose them through CMS/public configuration before release.

## 5. Screen-to-API build checklist

| Screen/flow | Required APIs | Auth |
|---|---|---:|
| Launch/session restore | `/auth/status`, `/auth/refresh` | Mixed |
| Register/login/OTP/reset | Auth endpoints in §2 | Public |
| Home | home collages, categories, deal placements/products, products/discover, recommendations | Mostly public |
| Category/brand/search | categories/attributes, brands, products or advanced search/autocomplete | Public |
| Product detail | product, related/cross/up-sell, reviews, serviceability, warranty | Mixed |
| Cart | `GET/PUT /carts/me` | Bearer |
| Checkout | user profile/addresses, serviceability, quote, payment options, order create | Bearer except lookups |
| Payment result | initiate/verify, then order detail | Bearer |
| Account/security | user me/update, profile upload, change password | Bearer |
| Orders/detail/tracking | orders me/detail and authenticated documents | Bearer |
| Cancel/return/refund | cancel, cancellations, return create/list/detail/tracking/dispute | Bearer |
| Wishlist/recent | local storage pending dedicated backend | Local |
| Notifications/preferences | notification endpoints | Bearer |
| Wallet/rewards | wallet and loyalty endpoints | Bearer |
| Subscription/warranty | subscription and warranty endpoints | Mixed |
| Support | AI chat, tickets/replies, CMS FAQ/help records | Mixed |
| Policies/about | CMS by slug with approved static fallback | Public |

Every asynchronous screen needs loading, pull-to-refresh where useful, empty, recoverable error, offline and expired-session states. Disable duplicate mutation taps and show server messages without exposing stack traces/internal details.

## 6. Mobile data and UX rules

- Treat IDs as opaque strings; the system uses both Mongo-style IDs and UUIDs.
- Use ISO-8601 timestamps from the API and format in the device locale/timezone.
- Format money using returned currency and minor/major-unit semantics verified from the response; never use floating-point arithmetic for checkout totals.
- Resolve relative media URLs against the API/static origin; allow HTTPS in production.
- Use cursor/page metadata returned by each endpoint; deduplicate list items by stable ID.
- Debounce autocomplete/search around 300 ms and cancel stale requests.
- Cache public catalogue/CMS reads briefly; do not persist sensitive account/payment responses unnecessarily.
- Clear authenticated cache on logout or user change.
- Do not log tokens, OTPs, addresses, phone/email, payment signatures or complete API bodies in production.
- Accessibility: dynamic type, screen-reader labels, 44pt/48dp tap targets, sufficient contrast, and announced loading/errors.
- Localize UI strings. Preserve backend enum keys in API requests; translate only their visible labels.

## 7. Realtime and deep links

The web app contains a Socket.IO client. Mobile can use realtime as an enhancement for order, notification, support, return and payment refresh, but REST remains the recovery/source-of-truth path. Reconnect with backoff, re-authenticate after token refresh, and fetch the affected entity after receiving an event.

Recommended deep-link targets:

- Product ID/public code → product detail.
- Order ID → owned order detail.
- Return ID → owned return detail.
- Support query ID → owned ticket detail.
- Notification without a valid entity → notification inbox.

Never trust a deep link as authorization; the API must enforce ownership.

## 8. Items requiring backend/product confirmation before release

- Environment base URLs, certificate/TLS policy and production CORS/native access expectations.
- Final buyer test account and environment-specific OTP/email behavior.
- Exact social-login providers, mobile client IDs and token payload contract.
- APNs/FCM device-token registration/unregistration API.
- Dedicated cross-device wishlist and recently-viewed APIs.
- Approved support phone/email, legal company details, social links and app-store URLs.
- CMS slug inventory for FAQ, privacy, terms, shipping, returns/refunds, seller policy, about and contact.
- Which recommendation interaction event keys mobile should emit.
- Razorpay native SDK public key source, callback handling and test/live rollout.
- Whether a new buyer-facing coupon discovery endpoint is required; the current coupon listing is management-only.
- Final analytics mobile event taxonomy and consent/privacy requirements.

## 9. Definition of done for mobile handoff

- [ ] Dev/staging/prod origins supplied outside source control.
- [ ] Postman collection runs successfully against the target environment.
- [ ] Secure token storage and single-flight refresh tested.
- [ ] Guest and authenticated navigation states implemented.
- [ ] Catalogue → detail → cart → quote → order → payment works end to end.
- [ ] COD and Razorpay outcomes are both handled when enabled.
- [ ] Order cancellation, return creation/tracking and invoice download tested.
- [ ] CMS policies and approved fallback/contact values reviewed by product/legal.
- [ ] Static-local limitations (wishlist, recent history, guest cart) accepted or backend tickets created.
- [ ] Loading, empty, error, offline, retry and session-expired states tested.
- [ ] Logs and analytics contain no secrets or unnecessary personal/payment data.
- [ ] Android and iOS deep links, upload permissions, file download/share and payment callbacks tested.

## 10. Source references for maintainers

- Customer endpoint map: `customer/src/api/endpoints.js`
- Customer API/session behavior: `customer/src/api/client.js`, `customer/src/api/tokenStorage.js`
- Customer static data: `customer/src/data/`, `customer/src/constants/`, `customer/src/config/`
- Backend route registration: `backend/src/api/register-routes.js`
- Backend per-module routes and validation: `backend/src/modules/*/routes/`, `backend/src/modules/*/validation/`
- Standard response helpers: `backend/src/shared/http/reply.js`
- Executable API examples: `backend/postman_collection.json`, `backend/postman_environment.json`
- Smaller coding-test brief (not the production source of truth): `backend/docs/RN_TASK_SHEET.md`

When this document and running validation differ, update this document in the same change as the backend contract and regenerate/sync the Postman collection.
