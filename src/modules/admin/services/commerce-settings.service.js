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
  },
  cod: {
    availabilityMode: "all_pincodes",
    allowPincodes: [],
    blockPincodes: [],
    collectionPolicy: "platform_or_courier",
    payoutRequiresCapture: true,
  },
  wallet: {
    partialPaymentMode: "user_opt_in",
    autoApplyMaxPercent: env.commerce.maxWalletUsagePerOrderPercent,
  },
  finance: {
    sellerPayoutBase: "gross_customer_price",
    platformFeeTaxRate: 18,
    chargePlatformFeeTaxToSeller: true,
    payoutReleaseMilestone: "delivered_or_fulfilled",
    shippingPolicy: "not_in_seller_payout",
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
  },
  cod: {
    availabilityMode: ["all_pincodes", "allowlist", "blocklist", "disabled"],
    collectionPolicy: ["platform_or_courier", "seller_direct", "hybrid"],
  },
  wallet: {
    partialPaymentMode: ["user_opt_in", "auto_apply", "disabled"],
  },
  finance: {
    sellerPayoutBase: ["gross_customer_price", "taxable_ex_gst"],
    payoutReleaseMilestone: ["confirmed", "delivered_or_fulfilled", "return_window_closed"],
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

const num = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) =>
  value === undefined || value === null ? fallback : Boolean(value);

const pickAllowed = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

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
      },
      cod: {
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
      },
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
        shippingPolicy: pickAllowed(
          source.finance.shippingPolicy,
          ALLOWED.finance.shippingPolicy,
          DEFAULT_SETTINGS.finance.shippingPolicy,
        ),
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
