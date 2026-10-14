# CA finance analytics — analysis and implementation plan

Audit date: 2026-10-14  
Purpose: a read-only Admin workspace for a Chartered Accountant/finance team to understand sales, collections, fees, taxes, refunds, seller liabilities, payouts, and reconciliation exceptions.

## 1. Recommendation

Create a new Admin page named **CA Finance & Reconciliation**. It should not be another general sales chart. It should answer four accounting questions:

1. What was sold and invoiced?
2. How much money was collected, by whom, and where is it now?
3. What is the platform's revenue and tax liability?
4. What is payable/paid to sellers, and which records do not reconcile?

The most important design rule is to show **gross, deductions, reversals, and net separately**. Do not call payment collections “revenue.” Customer money collected includes seller money, GST, shipping, platform/customer fees, and other components.

## 2. Current-data audit

| Data area | Current source | Readiness | Important finding |
|---|---|---|---|
| Orders and order count | `orders`, `order_items` | Available | Has subtotal, discount, tax, total, wallet discount, payable and platform-fee snapshots |
| Online payments | `payments` | Available with correction | Provider/status/amount/provider IDs exist; summaries must include captured/verified statuses only |
| Razorpay collections | `payments.provider = razorpay` | Partial | Captured customer amount is available |
| Razorpay fees and settlement | No complete settlement ledger | Missing | Gateway fee, GST on gateway fee, settlement ID, UTR, settled amount and bank-credit date are not reliably stored |
| COD | `cod_collections` | Available | Expected/collected amount, collector, proof, verification and remittance exist |
| Platform fee | `orders.platform_fee_amount` and breakup | Available | Must split fee charged to customer from commission charged to seller |
| Seller commission | `seller_commissions` | Available | Gross, commission, GST on commission, refund, TCS, TDS, shipping deductions and net are present |
| Seller payouts | `seller_payouts` | Available | Net, status, method, reference and processed date exist |
| Seller settlements | `seller_settlements` | Available | Gross-to-net settlement statement data exists |
| Refunds | returns plus payment/cancellation records | Fragmented | Return, cancellation, wallet and provider refunds need one canonical refund fact view |
| GST invoices | `tax_invoices` | Available | Seller/customer, platform/customer-fee and commission invoice types exist |
| Credit notes | `tax_credit_notes` | Available | Tax reversals exist |
| GST ledger | tax ledger/invoices | Available | CGST/SGST/IGST collection and reversal can be reported |
| GST TCS | commission metadata | Available | Settlement withholding is calculated; customer invoices deliberately show TCS as zero |
| Income-tax TDS | commission metadata | Available | Taxable base and withheld amount are calculated in seller finance data |
| Wallet | `wallet_transactions` | Available | Credits/debits/holds can be reconciled by reference |
| Promotions | promotion funding ledger/metadata | Available | Marketplace, seller and payment-partner contribution should be separated |

## 3. Critical correctness issues before calling figures final

| Priority | Issue | Why it matters | Required correction |
|---|---|---|---|
| P0 | Current finance summary sums all payment rows | Initiated/failed rows can overstate collections | Sum only authoritative captured/verified payments; define status mapping once |
| P0 | Current order-item summary does not apply date filters | Selected-period order totals can disagree with cards | Join orders and filter by the selected accounting date |
| P0 | Refund data is split across returns, cancellations, payments and wallet | Double-count or missed refund risk | Create one canonical refund fact/read model with unique refund identity |
| P0 | No Razorpay settlement and fee ledger | Cannot prove bank receipt or net provider balance | Ingest payment, refund, fee, tax, settlement, UTR and bank-credit details from provider reports/API/webhooks |
| P0 | “Revenue” is not formally defined | GMV, collection and platform income can be confused | Publish metric definitions and formulas in UI/tooltips/export |
| P0 | Accounting date is ambiguous | Order, payment, invoice and settlement dates produce different totals | Let CA select basis: order date, payment captured date, invoice date, refund date, payout date or settlement date |
| P1 | TCS/TDS mostly live inside JSON metadata | Harder to aggregate/audit/index | Add explicit immutable ledger columns/table for statutory withholdings and reversals |
| P1 | Provider and internal state can diverge | Captured/refunded/settled mismatches remain hidden | Add daily reconciliation snapshots and exception queue |
| P1 | Historical snapshots must never use current settings | Tax/fee changes can rewrite history | Always aggregate order/invoice/commission snapshots, not live configuration |

## 4. Dashboard count

Recommended first version:

| Component | Count |
|---|---:|
| Top summary cards | **16** |
| Reconciliation checks | **12** |
| Analysis charts | **8** |
| Drill-down tables | **9** |
| Global filters | **12** |
| Export packs | **8** |

## 5. Top 16 summary cards

| No. | Card | Formula/meaning | Current readiness |
|---:|---|---|---|
| 1 | Orders booked | Distinct orders in period | Ready |
| 2 | Units sold | Sum item quantity excluding invalid/cancelled basis | Ready after status rule |
| 3 | Gross merchandise value (GMV) | Product value before discounts/refunds | Ready after definition |
| 4 | Net merchandise value | GMV − cancelled value − returned/refunded product value | Needs canonical refund view |
| 5 | Customer invoice value | Sum issued customer invoices − customer credit notes | Ready |
| 6 | Customer collections | Captured online + verified COD + wallet debit | Ready after payment-status correction |
| 7 | Razorpay captured | Captured payments where provider is Razorpay | Ready |
| 8 | Razorpay settled to bank | Provider settlements credited to bank | New data required |
| 9 | Razorpay fees + GST | Gateway fee and GST retained by provider | New data required |
| 10 | COD outstanding | Expected COD − verified/remitted COD | Ready |
| 11 | Refunds completed | Provider + wallet + verified manual refunds, deduplicated | Needs canonical refund view |
| 12 | Refunds pending/failed | Approved but not completed | Available after unified query |
| 13 | Platform revenue | Seller commission + customer platform fees + other platform income − reversals | Mostly ready |
| 14 | Output GST liability | Net CGST + SGST + IGST on platform-issued taxable services | Ready from invoices/credit notes |
| 15 | GST TCS / income-tax TDS withheld | Net statutory seller withholding after reversals | Ready, ledger hardening recommended |
| 16 | Seller payable and paid | Eligible net payable, on hold, paid, and outstanding | Ready |

### Do not combine these figures

- **GMV** is not platform revenue.
- **Customer collection** is not platform revenue.
- **Razorpay captured** is not Razorpay settled.
- **Seller payable** is a liability, not an expense at the time cash is collected.
- **GST collected** is a liability, not revenue.
- **TCS/TDS withheld** is a statutory liability/credit trail, not platform income.

## 6. Twelve reconciliation checks

Show each as `Matched`, `Warning`, or `Mismatch`, with count, amount difference, oldest age, and drill-down.

1. Order payable amount vs captured payment amount.
2. Captured Razorpay amount vs provider payment report.
3. Razorpay captured − refunds − fees − fee GST vs provider settlement amount.
4. Provider settlement amount vs bank credit/UTR.
5. COD expected vs COD collected.
6. COD collected vs COD verified/remitted or seller-direct liability.
7. Completed refund vs provider/wallet/manual refund evidence.
8. Customer invoice total vs order financial snapshot.
9. Credit-note amount vs refund/cancellation tax reversal.
10. Seller gross − all deductions/reversals vs seller net payable.
11. Eligible seller payable vs payout/settlement amount.
12. GST TCS/TDS withheld vs statutory ledger/deposit/return filing amount.

## 7. Eight charts

1. Daily orders, GMV, net sales and refunds.
2. Collections by Razorpay, COD, wallet and other providers.
3. Platform revenue split: commission, customer platform fee, shipping/other income and reversals.
4. GST split: CGST, SGST, IGST, credit-note reversals and net liability.
5. GST TCS and income-tax TDS withheld/reversed by month.
6. Seller liability ageing: not eligible, eligible, on hold, approved, processing and overdue.
7. Razorpay settlement trend: captured, refunded, fee, fee GST, settled and unreconciled.
8. Refund ageing: pending <24h, 1–3d, 3–7d, >7d and failed.

## 8. Nine drill-down tabs

| Tab | Required columns |
|---|---|
| Sales register | Date, order, invoice, seller/org, buyer state, HSN, taxable value, CGST, SGST, IGST, total, status |
| Collections | Payment, order, provider/method, captured amount/date, provider IDs, current reconciliation state |
| Razorpay reconciliation | Payment ID, order ID, captured, refunded, fee, fee GST, settlement ID, settled amount, UTR, bank date, variance |
| Refund register | Refund ID, order/return/cancellation, method, provider/wallet split, approved, completed, pending, failed reason, credit note |
| Platform revenue | Source, order/seller, taxable value, fee/commission, GST, reversal, net recognized amount |
| Seller payable | Seller/org, gross, commission, commission GST, TCS, TDS, shipping, refund, adjustment, net, eligibility/hold |
| Payouts and settlements | Payout/settlement, seller, period, amount, status, payment reference/UTR, processed date, variance |
| GST register | GSTIN, document type/number/date, place of supply, taxable value, CGST/SGST/IGST, reversal, net |
| TCS/TDS register | Seller PAN/GSTIN, section/type, taxable base, rate, withheld, reversed, net, deposit/return status |

## 9. Twelve global filters

1. Date range.
2. Accounting date basis.
3. Seller.
4. Seller organization/legal entity.
5. Payment provider.
6. Payment method: prepaid, COD, wallet, mixed.
7. Order status.
8. Payment/refund/settlement status.
9. Invoice/document type.
10. Customer place-of-supply state.
11. GST type: CGST+SGST or IGST.
12. Reconciliation state: matched, unmatched, duplicate, missing, variance.

Every card, chart, table and export must use the same filter contract and show the active accounting-date basis.

## 10. Eight export packs

1. Sales/invoice register.
2. Credit-note and refund register.
3. Payment collection register.
4. Razorpay settlement reconciliation.
5. Platform revenue and GST-on-fees register.
6. Seller commission/payable/payout register.
7. GST summary with HSN and state breakdown.
8. GST TCS and income-tax TDS withholding register.

CSV/XLSX is required for working papers. PDF should be limited to signed/final summaries, invoices, credit notes and settlement statements. Each export needs generated-at time, timezone, filters, basis, currency, row count, and a stable report ID.

## 11. Metric formulas

Use integer paise or exact decimal arithmetic in aggregation; round only for display.

```text
Gross GMV
  = sum(original item price × ordered quantity)

Net sales
  = gross item value
  − cancelled item value
  − returned/refunded item value
  − seller-funded discount
  [define whether tax and shipping are included]

Customer collections
  = captured online payments
  + verified COD collections
  + captured wallet amount

Platform revenue before GST
  = seller commission before GST
  + customer platform fee before GST
  + other platform-owned taxable fees
  − fee/commission reversals

Seller net payable
  = seller gross proceeds
  + seller shipping reimbursement
  − seller-funded promotion
  − platform commission
  − GST on platform commission
  − GST TCS
  − income-tax TDS
  − refunds/reversals
  ± approved adjustments

Razorpay expected settlement
  = captured Razorpay amount
  − provider refunds
  − Razorpay fee
  − GST on Razorpay fee
  ± provider adjustments

Net GST liability
  = output GST on platform taxable supplies
  − GST reversed through valid credit notes
  [input tax credit is separate and cannot be inferred only from this commerce database]
```

Final legal/accounting definitions, TCS/TDS applicability, rates, recognition basis and return mappings must be confirmed by the CA for the actual marketplace model and registrations.

## 12. Required new backend read model

Do not build this page by making the browser call orders, payments, tax, refunds and payouts separately and adding numbers in JavaScript. Create a server-side CA analytics module:

```text
GET /admin/ca-analytics/summary
GET /admin/ca-analytics/trends
GET /admin/ca-analytics/reconciliation
GET /admin/ca-analytics/registers/:register
GET /admin/ca-analytics/exports/:report
```

Recommended derived/read tables:

- `finance_daily_facts` — daily totals by basis/provider/method/seller/org/state.
- `payment_provider_transactions` — normalized payment/refund/fee/settlement/adjustment facts.
- `payment_reconciliation_runs` and `payment_reconciliation_items`.
- `statutory_withholding_ledger` — TCS/TDS charges and reversals.
- `accounting_report_exports` — report ID, filters, checksum, creator and generated timestamp.

All monetary facts need `source_type`, `source_id`, `event_type`, `occurred_at`, `currency`, `amount`, `seller_id`, `organization_id`, idempotency key and reversal linkage.

## 13. Access and audit controls

- Add a dedicated `ca-analytics:view` permission.
- Add separate `ca-analytics:export` permission because exports contain financial and personal data.
- CA role is read-only; it must not approve refunds, edit tax, release payouts or change reconciliation records.
- Mask buyer phone/address and bank details unless a specific report legally requires them.
- Log every register view/export with actor, time, filters, row count and report ID.
- Finalized period snapshots should be immutable; later corrections appear as adjustments in a later period.

## 14. Implementation phases

### Phase 1 — reliable internal dashboard

- [ ] Approve metric dictionary and accounting date rules with CA.
- [ ] Correct payment-status and order-date aggregation defects.
- [ ] Build canonical refund fact view with deduplication.
- [ ] Build summary API using existing order, commission, tax, payout, COD and wallet data.
- [ ] Add 16 cards, shared filters, sales register, seller payable and refund register.
- [ ] Add CSV/XLSX exports and CA-specific RBAC.

### Phase 2 — Razorpay and bank reconciliation

- [ ] Ingest Razorpay payment/refund/fee/tax/settlement/adjustment reports.
- [ ] Store settlement ID, UTR and bank-credit date/amount.
- [ ] Build automated payment-to-settlement and settlement-to-bank matching.
- [ ] Add reconciliation exception queue and ageing.
- [ ] Add immutable daily reconciliation run snapshots.

### Phase 3 — statutory and period close

- [ ] Add explicit statutory withholding ledger and reversal links.
- [ ] Add GST/TCS/TDS deposit/return filing status and references.
- [ ] Add month-close lock, adjustment periods and opening/closing balances.
- [ ] Add CA sign-off, report checksum and final-period export pack.
- [ ] Add scheduled reconciliation and mismatch notifications.

## 15. Best first release

Start with existing trustworthy data: orders, issued invoices/credit notes, captured payments, verified COD, platform fee, commissions, TCS/TDS snapshots, seller payables/payouts and completed refunds. Clearly label Razorpay settled amount and provider fees as **Unavailable until provider settlement import is implemented**. Never estimate those figures from configured fee percentages on a CA-facing report.
