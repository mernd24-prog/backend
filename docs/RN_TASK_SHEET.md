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
- **Register Screen** — name, email, phone, password

### APIs
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/register` | `{ name, email, phone, password }` |
| POST | `/auth/refresh` | `{ refreshToken }` |
| GET | `/auth/status` | — (Bearer token) |

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
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/products?page=1&limit=20` | Product listing with pagination |
| GET | `/products/search?q=<term>` | Search products by keyword |
| GET | `/platform/categories` | Category tree for filter chips |

### Key Query Params for `/products`
```
page, limit, category, brand, minPrice, maxPrice, sort (price_asc / price_desc / newest)
```

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

**API:**
```
GET  /carts/me               — fetch current user's cart
PUT  /carts/me               — upsert (add/update/remove items)
```

**PUT /carts/me body:**
```json
{
  "items": [
    { "productId": "abc123", "variantId": "v1", "quantity": 2 }
  ]
}
```

**Requirements:**
- List cart items with image, name, quantity stepper (+/−), unit price, line total
- Remove item (set quantity to 0)
- Show cart subtotal at the bottom
- Empty cart state with CTA to browse products
- "Proceed to Checkout" button

---

### Checkout Screen

**Flow:** Address → Payment Method → Review → Place Order → Payment → Confirmation

#### Step 1 — Address
```
GET  /users/me/addresses          — list saved addresses
POST /users/me/addresses          — add new address
```

Address fields: `name, phone, line1, line2, city, state, pincode, country`

#### Step 2 — Order Quote (price summary before placing)
```
POST /orders/quote
Body: { items: [{ productId, variantId, quantity }], addressId, couponCode? }
```
Display: subtotal, discount, shipping, tax, total

#### Step 3 — Payment Options
```
GET /payments/options            — list available payment methods
```
Show: Razorpay (online), COD (if available)

#### Step 4 — Place Order
```
POST /orders
Body: {
  items: [...],
  addressId: "...",
  paymentMethod: "razorpay" | "cod",
  couponCode?: "...",
  quoteId?: "..."
}
```
Response: `{ orderId, paymentRequired, paymentDetails }`

#### Step 5 — Payment (for online payment)
```
POST /payments/initiate   Body: { orderId }
POST /payments/verify     Body: { orderId, razorpayPaymentId, razorpaySignature }
```
Integrate **Razorpay React Native SDK** for the payment sheet.

#### Step 6 — Confirmation Screen
- Success/failure state
- Order ID display
- "View Order" and "Continue Shopping" CTAs

---

## Task 4 — Orders Screen

### Orders List
```
GET /orders/me?page=1&limit=10
```

Display each order: order ID, date, status badge, item count, total amount

**Order status values:** `pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`

### Order Detail Screen
```
GET /orders/:orderId
```

Display:
- Order header (ID, date, status, timeline/stepper)
- Items list with image, name, quantity, price
- Delivery address
- Payment summary (subtotal, tax, shipping, total)
- **Cancel Order** button (only if status is `pending` or `confirmed`)
  ```
  POST /orders/:orderId/cancel   Body: { reason }
  ```
- **Request Return** button (only if status is `delivered`)

---

## Task 5 — Returns Screen

### Return Request
```
POST /returns
Body: {
  orderId: "...",
  items: [{ orderItemId: "...", quantity: 1, reason: "..." }],
  reason: "defective" | "wrong_item" | "not_needed" | "other",
  description: "...",
  resolution: "refund" | "replacement",
  photos: []
}
```

### My Returns List
```
GET /returns/my-returns
```

### Screens
1. **Return Request Form** — item selector from delivered order, reason dropdown, description, resolution choice (Refund / Replacement)
2. **My Returns List** — status badge (requested, approved, rejected, completed), return ID, date

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
