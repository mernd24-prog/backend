const HERO_ART = {
  auth: {
    symbol: "&#128274;",
    accessory: "envelope",
  },
  order: {
    symbol: "&#128722;",
    accessory: "box",
  },
  delivery: {
    symbol: "&#128666;",
    accessory: "box",
  },
  return: {
    symbol: "&#8635;",
    accessory: "box",
  },
  money: {
    symbol: "&#8377;",
    accessory: "receipt",
  },
  seller: {
    symbol: "&#127970;",
    accessory: "document",
  },
  support: {
    symbol: "&#9993;",
    accessory: "chat",
  },
  inventory: {
    symbol: "&#128230;",
    accessory: "document",
  },
  alert: {
    symbol: "&#9888;",
    accessory: "mail",
  },
  account: {
    symbol: "&#128100;",
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
  if (type === "chat") return "&#128172;";
  if (type === "receipt") return "&#129534;";
  if (type === "document") return "&#128196;";
  if (type === "shield") return "&#128737;";
  if (type === "box") return "&#128230;";
  return "&#9993;";
}

function renderHeroArt(key = "", options = {}) {
  const type = options.type || pickHeroType(key);
  const imageUrl = heroImageUrlForType(type);
  if (imageUrl) {
    return `<img class="sg-hero-art" src="${escapeAttribute(imageUrl)}" width="168" height="95" alt="" style="display:block;width:168px;max-width:168px;height:auto;border:0;outline:none;text-decoration:none;">`;
  }

  const art = HERO_ART[type] || HERO_ART.auth;
  return `
    <table role="presentation" class="sg-hero-art" width="168" cellpadding="0" cellspacing="0" style="width:168px;max-width:168px;border-collapse:collapse;">
      <tr>
        <td colspan="3" align="right" style="height:14px;font-size:12px;line-height:14px;color:#8fb1ff;">&#10022;&nbsp;&nbsp;&nbsp;&#183;</td>
      </tr>
      <tr>
        <td width="46" align="center" valign="middle" style="padding-top:34px;">
          <span style="display:inline-block;width:46px;height:34px;background:#2f55d4;border:1px solid #6f8cff;border-radius:8px;color:#dbe6ff;font-size:22px;line-height:34px;text-align:center;">${accessoryIcon(art.accessory)}</span>
        </td>
        <td width="90" align="center" valign="middle">
          <table role="presentation" width="84" cellpadding="0" cellspacing="0" style="width:84px;border-collapse:collapse;">
            <tr>
              <td align="center" style="height:90px;background:#4965e8;border:3px solid #8ba5ff;border-radius:36px 36px 44px 44px;box-shadow:inset 0 0 0 6px #203bb6;color:#ffffff;">
                <table role="presentation" width="46" cellpadding="0" cellspacing="0" style="width:46px;margin:0 auto;border-collapse:collapse;">
                  <tr>
                    <td align="center" style="height:42px;background:#ffffff;border-radius:10px;color:#061044;font-size:24px;line-height:42px;font-weight:700;">${art.symbol}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
        <td width="32" align="center" valign="middle" style="padding-top:42px;color:#f2a900;font-size:22px;line-height:1;">&#10148;</td>
      </tr>
      <tr>
        <td colspan="3" align="center" style="height:14px;font-size:1px;line-height:1px;">
          <div style="width:104px;height:1px;border-top:2px dashed #d9a327;">&nbsp;</div>
        </td>
      </tr>
    </table>`;
}

module.exports = {
  pickHeroType,
  renderHeroArt,
};
