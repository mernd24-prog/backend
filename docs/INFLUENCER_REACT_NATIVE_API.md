# Influencer Parent and Child API

Base URL: `{{baseUrl}}/api/v1`  
Development URL: `http://192.168.16.47:4000/api/v1`

Influencer accounts are separate from the main user model. Admin creates the account, login email, referral identity/code, type, hierarchy and initial password. The influencer can update personal, address, KYC-document and payout details. Email, referral code, hierarchy, type and approval statuses remain Admin-controlled.

## Quick start

1. Import `influencer_postman_collection.json` and `influencer_postman_environment.json`.
2. Select the environment and set `parentEmail`, `parentPassword`, `childEmail`, and `childPassword`.
3. Run Parent Login or Child Login. The collection saves the corresponding access and refresh tokens automatically.
4. Run Session. Render navigation only from `data.allowedModules`.
5. Use the Parent or Child folder for the selected account type.

## Authentication

### Login

`POST /auth/influencer/login`

```json
{
  "email": "parent@example.com",
  "password": "StrongPassword123!"
}
```

Successful responses contain `data.tokens.accessToken`, `data.tokens.refreshToken`, and `data.influencer`. Send the access token as `Authorization: Bearer <token>`.

### Refresh token

`POST /auth/refresh`

```json
{ "refreshToken": "<refresh token>" }
```

Replace both locally stored tokens if the response rotates them. A `401 TOKEN_INVALID` requires login again.

## Access matrix

| API/module | Parent | Child | Notes |
|---|---:|---:|---|
| Session | Yes | Yes | Source of truth for allowed modules |
| Dashboard | Yes | Yes | Actor-scoped summary, charts and recent orders |
| Analytics | Yes | Yes | Parent response can include child-network analytics |
| Codes | Yes | Yes | Only codes owned by the logged-in influencer |
| Orders | Yes | Yes | Only attributed referral orders |
| Ledger/Earnings | Yes | Yes | Only the actor's coin ledger |
| Wallet | Yes | Yes | Actor wallet only |
| Withdrawals | Yes | Yes | Actor requests only |
| Bonus progress | Yes | Yes | Actor-scoped eligible bonus rules |
| Profile read/update | Yes | Yes | Cannot change email/code/type/hierarchy/status |
| Network/My Children | Parent only | No | Requires `canCreateChildren=true` |
| Child analytics | Parent only | No | Returned through Analytics/Network |

Inactive influencers receive only the Profile module in Session. Active-only endpoints return `403` for pending, suspended or rejected profiles.

## Endpoints

### Session

`GET /influencer/referral/session`

Returns `influencerType`, status, primary code, `allowedModules`, and the available API map. Do not maintain a static parent/child sidebar.

### Dashboard

`GET /influencer/referral/dashboard/summary?fromDate=2026-08-01&toDate=2026-08-31&code=CODE`

Returns backend-calculated summary cards, wallet, daily earnings, order-status breakdown, bonus targets, recent referral orders and code performance.

### Analytics

`GET /influencer/referral/analytics?fromDate=2026-08-01&toDate=2026-08-31&code=CODE`

Returns summary, daily earnings, status breakdown, code performance, recent orders and—only for eligible parents—network summary and top children.

### Codes

`GET /influencer/referral/codes?page=1&limit=20&status=active&code=CODE`

Optional filters: `fromDate`, `toDate`, `status`, and `code`. Maximum `limit` is 100.

### Referral orders

`GET /influencer/referral/orders?page=1&limit=20&status=completed&coinStatus=available&code=CODE`

Statuses: `pending`, `completed`, `cancelled`, `refunded`, `reversed`, `locked`, `available`. Maximum `limit` is 100.

### Earnings ledger

`GET /influencer/referral/ledger?page=1&limit=20&status=available&commissionType=code_owner_base`

Other filters: `transactionType`, `code`, `orderId`, `fromDate`, `toDate`.

### Wallet

`GET /influencer/referral/wallet`

Returns locked, available, withdrawn, reversed and pending-withdrawal values plus minimum withdrawal rules.

### List withdrawals

`GET /influencer/referral/withdrawals?page=1&limit=20&status=pending`

### Request withdrawal

`POST /influencer/referral/withdrawals`

Bank example:

```json
{
  "amount": 500,
  "payoutMethod": "bank",
  "bankAccountId": "primary-bank",
  "metadata": { "note": "August payout" }
}
```

UPI example:

```json
{
  "amount": 500,
  "payoutMethod": "upi",
  "upiId": "creator@upi"
}
```

The amount must be positive, within the available balance, and comply with the configured minimum withdrawal amount.

### Bonus progress

`GET /influencer/referral/bonus-progress?page=1&limit=20&referenceDate=2026-08-10`

Optional `ruleId` restricts the response to one rule.

### Parent network

`GET /influencer/referral/network?page=1&limit=20&status=active&code=CHILDCODE`

Parent-only. Returns the parent snapshot, aggregate child metrics and paginated direct children. A child account must hide this module and must not call this endpoint.

### Profile

`GET /influencer/referral/profile`

### Update profile

`PATCH /influencer/referral/profile`

```json
{
  "firstName": "Asha",
  "lastName": "Sharma",
  "phone": "+919876543210",
  "avatarUrl": "https://cdn.example.com/profile.jpg",
  "dateOfBirth": "1995-05-18",
  "gender": "female",
  "address": {
    "line1": "12 Market Road",
    "line2": "Near Central Mall",
    "country": "India",
    "state": "Delhi",
    "city": "New Delhi",
    "postalCode": "110001"
  },
  "documents": {
    "panCardUrl": "https://cdn.example.com/pan.pdf",
    "aadhaarCardUrl": "https://cdn.example.com/aadhaar.pdf",
    "cancelledChequeUrl": "https://cdn.example.com/cheque.pdf"
  },
  "payout": {
    "method": "bank",
    "accountHolderName": "Asha Sharma",
    "bankName": "Example Bank",
    "accountNumber": "1234567890",
    "ifscCode": "EXAMPLE0001",
    "upiId": ""
  }
}
```

Document or payout updates set the corresponding review status to submitted. Admin reviews and approves them.

## Pagination and errors

List endpoints return data plus pagination metadata. Use the returned `page`, `limit`, `total`, and `totalPages`; never request more than 100 from Influencer list APIs.

Common responses:

- `400 VALIDATION_ERROR` — invalid query/body; show field errors from `error.details.fields`.
- `401 TOKEN_INVALID` — refresh or login again.
- `403` — inactive influencer or a child calling a parent-only feature.
- `404` — influencer profile/resource not found.
- `409` — conflicting operation.

## Client rules

- Never expose one influencer's IDs as filters for another influencer; scoping comes from the token.
- Never calculate wallet balances, commissions or analytics totals on the client.
- Never show Network/Child Analytics unless present in Session `allowedModules`.
- Never permit email, referral code, type, parent, status, KYC approval or payout approval updates from the influencer client.
- Store tokens in secure device storage for mobile apps, not plain AsyncStorage.
