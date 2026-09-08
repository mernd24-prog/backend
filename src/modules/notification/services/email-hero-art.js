const HERO_ART = {
  auth: {
    symbol: "",
    accessory: "envelope",
  },
  order: {
    symbol: "",
    accessory: "box",
  },
  delivery: {
    symbol: "",
    accessory: "box",
  },
  return: {
    symbol: "",
    accessory: "box",
  },
  money: {
    symbol: "",
    accessory: "receipt",
  },
  seller: {
    symbol: "",
    accessory: "document",
  },
  support: {
    symbol: "",
    accessory: "chat",
  },
  inventory: {
    symbol: "",
    accessory: "document",
  },
  alert: {
    symbol: "",
    accessory: "mail",
  },
  account: {
    symbol: "",
    accessory: "shield",
  },
};

function pickHeroType(key = "") {
  const value = String(key || "").toLowerCase();
  if (/failed|rejected|cancelled|low_stock|alert/.test(value)) return "alert";
  if (/auth|otp|password|verification/.test(value)) return "auth";
  if (/shipment|delivered|tracking/.test(value)) return "delivery";
  if (/return|refund|credit_note/.test(value)) return "return";
  if (/payout|reward|growth|paid/.test(value)) return "money";
  if (/seller|onboarding|kyc/.test(value)) return "seller";
  if (/support|ticket|query/.test(value)) return "support";
  if (/stock|inventory|product/.test(value)) return "inventory";
  if (/welcome|account/.test(value)) return "account";
  if (/order|payment|invoice/.test(value)) return "order";
  return "auth";
}

function trimTrailingSlash(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

function getCustomerAppBaseUrl() {
  return trimTrailingSlash(
    process.env.CUSTOMER_APP_BASE_URL ||
      process.env.FRONTEND_PUBLIC_URL ||
      process.env.APP_PUBLIC_URL ||
      "",
  );
}

function heroImageUrlForType(type = "auth") {
  const envKey = `EMAIL_${String(type || "auth").toUpperCase()}_HERO_URL`;
  const explicitUrl = process.env[envKey] || (type === "auth" ? process.env.EMAIL_AUTH_HERO_URL : "");
  if (explicitUrl) return explicitUrl;

  const baseUrl = getCustomerAppBaseUrl();
  if (!baseUrl) return "";

  const imageByType = {
    auth: "auth-security-hero.png",
    account: "auth-security-hero.png",
    order: "order-commerce-hero.png",
    inventory: "order-commerce-hero.png",
    seller: "order-commerce-hero.png",
    delivery: "delivery-shipment-hero.png",
    return: "money-payment-hero.png",
    money: "money-payment-hero.png",
    support: "support-alert-hero.png",
    alert: "support-alert-hero.png",
  };
  const filename = imageByType[type] || imageByType.auth;
  return `${baseUrl}/email-assets/${filename}`;
}

function escapeAttribute(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function accessoryIcon(type) {
  return "";
}

function renderHeroArt(key = "", options = {}) {
  return "";
}

module.exports = {
  pickHeroType,
  renderHeroArt,
};
