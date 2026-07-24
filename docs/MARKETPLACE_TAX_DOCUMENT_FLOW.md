# Marketplace tax-document flow

## Document ownership and visibility

| Document | Issuer | Recipient | Scope | Buyer access | Seller access |
| --- | --- | --- | --- | --- | --- |
| Customer order receipt (`order_customer`) | Marketplace | Buyer | Whole-order payment summary | After fulfillment | No |
| Seller tax invoice (`seller_customer`) | Seller organization | Buyer | Only that seller organization's delivered items | After that package is delivered | Issuing seller |
| Commission tax invoice (`platform_commission`) | Marketplace | Seller organization | Product-linked marketplace commission/service fees | Never | Billed seller |
| Customer platform-fee invoice (`platform_customer_fee`) | Marketplace | Buyer | Taxable customer platform service fee only | Buyer | No |
| Seller customer credit note | Original seller | Buyer | Returned seller items and reversed product GST | Same as original invoice | Issuing seller |
| Commission credit note | Marketplace | Seller organization | Reversed product-linked commission and commission GST | Never | Billed seller |
| Settlement statement | Marketplace | Seller organization | Private payout, withholding, refund, and recovery details | Never | Statement seller |

The `order_customer` database value is retained for backward compatibility, but
the document is rendered and presented as an **order receipt**, not as a second
product tax invoice.

## Item and discount rules

1. The order discount is allocated proportionally by item line value.
2. The final item receives the rounding remainder, so item discounts always sum
   exactly to the order discount.
3. Each item snapshot records marketplace-funded, seller-funded, and
   payment-partner-funded portions.
4. The seller invoice visibly shows the complete customer promotion as a
   negative line and then shows marketplace/payment-partner funding as positive
   payment contributions. Only the seller-funded portion reduces the final
   taxable invoice value.
5. A seller payout base is reduced only by the seller-funded portion. The
   marketplace-funded portion does not reduce seller receivable.
6. Returns create a seller credit note for the original seller invoice value,
   refund only the customer's paid portion, reverse the marketplace/payment
   partner contribution separately, and reverse commission in proportion to
   returned quantity.

## Charge placement

- Product GST: seller tax invoice.
- Marketplace commission and GST on commission: platform-to-seller commission
  invoice.
- Customer platform fee: whole-order marketplace receipt. When the customer
  platform fee has tax, the system also creates a dedicated marketplace-to-
  customer service invoice rather than placing it on a seller product invoice.
- GST TCS and income-tax TDS: settlement statement only; neither is a customer
  invoice charge.
- Seller payout, refunds, adjustments, and recoveries: settlement statement
  only.

## Reconciliation invariants

- Seller invoice total = seller item gross - seller-funded discount +
  exclusive item GST + seller-specific delivery.
- Seller invoice total = customer-paid portion + marketplace contribution +
  payment-partner contribution.
- Commission invoice total = sum of product-linked commission taxable values +
  GST on commission.
- Commission credit value uses the returned product's original fee snapshot,
  not an order-average ratio.
- GST TCS uses the immutable GST-exclusive taxable supply snapshot.
- Zero-value commission invoices are not created.

## Promotion funding ledger

`GET /api/v1/sellers/commissions/promotion-ledger` is the platform-finance view.
`GET /api/v1/sellers/commissions/my-promotion-ledger` is seller-scoped.

The ledger is derived from immutable order-item pricing snapshots and shows the
customer discount, seller-funded reduction, marketplace/payment-partner
contribution, reversal, commission reference, and payout reference. A platform
contribution is a payment source for the seller invoice and is not added again
to the seller payout:

```text
seller invoice = customer-paid portion + platform/partner contribution
seller payout = seller invoice base - commission - commission GST - statutory withholdings
```

## Configuration

- `GSTIN_MARKETPLACE`: marketplace GSTIN used when the marketplace is the
  service provider.
- `PLATFORM_COMMISSION_SAC_CODE`: SAC code displayed on marketplace commission
  invoices. It must be configured by the accounting/tax owner for the actual
  service classification.
- `PLATFORM_CUSTOMER_FEE_SAC_CODE`: SAC code displayed on the separate
  marketplace-to-customer platform-fee invoice. It falls back to
  `PLATFORM_COMMISSION_SAC_CODE` only for backward compatibility and should be
  confirmed independently by the accounting/tax owner.
- `INVOICE_BRAND_NAME`, `INVOICE_REGISTERED_OFFICE`: marketplace legal document
  identity.

## Seller-managed shipping

When the seller owns fulfillment and the platform collects delivery charges:

- the delivery charge is a seller receivable, not platform revenue;
- the seller tax invoice contains a separate delivery/shipping line;
- the settlement reimburses the charge exactly once;
- its GST-exclusive value is included in the GST TCS base when applicable;
- full cancellation reverses the shipping line and shipping GST on the seller
  credit note;
- RTO settlement reverses the returned seller package's shipping amount for
  that seller organization;
- ordinary post-delivery return refunds remain product/tax only unless a
  separate return-shipping waiver or policy is implemented;
- a platform logistics fee is a different service and must not be inferred
  from the customer shipping collection.

Customer platform fees are separately invoiced by the marketplace. A full
cancellation that refunds that fee creates a separate customer platform-fee
credit note and never transfers that reversal to the seller.
