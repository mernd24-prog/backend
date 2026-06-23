# React Native Developer — Machine Test Task Sheet
**Experience Level:** 2–3 Years | **Duration:** 4–6 Hours | **Platform:** React Native (CLI or Expo)

---

## Overview

Build a **React Native mobile app** that integrates with the existing Ecommerce REST API. The app should cover four key buyer-facing flows: Home, Checkout, Orders, and Returns. You will be evaluated on code quality, API integration, state management, UI/UX polish, and error handling — not just whether the screens "show up."

---

## Base API Contract

```
Base URL:    http://<PROVIDED_HOST>/api/v1
Auth Header: Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Standard success response:**
```json
{
  "success": true,
  "message": "...",
  "data": {},
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

**Standard error response:**
```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "error": { "details": { "fields": [{ "field": "email", "message": "..." }] } }
}
```

> Token refresh: on a `401`, call `POST /auth/refresh` with `{ refreshToken }` and retry once automatically.

---

## Task 1 — Authentication (Prerequisite)

### Screens
- **Login Screen** — email + password login
- **Register Screen** — first name, last name, email, phone, password

---

### POST `/auth/register`

```json
{
  "email": "buyer@example.com",
  "phone": "9876543210",
  "password": "MyPass@123",
  "profile": {
    "firstName": "Rahul",
    "lastName": "Sharma"
  }
}
```

| Field | Type | Rules |
|-------|------|-------|
| `email` | string | required · valid email format |
| `phone` | string | required · min 10, max 15 chars |
| `password` | string | required · min 8, max 64 chars |
| `profile.firstName` | string | required · min 2, max 50 chars |
| `profile.lastName` | string | required · min 2, max 50 chars |

**On success:** returns `{ accessToken, refreshToken, user }`. Store tokens in secure storage.

> **Note:** Registration may require OTP verification. After register, call `POST /auth/verify-otp` with `{ email, otp, purpose: "registration" }`. Dev OTP is `123456`.

---

### POST `/auth/login`

```json
{
  "email": "buyer@test.com",
  "password": "Test@1234"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `email` | string | required · valid email format |
| `password` | string | required |

**On success:** returns `{ accessToken, refreshToken, user }`.

---

### POST `/auth/refresh`

```json
{
  "refreshToken": "<your_refresh_token>"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `refreshToken` | string | required |

**On success:** returns new `{ accessToken, refreshToken }`.

---

### GET `/auth/status`

No body. Requires `Authorization: Bearer <accessToken>` header.

---

### POST `/auth/send-otp`

```json
{
  "email": "buyer@example.com",
  "purpose": "registration"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `email` | string | required · valid email |
| `purpose` | string | `"registration"` \| `"forgot_password"` \| `"login"` · default `"registration"` |

---

### POST `/auth/verify-otp`

```json
{
  "email": "buyer@example.com",
  "otp": "123456",
  "purpose": "registration"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `email` | string | required · valid email |
| `otp` | string | required · exactly 6 characters |
| `purpose` | string | `"registration"` \| `"forgot_password"` \| `"login"` |

---

### POST `/auth/forgot-password`

```json
{
  "email": "buyer@example.com"
}
```

---

### POST `/auth/reset-password`

```json
{
  "email": "buyer@example.com",
  "otp": "123456",
  "newPassword": "NewPass@456"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `email` | string | required · valid email |
| `otp` | string | required · exactly 6 characters |
| `newPassword` | string | required · min 8, max 64 chars |

---

### Requirements
- Store `accessToken` and `refreshToken` in secure storage (`expo-secure-store` or `react-native-keychain`)
- Implement auto token refresh (intercept 401 → refresh → retry)
- Persist auth state across app restarts
- Navigate to Home on success, show field-level validation errors on failure

---

## Task 2 — Home Screen

### Goal
Display a discoverable product feed with category navigation and search.

### APIs

#### GET `/products?page=1&limit=20`
No body. Query params:

| Param | Type | Notes |
|-------|------|-------|
| `page` | number | default 1 |
| `limit` | number | default 20 |
| `category` | string | category ID |
| `brand` | string | brand ID |
| `minPrice` | number | minimum price filter |
| `maxPrice` | number | maximum price filter |
| `sort` | string | `price_asc` \| `price_desc` \| `newest` |

#### GET `/products/search?q=<term>`
No body. Pass search keyword as `q` query param.

#### GET `/platform/categories`
No body. Returns category tree for filter chips.

---

### Requirements
- **Category chips** — horizontally scrollable, tap to filter the product list
- **Product grid** — 2-column card layout showing: image, name, price (with discount if applicable), rating
- **Search bar** — debounced (300 ms), calls `/products/search` as user types
- **Infinite scroll / pagination** — load next page on scroll end
- **Pull-to-refresh**
- Tapping a product card navigates to the **Product Detail Screen**

### Product Detail Screen
- Images carousel / swiper
- Name, description, price, discount percentage
- Variant selector (size, color) if product has variants
- **Add to Cart** button — calls `PUT /carts/me`
- Stock / availability badge

---

## Task 3 — Cart & Checkout Screen

### Cart Screen

#### GET `/carts/me`
No body. Returns the current user's cart.

#### PUT `/carts/me` — Add / Update / Remove Items

```json
{
  "items": [
    {
      "productId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "variantId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "quantity": 2
    }
  ]
}
```

| Field | Type | Rules |
|-------|------|-------|
| `items` | array | required · replaces the entire cart |
| `items[].productId` | string | required · 24-char MongoDB ObjectId |
| `items[].variantId` | string | optional · 24-char MongoDB ObjectId |
| `items[].variantSku` | string | optional |
| `items[].quantity` | number | required · integer · min 1 |

> **Remove an item:** exclude it from the `items` array entirely (do not send `quantity: 0`).

**Requirements:**
- List cart items with image, name, quantity stepper (+/−), unit price, line total
- Show cart subtotal at the bottom
- Empty cart state with CTA to browse products
- "Proceed to Checkout" button

---

### Checkout Screen

**Flow:** Address → Payment Method → Review → Place Order → Payment → Confirmation

#### Step 1 — Address

##### GET `/users/me/addresses`
No body. Returns saved addresses.

##### POST `/users/me/addresses`

```json
{
  "label": "home",
  "fullName": "Rahul Sharma",
  "phone": "9876543210",
  "line1": "Flat 4B, Sunrise Apartments",
  "line2": "MG Road",
  "city": "Bangalore",
  "state": "Karnataka",
  "country": "India",
  "postalCode": "560001",
  "isDefault": true
}
```

| Field | Type | Rules |
|-------|------|-------|
| `label` | string | `"home"` \| `"work"` \| `"other"` · default `"home"` |
| `fullName` | string | required |
| `phone` | string | required · min 10, max 15 chars |
| `line1` | string | required |
| `line2` | string | optional |
| `city` | string | required |
| `state` | string | required |
| `country` | string | default `"India"` |
| `postalCode` | string | required · min 5, max 10 chars |
| `isDefault` | boolean | default `false` |

---

#### Step 2 — Order Quote

##### POST `/orders/quote`

```json
{
  "items": [
    {
      "productId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "variantId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "quantity": 1
    }
  ],
  "shippingAddress": {
    "line1": "Flat 4B, Sunrise Apartments",
    "line2": "MG Road",
    "city": "Bangalore",
    "state": "Karnataka",
    "postalCode": "560001",
    "country": "India"
  },
  "couponCode": "SAVE10",
  "paymentProvider": "razorpay"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `items` | array | required · min 1 item |
| `items[].productId` | string | required · 24-char ObjectId |
| `items[].variantId` | string | optional |
| `items[].quantity` | number | required · integer · min 1 |
| `shippingAddress.line1` | string | required |
| `shippingAddress.city` | string | required |
| `shippingAddress.state` | string | required |
| `shippingAddress.postalCode` | string | required |
| `shippingAddress.country` | string | required |
| `couponCode` | string | optional · auto-uppercased |
| `paymentProvider` | string | `"razorpay"` \| `"cod"` \| `"wallet_only"` |

**Response:** `{ subtotal, discount, shipping, tax, total, quoteId }`

---

#### Step 3 — Payment Options

##### GET `/payments/options?orderAmount=999&postalCode=560001`
No body. Query params:

| Param | Type | Notes |
|-------|------|-------|
| `orderAmount` | number | used to check COD eligibility |
| `postalCode` | string | used for serviceability check |

**Response:** list of available payment methods (Razorpay, COD, etc.)

---

#### Step 4 — Place Order

##### POST `/orders`

```json
{
  "items": [
    {
      "productId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "variantId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "quantity": 1
    }
  ],
  "shippingAddress": {
    "line1": "Flat 4B, Sunrise Apartments",
    "line2": "MG Road",
    "city": "Bangalore",
    "state": "Karnataka",
    "postalCode": "560001",
    "country": "India"
  },
  "paymentProvider": "razorpay",
  "couponCode": "SAVE10",
  "walletAmount": 0,
  "currency": "INR"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `items` | array | required · min 1 item (same structure as quote) |
| `shippingAddress` | object | required · same fields as quote |
| `paymentProvider` | string | `"razorpay"` \| `"cod"` \| `"manual_bank_transfer"` \| `"manual_upi"` \| `"wallet_only"` · default `"razorpay"` |
| `couponCode` | string | optional |
| `walletAmount` | number | optional · min 0 · default 0 |
| `currency` | string | default `"INR"` |

**Response:** `{ orderId, paymentRequired, paymentDetails }`

---

#### Step 5 — Payment (online only)

##### POST `/payments/initiate`

```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "provider": "razorpay",
  "currency": "INR"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `orderId` | string | required · UUID v4 format |
| `provider` | string | required · `"razorpay"` \| `"cod"` \| `"manual_bank_transfer"` \| `"manual_upi"` \| `"wallet_only"` |
| `currency` | string | default `"INR"` |
| `amount` | number | optional · positive number |

**Response:** Razorpay order details needed to open the SDK payment sheet.

##### POST `/payments/verify`

Call this after the Razorpay SDK returns a successful payment callback.

```json
{
  "provider": "razorpay",
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "razorpayOrderId": "order_ABC123xyz",
  "razorpayPaymentId": "pay_XYZ789abc",
  "razorpaySignature": "abc123def456..."
}
```

| Field | Type | Rules |
|-------|------|-------|
| `provider` | string | required · must be `"razorpay"` |
| `orderId` | string | required · UUID v4 (your internal order ID) |
| `razorpayOrderId` | string | required · from Razorpay response |
| `razorpayPaymentId` | string | required · from Razorpay callback |
| `razorpaySignature` | string | required · from Razorpay callback |

---

#### Step 6 — Confirmation Screen
- Success/failure state
- Order ID display
- "View Order" and "Continue Shopping" CTAs

---

## Task 4 — Orders Screen

### Orders List

#### GET `/orders/me?page=1&limit=10`
No body. Query params:

| Param | Type | Notes |
|-------|------|-------|
| `page` | number | pagination page |
| `limit` | number | items per page · max 200 |
| `status` | string | filter by order status (see values below) |
| `fromDate` | string | ISO date string |
| `toDate` | string | ISO date string |

Display each order: order ID, date, status badge, item count, total amount.

**Order status values:** `pending_payment`, `confirmed`, `packed`, `shipped`, `delivered`, `fulfilled`, `return_requested`, `partially_returned`, `returned`, `cancelled`

---

### Order Detail Screen

#### GET `/orders/:orderId`
No body. Pass `orderId` as path param.

Display:
- Order header (ID, date, status, timeline/stepper)
- Items list with image, name, quantity, price
- Delivery address
- Payment summary (subtotal, tax, shipping, total)
- **Cancel Order** button (only if status is `pending_payment` or `confirmed`)
- **Request Return** button (only if status is `delivered`)

---

### Cancel Order

#### POST `/orders/:orderId/cancel`

```json
{
  "reason": "I ordered by mistake and no longer need this item",
  "reasonCode": "ordered_by_mistake"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `reason` | string | required · min 3, max 500 chars |
| `reasonCode` | string | `"changed_mind"` \| `"ordered_by_mistake"` \| `"address_issue"` \| `"payment_issue"` \| `"delivery_delay"` \| `"pricing_issue"` \| `"other"` · default `"other"` |
| `refundMethod` | string | optional · `"auto"` \| `"original_source"` \| `"wallet"` \| `"manual"` · default `"auto"` |

---

## Task 5 — Returns Screen

### Return Request

#### POST `/returns`

```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "items": [
    {
      "productId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "orderItemId": "64f1a2b3c4d5e6f7a8b9c0d3",
      "variantId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "quantity": 1
    }
  ],
  "reason": "defective",
  "resolution": "refund",
  "description": "The product stopped working after one day of use."
}
```

| Field | Type | Rules |
|-------|------|-------|
| `orderId` | string | required |
| `items` | array | required · min 1 item |
| `items[].productId` | string | required |
| `items[].orderItemId` | string | optional (include if available from order detail) |
| `items[].variantId` | string | optional |
| `items[].quantity` | number | required · positive integer |
| `reason` | string | required · one of the enum values below |
| `resolution` | string | `"refund"` \| `"replacement"` \| `"exchange"` \| `"store_credit"` · default `"refund"` |
| `description` | string | optional · max 1000 chars |
| `photos` | string[] | optional · array of image URLs |

**Reason enum values:**
`"defective"` · `"damaged_in_transit"` · `"wrong_item"` · `"missing_parts"` · `"size_issue"` · `"quality_issue"` · `"not_as_described"` · `"changed_mind"` · `"other"`

---

### My Returns List

#### GET `/returns/my-returns`
No body. Returns all return requests for the logged-in buyer.

**Return status values:** `requested`, `approved`, `rejected`, `reverse_pickup_scheduled`, `shipped_back`, `received`, `qc_passed`, `qc_failed`, `refund_pending`, `refunded`, `replaced`, `closed`

### Screens
1. **Return Request Form** — item selector from delivered order, reason dropdown, description, resolution choice (Refund / Replacement)
2. **My Returns List** — status badge, return ID, date

---

## Technical Requirements

### Mandatory

- **State Management** — Redux Toolkit or Zustand (justify your choice in README)
- **Navigation** — React Navigation v6 (stack + bottom tabs)
- **API Layer** — centralized Axios instance with interceptors for auth and refresh
- **Loading States** — skeleton loaders or activity indicators on every async call
- **Error Handling** — user-visible error messages for network/API failures
- **Form Validation** — inline field-level errors using React Hook Form + Zod/Yup

### Bonus (evaluated if core is complete)
- Coupon code input on checkout quote step
- Deep link to order detail from notification tap
- Animated cart icon badge counter
- Offline-aware UX (detect no network, show banner)
- Unit tests for at least one reducer/service using Jest

---

## Evaluation Criteria

| Area | Weight |
|------|--------|
| API integration correctness (auth, cart, checkout flow) | 30% |
| TypeScript usage and type safety | 20% |
| State management approach and code organization | 20% |
| UI polish, loading/error/empty states | 15% |
| Token refresh, error handling, edge cases | 15% |

---

## Submission Checklist

- [ ] README with setup instructions, env vars needed, and tech choices
- [ ] `.env.example` with `API_BASE_URL`
- [ ] App runs on Android emulator or physical device without manual patching
- [ ] Auth flow works end-to-end (login → home)
- [ ] Cart add and remove works
- [ ] Checkout reaches order placement (COD is acceptable if Razorpay keys not provided)
- [ ] Orders list and detail load correctly
- [ ] Return request form submits successfully

---

## Provided Test Credentials

```
Email:    buyer@test.com
Password: Test@1234
Base URL: http://<HOST_WILL_BE_PROVIDED>/api/v1
```

> Static OTP for phone verification is `123456` in the development environment.

---

*Good luck! Focus on correctness and clean code over covering every bonus point.*
