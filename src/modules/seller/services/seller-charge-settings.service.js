const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { AppError } = require("../../../shared/errors/app-error");
const { ShippingProfilesService } = require("../../delivery/services/shipping-profiles.service");

const TABLE_NAME = "seller_charge_settings";
const GLOBAL_ORGANIZATION_KEY = "seller_default";

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
    serviceabilityMode: "all_pincodes",
    allowPincodes: [],
    blockPincodes: [],
    regions: [],
    productRules: [],
    orderRules: [],
    regionRules: [],
    estimatedDaysMin: null,
    estimatedDaysMax: null,
    shippingPartner: "",
    shippingMethod: "standard",
    handlingCharge: 0,
    notes: "",
  },
  metadata: {},
};

const shippingProfilesService = new ShippingProfilesService();

const ALLOWED = {
  codChargeMode: ["inherit", "none", "flat"],
  codAvailabilityMode: ["inherit", "all_pincodes", "allowlist", "blocklist", "disabled"],
  deliveryMode: ["none", "flat", "free_over_amount", "product", "order", "region", "rule_based"],
  deliveryServiceabilityMode: ["all_pincodes", "allowlist", "blocklist", "regions", "disabled"],
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

const normalizeRuleList = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter(isPlainObject)
    .map((item) => ({
      ...item,
      productId: item.productId ? String(item.productId).trim() : "",
      productSku: item.productSku ? String(item.productSku).trim() : "",
      name: String(item.name || item.label || "").trim(),
      chargeAmount: Math.max(money(item.chargeAmount), 0),
      handlingCharge: Math.max(money(item.handlingCharge), 0),
      freeDeliveryMinOrderAmount: nullableMoney(item.freeDeliveryMinOrderAmount),
      minOrderAmount: nullableMoney(item.minOrderAmount),
      maxOrderAmount: nullableMoney(item.maxOrderAmount),
      serviceablePincodes: uniqueStrings(item.serviceablePincodes || item.allowPincodes),
      blockPincodes: uniqueStrings(item.blockPincodes),
      regions: uniqueStrings(item.regions),
      states: uniqueStrings(item.states),
      cities: uniqueStrings(item.cities),
      estimatedDaysMin: item.estimatedDaysMin === "" || item.estimatedDaysMin === undefined || item.estimatedDaysMin === null
        ? null
        : Number(item.estimatedDaysMin),
      estimatedDaysMax: item.estimatedDaysMax === "" || item.estimatedDaysMax === undefined || item.estimatedDaysMax === null
        ? null
        : Number(item.estimatedDaysMax),
      shippingPartner: String(item.shippingPartner || item.partner || "").trim(),
      shippingMethod: String(item.shippingMethod || item.method || "").trim(),
      codAvailable: item.codAvailable === undefined ? null : Boolean(item.codAvailable),
      active: item.active !== false,
    }));

class SellerChargeSettingsService {
  async ensureTable() {
    const hasTable = await knex.schema.hasTable(TABLE_NAME);
    if (!hasTable) {
      await knex.schema.createTable(TABLE_NAME, (table) => {
        table.string("seller_id", 64).notNullable();
        table.uuid("organization_id").nullable();
        table.jsonb("settings").notNullable().defaultTo({});
        table.string("updated_by", 64).nullable();
        table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      });
    }
    const hasOrganizationId = await knex.schema.hasColumn(TABLE_NAME, "organization_id");
    if (!hasOrganizationId) {
      await knex.schema.alterTable(TABLE_NAME, (table) => {
        table.uuid("organization_id").nullable();
      });
    }
    await knex.raw(`ALTER TABLE ${TABLE_NAME} DROP CONSTRAINT IF EXISTS seller_charge_settings_pkey`);
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_charge_settings_scope
      ON ${TABLE_NAME} (seller_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
    `);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_seller_charge_settings_org ON ${TABLE_NAME} (organization_id)`);
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
        serviceabilityMode: pickAllowed(
          source.delivery.serviceabilityMode,
          ALLOWED.deliveryServiceabilityMode,
          "all_pincodes",
        ),
        allowPincodes: uniqueStrings(source.delivery.allowPincodes),
        blockPincodes: uniqueStrings(source.delivery.blockPincodes),
        regions: uniqueStrings(source.delivery.regions),
        productRules: normalizeRuleList(source.delivery.productRules),
        orderRules: normalizeRuleList(source.delivery.orderRules),
        regionRules: normalizeRuleList(source.delivery.regionRules),
        estimatedDaysMin: source.delivery.estimatedDaysMin === "" || source.delivery.estimatedDaysMin === undefined
          ? null
          : Number(source.delivery.estimatedDaysMin),
        estimatedDaysMax: source.delivery.estimatedDaysMax === "" || source.delivery.estimatedDaysMax === undefined
          ? null
          : Number(source.delivery.estimatedDaysMax),
        shippingPartner: String(source.delivery.shippingPartner || ""),
        shippingMethod: String(source.delivery.shippingMethod || "standard"),
        handlingCharge: Math.max(money(source.delivery.handlingCharge), 0),
        notes: String(source.delivery.notes || ""),
      },
      metadata: isPlainObject(source.metadata) ? source.metadata : {},
    };
  }

  normalizeOrganizationId(organizationId) {
    const value = String(organizationId || "").trim();
    return value || null;
  }

  scopeKey(sellerId, organizationId = null) {
    return `${String(sellerId || "")}:${this.normalizeOrganizationId(organizationId) || GLOBAL_ORGANIZATION_KEY}`;
  }

  rowScopeQuery(query, sellerId, organizationId = null) {
    query.where("seller_id", String(sellerId));
    const normalizedOrganizationId = this.normalizeOrganizationId(organizationId);
    if (normalizedOrganizationId) {
      query.where("organization_id", normalizedOrganizationId);
    } else {
      query.whereNull("organization_id");
    }
    return query;
  }

  withSellerId(sellerId, settings, organizationId = null, source = "default") {
    return {
      sellerId: String(sellerId),
      organizationId: this.normalizeOrganizationId(organizationId),
      scope: this.normalizeOrganizationId(organizationId) ? "organization" : "seller",
      source,
      ...this.normalize(settings),
    };
  }

  async getSettings(sellerId, organizationId = null, options = {}) {
    if (!sellerId) throw new AppError("Seller id is required", 400);
    await this.ensureTable();
    const normalizedOrganizationId = this.normalizeOrganizationId(organizationId);
    const [row] = await this.rowScopeQuery(knex(TABLE_NAME), sellerId, normalizedOrganizationId).limit(1);
    if (row) {
      return this.withSellerId(sellerId, row.settings || {}, row.organization_id, "saved");
    }
    if (normalizedOrganizationId && options.fallbackToSeller !== false) {
      const [fallbackRow] = await this.rowScopeQuery(knex(TABLE_NAME), sellerId, null).limit(1);
      return this.withSellerId(
        sellerId,
        fallbackRow?.settings || {},
        normalizedOrganizationId,
        fallbackRow ? "seller_fallback" : "default",
      );
    }
    return this.withSellerId(sellerId, {}, normalizedOrganizationId, "default");
  }

  normalizeScopeInput(input) {
    if (input && typeof input === "object") {
      return {
        sellerId: String(input.sellerId || input.seller_id || "").trim(),
        organizationId: this.normalizeOrganizationId(input.organizationId || input.organization_id),
      };
    }
    const raw = String(input || "").trim();
    if (!raw) return { sellerId: "", organizationId: null };
    const [sellerId, organizationId] = raw.split(":");
    return {
      sellerId: String(sellerId || "").trim(),
      organizationId: organizationId && organizationId !== GLOBAL_ORGANIZATION_KEY
        ? this.normalizeOrganizationId(organizationId)
        : null,
    };
  }

  async getSettingsMap(scopes = []) {
    await this.ensureTable();
    const uniqueScopes = Array.from(
      new Map(
        (scopes || [])
          .map((scope) => this.normalizeScopeInput(scope))
          .filter((scope) => scope.sellerId)
          .map((scope) => [this.scopeKey(scope.sellerId, scope.organizationId), scope]),
      ).values(),
    );
    const uniqueSellerIds = Array.from(new Set(uniqueScopes.map((scope) => scope.sellerId)));
    const map = new Map();
    uniqueScopes.forEach((scope) => {
      map.set(this.scopeKey(scope.sellerId, scope.organizationId), this.withSellerId(scope.sellerId, {}, scope.organizationId));
    });
    if (!uniqueSellerIds.length) return map;

    const rows = await knex(TABLE_NAME).whereIn("seller_id", uniqueSellerIds);
    const rowsByScope = new Map();
    rows.forEach((row) => {
      rowsByScope.set(this.scopeKey(row.seller_id, row.organization_id), row);
    });
    uniqueScopes.forEach((scope) => {
      const key = this.scopeKey(scope.sellerId, scope.organizationId);
      const exact = rowsByScope.get(key);
      const fallback = rowsByScope.get(this.scopeKey(scope.sellerId, null));
      if (exact) {
        map.set(key, this.withSellerId(exact.seller_id, exact.settings || {}, exact.organization_id, "saved"));
      } else if (scope.organizationId && fallback) {
        map.set(key, this.withSellerId(scope.sellerId, fallback.settings || {}, scope.organizationId, "seller_fallback"));
      } else if (fallback) {
        map.set(key, this.withSellerId(fallback.seller_id, fallback.settings || {}, null, "saved"));
      }
    });
    return map;
  }

  async listSettings(query = {}) {
    await this.ensureTable();
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const search = String(query.search || "").trim();
    const organizationId = this.normalizeOrganizationId(query.organizationId || query.organization_id);
    const sellerId = query.sellerId || query.seller_id;

    const baseQuery = knex(TABLE_NAME);
    if (sellerId) baseQuery.where("seller_id", String(sellerId));
    if (organizationId) baseQuery.where("organization_id", organizationId);
    if (search) {
      baseQuery.where((builder) => {
        builder
          .where("seller_id", "ilike", `%${search}%`)
          .orWhereRaw("CAST(organization_id AS TEXT) ILIKE ?", [`%${search}%`]);
      });
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
        ...this.withSellerId(row.seller_id, row.settings || {}, row.organization_id, "saved"),
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

  async updateSettings(sellerId, payload = {}, actor = {}, organizationId = null) {
    if (!sellerId) throw new AppError("Seller id is required", 400);
    await this.ensureTable();
    const normalizedOrganizationId = this.normalizeOrganizationId(
      organizationId || payload.organizationId || payload.organization_id,
    );
    const current = await this.getSettings(sellerId, normalizedOrganizationId, { fallbackToSeller: true });
    const next = this.normalize({
      cod: { ...current.cod, ...(payload.cod || {}) },
      delivery: { ...current.delivery, ...(payload.delivery || {}) },
      metadata: { ...(current.metadata || {}), ...(payload.metadata || {}) },
    });
    const row = {
      seller_id: String(sellerId),
      organization_id: normalizedOrganizationId,
      settings: next,
      updated_by: actor.userId || actor.sub || null,
      updated_at: knex.fn.now(),
    };
    const [saved] = await knex(TABLE_NAME)
      .insert({ ...row, created_at: knex.fn.now() })
      .onConflict(knex.raw("(seller_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))"))
      .merge(row)
      .returning("*");
    return {
      ...this.withSellerId(sellerId, saved?.settings || next, saved?.organization_id || normalizedOrganizationId, "saved"),
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
      const organizationId = this.normalizeOrganizationId(item.organizationId);
      const key = this.scopeKey(sellerId, organizationId);
      const current = grouped.get(key) || {
        sellerId,
        organizationId,
        amount: 0,
        quantity: 0,
        items: [],
      };
      current.amount += money(item.discountedLineTotal ?? item.lineTotal);
      current.quantity += Number(item.quantity || 0);
      current.items.push(item);
      grouped.set(key, current);
    }
    return grouped;
  }

  normalizeLocation(value = "") {
    return String(value || "").trim().toLowerCase();
  }

  getAddressParts(address = {}) {
    return {
      pincode: this.getPostalCode(address),
      city: this.normalizeLocation(address.city),
      state: this.normalizeLocation(address.state),
      region: this.normalizeLocation(address.region || address.zone || address.zoneCode),
    };
  }

  listHasValue(list = [], value = "") {
    const needle = this.normalizeLocation(value);
    return needle && (list || []).map((item) => this.normalizeLocation(item)).includes(needle);
  }

  ruleMatchesLocation(rule = {}, address = {}) {
    const parts = this.getAddressParts(address);
    if ((rule.serviceablePincodes || []).length && !this.listHasValue(rule.serviceablePincodes, parts.pincode)) {
      return false;
    }
    if ((rule.blockPincodes || []).length && this.listHasValue(rule.blockPincodes, parts.pincode)) {
      return false;
    }
    if ((rule.states || []).length && !this.listHasValue(rule.states, parts.state)) {
      return false;
    }
    if ((rule.cities || []).length && !this.listHasValue(rule.cities, parts.city)) {
      return false;
    }
    if ((rule.regions || []).length) {
      return this.listHasValue(rule.regions, parts.region) ||
        this.listHasValue(rule.regions, parts.state) ||
        this.listHasValue(rule.regions, parts.city) ||
        this.listHasValue(rule.regions, parts.pincode);
    }
    return true;
  }

  ruleMatchesOrder(rule = {}, group = {}, address = {}) {
    if (rule.active === false) return false;
    if (!this.ruleMatchesLocation(rule, address)) return false;
    if (rule.minOrderAmount !== null && rule.minOrderAmount !== undefined && group.amount < rule.minOrderAmount) return false;
    if (rule.maxOrderAmount !== null && rule.maxOrderAmount !== undefined && group.amount > rule.maxOrderAmount) return false;
    return true;
  }

  findProductRule(settings = {}, item = {}, address = {}) {
    const delivery = settings.delivery || {};
    const productId = String(item.productId || "").trim();
    const sku = this.normalizeLocation(item.sku || item.variantSku);
    const configuredRule = (delivery.productRules || []).find((rule) => {
      if (rule.active === false) return false;
      const ruleProductId = String(rule.productId || "").trim();
      const ruleSku = this.normalizeLocation(rule.productSku);
      const matchesProduct = (ruleProductId && ruleProductId === productId) || (ruleSku && ruleSku === sku);
      return matchesProduct && this.ruleMatchesLocation(rule, address);
    });
    return configuredRule || this.buildProductShippingRule(item, address);
  }

  buildProductShippingRule(item = {}, address = {}) {
    const shipping = isPlainObject(item.shipping) ? item.shipping : {};
    const hasCharge = shipping.shippingCharge !== undefined ||
      shipping.chargeAmount !== undefined ||
      shipping.additionalCost !== undefined ||
      shipping.handlingCharge !== undefined ||
      shipping.freeShipping === true;
    const hasServiceability = Boolean(
      shipping.serviceabilityMode ||
      shipping.codAvailable !== undefined ||
      (shipping.allowPincodes || shipping.serviceablePincodes || []).length ||
      (shipping.blockPincodes || []).length ||
      (shipping.regions || []).length ||
      (shipping.states || []).length ||
      (shipping.cities || []).length,
    );
    if (!hasCharge && !hasServiceability) return null;

    const mode = shipping.serviceabilityMode || "all_pincodes";
    const rule = {
      name: shipping.name || "Product shipping rule",
      productId: String(item.productId || ""),
      productSku: String(item.sku || item.variantSku || ""),
      chargeAmount: shipping.freeShipping
        ? 0
        : Math.max(money(shipping.shippingCharge ?? shipping.chargeAmount ?? shipping.additionalCost), 0),
      handlingCharge: Math.max(money(shipping.handlingCharge), 0),
      freeDeliveryMinOrderAmount: nullableMoney(shipping.freeShippingMinOrder ?? shipping.freeShippingMinOrderAmount),
      serviceabilityMode: mode,
      serviceablePincodes: uniqueStrings(shipping.serviceablePincodes || shipping.allowPincodes),
      blockPincodes: uniqueStrings(shipping.blockPincodes),
      regions: uniqueStrings(shipping.regions),
      states: uniqueStrings(shipping.states),
      cities: uniqueStrings(shipping.cities),
      estimatedDaysMin: shipping.estimatedDaysMin ?? shipping.processingDays ?? null,
      estimatedDaysMax: shipping.estimatedDaysMax ?? shipping.processingDays ?? null,
      shippingPartner: String(shipping.shippingPartner || shipping.provider || ""),
      shippingMethod: String(shipping.shippingMethod || shipping.method || "standard"),
      codAvailable: shipping.codAvailable === undefined ? null : Boolean(shipping.codAvailable),
      active: mode !== "disabled",
      source: "product_shipping",
    };
    if (!this.productRuleAllowsAddress(rule, address)) return null;
    return rule;
  }

  productRuleAllowsAddress(rule = {}, address = {}) {
    if (rule.serviceabilityMode === "disabled" || rule.active === false) return false;
    const pin = this.getPostalCode(address);
    if (rule.serviceabilityMode === "allowlist" && !this.listHasValue(rule.serviceablePincodes, pin)) return false;
    if (rule.serviceabilityMode === "blocklist" && this.listHasValue(rule.blockPincodes, pin)) return false;
    if (rule.serviceabilityMode === "regions" && (rule.regions || []).length) {
      return this.ruleMatchesLocation(rule, address);
    }
    return this.ruleMatchesLocation(rule, address);
  }

  getProductShippingBlocker(item = {}, address = {}) {
    const shipping = isPlainObject(item.shipping) ? item.shipping : {};
    if (!Object.keys(shipping).length) return null;
    const rawRule = {
      serviceabilityMode: shipping.serviceabilityMode || "all_pincodes",
      serviceablePincodes: uniqueStrings(shipping.serviceablePincodes || shipping.allowPincodes),
      blockPincodes: uniqueStrings(shipping.blockPincodes),
      regions: uniqueStrings(shipping.regions),
      states: uniqueStrings(shipping.states),
      cities: uniqueStrings(shipping.cities),
      active: shipping.serviceabilityMode !== "disabled",
    };
    if (!this.productRuleAllowsAddress(rawRule, address)) {
      return {
        allowed: false,
        reason: "product_not_deliverable_to_pincode",
        productId: item.productId,
        productTitle: item.title,
      };
    }
    return null;
  }

  findRegionRule(settings = {}, group = {}, address = {}) {
    return (settings.delivery?.regionRules || []).find((rule) => this.ruleMatchesOrder(rule, group, address)) || null;
  }

  findOrderRule(settings = {}, group = {}, address = {}) {
    return (settings.delivery?.orderRules || []).find((rule) => this.ruleMatchesOrder(rule, group, address)) || null;
  }

  assertDeliveryServiceable(settings = {}, group = {}, address = {}) {
    const delivery = settings.delivery || {};
    const mode = delivery.serviceabilityMode || "all_pincodes";
    const pin = this.getPostalCode(address);
    const parts = this.getAddressParts(address);

    if (mode === "disabled") {
      return { allowed: false, reason: "seller_delivery_disabled" };
    }
    if (mode === "allowlist" && !this.listHasValue(delivery.allowPincodes, pin)) {
      return { allowed: false, reason: "seller_delivery_pincode_not_allowed" };
    }
    if (mode === "blocklist" && this.listHasValue(delivery.blockPincodes, pin)) {
      return { allowed: false, reason: "seller_delivery_pincode_blocked" };
    }
    if (mode === "regions" && (delivery.regions || []).length) {
      const inRegion = this.listHasValue(delivery.regions, parts.region) ||
        this.listHasValue(delivery.regions, parts.state) ||
        this.listHasValue(delivery.regions, parts.city) ||
        this.listHasValue(delivery.regions, parts.pincode);
      if (!inRegion) return { allowed: false, reason: "seller_delivery_region_not_allowed" };
    }

    for (const item of group.items || []) {
      const productShippingBlocker = this.getProductShippingBlocker(item, address);
      if (productShippingBlocker) return productShippingBlocker;

      const productRules = (delivery.productRules || []).filter((rule) => {
        if (rule.active === false) return false;
        const productId = String(rule.productId || "").trim();
        const sku = this.normalizeLocation(rule.productSku);
        return (productId && productId === String(item.productId || "").trim()) ||
          (sku && sku === this.normalizeLocation(item.sku || item.variantSku));
      });
      if (!productRules.length) continue;

      const matched = productRules.find((rule) => this.ruleMatchesLocation(rule, address));
      if (!matched) {
        return {
          allowed: false,
          reason: "product_not_deliverable_to_pincode",
          productId: item.productId,
          productTitle: item.title,
        };
      }
    }

    return { allowed: true, reason: null };
  }

  ruleCharge(rule = {}, group = {}) {
    const threshold = nullableMoney(rule.freeDeliveryMinOrderAmount);
    if (threshold !== null && group.amount >= threshold) return 0;
    return money(rule.chargeAmount);
  }

  ruleEta(rule = {}, delivery = {}) {
    const min = rule?.estimatedDaysMin ?? delivery.estimatedDaysMin ?? null;
    const max = rule?.estimatedDaysMax ?? delivery.estimatedDaysMax ?? null;
    if (min === null && max === null) return null;
    return {
      minDays: min === null || min === "" ? null : Number(min),
      maxDays: max === null || max === "" ? null : Number(max),
    };
  }

  getShippingProfileId(item = {}) {
    return item.shipping?.shippingProfileId ||
      item.productSnapshot?.shipping?.shippingProfileId ||
      item.product_snapshot?.shipping?.shippingProfileId ||
      null;
  }

  async loadShippingProfileMap(items = []) {
    const profileIds = items.map((item) => this.getShippingProfileId(item)).filter(Boolean);
    return shippingProfilesService.getByIds(profileIds);
  }

  profileEta(profile = {}) {
    if (profile.etaMin == null && profile.etaMax == null) return null;
    return {
      minDays: profile.etaMin == null ? null : Number(profile.etaMin),
      maxDays: profile.etaMax == null ? null : Number(profile.etaMax),
    };
  }

  ensureProfileForItem(profile, item = {}, group = {}) {
    shippingProfilesService.assertProfileBelongsToSeller(profile, {
      sellerId: group.sellerId || item.sellerId,
      organizationId: group.organizationId || item.organizationId || null,
    });
  }

  evaluateShippingProfilesForGroup(group = {}, address = {}, profileMap = new Map()) {
    const profileItems = [];
    const fallbackItems = [];
    for (const item of group.items || []) {
      if (this.getShippingProfileId(item)) profileItems.push(item);
      else fallbackItems.push(item);
    }
    if (!profileItems.length) {
      return {
        hasProfiles: false,
        fallbackGroup: group,
        amount: 0,
        profiles: [],
      };
    }

    const parts = this.getAddressParts(address);
    const byProfile = new Map();
    for (const item of profileItems) {
      const profileId = this.getShippingProfileId(item);
      if (!byProfile.has(profileId)) {
        byProfile.set(profileId, { profileId, items: [], amount: 0, quantity: 0 });
      }
      const current = byProfile.get(profileId);
      current.items.push(item);
      current.amount += money(item.discountedLineTotal ?? item.lineTotal);
      current.quantity += Number(item.quantity || 0);
    }

    let profileChargeAmount = 0;
    const profileBreakup = [];
    for (const profileGroup of byProfile.values()) {
      const profile = profileMap.get(String(profileGroup.profileId));
      if (!profile) {
        throw new AppError("Shipping profile assigned to a product was not found", 400);
      }
      this.ensureProfileForItem(profile, profileGroup.items[0], group);
      const serviceability = shippingProfilesService.checkPincodeAgainstProfile(
        profile,
        parts.pincode,
        parts.city,
        parts.state,
      );
      if (!serviceability.allowed) {
        const productTitle = profileGroup.items[0]?.title || profileGroup.items[0]?.productTitle || "Selected product";
        throw new AppError(
          `${productTitle} is not deliverable to ${parts.pincode || "the selected pincode"}: ${serviceability.reason}`,
          400,
        );
      }

      const threshold = profile.freeShippingThreshold == null ? null : Number(profile.freeShippingThreshold);
      const chargeAmount = threshold !== null && profileGroup.amount >= threshold
        ? 0
        : money(profile.shippingCharge);
      profileChargeAmount += chargeAmount;
      profileBreakup.push({
        shippingProfileId: profile.id,
        shippingProfileName: profile.name,
        sourceTemplateId: profile.sourceTemplateId || null,
        sourceTemplateVersion: profile.sourceTemplateVersion || null,
        itemCount: profileGroup.items.length,
        quantity: profileGroup.quantity,
        orderAmount: money(profileGroup.amount),
        chargeAmount,
        freeShippingThreshold: threshold,
        shippingMethod: profile.shippingMethod || "standard",
        estimatedDeliveryDays: this.profileEta(profile),
        codAvailable: profile.codAvailable !== false,
      });
    }

    const fallbackGroup = {
      ...group,
      items: fallbackItems,
      amount: money(fallbackItems.reduce((sum, item) => sum + money(item.discountedLineTotal ?? item.lineTotal), 0)),
      quantity: fallbackItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    };

    return {
      hasProfiles: true,
      fallbackGroup,
      amount: money(profileChargeAmount),
      profiles: profileBreakup,
    };
  }

  findProfileCodBlocker(group = {}, profileMap = new Map()) {
    for (const item of group.items || []) {
      const profileId = this.getShippingProfileId(item);
      if (!profileId) continue;
      const profile = profileMap.get(String(profileId));
      if (!profile || profile.active === false || profile.archivedAt) {
        return { item, reason: "shipping_profile_inactive" };
      }
      this.ensureProfileForItem(profile, item, group);
      if (profile.codAvailable === false) {
        return { item, profile, reason: "shipping_profile_cod_disabled" };
      }
    }
    return null;
  }

  async evaluateCodForItems(pricedItems = [], address = {}) {
    const groups = this.groupItemsBySeller(pricedItems);
    const settingsMap = await this.getSettingsMap([...groups.values()]);
    const profileMap = await this.loadShippingProfileMap(pricedItems);
    const sellers = [];
    const blockers = [];
    let sellerChargeAmount = 0;

    for (const group of groups.values()) {
      const settings = settingsMap.get(this.scopeKey(group.sellerId, group.organizationId)) ||
        this.withSellerId(group.sellerId, {}, group.organizationId);
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
      } else {
        const profileCodBlocker = this.findProfileCodBlocker(group, profileMap);
        if (profileCodBlocker) {
          allowed = false;
          reason = profileCodBlocker.reason;
        }
      }

      if (allowed) {
        const deliveryCodBlocker = (group.items || []).find((item) => {
          const productRule = this.findProductRule(settings, item, address);
          const regionRule = this.findRegionRule(settings, group, address);
          return productRule?.codAvailable === false || regionRule?.codAvailable === false;
        });
        if (deliveryCodBlocker) {
          allowed = false;
          reason = "seller_delivery_rule_cod_disabled";
        }
      }

      const chargeAmount = allowed && cod.chargeMode === "flat" ? money(cod.chargeAmount) : 0;
      sellerChargeAmount += chargeAmount;
      const sellerResult = {
        sellerId: group.sellerId,
        organizationId: group.organizationId,
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
    const settingsMap = await this.getSettingsMap([...groups.values()]);
    const profileMap = await this.loadShippingProfileMap(pricedItems);
    const sellers = [];
    let totalAmount = 0;

    for (const group of groups.values()) {
      const profileDelivery = this.evaluateShippingProfilesForGroup(group, address, profileMap);
      const workingGroup = profileDelivery.hasProfiles ? profileDelivery.fallbackGroup : group;
      const settings = settingsMap.get(this.scopeKey(group.sellerId, group.organizationId)) ||
        this.withSellerId(group.sellerId, {}, group.organizationId);
      const delivery = settings.delivery;
      let chargeAmount = profileDelivery.amount;
      let appliedRule = null;
      let ruleSource = profileDelivery.hasProfiles ? "shipping_profile" : delivery.mode;

      if (workingGroup.items.length) {
        const serviceability = this.assertDeliveryServiceable(settings, workingGroup, address);
        if (!serviceability.allowed) {
          throw new AppError(
            serviceability.productTitle
              ? serviceability.productTitle + " is not deliverable to " + (this.getPostalCode(address) || "the selected pincode")
              : "Seller " + group.sellerId + " is not deliverable to " + (this.getPostalCode(address) || "the selected pincode"),
            400,
          );
        }
      }

      const productRuleCharge = () => {
        let amount = 0;
        let firstRule = null;
        for (const item of workingGroup.items || []) {
          const rule = this.findProductRule(settings, item, address);
          if (!rule) continue;
          firstRule = firstRule || rule;
          amount += this.ruleCharge(rule, workingGroup) * Number(item.quantity || 1);
          amount += money(rule.handlingCharge) * Number(item.quantity || 1);
        }
        return { amount: money(amount), rule: firstRule };
      };

      if (delivery.mode === "none") {
        const productCharges = productRuleCharge();
        if (productCharges.rule) {
          chargeAmount = money(chargeAmount + productCharges.amount);
          appliedRule = productCharges.rule;
          ruleSource = profileDelivery.hasProfiles ? "shipping_profile_plus_product_rule" : productCharges.rule.source || "product_rule";
        }
      } else if (workingGroup.items.length && delivery.mode === "flat") {
        chargeAmount = money(chargeAmount + money(delivery.chargeAmount));
        if (!profileDelivery.hasProfiles) ruleSource = delivery.mode;
      } else if (workingGroup.items.length && delivery.mode === "free_over_amount") {
        const threshold = nullableMoney(delivery.freeDeliveryMinOrderAmount);
        const fallbackCharge = threshold !== null && workingGroup.amount >= threshold
          ? 0
          : money(delivery.chargeAmount);
        chargeAmount = money(chargeAmount + fallbackCharge);
        if (!profileDelivery.hasProfiles) ruleSource = delivery.mode;
      } else if (workingGroup.items.length && ["product", "rule_based"].includes(delivery.mode)) {
        const productCharges = productRuleCharge();
        chargeAmount = money(chargeAmount + productCharges.amount);
        appliedRule = productCharges.rule;
        if (!appliedRule && delivery.mode === "rule_based") {
          appliedRule = this.findRegionRule(settings, workingGroup, address) || this.findOrderRule(settings, workingGroup, address);
          if (appliedRule) {
            chargeAmount = money(chargeAmount + this.ruleCharge(appliedRule, workingGroup));
            ruleSource = profileDelivery.hasProfiles
              ? "shipping_profile_plus_rule_based"
              : appliedRule.states?.length || appliedRule.cities?.length || appliedRule.regions?.length ? "region_rule" : "order_rule";
          }
        } else if (appliedRule) {
          ruleSource = profileDelivery.hasProfiles ? "shipping_profile_plus_product_rule" : "product_rule";
        }
      } else if (workingGroup.items.length && delivery.mode === "region") {
        appliedRule = this.findRegionRule(settings, workingGroup, address);
        chargeAmount = money(chargeAmount + (appliedRule ? this.ruleCharge(appliedRule, workingGroup) : money(delivery.chargeAmount)));
        ruleSource = profileDelivery.hasProfiles ? "shipping_profile_plus_region" : appliedRule ? "region_rule" : "region_fallback";
      } else if (workingGroup.items.length && delivery.mode === "order") {
        appliedRule = this.findOrderRule(settings, workingGroup, address);
        chargeAmount = money(chargeAmount + (appliedRule ? this.ruleCharge(appliedRule, workingGroup) : money(delivery.chargeAmount)));
        ruleSource = profileDelivery.hasProfiles ? "shipping_profile_plus_order" : appliedRule ? "order_rule" : "order_fallback";
      }

      const handlingCharge = workingGroup.items.length ? money(delivery.handlingCharge) : 0;
      chargeAmount = money(chargeAmount + handlingCharge);
      totalAmount += chargeAmount;
      sellers.push({
        sellerId: group.sellerId,
        organizationId: group.organizationId,
        orderAmount: money(group.amount),
        quantity: group.quantity,
        mode: delivery.mode,
        chargeAmount,
        handlingCharge,
        freeDeliveryMinOrderAmount: delivery.freeDeliveryMinOrderAmount,
        serviceabilityMode: delivery.serviceabilityMode,
        shippingPartner: appliedRule?.shippingPartner || delivery.shippingPartner || null,
        shippingMethod: profileDelivery.profiles[0]?.shippingMethod || appliedRule?.shippingMethod || delivery.shippingMethod || "standard",
        estimatedDeliveryDays: profileDelivery.profiles[0]?.estimatedDeliveryDays || this.ruleEta(appliedRule, delivery),
        ruleSource,
        appliedRuleName: appliedRule?.name || null,
        shippingProfiles: profileDelivery.profiles,
        settingsSource: settings.source,
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
