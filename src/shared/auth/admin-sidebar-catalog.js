const SIDEBAR_MODULES = [
  { moduleName: "Dashboard", moduleKey: "home", moduleSlug: "home", icon: "MdOutlineDashboard", routePath: "/app/home", moduleType: "page", order: 1, parentModule: null, requiredModule: "admin" },

  { moduleName: "Catalog Management", moduleKey: "catalog-management", moduleSlug: "catalog-management", icon: "MdInventory", moduleType: "group", order: 10, parentModule: null, requiredModule: "products" },
  { moduleName: "Products", moduleKey: "products-menu", moduleSlug: "products-menu", icon: "MdListAlt", moduleType: "group", order: 11, parentModule: "catalog-management", requiredModule: "products" },
  { moduleName: "All Products", moduleKey: "product-catalog", moduleSlug: "product-catalog", icon: "MdViewList", routePath: "/app/product-catalog", moduleType: "page", order: 12, parentModule: "products-menu", requiredModule: "products" },
  { moduleName: "Product Moderation Queue", moduleKey: "product-moderation-queue", moduleSlug: "product-moderation-queue", icon: "MdFactCheck", routePath: "/app/product-moderation-queue", moduleType: "page", order: 14, parentModule: "products-menu", requiredModule: "products" },
  { moduleName: "Add Product", moduleKey: "add-product", moduleSlug: "add-product", icon: "MdAddBox", routePath: "/app/product-catalog/form", moduleType: "page", order: 13, parentModule: "products-menu", requiredModule: "products" },

  { moduleName: "Catalog Masters", moduleKey: "catalog-masters", moduleSlug: "catalog-masters", icon: "MdCategory", moduleType: "group", order: 20, parentModule: "catalog-management", requiredModule: "platform" },
  { moduleName: "Category Tree", moduleKey: "categories", moduleSlug: "categories", icon: "MdAccountTree", routePath: "/app/categories", moduleType: "page", order: 21, parentModule: "catalog-masters", requiredModule: "categories" },
  { moduleName: "Brands", moduleKey: "brands", moduleSlug: "brands", icon: "MdBrandingWatermark", routePath: "/app/brands", moduleType: "page", order: 23, parentModule: "catalog-masters", requiredModule: "brands" },
  { moduleName: "Product Families", moduleKey: "product-families", moduleSlug: "product-families", icon: "MdFamilyRestroom", routePath: "/app/product-families", moduleType: "page", order: 24, parentModule: "catalog-masters", requiredModule: "platform" },
  { moduleName: "Option Masters", moduleKey: "product-options", moduleSlug: "product-options", icon: "MdSettings", routePath: "/app/product-options", moduleType: "page", order: 25, parentModule: "catalog-masters", requiredModule: "option_masters" },
  { moduleName: "Option Values", moduleKey: "product-option-values", moduleSlug: "product-option-values", icon: "MdListAlt", routePath: "/app/product-option-values", moduleType: "page", order: 26, parentModule: "catalog-masters", requiredModule: "option_values" },
  { moduleName: "Product Variants", moduleKey: "product-variants", moduleSlug: "product-variants", icon: "MdGridView", routePath: "/app/product-variants", moduleType: "page", order: 27, parentModule: "catalog-masters", requiredModule: "platform" },
  { moduleName: "Product Reviews", moduleKey: "product-reviews", moduleSlug: "product-reviews", icon: "MdReviews", routePath: "/app/product-reviews", moduleType: "page", order: 28, parentModule: "catalog-masters", requiredModule: "reviews" },

  { moduleName: "Inventory Operations", moduleKey: "inventory-management", moduleSlug: "inventory-management", icon: "MdWarehouse", moduleType: "group", order: 50, parentModule: null, requiredModule: "inventory" },
  { moduleName: "Stock Overview", moduleKey: "inventory-overview", moduleSlug: "inventory-overview", icon: "MdDashboard", routePath: "/app/inventory-overview", moduleType: "page", order: 51, parentModule: "inventory-management", requiredModule: "inventory" },
  { moduleName: "Variant Inventory", moduleKey: "variant-inventory", moduleSlug: "variant-inventory", icon: "MdGridView", routePath: "/app/variant-inventory", moduleType: "page", order: 52, parentModule: "inventory-management", requiredModule: "inventory" },
  { moduleName: "Seller Product Inventory", moduleKey: "seller-product-inventory", moduleSlug: "seller-product-inventory", icon: "MdStorefront", routePath: "/app/seller-product-inventory", moduleType: "page", order: 53, parentModule: "inventory-management", requiredModule: "inventory" },
  { moduleName: "Inventory Adjustment", moduleKey: "inventory-adjustment", moduleSlug: "inventory-adjustment", icon: "MdTune", routePath: "/app/inventory-adjustment", moduleType: "page", order: 54, parentModule: "inventory-management", requiredModule: "inventory" },
  { moduleName: "Inventory Transactions", moduleKey: "inventory-transactions", moduleSlug: "inventory-transactions", icon: "MdHistory", routePath: "/app/inventory-transactions", moduleType: "page", order: 55, parentModule: "inventory-management", requiredModule: "inventory" },

  { moduleName: "Orders Management", moduleKey: "orders-management", moduleSlug: "orders-management", icon: "MdShoppingCart", moduleType: "group", order: 70, parentModule: null, requiredModule: "orders" },
  { moduleName: "Orders", moduleKey: "orders", moduleSlug: "orders", icon: "MdReceipt", routePath: "/app/orders", moduleType: "page", order: 71, parentModule: "orders-management", requiredModule: "orders" },
  { moduleName: "Checkout Quotes", moduleKey: "checkout-quote", moduleSlug: "checkout-quote", icon: "MdCalculate", routePath: "/app/checkout-quote", moduleType: "page", order: 72, parentModule: "orders-management", requiredModule: "orders" },
  { moduleName: "Abandoned Carts", moduleKey: "carts", moduleSlug: "carts", icon: "MdShoppingBag", routePath: "/app/carts", moduleType: "page", order: 73, parentModule: "orders-management", requiredModule: "carts" },
  { moduleName: "Subscription Orders", moduleKey: "subscription-orders", moduleSlug: "subscription-orders", icon: "MdSubscriptions", routePath: "/app/subscription-orders", moduleType: "page", order: 74, parentModule: "orders-management", requiredModule: "subscriptions" },

  { moduleName: "Payments & Finance", moduleKey: "payments-finance", moduleSlug: "payments-finance", icon: "MdPayment", moduleType: "group", order: 80, parentModule: null, requiredModule: "payments" },
  { moduleName: "Payments", moduleKey: "payments", moduleSlug: "payments", icon: "MdPayment", routePath: "/app/payments", moduleType: "page", order: 81, parentModule: "payments-finance", requiredModule: "payments" },
  { moduleName: "Chargebacks", moduleKey: "chargebacks", moduleSlug: "chargebacks", icon: "MdSecurityUpdate", routePath: "/app/chargebacks", moduleType: "page", order: 82, parentModule: "payments-finance", requiredModule: "fraud" },
  { moduleName: "Fraud Cases", moduleKey: "fraud-cases", moduleSlug: "fraud-cases", icon: "MdGppBad", routePath: "/app/fraud-cases", moduleType: "page", order: 83, parentModule: "payments-finance", requiredModule: "fraud" },
  { moduleName: "Admin Wallet", moduleKey: "wallet-management", moduleSlug: "wallet-management", icon: "MdAccountBalanceWallet", routePath: "/app/wallet-management", moduleType: "page", order: 84, parentModule: "payments-finance", requiredModule: "wallets" },

  { moduleName: "Shipping & Fulfilment", moduleKey: "shipping-fulfilment", moduleSlug: "shipping-fulfilment", icon: "MdLocalShipping", moduleType: "group", order: 85, parentModule: null, requiredModule: "delivery" },
  { moduleName: "Shipments", moduleKey: "shipment-tracking", moduleSlug: "shipment-tracking", icon: "MdLocalShipping", routePath: "/app/shipment-tracking", moduleType: "page", order: 86, parentModule: "shipping-fulfilment", requiredModule: "delivery" },
  { moduleName: "Delivery Agents", moduleKey: "delivery-agents", moduleSlug: "delivery-agents", icon: "MdPeople", routePath: "/app/delivery-agents", moduleType: "page", order: 87, parentModule: "shipping-fulfilment", requiredModule: "delivery" },
  { moduleName: "Shipping Profiles", moduleKey: "shipping-profiles", moduleSlug: "shipping-profiles", icon: "MdLocalShipping", routePath: "/app/shipping-profiles", moduleType: "page", order: 88, parentModule: "shipping-fulfilment", requiredModule: "delivery" },

  { moduleName: "Returns & Cancellations", moduleKey: "returns-cancellations", moduleSlug: "returns-cancellations", icon: "MdAssignmentReturn", moduleType: "group", order: 90, parentModule: null, requiredModule: "returns" },
  { moduleName: "Return Requests", moduleKey: "returns", moduleSlug: "returns", icon: "MdAssignmentReturn", routePath: "/app/returns", moduleType: "page", order: 91, parentModule: "returns-cancellations", requiredModule: "returns" },
  { moduleName: "Cancellations", moduleKey: "cancellations", moduleSlug: "cancellations", icon: "MdCancel", routePath: "/app/cancellations", moduleType: "page", order: 92, parentModule: "returns-cancellations", requiredModule: "cancellations" },

  { moduleName: "Invoices & Taxation", moduleKey: "invoices-taxation", moduleSlug: "invoices-taxation", icon: "MdReceiptLong", moduleType: "group", order: 94, parentModule: null, requiredModule: "tax" },
  { moduleName: "Tax Invoices", moduleKey: "tax-invoices", moduleSlug: "tax-invoices", icon: "MdReceiptLong", routePath: "/app/tax-invoices", moduleType: "page", order: 95, parentModule: "invoices-taxation", requiredModule: "tax" },
  { moduleName: "Credit Notes", moduleKey: "credit-notes", moduleSlug: "credit-notes", icon: "MdCreditScore", routePath: "/app/credit-notes", moduleType: "page", order: 96, parentModule: "invoices-taxation", requiredModule: "tax" },
  { moduleName: "HSN Codes", moduleKey: "hsn-code", moduleSlug: "hsn-code", icon: "MdQrCode", routePath: "/app/hsn-code", moduleType: "page", order: 97, parentModule: "invoices-taxation", requiredModule: "tax" },
  { moduleName: "Taxes", moduleKey: "tax", moduleSlug: "tax", icon: "MdReceiptLong", routePath: "/app/tax", moduleType: "page", order: 98, parentModule: "invoices-taxation", requiredModule: "tax" },
  { moduleName: "Sub Taxes", moduleKey: "subTax", moduleSlug: "subTax", icon: "MdReceiptLong", routePath: "/app/subTax", moduleType: "page", order: 99, parentModule: "invoices-taxation", requiredModule: "tax" },
  { moduleName: "Tax Rules", moduleKey: "tax-rule", moduleSlug: "tax-rule", icon: "MdRule", routePath: "/app/tax-rule", moduleType: "page", order: 99.1, parentModule: "invoices-taxation", requiredModule: "tax" },
  { moduleName: "Tax Documents", moduleKey: "tax-documents", moduleSlug: "tax-documents", icon: "MdDescription", routePath: "/app/tax-documents", moduleType: "page", order: 99.2, parentModule: "invoices-taxation", requiredModule: "tax" },

  { moduleName: "Seller Finance & Payouts", moduleKey: "seller-finance-payouts", moduleSlug: "seller-finance-payouts", icon: "MdAccountBalanceWallet", moduleType: "group", order: 99.3, parentModule: null, requiredModule: "sellers/commissions" },
  { moduleName: "Seller Finance", moduleKey: "seller-finance", moduleSlug: "seller-finance", icon: "MdAccountBalanceWallet", routePath: "/app/seller-finance", moduleType: "page", order: 99.4, parentModule: "seller-finance-payouts", requiredModule: "sellers/commissions" },
  { moduleName: "Seller Payouts", moduleKey: "seller-payouts", moduleSlug: "seller-payouts", icon: "MdPayments", routePath: "/app/seller-payouts", moduleType: "page", order: 99.5, parentModule: "seller-finance-payouts", requiredModule: "sellers/commissions" },
  { moduleName: "Payout Ops Queue", moduleKey: "payout-ops-queue", moduleSlug: "payout-ops-queue", icon: "MdOutbox", routePath: "/app/payout-ops-queue", moduleType: "page", order: 99.6, parentModule: "seller-finance-payouts", requiredModule: "sellers/commissions" },
  { moduleName: "Negative Balances", moduleKey: "negative-balances", moduleSlug: "negative-balances", icon: "MdMoneyOff", routePath: "/app/negative-balances", moduleType: "page", order: 99.7, parentModule: "seller-finance-payouts", requiredModule: "sellers/commissions" },

  { moduleName: "Commerce Settings", moduleKey: "commerce-settings-menu", moduleSlug: "commerce-settings-menu", icon: "MdSettings", moduleType: "group", order: 99.8, parentModule: null, requiredModule: "admin" },
  { moduleName: "Commerce Config", moduleKey: "commerce-settings", moduleSlug: "commerce-settings", icon: "MdSettings", routePath: "/app/commerce-settings", moduleType: "page", order: 99.81, parentModule: "commerce-settings-menu", requiredModule: "admin" },
  { moduleName: "Coupons & Discounts", moduleKey: "discount-coupons", moduleSlug: "discount-coupons", icon: "MdConfirmationNumber", routePath: "/app/discount-coupons", moduleType: "page", order: 99.82, parentModule: "commerce-settings-menu", requiredModule: "coupons" },
  { moduleName: "Platform Fee", moduleKey: "platform-fee-config", moduleSlug: "platform-fee-config", icon: "MdAccountBalanceWallet", routePath: "/app/platform-fee-config", moduleType: "page", order: 99.83, parentModule: "commerce-settings-menu", requiredModule: "admin" },
  { moduleName: "Commission Rules", moduleKey: "commission-rules", moduleSlug: "commission-rules", icon: "MdRule", routePath: "/app/commission-rules", moduleType: "page", order: 99.84, parentModule: "commerce-settings-menu", requiredModule: "sellers/commissions" },
  { moduleName: "COD Settings", moduleKey: "cod-config", moduleSlug: "cod-config", icon: "MdLocalAtm", routePath: "/app/cod-config", moduleType: "page", order: 99.85, parentModule: "commerce-settings-menu", requiredModule: "cod-config" },
  { moduleName: "Subscription Plans", moduleKey: "subscription-plans", moduleSlug: "subscription-plans", icon: "MdSubscriptions", routePath: "/app/subscription-plans", moduleType: "page", order: 99.86, parentModule: "commerce-settings-menu", requiredModule: "subscriptions" },

  { moduleName: "Users & Access", moduleKey: "users-access", moduleSlug: "users-access", icon: "MdPeople", moduleType: "group", order: 100, parentModule: null, requiredModule: "users" },
  { moduleName: "Customers", moduleKey: "users", moduleSlug: "users", icon: "MdPerson", routePath: "/app/users", moduleType: "page", order: 101, parentModule: "users-access", requiredModule: "users" },
  { moduleName: "Sellers", moduleKey: "seller", moduleSlug: "seller", icon: "MdStorefront", routePath: "/app/seller", moduleType: "page", order: 102, parentModule: "users-access", requiredModule: "sellers" },
  { moduleName: "Admin Users", moduleKey: "admin-users", moduleSlug: "admin-users", icon: "MdAdminPanelSettings", routePath: "/app/admin-users", moduleType: "page", order: 103, parentModule: "users-access", requiredModule: "admin_users" },
  { moduleName: "Seller Users", moduleKey: "seller-users", moduleSlug: "seller-users", icon: "MdGroup", routePath: "/app/seller-users", moduleType: "page", order: 104, parentModule: "users-access", requiredModule: "sellers" },
  { moduleName: "Seller Organizations", moduleKey: "seller-organizations", moduleSlug: "seller-organizations", icon: "MdBusiness", routePath: "/app/seller-organizations", moduleType: "page", order: 104.5, parentModule: "users-access", requiredModule: "sellers" },
  { moduleName: "Roles & Permissions", moduleKey: "roles-permissions", moduleSlug: "roles-permissions", icon: "MdSecurity", routePath: "/app/roles-permissions", moduleType: "page", order: 107, parentModule: "users-access", requiredModule: "rbac" },
  { moduleName: "Module Management", moduleKey: "module-management", moduleSlug: "module-management", icon: "MdViewModule", routePath: "/app/module-management", moduleType: "page", order: 108, parentModule: "users-access", requiredModule: "rbac" },
  { moduleName: "Activity Logs", moduleKey: "activity-logs", moduleSlug: "activity-logs", icon: "MdHistory", routePath: "/app/activity-logs", moduleType: "page", order: 109, parentModule: "users-access", requiredModule: "rbac" },
  { moduleName: "RBAC Audit Log", moduleKey: "rbac-audit-log", moduleSlug: "rbac-audit-log", icon: "MdManageSearch", routePath: "/app/rbac-audit-log", moduleType: "page", order: 110, parentModule: "users-access", requiredModule: "rbac" },
  { moduleName: "Permission Templates", moduleKey: "permission-templates", moduleSlug: "permission-templates", icon: "MdDashboardCustomize", routePath: "/app/permission-templates", moduleType: "page", order: 111, parentModule: "users-access", requiredModule: "rbac" },

  { moduleName: "Marketing", moduleKey: "marketing", moduleSlug: "marketing", icon: "MdCampaign", moduleType: "group", order: 120, parentModule: null, requiredModule: "pricing" },
  { moduleName: "Promotion Banners", moduleKey: "promotions-banners", moduleSlug: "promotions-banners", icon: "MdWeb", routePath: "/app/content-management/promotion-banner", moduleType: "page", order: 125, parentModule: "marketing", requiredModule: "banners" },
  { moduleName: "Referral Programs", moduleKey: "referral-commerce", moduleSlug: "referral-commerce", icon: "MdShare", routePath: "/app/referral-commerce", moduleType: "page", order: 130, parentModule: "marketing", requiredModule: "referral" },

  { moduleName: "Reports & Analytics", moduleKey: "reports-analytics", moduleSlug: "reports-analytics", icon: "MdBarChart", moduleType: "group", order: 150, parentModule: null, requiredModule: "reports" },
  { moduleName: "Sales Reports", moduleKey: "reports-sales", moduleSlug: "reports-sales", icon: "MdTrendingUp", routePath: "/app/reports-sales", moduleType: "page", order: 151, parentModule: "reports-analytics", requiredModule: "reports" },
  { moduleName: "Product Analytics", moduleKey: "reports-products", moduleSlug: "reports-products", icon: "MdInventory", routePath: "/app/reports-products", moduleType: "page", order: 152, parentModule: "reports-analytics", requiredModule: "reports" },
  { moduleName: "Inventory Analytics", moduleKey: "reports-inventory", moduleSlug: "reports-inventory", icon: "MdWarehouse", routePath: "/app/reports-inventory", moduleType: "page", order: 153, parentModule: "reports-analytics", requiredModule: "reports" },
  { moduleName: "Seller Analytics", moduleKey: "reports-sellers", moduleSlug: "reports-sellers", icon: "MdStorefront", routePath: "/app/reports-sellers", moduleType: "page", order: 154, parentModule: "reports-analytics", requiredModule: "reports" },

  { moduleName: "Location Management", moduleKey: "location-management", moduleSlug: "location-management", icon: "MdLocationOn", moduleType: "group", order: 170, parentModule: null, requiredModule: "countries" },
  { moduleName: "Countries", moduleKey: "countries", moduleSlug: "countries", icon: "MdPublic", routePath: "/app/country", moduleType: "page", order: 171, parentModule: "location-management", requiredModule: "countries" },
  { moduleName: "States", moduleKey: "states", moduleSlug: "states", icon: "MdMap", routePath: "/app/state", moduleType: "page", order: 172, parentModule: "location-management", requiredModule: "states" },
  { moduleName: "Cities", moduleKey: "cities", moduleSlug: "cities", icon: "MdLocationCity", routePath: "/app/city", moduleType: "page", order: 173, parentModule: "location-management", requiredModule: "cities" },
  { moduleName: "Zip / Pin Codes", moduleKey: "zip-codes", moduleSlug: "zip-codes", icon: "MdPinDrop", routePath: "/app/zip-codes", moduleType: "page", order: 174, parentModule: "location-management", requiredModule: "zip_codes" },

  { moduleName: "Settings", moduleKey: "settings-menu", moduleSlug: "settings-menu", icon: "CiSettings", moduleType: "group", order: 190, parentModule: null, requiredModule: "cms_pages" },
  { moduleName: "Content Pages", moduleKey: "content-management", moduleSlug: "content-management", icon: "MdArticle", routePath: "/app/content-management", moduleType: "page", order: 191, parentModule: "settings-menu", requiredModule: "cms_pages" },
  { moduleName: "CMS Pages", moduleKey: "content-pages", moduleSlug: "content-pages", icon: "MdPages", routePath: "/app/content-pages", moduleType: "page", order: 192, parentModule: "settings-menu", requiredModule: "cms_pages" },

  // Catalog Masters additions
  { moduleName: "Collections", moduleKey: "collections", moduleSlug: "collections", icon: "MdCollections", routePath: "/app/collections", moduleType: "page", order: 201, parentModule: "catalog-masters", requiredModule: "platform" },
  { moduleName: "Badges", moduleKey: "badges", moduleSlug: "badges", icon: "MdMilitaryTech", routePath: "/app/badges", moduleType: "page", order: 202, parentModule: "catalog-masters", requiredModule: "platform" },

  // Users & Access additions
  { moduleName: "Seller Sub-Admins", moduleKey: "seller-sub-admins", moduleSlug: "seller-sub-admins", icon: "MdSupervisorAccount", routePath: "/app/seller-sub-admins", moduleType: "page", order: 214, parentModule: "users-access", requiredModule: "sellers" },
  { moduleName: "User Addresses", moduleKey: "users-addresses", moduleSlug: "users-addresses", icon: "MdLocationOn", routePath: "/app/users-addresses", moduleType: "page", order: 215, parentModule: "users-access", requiredModule: "users" },

  // Marketing additions
  { moduleName: "Influencers", moduleKey: "influencer-management", moduleSlug: "influencer-management", icon: "MdStarBorder", routePath: "/app/influencer-management", moduleType: "page", order: 216, parentModule: "marketing", requiredModule: "influencer-management" },
  { moduleName: "Notifications", moduleKey: "notifications", moduleSlug: "notifications", icon: "MdNotifications", routePath: "/app/notifications", moduleType: "page", order: 238, parentModule: "marketing", requiredModule: "notifications" },

  // Reports & Analytics additions
  { moduleName: "Analytics Dashboard", moduleKey: "analytics", moduleSlug: "analytics", icon: "MdDashboardCustomize", routePath: "/app/analytics", moduleType: "page", order: 239, parentModule: "reports-analytics", requiredModule: "analytics" },

  // Deals Management (new top-level group, order 160 — appears between Reports and Location)
  { moduleName: "Deals Management", moduleKey: "deals-management", moduleSlug: "deals-management", icon: "MdLocalOffer", moduleType: "group", order: 160, parentModule: null, requiredModule: "deals" },
  { moduleName: "Deals", moduleKey: "deal-management", moduleSlug: "deal-management", icon: "MdLocalOffer", routePath: "/app/deal-management", moduleType: "page", order: 224, parentModule: "deals-management", requiredModule: "deals" },
  { moduleName: "Deal Payouts", moduleKey: "deal-payouts", moduleSlug: "deal-payouts", icon: "MdPayments", routePath: "/app/deal-payouts", moduleType: "page", order: 225, parentModule: "deals-management", requiredModule: "deals" },
  { moduleName: "Deal Sponsorships", moduleKey: "deal-sponsorships", moduleSlug: "deal-sponsorships", icon: "MdHandshake", routePath: "/app/deal-sponsorships", moduleType: "page", order: 226, parentModule: "deals-management", requiredModule: "deals" },

  // System Administration (new top-level group, order 175 — appears between Location and Settings)
  { moduleName: "System Administration", moduleKey: "system-admin", moduleSlug: "system-admin", icon: "MdAdminPanelSettings", moduleType: "group", order: 175, parentModule: null, requiredModule: "admin" },
  { moduleName: "Event Log", moduleKey: "analytics-events", moduleSlug: "analytics-events", icon: "MdEventNote", routePath: "/app/analytics-events", moduleType: "page", order: 227, parentModule: "system-admin", requiredModule: "analytics-events" },
  { moduleName: "Notif. Templates", moduleKey: "notification-templates", moduleSlug: "notification-templates", icon: "MdNotificationsActive", routePath: "/app/notification-templates", moduleType: "page", order: 228, parentModule: "system-admin", requiredModule: "notification-templates" },
  { moduleName: "API Keys", moduleKey: "api-keys", moduleSlug: "api-keys", icon: "MdKey", routePath: "/app/api-keys", moduleType: "page", order: 229, parentModule: "system-admin", requiredModule: "api-keys" },
  { moduleName: "Platform Features", moduleKey: "feature-flags", moduleSlug: "feature-flags", icon: "MdFlag", routePath: "/app/feature-flags", moduleType: "page", order: 230, parentModule: "system-admin", requiredModule: "feature-flags" },
  { moduleName: "Webhooks", moduleKey: "webhooks", moduleSlug: "webhooks", icon: "MdWebhook", routePath: "/app/webhooks", moduleType: "page", order: 231, parentModule: "system-admin", requiredModule: "webhooks" },
  { moduleName: "System Status", moduleKey: "system-health", moduleSlug: "system-health", icon: "MdMonitorHeart", routePath: "/app/system-health", moduleType: "page", order: 232, parentModule: "system-admin", requiredModule: "system-health" },
  { moduleName: "Job Queues", moduleKey: "queue-management", moduleSlug: "queue-management", icon: "MdQueuePlayNext", routePath: "/app/queue-management", moduleType: "page", order: 233, parentModule: "system-admin", requiredModule: "queue-management" },
  { moduleName: "Failed Jobs", moduleKey: "dead-letter-queue", moduleSlug: "dead-letter-queue", icon: "MdOutbox", routePath: "/app/dead-letter-queue", moduleType: "page", order: 234, parentModule: "system-admin", requiredModule: "dead-letter-queue" },
  { moduleName: "Preferences", moduleKey: "preferences", moduleSlug: "preferences", icon: "MdTune", routePath: "/app/preferences", moduleType: "page", order: 235, parentModule: "system-admin", requiredModule: "admin" },
];

const SELLER_SIDEBAR_MODULES = [
  { moduleName: "Seller Dashboard", moduleKey: "seller-home", moduleSlug: "seller-home", icon: "MdOutlineDashboard", routePath: "/app/home", moduleType: "page", order: 1, parentModule: null, requiredModule: "analytics" },

  { moduleName: "Seller Catalog", moduleKey: "seller-catalog-management", moduleSlug: "seller-catalog-management", icon: "MdInventory", moduleType: "group", order: 10, parentModule: null, requiredModule: "products" },
  { moduleName: "Seller Products", moduleKey: "seller-product-catalog", moduleSlug: "seller-product-catalog", icon: "MdViewList", routePath: "/app/product-catalog", moduleType: "page", order: 11, parentModule: "seller-catalog-management", requiredModule: "products" },
  { moduleName: "Add Product", moduleKey: "seller-add-product", moduleSlug: "seller-add-product", icon: "MdAddBox", routePath: "/app/product-catalog/form", moduleType: "page", order: 12, parentModule: "seller-catalog-management", requiredModule: "products" },

  { moduleName: "Seller Inventory", moduleKey: "seller-inventory-management", moduleSlug: "seller-inventory-management", icon: "MdWarehouse", moduleType: "group", order: 20, parentModule: null, requiredModule: "inventory" },
  { moduleName: "Inventory", moduleKey: "seller-inventory-overview", moduleSlug: "seller-inventory-overview", icon: "MdDashboard", routePath: "/app/inventory-overview", moduleType: "page", order: 21, parentModule: "seller-inventory-management", requiredModule: "inventory" },
  { moduleName: "Low Stock Alerts", moduleKey: "seller-low-stock-alerts", moduleSlug: "seller-low-stock-alerts", icon: "MdWarning", routePath: "/app/low-stock-alerts", moduleType: "page", order: 22, parentModule: "seller-inventory-management", requiredModule: "inventory" },

  { moduleName: "Seller Orders", moduleKey: "seller-orders-management", moduleSlug: "seller-orders-management", icon: "MdShoppingCart", moduleType: "group", order: 30, parentModule: null, requiredModule: "orders" },
  { moduleName: "Seller Order List", moduleKey: "seller-orders", moduleSlug: "seller-orders", icon: "MdReceipt", routePath: "/app/orders", moduleType: "page", order: 31, parentModule: "seller-orders-management", requiredModule: "orders" },
  { moduleName: "Seller Shipments", moduleKey: "seller-shipment-tracking", moduleSlug: "seller-shipment-tracking", icon: "MdLocalShipping", routePath: "/app/shipment-tracking", moduleType: "page", order: 32, parentModule: "seller-orders-management", requiredModule: "delivery" },
  { moduleName: "My Shipping Profiles", moduleKey: "seller-shipping-profiles", moduleSlug: "seller-shipping-profiles", icon: "MdLocalShipping", routePath: "/app/shipping-profiles", moduleType: "page", order: 33, parentModule: "seller-orders-management", requiredModule: "delivery" },
  { moduleName: "Returns", moduleKey: "seller-returns", moduleSlug: "seller-returns", icon: "MdAssignmentReturn", routePath: "/app/returns", moduleType: "page", order: 34, parentModule: "seller-orders-management", requiredModule: "returns" },

  { moduleName: "Seller Commerce", moduleKey: "seller-commerce-settings", moduleSlug: "seller-commerce-settings", icon: "MdSettings", moduleType: "group", order: 35, parentModule: null, requiredModule: "cod-config" },
  { moduleName: "COD Settings", moduleKey: "seller-cod-config", moduleSlug: "seller-cod-config", icon: "MdLocalAtm", routePath: "/app/cod-config", moduleType: "page", order: 36, parentModule: "seller-commerce-settings", requiredModule: "cod-config" },

  { moduleName: "Seller Marketing", moduleKey: "seller-marketing", moduleSlug: "seller-marketing", icon: "MdCampaign", moduleType: "group", order: 40, parentModule: null, requiredModule: "pricing" },
  { moduleName: "My Coupons", moduleKey: "seller-discount-coupons", moduleSlug: "seller-discount-coupons", icon: "MdConfirmationNumber", routePath: "/app/discount-coupons", moduleType: "page", order: 41, parentModule: "seller-marketing", requiredModule: "pricing" },
  { moduleName: "Seller Notifications", moduleKey: "seller-messages", moduleSlug: "seller-messages", icon: "MdNotifications", routePath: "/app/messages", moduleType: "page", order: 42, parentModule: "seller-marketing", requiredModule: "notifications" },

  { moduleName: "Seller Access", moduleKey: "seller-users-access", moduleSlug: "seller-users-access", icon: "MdPeople", moduleType: "group", order: 50, parentModule: null, requiredModule: "sellers" },
  { moduleName: "Profile", moduleKey: "seller-profile", moduleSlug: "seller-profile", icon: "MdStorefront", routePath: "/app/profile", moduleType: "page", order: 51, parentModule: "seller-users-access", requiredModule: "sellers" },
  { moduleName: "Organizations", moduleKey: "seller-my-organizations", moduleSlug: "seller-my-organizations", icon: "MdBusiness", routePath: "/app/my-organizations", moduleType: "page", order: 52, parentModule: "seller-users-access", requiredModule: "sellers" },
  { moduleName: "Access Management", moduleKey: "seller-access-management", moduleSlug: "seller-access-management", icon: "MdGroup", routePath: "/app/seller-users", moduleType: "page", order: 53, parentModule: "seller-users-access", requiredModule: "sellers" },

  { moduleName: "My Finance & Payouts", moduleKey: "seller-finance-payouts-menu", moduleSlug: "seller-finance-payouts-menu", icon: "MdAccountBalanceWallet", moduleType: "group", order: 60, parentModule: null, requiredModule: "sellers/commissions" },
  { moduleName: "Transactions & Commissions", moduleKey: "seller-commissions", moduleSlug: "seller-commissions", icon: "MdAccountBalanceWallet", routePath: "/app/seller-finance", moduleType: "page", order: 61, parentModule: "seller-finance-payouts-menu", requiredModule: "sellers/commissions" },
  { moduleName: "Payouts", moduleKey: "seller-payout-history", moduleSlug: "seller-payout-history", icon: "MdPayments", routePath: "/app/seller-payouts", moduleType: "page", order: 62, parentModule: "seller-finance-payouts-menu", requiredModule: "sellers/commissions" },

  { moduleName: "Seller Invoices", moduleKey: "seller-invoices-taxation", moduleSlug: "seller-invoices-taxation", icon: "MdReceiptLong", moduleType: "group", order: 65, parentModule: null, requiredModule: "tax" },
  { moduleName: "GST Invoices", moduleKey: "seller-tax-invoices", moduleSlug: "seller-tax-invoices", icon: "MdReceiptLong", routePath: "/app/tax-invoices", moduleType: "page", order: 66, parentModule: "seller-invoices-taxation", requiredModule: "tax" },
  { moduleName: "Credit Notes", moduleKey: "seller-credit-notes", moduleSlug: "seller-credit-notes", icon: "MdCreditScore", routePath: "/app/credit-notes", moduleType: "page", order: 67, parentModule: "seller-invoices-taxation", requiredModule: "tax" },

  { moduleName: "My Reports", moduleKey: "seller-reports-analytics", moduleSlug: "seller-reports-analytics", icon: "MdBarChart", moduleType: "group", order: 70, parentModule: null, requiredModule: "reports" },
  { moduleName: "Seller Reports", moduleKey: "seller-reports-sales", moduleSlug: "seller-reports-sales", icon: "MdTrendingUp", routePath: "/app/reports-sales", moduleType: "page", order: 71, parentModule: "seller-reports-analytics", requiredModule: "reports" },
].map((module) => ({
  ...module,
  allowedRoles: ["seller", "seller-admin", "seller-sub-admin"],
}));

const ROUTE_METADATA_BY_KEY = {
  "admin-users": { supportedRoutes: ["/app/admin-users/view/:id"] },
  users: {
    supportedRoutes: [
      "/app/users/view/:id",
      "/app/users-addresses",
      "/app/transactions",
      "/app/transactions/view/:id",
    ],
  },
  seller: {
    supportedRoutes: [
      "/app/seller/view/:id",
      "/app/seller-kyc",
      "/app/seller-bank",
      "/app/seller-onboarding",
      "/app/seller-status",
      "/app/seller-kyc-detail/:id",
      "/app/seller-bank-detail/:id",
    ],
  },
  "seller-users": {
    supportedRoutes: [
      "/app/seller-management",
      "/app/seller-staff",
      "/app/user-permissions/:id",
    ],
  },
  "seller-access-management": {
    supportedRoutes: ["/app/user-permissions/:id"],
  },
  transactions: { supportedRoutes: ["/app/transactions/view/:id"] },
  "product-catalog": {
    supportedRoutes: [
      "/app/store",
      "/app/bar-code",
      "/app/product-catalog/form/:id?",
      "/app/product-catalog/view/:id",
    ],
  },
  "seller-add-product": {
    supportedRoutes: [
      "/app/product-catalog/form/:id?",
      "/app/product-catalog/view/:id",
    ],
  },
  "inventory-overview": {
    supportedRoutes: [
      "/app/warehouse",
      "/app/low-stock-alerts",
      "/app/threshold-products",
      "/app/inventory-audit",
    ],
  },
  "seller-product-inventory": {
    supportedRoutes: ["/app/seller-Product-Inventory"],
  },
  orders: { supportedRoutes: ["/app/orders/view/:id", "/app/view-orders"] },
  "seller-orders": { supportedRoutes: ["/app/orders/view/:id", "/app/view-orders"] },
  "content-management": { supportedRoutes: ["/app/content-management/:type"] },
  "product-options": { supportedRoutes: ["/app/product-option-value/:id"] },
  "product-option-values": { supportedRoutes: ["/app/product-option-value/:id"] },
  subTax: { supportedRoutes: ["/app/subTax/:id"] },
  "shipment-tracking": {
    supportedRoutes: [
      "/app/shipping-company-users",
      "/app/shipping-packages",
      "/app/pickup-addresses",
    ],
  },
  "delivery-agents": { supportedRoutes: ["/app/delivery-staff"] },
  "shipping-profiles": { supportedRoutes: ["/app/shipping-profiles"] },
  "seller-shipping-profiles": { supportedRoutes: ["/app/shipping-profiles"] },
  "wallet-management": { supportedRoutes: ["/app/wallet-transactions"] },
  categories: { supportedRoutes: ["/app/category-attributes"] },
};

const withRouteMetadata = (module) => {
  const routeMetadata = ROUTE_METADATA_BY_KEY[module.moduleKey] || {};
  return {
    ...module,
    metadata: {
      ...(module.metadata || {}),
      ...routeMetadata,
    },
  };
};

module.exports = {
  SIDEBAR_MODULES: [...SIDEBAR_MODULES, ...SELLER_SIDEBAR_MODULES].map(withRouteMetadata),
};
