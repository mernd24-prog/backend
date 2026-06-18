const PRODUCT_STATUS = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  ACTIVE: "active",
  CHANGE_PENDING: "change_pending",
  INACTIVE: "inactive",
  REJECTED: "rejected",
  ARCHIVED: "archived",
  SCHEDULED: "scheduled",
};

const PRODUCT_TYPE = {
  SIMPLE: "simple",
  VARIABLE: "variable",
  DIGITAL: "digital",
  BUNDLE: "bundle",
  SUBSCRIPTION: "subscription",
};

const PRODUCT_VISIBILITY = {
  PUBLIC: "public",
  PRIVATE: "private",
  HIDDEN: "hidden",
  SCHEDULED: "scheduled",
};

const PRODUCT_REVISION_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const PRODUCT_REVISION_WORKFLOW_STATUS = {
  NONE: "none",
  CHANGE_PENDING: "change_pending",
};

const DIGITAL_FILE_TYPE = {
  EBOOK: "ebook",
  SOFTWARE: "software",
  COURSE: "course",
  TEMPLATE: "template",
  AUDIO: "audio",
  VIDEO: "video",
  OTHER: "other",
};

const SUBSCRIPTION_BILLING_CYCLE = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  YEARLY: "yearly",
};

const INVENTORY_TRANSACTION_TYPE = {
  PURCHASE: "purchase",
  SALE: "sale",
  RETURN: "return",
  ADJUSTMENT: "adjustment",
  RESERVATION: "reservation",
  RELEASE: "release",
  DAMAGE: "damage",
  TRANSFER: "transfer",
};

const PRODUCT_BADGE_TYPE = {
  NEW: "new",
  SALE: "sale",
  HOT: "hot",
  FEATURED: "featured",
  LIMITED: "limited",
  BESTSELLER: "bestseller",
  EXCLUSIVE: "exclusive",
};

const ORDER_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  PAYMENT_FAILED: "payment_failed",
  CONFIRMED: "confirmed",
  PACKED: "packed",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  RETURN_REQUESTED: "return_requested",
  PARTIALLY_RETURNED: "partially_returned",
  RETURNED: "returned",
  CANCELLED: "cancelled",
  FULFILLED: "fulfilled",
};

const PAYMENT_STATUS = {
  INITIATED: "initiated",
  AUTHORIZED: "authorized",
  CAPTURED: "captured",
  FAILED: "failed",
  PARTIALLY_REFUNDED: "partially_refunded",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
};

const PAYMENT_PROVIDER = {
  RAZORPAY: "razorpay",
  STRIPE: "stripe",
  COD: "cod",
  MANUAL_BANK_TRANSFER: "manual_bank_transfer",
  MANUAL_UPI: "manual_upi",
  WALLET_ONLY: "wallet_only",
};

const KYC_STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  VERIFIED: "verified",
  REJECTED: "rejected",
};

const KYC_ENTITY_TYPE = {
  SELLER: "seller",
  USER: "user",
};

const DOCUMENT_STATUS = {
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected",
};

const COUPON_TYPE = {
  PERCENTAGE: "percentage",
  FIXED: "fixed",
};

const WALLET_TRANSACTION_TYPE = {
  CREDIT: "credit",
  DEBIT: "debit",
};

const WALLET_TRANSACTION_STATUS = {
  HELD: "held",
  COMPLETED: "completed",
  RELEASED: "released",
};

module.exports = {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
  PRODUCT_REVISION_STATUS,
  PRODUCT_REVISION_WORKFLOW_STATUS,
  DIGITAL_FILE_TYPE,
  SUBSCRIPTION_BILLING_CYCLE,
  INVENTORY_TRANSACTION_TYPE,
  PRODUCT_BADGE_TYPE,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  KYC_STATUS,
  KYC_ENTITY_TYPE,
  DOCUMENT_STATUS,
  COUPON_TYPE,
  WALLET_TRANSACTION_TYPE,
  WALLET_TRANSACTION_STATUS,
};
