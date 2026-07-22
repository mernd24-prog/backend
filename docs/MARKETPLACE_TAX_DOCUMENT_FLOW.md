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
3. Each item snapshot records marketplace-funded and seller-funded portions.
4. A seller invoice includes only the item discounts in that seller's invoice.
5. A seller payout base is reduced only by the seller-funded portion. The
   marketplace-funded portion does not reduce seller receivable.
6. Returns reverse the original item taxable value, GST, discount, and
   commission in proportion to returned quantity.

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

- Seller invoice total = seller item gross - allocated customer discount +
  exclusive item GST + seller-specific delivery.
- Commission invoice total = sum of product-linked commission taxable values +
  GST on commission.
- Commission credit value uses the returned product's original fee snapshot,
  not an order-average ratio.
- GST TCS uses the immutable GST-exclusive taxable supply snapshot.
- Zero-value commission invoices are not created.

## Configuration

- `GSTIN_MARKETPLACE`: marketplace GSTIN used when the marketplace is the
  service provider.
- `PLATFORM_COMMISSION_SAC_CODE`: SAC code displayed on marketplace commission
  invoices. It must be configured by the accounting/tax owner for the actual
  service classification.
- `INVOICE_BRAND_NAME`, `INVOICE_REGISTERED_OFFICE`: marketplace legal document
  identity.
