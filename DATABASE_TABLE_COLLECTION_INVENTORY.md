# Database Table And Collection Inventory

Last updated: 2026-06-17

This inventory is generated from the backend codebase, not from a live database dump. PostgreSQL table names come from migrations, Sequelize/Knex model definitions, and runtime schema helpers. Mongo names come from Mongoose model registrations; unless a schema sets an explicit collection name, the collection name shown is the normal Mongoose pluralized collection name.

## Summary

- PostgreSQL tables: 103
- Mongo/Mongoose models and collections: 62
- Direct raw Mongo collection references: 1 (`collections`)

## PostgreSQL Tables

```text
ab_test_conversions
ab_test_experiments
admin_action_logs
api_keys
bulk_email_campaigns
categories
category_attributes
chargebacks
cities
config_change_history
countries
cron_job_executions
dead_letter_events
deal_commission_rules
deal_payouts
deal_sales
deal_sponsorships
deal_timeline
deals
delivery_agents
delivery_exclusions
dispute_messages
dispute_tickets
e_way_bill_details
email_opens_clicks
feature_flag_rollouts
fraud_detections
gift_messages
gift_wrap_options
gst_filing_records
gst_filings
holiday_calendar
hsn_codes
idempotency_keys
inventory_snapshots
inventory_transactions
ip_reputation_scores
loyalty_ledger
modules
operating_hours
order_cancel_reasons
order_cancellations
order_hold_logs
order_items
orders
outbox_events
password_reset_requests
payments
penalty_rules
permission_templates
permissions
pincode_serviceability
platform_fee_config
platform_subscription_plans
platform_subscription_transactions
platform_subscriptions
product_inventory
product_price_history
product_price_rules
product_variant_prices
push_notification_tokens
rate_limit_violations
rbac_audit_logs
recommendation_events
refund_transactions
return_requests
returns
role_permissions
roles
schema_migrations
seller_bank_accounts
seller_charge_settings
seller_commissions
seller_documents
seller_kyc
seller_payouts
seller_settlements
shipment_manifests
shipment_tracking_events
shipments
shipping_rates
shipping_zones
sms_logs
states
subscription_orders
subscription_plans
super_admins
tax_invoices
tax_ledger_entries
tcs_credit_ledger
two_factor_codes
user_activity_velocity
user_kyc
user_login_history
user_permissions
user_roles
user_sessions
vendor_payouts
wallet_cashback_rules
wallet_transactions
wallets
webhook_delivery_logs
webhook_subscriptions
```

## Mongo/Mongoose Models And Collections

| Model | Collection | Source file |
| --- | --- | --- |
| AdminCity | admincities | `src/modules/admin/models/common-management.model.js` |
| AdminCountry | admincountries | `src/modules/admin/models/common-management.model.js` |
| AdminState | adminstates | `src/modules/admin/models/common-management.model.js` |
| AdminSubTax | adminsubtaxes | `src/modules/admin/models/common-management.model.js` |
| AdminTax | admintaxes | `src/modules/admin/models/common-management.model.js` |
| AdminTaxRule | admintaxrules | `src/modules/admin/models/common-management.model.js` |
| AdminZipCode | adminzipcodes | `src/modules/admin/models/common-management.model.js` |
| Analytics | analytics | `src/modules/analytics/models/analytics.model.js` |
| AuditLog | auditlogs | `src/shared/logger/audit-log.model.js` |
| Cart | carts | `src/modules/cart/models/cart.model.js` |
| CategoryTree | categorytrees | `src/modules/platform/models/category-tree.model.js` |
| CommissionRule | commissionrules | `src/modules/seller/models/commission-rule.model.js` |
| ContentPage | contentpages | `src/modules/platform/models/content-page.model.js` |
| Coupon | coupons | `src/modules/pricing/models/coupon.model.js` |
| DomainEventLog | domaineventlogs | `src/shared/logger/domain-event-log.model.js` |
| DynamicPricing | dynamicpricings | `src/modules/pricing/models/dynamic-pricing.model.js` |
| FraudDetection | frauddetections | `src/modules/fraud/models/fraud-detection.model.js` |
| Geography | geographies | `src/modules/platform/models/geography.model.js` |
| HsnCode | hsncodes | `src/modules/platform/models/hsn-code.model.js` |
| InfluencerPayoutRequest | influencerpayoutrequests | `src/modules/referral/models/referral.model.js` |
| InfluencerProfile | influencerprofiles | `src/modules/referral/models/referral.model.js` |
| InfluencerWallet | influencerwallets | `src/modules/referral/models/referral.model.js` |
| InventoryReservation | inventoryreservations | `src/modules/inventory/models/inventory-reservation.model.js` |
| InventoryTransaction | inventorytransactions | `src/modules/inventory/models/inventory-transaction.model.js` |
| Loyalty | loyalties | `src/modules/loyalty/models/loyalty.model.js` |
| Notification | notifications | `src/modules/notification/models/notification.model.js` |
| NotificationPreference | notificationpreferences | `src/modules/notification/models/notification-preference.model.js` |
| NotificationQueue | notificationqueues | `src/modules/notification/models/notification-preference.model.js` |
| PickupAddress | pickupaddresses | `src/modules/delivery/models/shipping-admin.model.js` |
| PlatformBatch | platformbatches | `src/modules/platform/models/platform-batch.model.js` |
| PlatformBrand | platformbrands | `src/modules/platform/models/platform-brand.model.js` |
| PlatformDimension | platformdimensions | `src/modules/platform/models/platform-dimension.model.js` |
| PlatformFeeRule | platformfeerules | `src/modules/seller/models/platform-fee-rule.model.js` |
| PlatformFinish | platformfinishes | `src/modules/platform/models/platform-finish.model.js` |
| PlatformProductOption | platformproductoptions | `src/modules/platform/models/platform-product-option.model.js` |
| PlatformProductOptionValue | platformproductoptionvalues | `src/modules/platform/models/platform-product-option-value.model.js` |
| Product | products | `src/modules/product/models/product.model.js` |
| ProductFamily | productfamilies | `src/modules/platform/models/product-family.model.js` |
| ProductReview | productreviews | `src/modules/platform/models/product-review.model.js` |
| ProductRevision | productrevisions | `src/modules/product/models/product-revision.model.js` |
| ProductVariant | productvariants | `src/modules/platform/models/product-variant.model.js` |
| Recommendation | recommendations | `src/modules/recommendation/models/recommendation.model.js` |
| Referral | referrals | `src/modules/referral/models/referral.model.js` |
| ReferralCode | referralcodes | `src/modules/referral/models/referral.model.js` |
| ReferralCommissionLedger | referralcommissionledgers | `src/modules/referral/models/referral.model.js` |
| ReferralCommissionRule | referralcommissionrules | `src/modules/referral/models/referral.model.js` |
| ReferralFraudReview | referralfraudreviews | `src/modules/referral/models/referral.model.js` |
| ReferralOrder | referralorders | `src/modules/referral/models/referral.model.js` |
| Return | returns | `src/modules/returns/models/return.model.js` |
| SecurityEvent | securityevents | `src/shared/security/security-event.model.js` |
| ShippingPackage | shippingpackages | `src/modules/delivery/models/shipping-admin.model.js` |
| User | users | `src/modules/user/models/user.model.js` |
| Warehouse | warehouses | `src/modules/inventory/models/warehouse.model.js` |
| Warranty | warranties | `src/modules/warranty/repositories/warranty.repository.js` |
| WarrantyTemplate | warrantytemplates | `src/modules/platform/models/warranty-template.model.js` |

## Direct Raw Mongo Collection Usage

| Collection | Where used | Purpose |
| --- | --- | --- |
| collections | `src/modules/product/services/product.service.js` | Product service direct lookup for collection records outside a Mongoose model wrapper. |

## Notes For Admin Integration

- Use `postman_collection.json` with `postman_environment.json` for API testing.
- PostgreSQL is the primary store for transactional commerce, RBAC, finance, shipping, tax, wallets, and order lifecycle data.
- Mongo stores catalog-adjacent documents, user/cart documents, analytics, notifications, recommendations, and platform content documents.
- A table or collection can exist in a live database only after the matching migration, model initialization, or seed path has run in that environment.
