const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { AppError } = require("../../../shared/errors/app-error");

const TABLE_NAME = "seller_charge_settings";

const DEFAULT_SELLER_CHARGE_SETTINGS = {
  cod: {
    enabled: true,
    chargeMode: "inherit",
    chargeAmount: 0,
    minOrderAmount: null,
    maxOrderAmount: null,
    availabilityMode: "inherit",
    allowPincodes: [],
    blockPincodes: [],
    notes: "",
  },
  delivery: {
    mode: "none",
    chargeAmount: 0,
    freeDeliveryMinOrderAmount: null,
    notes: "",
  },
  metadata: {},
};

const ALLOWED = {
  codChargeMode: ["inherit", "none", "flat"],
  codAvailabilityMode: ["inherit", "all_pincodes", "allowlist", "blocklist", "disabled"],
  deliveryMode: ["none", "flat", "free_over_amount"],
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const pickAllowed = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

const money = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : fallback;
};

const nullableMoney = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return money(value, 0);
};

const bool = (value, fallback = false) =>
  value === undefined || value === null ? fallback : Boolean(value);

const uniqueStrings = (items = []) =>
  Array.from(
    new Set(
      (Array.isArray(items) ? items : String(items || "").split(","))
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );

class SellerChargeSettingsService {
  async ensureTable() {
    await knex.schema.createTableIfNotExists(TABLE_NAME, (table) => {
      table.string("seller_id", 64).primary();
      table.jsonb("settings").notNullable().defaultTo({});
      table.string("updated_by", 64).nullable();
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  resolveSellerId(actor = {}) {
    const sellerId = actor.ownerSellerId || actor.parentSellerId || actor.userId;
    if (!sellerId) {
      throw new AppError("Seller context is required", 400);
    }
    return String(sellerId);
  }

  mergeRaw(base = DEFAULT_SELLER_CHARGE_SETTINGS, override = {}) {
    return Object.entries(base).reduce((acc, [section, defaults]) => {
      const sectionOverride = isPlainObject(override[section]) ? override[section] : {};
      acc[section] = isPlainObject(defaults)
        ? { ...defaults, ...sectionOverride }
        : override[section] ?? defaults;
      return acc;
    }, {});
  }

  normalize(payload = {}) {
    const source = this.mergeRaw(DEFAULT_SELLER_CHARGE_SETTINGS, payload);
    const minOrderAmount = nullableMoney(source.cod.minOrderAmount);
    const maxOrderAmount = nullableMoney(source.cod.maxOrderAmount);
    const freeDeliveryMinOrderAmount = nullableMoney(source.delivery.freeDeliveryMinOrderAmount);

    return {
      cod: {
        enabled: bool(source.cod.enabled, true),
        chargeMode: pickAllowed(source.cod.chargeMode, ALLOWED.codChargeMode, "inherit"),
        chargeAmount: Math.max(money(source.cod.chargeAmount), 0),
        minOrderAmount,
        maxOrderAmount,
        availabilityMode: pickAllowed(source.cod.availabilityMode, ALLOWED.codAvailabilityMode, "inherit"),
        allowPincodes: uniqueStrings(source.cod.allowPincodes),
        blockPincodes: uniqueStrings(source.cod.blockPincodes),
        notes: String(source.cod.notes || ""),
      },
      delivery: {
        mode: pickAllowed(source.delivery.mode, ALLOWED.deliveryMode, "none"),
        chargeAmount: Math.max(money(source.delivery.chargeAmount), 0),
        freeDeliveryMinOrderAmount,
        notes: String(source.delivery.notes || ""),
      },
      metadata: isPlainObject(source.metadata) ? source.metadata : {},
    };
  }

  withSellerId(sellerId, settings) {
    return {
      sellerId: String(sellerId),
      ...this.normalize(settings),
    };
  }

  async getSettings(sellerId) {
    if (!sellerId) throw new AppError("Seller id is required", 400);
    await this.ensureTable();
    const [row] = await knex(TABLE_NAME)
      .where("seller_id", String(sellerId))
      .limit(1);
    return this.withSellerId(sellerId, row?.settings || {});
  }

  async getSettingsMap(sellerIds = []) {
    await this.ensureTable();
    const uniqueSellerIds = Array.from(new Set((sellerIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
    const map = new Map();
    uniqueSellerIds.forEach((sellerId) => {
      map.set(sellerId, this.withSellerId(sellerId, {}));
    });
    if (!uniqueSellerIds.length) return map;

    const rows = await knex(TABLE_NAME).whereIn("seller_id", uniqueSellerIds);
    rows.forEach((row) => {
      map.set(String(row.seller_id), this.withSellerId(row.seller_id, row.settings || {}));
    });
    return map;
  }

  async listSettings(query = {}) {
    await this.ensureTable();
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const search = String(query.search || "").trim();

    const baseQuery = knex(TABLE_NAME);
    if (search) {
      baseQuery.where("seller_id", "ilike", `%${search}%`);
    }

    const countQuery = baseQuery.clone().count({ count: "*" }).first();
    const rowsQuery = baseQuery
      .clone()
      .orderBy("updated_at", "desc")
      .limit(limit)
      .offset(offset);
    const [countRow, rows] = await Promise.all([countQuery, rowsQuery]);

    return {
      items: rows.map((row) => ({
        ...this.withSellerId(row.seller_id, row.settings || {}),
        updatedBy: row.updated_by || null,
        updatedAt: row.updated_at || null,
      })),
      pagination: {
        limit,
        offset,
        total: Number(countRow?.count || 0),
      },
    };
  }

  async updateSettings(sellerId, payload = {}, actor = {}) {
    if (!sellerId) throw new AppError("Seller id is required", 400);
    await this.ensureTable();
    const current = await this.getSettings(sellerId);
    const next = this.normalize({
      cod: { ...current.cod, ...(payload.cod || {}) },
      delivery: { ...current.delivery, ...(payload.delivery || {}) },
      metadata: { ...(current.metadata || {}), ...(payload.metadata || {}) },
    });
    const row = {
      seller_id: String(sellerId),
      settings: next,
      updated_by: actor.userId || actor.sub || null,
      updated_at: knex.fn.now(),
    };
    const [saved] = await knex(TABLE_NAME)
      .insert({ ...row, created_at: knex.fn.now() })
      .onConflict("seller_id")
      .merge(row)
      .returning("*");
    return {
      ...this.withSellerId(sellerId, saved?.settings || next),
      updatedBy: saved?.updated_by || row.updated_by,
      updatedAt: saved?.updated_at || new Date().toISOString(),
    };
  }

  getPostalCode(address = {}) {
    return String(
      address.postalCode ||
      address.postal_code ||
      address.pincode ||
      address.zip ||
      "",
    ).trim();
  }

  isSellerCodAllowed(settings, address = {}) {
    const mode = settings?.cod?.availabilityMode || "inherit";
    if (mode === "inherit" || mode === "all_pincodes") return true;
    if (mode === "disabled") return false;

    const pin = this.getPostalCode(address);
    if (!pin) return mode !== "allowlist";

    if (mode === "allowlist") {
      return (settings.cod.allowPincodes || []).includes(pin);
    }
    if (mode === "blocklist") {
      return !(settings.cod.blockPincodes || []).includes(pin);
    }
    return true;
  }

  groupItemsBySeller(pricedItems = []) {
    const grouped = new Map();
    for (const item of pricedItems || []) {
      const sellerId = String(item.sellerId || "platform");
      const current = grouped.get(sellerId) || {
        sellerId,
        amount: 0,
        quantity: 0,
      };
      current.amount += money(item.discountedLineTotal ?? item.lineTotal);
      current.quantity += Number(item.quantity || 0);
      grouped.set(sellerId, current);
    }
    return grouped;
  }

  async evaluateCodForItems(pricedItems = [], address = {}) {
    const groups = this.groupItemsBySeller(pricedItems);
    const settingsMap = await this.getSettingsMap([...groups.keys()]);
    const sellers = [];
    const blockers = [];
    let sellerChargeAmount = 0;

    for (const group of groups.values()) {
      const settings = settingsMap.get(group.sellerId) || this.withSellerId(group.sellerId, {});
      const cod = settings.cod;
      let allowed = true;
      let reason = null;

      if (!cod.enabled) {
        allowed = false;
        reason = "seller_cod_disabled";
      } else if (!this.isSellerCodAllowed(settings, address)) {
        allowed = false;
        reason = "seller_cod_pincode_restricted";
      } else if (cod.minOrderAmount !== null && group.amount < cod.minOrderAmount) {
        allowed = false;
        reason = "seller_cod_min_order_not_met";
      } else if (cod.maxOrderAmount !== null && group.amount > cod.maxOrderAmount) {
        allowed = false;
        reason = "seller_cod_max_order_exceeded";
      }

      const chargeAmount = allowed && cod.chargeMode === "flat" ? money(cod.chargeAmount) : 0;
      sellerChargeAmount += chargeAmount;
      const sellerResult = {
        sellerId: group.sellerId,
        orderAmount: money(group.amount),
        quantity: group.quantity,
        allowed,
        reason,
        chargeMode: cod.chargeMode,
        chargeAmount,
        availabilityMode: cod.availabilityMode,
      };
      sellers.push(sellerResult);
      if (!allowed) blockers.push(sellerResult);
    }

    return {
      allowed: blockers.length === 0,
      sellerChargeAmount: money(sellerChargeAmount),
      sellers,
      blockers,
    };
  }

  async calculateDeliveryCharges(pricedItems = [], address = {}) {
    const groups = this.groupItemsBySeller(pricedItems);
    const settingsMap = await this.getSettingsMap([...groups.keys()]);
    const sellers = [];
    let totalAmount = 0;

    for (const group of groups.values()) {
      const settings = settingsMap.get(group.sellerId) || this.withSellerId(group.sellerId, {});
      const delivery = settings.delivery;
      let chargeAmount = 0;

      if (delivery.mode === "flat") {
        chargeAmount = money(delivery.chargeAmount);
      } else if (delivery.mode === "free_over_amount") {
        const threshold = nullableMoney(delivery.freeDeliveryMinOrderAmount);
        chargeAmount = threshold !== null && group.amount >= threshold
          ? 0
          : money(delivery.chargeAmount);
      }

      totalAmount += chargeAmount;
      sellers.push({
        sellerId: group.sellerId,
        orderAmount: money(group.amount),
        quantity: group.quantity,
        mode: delivery.mode,
        chargeAmount,
        freeDeliveryMinOrderAmount: delivery.freeDeliveryMinOrderAmount,
      });
    }

    return {
      amount: money(totalAmount),
      breakup: {
        method: "seller_delivery_charge",
        taxPolicy: "exclusive_product_tax_only",
        addressPincode: this.getPostalCode(address),
        sellers,
      },
    };
  }
}

const sellerChargeSettingsService = new SellerChargeSettingsService();

module.exports = {
  SellerChargeSettingsService,
  sellerChargeSettingsService,
  DEFAULT_SELLER_CHARGE_SETTINGS,
};
