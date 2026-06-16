"use strict";

const DEAL_STATUS = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  PAUSED: "paused",
  EXPIRED: "expired",
  COMPLETED: "completed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

const DEAL_TYPE = {
  FIXED_PRICE: "fixed_price",
  PERCENTAGE_DISCOUNT: "percentage_discount",
  FLASH_SALE: "flash_sale",
  LIMITED_INVENTORY: "limited_inventory",
  SPONSORED_PLACEMENT: "sponsored_placement",
  BULK_QUANTITY: "bulk_quantity",
  NEW_SELLER_PROMO: "new_seller_promo",
  BRAND_PARTNERSHIP: "brand_partnership",
  REGION_SPECIFIC: "region_specific",
  VARIANT_LEVEL: "variant_level",
};

const DEAL_FULFILLMENT_MODEL = {
  SELLER_FULFILLED: "seller_fulfilled",
  PLATFORM_SHIPPER_FULFILLED: "platform_shipper_fulfilled",
  HYBRID: "hybrid",
};

const DEAL_VERIFICATION_METHODS = ["otp", "signature", "photo", "qr", "courier_api"];

const DEAL_SALE_STATUS = {
  RESERVED: "reserved",
  CONFIRMED: "confirmed",
  DELIVERED_VERIFIED: "delivered_verified",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
};

const DEAL_PAYOUT_STATUS = {
  GENERATED: "generated",
  PROCESSING: "processing",
  PAID: "paid",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const DEAL_TIMELINE_EVENT = {
  CREATED: "deal_created",
  UPDATED: "deal_updated",
  SUBMITTED: "deal_submitted",
  APPROVED: "deal_approved",
  REJECTED: "deal_rejected",
  PAUSED: "deal_paused",
  RESUMED: "deal_resumed",
  CANCELLED: "deal_cancelled",
  EXPIRED: "deal_expired",
  COMPLETED: "deal_completed",
  RENEWED: "deal_renewed",
  SALE_RESERVED: "sale_reserved",
  SALE_CONFIRMED: "sale_confirmed",
  DELIVERY_VERIFIED: "delivery_verified",
  PAYOUT_GENERATED: "payout_generated",
  PAYOUT_PROCESSED: "payout_processed",
  SPONSORSHIP_UPDATED: "sponsorship_updated",
};

module.exports = {
  DEAL_STATUS,
  DEAL_TYPE,
  DEAL_FULFILLMENT_MODEL,
  DEAL_VERIFICATION_METHODS,
  DEAL_SALE_STATUS,
  DEAL_PAYOUT_STATUS,
  DEAL_TIMELINE_EVENT,
};
