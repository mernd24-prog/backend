# Razorpay and RazorpayX: Management Business Case

Prepared for: Sam Global management  
Prepared on: 2 November 2026  
Purpose: Approve account onboarding and establish the scope, business value, dependencies and launch criteria for payments and payouts.

## 1. Decision requested

Approve onboarding for Razorpay Payment Gateway to collect customer payments and RazorpayX to execute approved business payouts. Ask Razorpay to confirm acceptance of our marketplace and referral-reward business model and the correct settlement product before finalising the production flow.

Approve a provisional **2–3 week onboarding planning window after complete documentation is submitted**. This is our internal planning allowance, not a Razorpay service commitment or a confirmed launch date. Integration completion and production acceptance testing are separate dependencies.

Razorpay collects money from customers. RazorpayX sends money to approved beneficiaries from a funded business account. The two products address different parts of our operations. Marketplace splitting of customer funds may require Razorpay Route and separate eligibility approval.

## 2. Why the business needs this

Our application supports customer orders, sellers, returns/cancellations, commissions, referral rewards and withdrawal requests. These activities create both incoming payments and outgoing financial obligations.

Using provider APIs can connect financial transactions to application records, reduce repeated bank-portal entry, and give finance a traceable transaction lifecycle. These are expected operational benefits; savings and return on investment must be measured using our actual volumes.

The payment provider does not calculate our seller entitlement, referral eligibility, taxes, return-window rules or approval hierarchy. Our application and finance policies remain responsible for these decisions.

## 3. Product selection

| Product | Business purpose | Recommendation |
|---|---|---|
| Razorpay Payment Gateway | Customer checkout and refunds against eligible online payments | Required for the existing online-payment integration |
| RazorpayX | Approved outgoing bank payouts, beneficiary setup and payout tracking | Required for the existing automated seller-payout path; proposed for referral automation |
| Razorpay Route | Split customer collections among onboarded linked accounts and manage related transfers/reversals | Evaluate with Razorpay if our marketplace settlement model requires it; no existing Route integration identified in this review |
| Other products, such as Payroll, Subscriptions or Payment Links | Additional business workflows | Outside the current request; do not purchase or implement without a confirmed requirement |

Razorpay documents Route as its marketplace/one-to-many split-payment product. RazorpayX should not be assumed to replace an approved marketplace settlement arrangement. [Route documentation](https://razorpay.com/docs/payments/route/)

## 4. Customer payment and refund use cases

“Existing code” below means an integration path was found in the repository. It does not mean the account is activated, the feature is configured in production, or live testing has passed.

| ID | Use case and trigger | Intended business outcome | Current position |
|---|---|---|---|
| P01 | Customer chooses online payment at checkout | Collect the order amount using payment methods enabled for our account | Existing Razorpay order/checkout integration |
| P02 | Customer completes checkout | Verify the payment response and associate provider references with the order | Existing signature-verification and payment-service code; live capture/status handling must be validated |
| P03 | Customer abandons checkout or payment fails | Keep unpaid orders distinguishable from paid orders; avoid fulfilment based only on a browser success screen | Payment lifecycle acceptance-test scenario |
| P04 | Payment succeeds but the browser closes or network response is lost | Recover the final payment state through trusted provider events and reconciliation | Existing webhook infrastructure; delayed-event scenarios require acceptance testing |
| P05 | Approved cancellation of a prepaid order | Initiate an eligible refund and track its result | Existing cancellation/refund integration paths |
| P06 | Approved return of an eligible purchased item | Refund the approved amount against the original payment | Existing return/refund provider paths |
| P07 | Only part of an order is refunded | Refund the eligible portion and retain an accurate remaining balance | Provider adapter accepts a refund amount; item allocation and maximum refundable balance require end-to-end validation |
| P08 | Refund is pending, processed or fails | Give support and finance a reliable refund status instead of treating submission as completion | Existing refund lookup and webhook handling |
| P09 | Customer disputes a payment | Investigate the order, delivery and transaction evidence and manage the provider dispute process | Operational requirement; automated dispute handling is not confirmed by this review |
| P10 | Finance reconciles customer receipts | Match orders, payment references, refunds, provider charges and bank settlements | Application records exist; complete settlement-to-bank reconciliation must be verified with finance |

Gateway refunds should normally use the original eligible online payment. Razorpay supports refund APIs and refund status events. Do not promise immediate customer credit: refund speed depends on the chosen service and processing outcome. [Refund documentation](https://razorpay.com/docs/payments/refunds/)

## 5. Seller and finance payout use cases

RazorpayX requires activation/KYC, a beneficiary contact and fund account, and a funded business account. Its documentation currently states that RazorpayX Lite is unavailable to new merchants; confirm the current-account onboarding route and eligibility with Razorpay. [Payout documentation](https://razorpay.com/docs/x/payouts/)

| ID | Use case and trigger | Intended business outcome | Current position |
|---|---|---|---|
| X01 | Seller submits approved bank details | Register a beneficiary for traceable payouts | Existing contact and bank fund-account integration |
| X02 | Seller bank details need verification | Reduce payments to incorrect bank accounts | Existing fund-account validation adapter; test-mode validation can be simulated, so live validation remains necessary |
| X03 | Seller earnings become eligible after configured delivery/return checks | Pay the approved net seller entitlement | Existing seller settlement lifecycle and RazorpayX payout integration |
| X04 | Finance deducts commission, applicable tax amounts, refunds and approved adjustments | Pay the net amount calculated by our system rather than gross order value | Existing seller commission/settlement calculations; finance must approve the calculation policy |
| X05 | Finance approves a seller payout manually | Retain control over release of funds | Existing application approval/payout paths; verify the configured mode and RBAC before launch |
| X06 | Business enables automatic seller payouts | Reduce repetitive execution after eligibility conditions are met | Existing automatic payout-mode code; enable only after pilot acceptance |
| X07 | Seller requests withdrawal of eligible funds | Transfer an approved, reserved entitlement without paying it twice | Existing seller withdrawal/payout paths; concurrency and repeat-submission checks require acceptance testing |
| X08 | Provider queues a payout because funds are insufficient | Track outstanding obligations and fund the payout account | Adapter requests low-balance queueing; finance must own funding and queue monitoring |
| X09 | Payout fails, reverses, is rejected or is cancelled | Update finance records and decide whether a fresh payout is appropriate | Existing provider-event and seller payout-sync handling |
| X10 | Request times out or an operator repeats an action | Confirm the previous result and avoid duplicate transfers | Adapter supports an idempotency key; business-level retry safety must be validated for each entry point |
| X11 | Provider webhook is delayed | Query payout status and resolve stale application records | Existing payout fetch and seller payout synchronization |
| X12 | Finance prepares a periodic payout run | Review eligible amounts and execute controlled payouts | Existing settlement/payout operations; bulk-upload or provider bulk-API integration is not established by this review |
| X13 | COD order creates a seller entitlement | Pay the seller only after the collection and reconciliation conditions are satisfied | Existing COD and settlement logic; Razorpay Gateway does not collect the physical cash |
| X14 | Seller entitlement is credited to an internal wallet | Track internal liability until an eligible bank withdrawal is approved | Existing seller-wallet option; a wallet ledger credit is not a bank transfer |

The current RazorpayX payout adapter requests **INR bank payouts using IMPS**. Do not describe other payout modes or destinations as already integrated simply because the provider offers them.

## 6. Referral, influencer and marketing use cases

| ID | Use case and trigger | Business justification | Current position |
|---|---|---|---|
| R01 | Eligible referred sale earns rewards | Record the partner’s entitlement under approved referral rules | Existing referral earnings/ledger logic; this is an internal accounting event |
| R02 | A sale is cancelled, returned or fails eligibility checks | Prevent release of an unearned referral reward | Eligibility/reversal acceptance-test scenario |
| R03 | Partner submits a withdrawal request | Reserve eligible rewards and route the request for review | Existing withdrawal and reservation workflow |
| R04 | Admin approves or rejects a withdrawal | Apply payout-profile, eligibility and business-policy checks | Existing referral approval/rejection workflow |
| R05 | Approved reward is transferred to the beneficiary’s bank | Reduce manual transfers and connect withdrawal records to provider results | **Proposed RazorpayX integration**; direct referral-to-provider execution was not identified in the reviewed service |
| R06 | Finance completes a referral payment manually | Record the actual transaction reference and clear the reserved obligation | Existing mark-paid workflow; approval alone must not be presented as payment completion |
| R07 | Bonus rewards become withdrawable under policy | Pay only approved monetary entitlement | Proposed provider automation; confirm conversion, limits and business-model acceptance |
| R08 | Partner payout fails or reverses | Restore or retain the correct liability and prevent duplicate payment | Required design and testing for referral automation |

Referral coins/reward balances are application records. They are not automatically cash, bank balances or provider-held wallets. Finance must approve conversion and withdrawal rules. Describe the actual referral structure to Razorpay and obtain acceptance rather than assuming that a general account approval covers every reward model.

## 7. Controls and exception scenarios

| Scenario | Required operating rule |
|---|---|
| Changed beneficiary bank details | Reverify the destination and require the appropriate approval before the next payout |
| Duplicate payment or payout event | Process the same provider reference safely without creating another financial obligation |
| Missing or invalid webhook signature | Reject the event and investigate; do not alter balances from an untrusted payload |
| Provider success differs from application status | Reconcile using provider transaction records before retrying or marking paid |
| Customer refund after seller has already been paid | Follow an approved recovery/adjustment policy; a gateway refund does not automatically recover a separate RazorpayX payout |
| Customer refund after referral reward has been paid | Apply approved referral recovery rules; do not assume a bank transfer can be recalled |
| Unfunded payout account | Alert finance, review queued obligations and replenish according to the approved process |
| Excess or unauthorised payout request | Enforce role permissions, available entitlement, limits and approval rules on the backend |
| Provider outage or uncertain response | Keep the transaction pending, investigate the provider result and retry only when safe |
| Test/mock configuration remains enabled | Block production sign-off until a controlled real payment, refund and payout have been reconciled |

Our application approvals and RazorpayX dashboard approval workflows are separate controls. Confirm how API-created payouts interact with the selected provider workflow. [Approval workflow documentation](https://razorpay.com/docs/x/manage-teams/approval-workflow)

## 8. Illustrative money flow

1. Customer pays ₹1,000 through Razorpay for an order.
2. The application verifies and reconciles payment status before fulfilment.
3. Our finance rules calculate seller entitlement, commission, applicable deductions and eligible referral rewards.
4. After configured delivery, return and approval checks, the application releases eligible obligations.
5. An approved seller payout is executed through the configured RazorpayX path from the funded payout account. Referral payments follow the existing manual recording flow until separate automation is implemented and accepted.
6. Finance matches customer receipts, provider settlements, outgoing payouts, fees, refunds and outstanding liabilities.

The ₹1,000 example illustrates the workflow only. It is not a quotation, a tax calculation or a guaranteed settlement amount. Gateway settlement into our bank and funding of RazorpayX must be planned explicitly; automatic movement between products is not assumed. The collection/settlement structure remains subject to provider acceptance.

## 9. Onboarding plan and timing justification

| Activity | Planning approach | Owner |
|---|---|---|
| Prepare application and documents | Confirm legal entity, authorised signatory, bank ownership, business description and website policies before submission | Management / Finance |
| Razorpay Payment Gateway review | Earlier 3–5 working-day estimate is an internal allowance only; approval can be faster or take longer | Finance / Razorpay |
| RazorpayX account and payout enablement | Earlier 1–3 week estimate is an internal allowance only; bank onboarding and required services determine actual timing | Finance / Partner bank / Razorpay |
| Marketplace/referral model review | Obtain explicit acceptance and confirm whether Route is required; do not assume this fits the standard timeline | Management / Razorpay |
| Technical preparation | Continue sandbox testing and integration review in parallel with onboarding | Engineering |
| Production pilot | Schedule once approved accounts, credentials, funding and business rules are ready | Engineering / Finance |

**Management planning position: reserve 2–3 weeks after complete submission, then revise the forecast using the actual provider review status.** This is not a maximum duration. Missing documents, clarification requests, bank checks or product eligibility can extend it. No provider-confirmed activation date has been established in this document.

Razorpay distinguishes test-mode preparation from live activation and states that approval is account-specific. Successful sandbox tests do not establish permission to transact live. [Activation guidance](https://razorpay.com/blog/instant-payment-gateway-activation-india/)

Prepare business PAN, entity/registration information as applicable, authorised-person KYC, address evidence, bank details and relevant website business/policy pages. The exact checklist depends on legal structure and the provider’s current onboarding requirements; use the checklist issued for our application.

## 10. Costs and financial justification

Request a written commercial proposal covering payment processing charges, applicable taxes, payout fees by mode, account/service charges, validation charges, refund/instant-refund charges where applicable, Route charges if selected, limits and any minimum commitments. No fixed pricing is assumed here.

Finance should also plan the cash required for payout funding, pending refunds and timing differences between collections and outgoing obligations. Payout funding is working capital, separate from provider fees.

Measure the business case using:

- Monthly online-payment volume and payment success rate.
- Monthly seller/referral payout count and average payout value.
- Staff minutes per manual payout, including approval and reconciliation.
- Payment/refund/payout support cases and reconciliation exceptions.
- Duplicate-payment incidents, failed payouts and outstanding liabilities.

Estimated monthly staff capacity released = payout count × minutes saved per payout ÷ 60. Net financial benefit must subtract provider charges and ongoing engineering/operations cost; no savings figure is claimed without these inputs.

## 11. Ownership and launch acceptance

| Owner | Accountability |
|---|---|
| Management | Approve business model, product scope, budget and rollout decision |
| Finance | Complete onboarding, approve financial rules, fund payouts and reconcile bank/provider records |
| Operations / Support | Handle customer refunds, seller/partner queries and exceptions under approved procedures |
| Engineering | Configure integrations, enforce permissions, secure provider events and resolve technical exceptions |
| Razorpay / Partner bank | Decide eligibility, approve accounts/services and confirm commercial and processing terms |

Production sign-off requires:

1. Confirmed account activation, enabled services and acceptance of our actual business model.
2. Confirmed settlement architecture for marketplace collections, including Route if required.
3. Verified production configuration, webhook verification and authorised operator access.
4. Finance-approved seller/referral eligibility, deductions, refund and recovery rules.
5. A controlled real payment, cancellation/return refund and seller payout reconciled to provider and bank records.
6. Tested failure, duplicate, delayed-event, insufficient-funds and payout-reversal scenarios.
7. Referral automation tested separately before it is described as available.
8. Named owners for daily reconciliation, payout funding and exception handling.

## 12. Application evidence and scope of review

Repository review identified these implementation references:

- Customer orders, signature verification and refunds: `src/infrastructure/payments/providers/razorpay.provider.js`.
- Provider events for payments, refunds and seller payouts: `src/modules/payment/services/payment.service.js`.
- Contacts, fund accounts, validation, IMPS payouts and payout lookup: `src/infrastructure/payouts/providers/razorpayx.provider.js`.
- Seller commission, payout execution and synchronization: `src/modules/seller/services/commission.service.js`.
- Settlement eligibility and return-related holds: `src/modules/seller/services/settlement-lifecycle.service.js`.
- Referral approval, rejection, reservation and manual payment recording: `src/modules/referral/services/`.

This document is a business justification based on source review and provider documentation. It is not a production certification, a confirmation of account activation or an exhaustive payment-security audit. Optional capabilities are labelled separately from existing code.

## 13. Statement for management approval

> We request approval to onboard Razorpay for customer payment collection and RazorpayX for approved outgoing payouts. These integrations support traceable order payments, refunds and seller settlements while reducing repetitive manual processing. Referral payout automation is a separate implementation phase. We will confirm marketplace/referral eligibility and the required settlement product with Razorpay, obtain commercial terms, and complete finance-led production acceptance before launch. We propose a provisional 2–3 week onboarding allowance after complete document submission, subject to provider and bank approval; this is not a guaranteed activation date.
