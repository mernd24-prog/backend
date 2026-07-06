# Influencer React Native API

Base path: `/api/v1` (or the configured `API_PREFIX`). Responses use `{ success, data, pagination? }`.

## Authentication

`POST /auth/influencer/login`

```json
{
  "email": "creator@example.com",
  "password": "the influencer password"
}
```

The response contains `data.tokens.accessToken`, `data.tokens.refreshToken`, and
`data.influencer`. Store the tokens with the same secure-storage flow used for a
buyer account. Send `Authorization: Bearer <accessToken>` to every endpoint below.

An admin-created influencer is also a normal buyer user. If the admin created the
user without supplying a password, the create-influencer response contains a
one-time `temporaryPassword` that must be delivered securely to that influencer.

Use `POST /auth/refresh` with `{ "refreshToken": "..." }` to renew the session.

## Session and analytics

- `GET /influencer/referral/session` — status and feature access; works for pending/suspended profiles.
- `GET /influencer/referral/profile` — active influencer profile, KYC, payout setup and primary code.
- `GET /influencer/referral/dashboard/summary` — earnings, orders, wallet, chart and bonus targets.
- `GET /influencer/referral/codes?page=1&limit=20`
- `GET /influencer/referral/orders?page=1&limit=20`
- `GET /influencer/referral/ledger?page=1&limit=20`
- `GET /influencer/referral/wallet`
- `GET /influencer/referral/bonus-progress?page=1&limit=20`
- `GET /influencer/referral/network?page=1&limit=20`
- `GET /influencer/referral/withdrawals?page=1&limit=20`
- `POST /influencer/referral/withdrawals`

The session response's `canAccessAnalytics` flag should gate analytics screens.
Pending, suspended, or rejected influencers can sign in and see their status, but
active-only analytics endpoints return `403` until the profile is active.

## Customer checkout

Send either a normal coupon or influencer code in the existing `couponCode` field
on `POST /orders/quote` and `POST /orders`. The quote returns
`quote.discountSource` (`coupon` or `influencer`) and
`quote.referralDiscountAmount` for influencer-code discounts.
