MLM order and coin activity context
==================================

Mobile referral orders (including dashboard recent orders) and coin-ledger rows
with an order ID include these additional fields:

| Field | Meaning |
| --- | --- |
| orderStatus | Current commerce order status, read from the orders database |
| paymentStatus | Current commerce payment status |
| returnStatus | Active return status, otherwise most recent return status |
| disputeStatus | QC review status on that return |
| returnWindowEndsAt | Purchased order return-window deadline |
| fulfillmentEligibleAt | Order fulfillment eligibility date |
| expectedReleaseDate | Eligibility date when waiting only for the window/release; null while blocked by a return, dispute, payment, or fulfillment |
| lockReason | Machine-readable reason for pending/locked coins, otherwise null |
| lockReasonMessage | Display text explaining the lock, otherwise null |
| coinStatus | Explicit coin state, separate from commerce and referral statuses; pending ledger coins are labelled locked |

Lock reasons: `awaiting_order_fulfillment`, `return_window_open`,
`return_in_progress`, `return_dispute_open`, `payment_not_settled`,
`awaiting_reversal`, `awaiting_coin_release`, `order_details_unavailable`,
`awaiting_order_finalization` (delivered, window ended, fulfillment not finalized).

Delivered orders with an open return window use `return_window_open` and include
the window deadline as `expectedReleaseDate`. Confirmed orders have no expected
release date until delivery establishes their return window.

Existing `status` values and ledger `releaseAt` remain compatible. `releaseAt`
is the ledger's stored schedule; use `expectedReleaseDate` and `lockReason`
to explain current eligibility. An eligibility date is not a guaranteed payout.
Withdrawals without an order ID do not receive order context.
These read endpoints do not move funds or repair ledger statuses.

Endpoint audit
--------------

All paths below are relative to `/api/v1/influencer/referral`.

| Endpoint | Status/context contract |
| --- | --- |
| GET /dashboard/summary | recentOrders contains full order/coin context; charts.orderStatus groups current commerce order statuses; charts.referralOrderStatus preserves pending/completed referral grouping |
| GET /analytics | Same two chart meanings and contextual recent orders as dashboard |
| GET /orders | status remains the existing coin summary; coinStatus is explicit; referralOrderStatus is the referral lifecycle; orderStatus/paymentStatus are live |
| GET /ledger | status remains the ledger transaction state; coinStatus labels pending coins locked; order-linked rows include full context |
| GET /network/children/:childId | recentOrders retains legacy referral status, adds referralOrderStatus and ledger-derived coinStatus; recentCoinActivity includes full order context |
| GET /wallet | Aggregate coin balances; no single order status or return date applies |
| GET /network | Partner account status and aggregate performance; individual order context is in child detail |
| GET /codes | Code activation status and aggregate performance, not order status |
| GET /withdrawals, POST /withdrawals | Withdrawal lifecycle status, not order status |
| GET /bonus-progress | Bonus lifecycle/progress, not an individual order status |
| GET /session, GET/PATCH /profile, POST /network/children | Account, verification and onboarding statuses; no individual order context |

The frontend should use `orderStatus` for order badges, `coinStatus` for coin
badges, and `lockReasonMessage` for locked-coin explanations. A referral may
legitimately remain `pending` while its delivered order has an open return
window. Never use `referralOrderStatus` as a delivery status.

The dashboard/analytics `orderStatus` chart now uses commerce states such as
`confirmed`, `delivered`, `fulfilled`, and `cancelled`; clients expecting referral
states should read `referralOrderStatus` instead. Missing commerce records fall
back to the stored order-status snapshot, otherwise `unknown`.
