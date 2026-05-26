const {
  DEFAULT_PLATFORM_MODULES,
  DEFAULT_SELLER_MODULES,
} = require("./module-catalog");

const ROLES_WITH_MODULE_ACCESS = new Set(["admin", "sub-admin", "seller-admin", "seller-sub-admin"]);

const MODULE_ALIASES = {
  "admin-users": "rbac",
  admin_users: "rbac",
  "user-permissions": "rbac",
  user_permissions: "rbac",
  "seller-users": "sellers",
  seller_users: "sellers",
  "seller-staff": "sellers",
  seller_staff: "sellers",
  "seller-management": "sellers",
  seller_management: "sellers",
  country: "locations",
  countries: "locations",
  state: "locations",
  states: "locations",
  city: "locations",
  cities: "locations",
  zipcode: "locations",
  zipcodes: "locations",
  "zip-code": "locations",
  "zip-codes": "locations",
  pincode: "locations",
  pincodes: "locations",
  "pin-code": "locations",
  "pin-codes": "locations",
  "hsn-code": "tax",
  "hsn-codes": "tax",
  product: "products",
  "product-catalog": "products",
  seller: "sellers",
  vendors: "sellers",
  commissions: "sellers/commissions",
  "seller-commissions": "sellers/commissions",
  seller_commissions: "sellers/commissions",
  order: "orders",
  "order-status": "orders",
  order_status: "orders",
  coupon: "pricing",
  coupons: "pricing",
  "discount-coupons": "pricing",
  discount_coupons: "pricing",
  "promotion-banners": "cms",
  promotion_banners: "cms",
  "content-management": "cms",
  content_management: "cms",
  messages: "notifications",
  "shipping-packages": "delivery",
  shipping_packages: "delivery",
  "dynamic-pricing": "dynamic-pricing",
  dynamic_pricing: "dynamic-pricing",
  "referral-commerce": "referral",
  referral_commerce: "referral",
};

function cleanModuleName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return MODULE_ALIASES[normalized] || normalized;
}

function getRequestModule(req) {
  const withoutQuery = String(req.originalUrl || "").split("?")[0];
  const parts = withoutQuery.split("/").filter(Boolean);
  const apiIndex = parts.indexOf("api");
  if (apiIndex === -1 || parts.length <= apiIndex + 2) {
    return null;
  }
  const first = parts[apiIndex + 2];
  const second = parts[apiIndex + 3];
  const third = parts[apiIndex + 4];
  const fourth = parts[apiIndex + 5];

  if (first === "admin") {
    if (
      second === "access" &&
      third === "modules"
    ) {
      return null;
    }

    if (second === "platform" && third === "hsn-codes") {
      return "tax";
    }

    if (second === "platform" && third === "product-reviews") {
      return "orders";
    }

    if (second === "products" && (third === "inventory" || fourth === "inventory")) {
      return "inventory";
    }

    if (second === "platform" && ["categories", "brands"].includes(third)) {
      return "platform";
    }

    if (second === "common" && ["countries", "states", "cities", "zip-codes"].includes(third)) {
      return "locations";
    }

    if (second === "common" && ["taxes", "sub-taxes", "tax-rules"].includes(third)) {
      return "tax";
    }

    if (second === "platform" && third === "content-pages") {
      return "cms";
    }

    const adminModuleMap = {
      access: "rbac",
      cms: "cms",
      dashboard: "admin",
      "seller-users": "sellers",
      users: "users",
      "admin-users": "rbac",
      vendors: "sellers",
      products: "products",
      orders: "orders",
      payments: "payments",
      payouts: "payments",
      tax: "tax",
      common: "platform",
      platform: "platform",
      analytics: "analytics",
      returns: "returns",
      chargebacks: "fraud",
      referral: "referral",
      system: "admin",
    };

    if (second === "platform" && third === "feature-flags") {
      return "admin";
    }

    return adminModuleMap[second] || "admin";
  }

  if (first === "sellers" && second === "commissions") {
    return "sellers/commissions";
  }
  if (first === "rbac" && second === "modules" && third === "sidebar") {
    return null;
  }
  if (first === "sellers" && second === "me" && third === "dashboard") {
    return "analytics";
  }
  if (first === "sellers" && second === "me" && third === "tracking") {
    return "orders";
  }
  if (first === "sellers" && second === "me" && third === "access") {
    return "sellers";
  }
  if (first === "platform" && second === "cms") {
    return "cms";
  }
  if (first === "platform" && second === "hsn-codes") {
    return "tax";
  }
  if (first === "platform" && second === "product-reviews") {
    return "orders";
  }
  if (first === "products" && (second === "inventory" || third === "inventory")) {
    return "inventory";
  }
  if (first === "platform" && ["categories", "brands"].includes(second)) {
    return "platform";
  }
  if (first === "coupons") {
    return "pricing";
  }
  if (first === "pricing" && second === "promotion-banners") {
    return "cms";
  }
  return cleanModuleName(first);
}

function usesModuleAccess(auth) {
  const roles = [
    auth?.role,
    ...(Array.isArray(auth?.roles) ? auth.roles : []),
  ].filter(Boolean);

  return roles.some((role) => ROLES_WITH_MODULE_ACCESS.has(role));
}

module.exports = {
  DEFAULT_PLATFORM_MODULES,
  DEFAULT_SELLER_MODULES,
  cleanModuleName,
  getRequestModule,
  usesModuleAccess,
};
