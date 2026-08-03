const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { env } = require("../../../config/env");

const SETTINGS_KEY = "commerce_policy";

const DEFAULT_SETTINGS = {
  productWorkflow: {
    moderationRevisionTiming: "parallel",
    revisionDiffStatus: "in_progress",
    notes: "Admin moderation queues and active-product revision diff screens should move in parallel with checkout finance work.",
  },
  checkout: {
    figmaSignoffStatus: "pending",
    figmaSignoffTargetDate: "2026-06-17",
    figmaSignoffDate: null,
    multiSellerOrderMode: "single_order",
    multiSellerPolicyLocked: true,
  },
  payments: {
    razorpaySandboxStatus: "pending",
    razorpaySandboxTargetDate: "2026-06-18",
    razorpaySandboxKeyAvailable: false,
    gatewayFeePolicy: "platform_absorbs",
    gateway: "razorpay",
    refundPolicy: "manual_review",
  },
  platformFees: {
    customerFeeType: "fixed",
    customerFeeValue: 0,
    customerFeeTaxRate: 0,
    sellerCommissionType: "percentage",
    sellerCommissionValue: 0,
    gstRate: 18,
    calculationBase: "subtotal",
  },
  cod: {
    enabled: true,
    availabilityMode: "all_pincodes",
    allowPincodes: [],
    blockPincodes: [],
    collectionPolicy: "platform_or_courier",
    payoutRequiresCapture: true,
    feeAmount: 0,
    minOrderAmount: null,
    maxOrderAmount: null,
  },
  returns: {
    // One platform-owned policy is snapshotted when delivery is verified.
    defaultWindowDays: 7,
    allowSellerOverrides: false,
    maxSellerOverrideDays: 7,
    refundPolicy: {
      shipping: {
        fullCancellation: true,
        sellerCancellation: true,
        rtoDeliveryFailed: true,
        customerReturn: false,
        partialReturn: false,
      },
      platformFee: {
        fullCancellation: true,
        sellerCancellation: true,
        rtoDeliveryFailed: false,
        customerReturn: false,
        partialReturn: false,
      },
    },
  },
  shippingDefaults: {
    defaultCharge: 0,
    freeShippingThreshold: null,
    handlingFee: 0,
    shippingMethod: "standard",
  },
  templates: [
    { id: "standard_seller", name: "Standard Seller", active: true, description: "Default marketplace commerce rules." },
    { id: "premium_seller", name: "Premium Seller", active: true, description: "Reduced friction settings for high quality sellers." },
    { id: "local_seller", name: "Local Seller", active: true, description: "Local delivery and tight regional serviceability." },
    { id: "grocery_seller", name: "Grocery Seller", active: true, description: "Fast moving grocery and COD friendly defaults." },
    { id: "heavy_item_seller", name: "Heavy Item Seller", active: true, description: "Higher shipping and handling defaults." },
    { id: "electronics_seller", name: "Electronics Seller", active: true, description: "Electronics focused shipping, COD, and payout rules." },
  ],
  sellerTiers: [
    { id: "bronze", name: "Bronze", active: true, platformFeeType: "percentage", platformFeeValue: 0, codCharge: 0, payoutDelayDays: 7, commissionPercent: 0 },
    { id: "silver", name: "Silver", active: true, platformFeeType: "percentage", platformFeeValue: 0, codCharge: 0, payoutDelayDays: 5, commissionPercent: 0 },
    { id: "gold", name: "Gold", active: true, platformFeeType: "percentage", platformFeeValue: 0, codCharge: 0, payoutDelayDays: 3, commissionPercent: 0 },
    { id: "platinum", name: "Platinum", active: true, platformFeeType: "percentage", platformFeeValue: 0, codCharge: 0, payoutDelayDays: 2, commissionPercent: 0 },
    { id: "enterprise", name: "Enterprise", active: true, platformFeeType: "percentage", platformFeeValue: 0, codCharge: 0, payoutDelayDays: 1, commissionPercent: 0 },
  ],
  wallet: {
    partialPaymentMode: "user_opt_in",
    autoApplyMaxPercent: env.commerce.maxWalletUsagePerOrderPercent,
  },
  finance: {
    sellerPayoutBase: "gross_customer_price",
    platformFeeTaxRate: 18,
    chargePlatformFeeTaxToSeller: true,
    payoutReleaseMilestone: "return_window_closed",
    payoutSchedule: "manual",
    payoutManualApprovalRequired: true,
    minimumPayoutAmount: 0,
    shippingPolicy: "reimburse_seller",
    gstTcsEnabled: false,
    gstTcsRate: 0.5,
    incomeTaxTdsEnabled: false,
    incomeTaxTdsRate: 0.1,
  },
};

const ALLOWED = {
  productWorkflow: {
    moderationRevisionTiming: ["parallel", "after_checkout_plan"],
    revisionDiffStatus: ["not_started", "in_progress", "blocked", "ready", "done"],
  },
  checkout: {
    figmaSignoffStatus: ["pending", "signed_off", "blocked", "not_required"],
    multiSellerOrderMode: ["single_order", "split_by_seller"],
  },
  payments: {
    razorpaySandboxStatus: ["pending", "available", "blocked", "not_required"],
    gatewayFeePolicy: ["platform_absorbs", "seller_deducted", "split"],
    gateway: ["razorpay", "cashfree", "stripe", "manual"],
    refundPolicy: ["manual_review", "auto_after_return", "instant_wallet", "gateway_original"],
  },
  platformFees: {
    feeType: ["fixed", "percentage"],
    calculationBase: ["product_price", "order_total", "subtotal"],
  },
  cod: {
    availabilityMode: ["all_pincodes", "allowlist", "blocklist", "disabled"],
    collectionPolicy: ["platform_or_courier", "seller_direct", "hybrid"],
  },
  returns: {},
  wallet: {
    partialPaymentMode: ["user_opt_in", "auto_apply", "disabled"],
  },
  finance: {
    sellerPayoutBase: ["gross_customer_price", "taxable_ex_gst"],
    payoutReleaseMilestone: ["return_window_closed"],
    payoutSchedule: ["manual", "daily", "weekly", "monthly"],
    shippingPolicy: ["not_in_seller_payout", "reimburse_seller", "deduct_from_seller"],
  },
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const uniqueStrings = (items = []) =>
  Array.from(
    new Set(
      (Array.isArray(items) ? items : String(items || "").split(","))
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );

const normalizeTemplateList = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter(isPlainObject)
    .map((item) => ({
      id: String(item.id || item.key || item.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name: String(item.name || item.label || "Commerce Template").trim(),
      description: String(item.description || ""),
      active: bool(item.active, true),
      version: String(item.version || "v1"),
      settings: isPlainObject(item.settings) ? item.settings : {},
      sellerIds: uniqueStrings(item.sellerIds || item.assignedSellerIds),
    }))
    .filter((item) => item.id && item.name);

const normalizeTierList = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter(isPlainObject)
    .map((item) => ({
      id: String(item.id || item.key || item.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name: String(item.name || item.label || "Seller Tier").trim(),
      active: bool(item.active, true),
      platformFeeType: pickAllowed(item.platformFeeType || item.feeType, ALLOWED.platformFees.feeType, "percentage"),
      platformFeeValue: Math.max(num(item.platformFeeValue || item.feeValue, 0), 0),
      codCharge: Math.max(num(item.codCharge, 0), 0),
      payoutDelayDays: Math.min(Math.max(num(item.payoutDelayDays, 0), 0), 365),
      commissionPercent: Math.min(Math.max(num(item.commissionPercent, 0), 0), 100),
      shippingBenefits: String(item.shippingBenefits || ""),
      freeShippingRule: String(item.freeShippingRule || ""),
      prioritySupport: bool(item.prioritySupport, false),
      upgradeRule: String(item.upgradeRule || ""),
    }))
    .filter((item) => item.id && item.name);

const num = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return Boolean(value);
};

const pickAllowed = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

const normalizeRefundComponentPolicy = (source = {}, fallback = {}) => ({
  fullCancellation: bool(source.fullCancellation, fallback.fullCancellation),
  sellerCancellation: bool(source.sellerCancellation, fallback.sellerCancellation),
  rtoDeliveryFailed: bool(source.rtoDeliveryFailed, fallback.rtoDeliveryFailed),
  customerReturn: bool(source.customerReturn, fallback.customerReturn),
  partialReturn: bool(source.partialReturn, fallback.partialReturn),
});

class CommerceSettingsService {
  async ensureTable() {
    await knex.schema.createTableIfNotExists("admin_settings", (table) => {
      table.string("setting_key", 96).primary();
      table.jsonb("setting_value").notNullable().defaultTo({});
      table.string("updated_by", 64).nullable();
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  mergeSettings(base = DEFAULT_SETTINGS, override = {}) {
    const merged = { ...base };
    for (const [section, value] of Object.entries(override || {})) {
      if (isPlainObject(value) && isPlainObject(merged[section])) {
        merged[section] = { ...merged[section], ...value };
      } else if (value !== undefined) {
        merged[section] = value;
      }
    }
    return this.normalize(merged);
  }

  normalize(payload = {}) {
    const source = this.mergeRaw(DEFAULT_SETTINGS, payload);
    return {
      productWorkflow: {
        moderationRevisionTiming: pickAllowed(
          source.productWorkflow.moderationRevisionTiming,
          ALLOWED.productWorkflow.moderationRevisionTiming,
          DEFAULT_SETTINGS.productWorkflow.moderationRevisionTiming,
        ),
        revisionDiffStatus: pickAllowed(
          source.productWorkflow.revisionDiffStatus,
          ALLOWED.productWorkflow.revisionDiffStatus,
          DEFAULT_SETTINGS.productWorkflow.revisionDiffStatus,
        ),
        notes: String(source.productWorkflow.notes || ""),
      },
      checkout: {
        figmaSignoffStatus: pickAllowed(
          source.checkout.figmaSignoffStatus,
          ALLOWED.checkout.figmaSignoffStatus,
          DEFAULT_SETTINGS.checkout.figmaSignoffStatus,
        ),
        figmaSignoffTargetDate: source.checkout.figmaSignoffTargetDate || DEFAULT_SETTINGS.checkout.figmaSignoffTargetDate,
        figmaSignoffDate: source.checkout.figmaSignoffDate || null,
        multiSellerOrderMode: pickAllowed(
          source.checkout.multiSellerOrderMode,
          ALLOWED.checkout.multiSellerOrderMode,
          DEFAULT_SETTINGS.checkout.multiSellerOrderMode,
        ),
        multiSellerPolicyLocked: bool(source.checkout.multiSellerPolicyLocked, true),
      },
      payments: {
        razorpaySandboxStatus: pickAllowed(
          source.payments.razorpaySandboxStatus,
          ALLOWED.payments.razorpaySandboxStatus,
          DEFAULT_SETTINGS.payments.razorpaySandboxStatus,
        ),
        razorpaySandboxTargetDate: source.payments.razorpaySandboxTargetDate || DEFAULT_SETTINGS.payments.razorpaySandboxTargetDate,
        razorpaySandboxKeyAvailable: bool(source.payments.razorpaySandboxKeyAvailable, false),
        gatewayFeePolicy: pickAllowed(
          source.payments.gatewayFeePolicy,
          ALLOWED.payments.gatewayFeePolicy,
          DEFAULT_SETTINGS.payments.gatewayFeePolicy,
        ),
        gateway: pickAllowed(
          source.payments.gateway,
          ALLOWED.payments.gateway,
          DEFAULT_SETTINGS.payments.gateway,
        ),
        refundPolicy: pickAllowed(
          source.payments.refundPolicy,
          ALLOWED.payments.refundPolicy,
          DEFAULT_SETTINGS.payments.refundPolicy,
        ),
      },
      platformFees: {
        customerFeeType: pickAllowed(
          source.platformFees.customerFeeType,
          ALLOWED.platformFees.feeType,
          DEFAULT_SETTINGS.platformFees.customerFeeType,
        ),
        customerFeeValue: Math.max(num(source.platformFees.customerFeeValue, 0), 0),
        customerFeeTaxRate: Math.min(Math.max(num(source.platformFees.customerFeeTaxRate, 0), 0), 100),
        sellerCommissionType: pickAllowed(
          source.platformFees.sellerCommissionType || source.platformFees.sellerFeeType,
          ALLOWED.platformFees.feeType,
          DEFAULT_SETTINGS.platformFees.sellerCommissionType,
        ),
        sellerCommissionValue: Math.max(num(
          source.platformFees.sellerCommissionValue ?? source.platformFees.sellerFeeValue,
          0,
        ), 0),
        gstRate: Math.min(Math.max(num(source.platformFees.gstRate, 18), 0), 100),
        calculationBase: pickAllowed(
          source.platformFees.calculationBase,
          ALLOWED.platformFees.calculationBase,
          DEFAULT_SETTINGS.platformFees.calculationBase,
        ),
      },
      cod: {
        enabled: bool(source.cod.enabled, true),
        availabilityMode: pickAllowed(
          source.cod.availabilityMode,
          ALLOWED.cod.availabilityMode,
          DEFAULT_SETTINGS.cod.availabilityMode,
        ),
        allowPincodes: uniqueStrings(source.cod.allowPincodes),
        blockPincodes: uniqueStrings(source.cod.blockPincodes),
        collectionPolicy: pickAllowed(
          source.cod.collectionPolicy,
          ALLOWED.cod.collectionPolicy,
          DEFAULT_SETTINGS.cod.collectionPolicy,
        ),
        payoutRequiresCapture: bool(source.cod.payoutRequiresCapture, true),
        feeAmount: Math.max(num(source.cod.feeAmount, 0), 0),
        minOrderAmount: source.cod.minOrderAmount === "" || source.cod.minOrderAmount === undefined || source.cod.minOrderAmount === null
          ? null
          : Math.max(num(source.cod.minOrderAmount, 0), 0),
        maxOrderAmount: source.cod.maxOrderAmount === "" || source.cod.maxOrderAmount === undefined || source.cod.maxOrderAmount === null
          ? null
          : Math.max(num(source.cod.maxOrderAmount, 0), 0),
      },
      returns: {
        defaultWindowDays: Math.min(Math.max(num(source.returns.defaultWindowDays, 7), 1), 60),
        allowSellerOverrides: bool(source.returns.allowSellerOverrides, false),
        maxSellerOverrideDays: Math.min(Math.max(num(source.returns.maxSellerOverrideDays, 7), 1), 60),
        refundPolicy: {
          shipping: normalizeRefundComponentPolicy(
            source.returns.refundPolicy?.shipping,
            DEFAULT_SETTINGS.returns.refundPolicy.shipping,
          ),
          platformFee: normalizeRefundComponentPolicy(
            source.returns.refundPolicy?.platformFee,
            DEFAULT_SETTINGS.returns.refundPolicy.platformFee,
          ),
        },
      },
      shippingDefaults: {
        defaultCharge: Math.max(num(source.shippingDefaults.defaultCharge, 0), 0),
        freeShippingThreshold: source.shippingDefaults.freeShippingThreshold === "" || source.shippingDefaults.freeShippingThreshold === undefined || source.shippingDefaults.freeShippingThreshold === null
          ? null
          : Math.max(num(source.shippingDefaults.freeShippingThreshold, 0), 0),
        handlingFee: Math.max(num(source.shippingDefaults.handlingFee, 0), 0),
        shippingMethod: String(source.shippingDefaults.shippingMethod || DEFAULT_SETTINGS.shippingDefaults.shippingMethod),
      },
      templates: normalizeTemplateList(source.templates).length
        ? normalizeTemplateList(source.templates)
        : DEFAULT_SETTINGS.templates,
      sellerTiers: normalizeTierList(source.sellerTiers).length
        ? normalizeTierList(source.sellerTiers)
        : DEFAULT_SETTINGS.sellerTiers,
      wallet: {
        partialPaymentMode: pickAllowed(
          source.wallet.partialPaymentMode,
          ALLOWED.wallet.partialPaymentMode,
          DEFAULT_SETTINGS.wallet.partialPaymentMode,
        ),
        autoApplyMaxPercent: Math.min(Math.max(num(source.wallet.autoApplyMaxPercent, env.commerce.maxWalletUsagePerOrderPercent), 0), 100),
      },
      finance: {
        sellerPayoutBase: pickAllowed(
          source.finance.sellerPayoutBase,
          ALLOWED.finance.sellerPayoutBase,
          DEFAULT_SETTINGS.finance.sellerPayoutBase,
        ),
        platformFeeTaxRate: Math.min(Math.max(num(source.finance.platformFeeTaxRate, 18), 0), 100),
        chargePlatformFeeTaxToSeller: bool(source.finance.chargePlatformFeeTaxToSeller, true),
        payoutReleaseMilestone: pickAllowed(
          source.finance.payoutReleaseMilestone,
          ALLOWED.finance.payoutReleaseMilestone,
          DEFAULT_SETTINGS.finance.payoutReleaseMilestone,
        ),
        payoutSchedule: pickAllowed(
          source.finance.payoutSchedule,
          ALLOWED.finance.payoutSchedule,
          DEFAULT_SETTINGS.finance.payoutSchedule,
        ),
        payoutManualApprovalRequired: bool(
          source.finance.payoutManualApprovalRequired,
          DEFAULT_SETTINGS.finance.payoutManualApprovalRequired,
        ),
        minimumPayoutAmount: Math.max(
          num(source.finance.minimumPayoutAmount, DEFAULT_SETTINGS.finance.minimumPayoutAmount),
          0,
        ),
        shippingPolicy: pickAllowed(
          source.finance.shippingPolicy,
          ALLOWED.finance.shippingPolicy,
          DEFAULT_SETTINGS.finance.shippingPolicy,
        ),
        gstTcsEnabled: bool(source.finance.gstTcsEnabled, DEFAULT_SETTINGS.finance.gstTcsEnabled),
        gstTcsRate: Math.min(Math.max(num(source.finance.gstTcsRate, DEFAULT_SETTINGS.finance.gstTcsRate), 0), 100),
        incomeTaxTdsEnabled: bool(source.finance.incomeTaxTdsEnabled, DEFAULT_SETTINGS.finance.incomeTaxTdsEnabled),
        incomeTaxTdsRate: Math.min(Math.max(num(source.finance.incomeTaxTdsRate, DEFAULT_SETTINGS.finance.incomeTaxTdsRate), 0), 100),
      },
    };
  }

  mergeRaw(base, override = {}) {
    return Object.entries(base).reduce((acc, [section, sectionDefaults]) => {
      const sectionOverride = isPlainObject(override[section]) ? override[section] : {};
      acc[section] = { ...sectionDefaults, ...sectionOverride };
      return acc;
    }, {});
  }

  async getSettings() {
    await this.ensureTable();
    const [row] = await knex("admin_settings")
      .where("setting_key", SETTINGS_KEY)
      .limit(1);
    const stored = row?.setting_value || {};
    return this.mergeSettings(DEFAULT_SETTINGS, stored);
  }

  async updateSettings(payload = {}, actor = {}) {
    await this.ensureTable();
    const current = await this.getSettings();
    const next = this.mergeSettings(current, payload);
    const row = {
      setting_key: SETTINGS_KEY,
      setting_value: next,
      updated_by: actor.userId || actor.sub || null,
      updated_at: knex.fn.now(),
    };
    const [saved] = await knex("admin_settings")
      .insert({ ...row, created_at: knex.fn.now() })
      .onConflict("setting_key")
      .merge(row)
      .returning("*");
    return saved?.setting_value || next;
  }

  async getRuntimeSummary() {
    const settings = await this.getSettings();
    return {
      settings,
      runtime: {
        razorpay: {
          configured: env.razorpay.configured,
          enabled: env.razorpay.enabled,
          mode: env.razorpay.mode,
          liveRequested: env.razorpay.liveRequested,
          missingKeys: env.razorpay.missingKeys,
        },
        razorpayX: {
          configured: env.razorpayX.configured,
          enabled: env.razorpayX.enabled,
          mode: env.razorpayX.mode,
          liveRequested: env.razorpayX.liveRequested,
          missingKeys: env.razorpayX.missingKeys,
        },
        commerce: {
          businessState: env.commerce.businessState,
          maxWalletUsagePerOrderPercent: env.commerce.maxWalletUsagePerOrderPercent,
        },
      },
    };
  }

  isCodAllowedForAddress(settings, address = {}) {
    const cod = settings?.cod || DEFAULT_SETTINGS.cod;
    if (cod.availabilityMode === "disabled") return false;
    if (cod.availabilityMode === "all_pincodes") return true;

    const pin = String(
      address.postalCode ||
      address.postal_code ||
      address.zip ||
      address.pincode ||
      "",
    ).trim();
    if (!pin) return cod.availabilityMode !== "allowlist";

    if (cod.availabilityMode === "allowlist") {
      return (cod.allowPincodes || []).includes(pin);
    }
    if (cod.availabilityMode === "blocklist") {
      return !(cod.blockPincodes || []).includes(pin);
    }
    return true;
  }
}

const commerceSettingsService = new CommerceSettingsService();

module.exports = {
  CommerceSettingsService,
  commerceSettingsService,
  DEFAULT_SETTINGS,
};
