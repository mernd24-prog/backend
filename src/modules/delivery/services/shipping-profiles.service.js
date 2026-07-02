"use strict";

const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");
const { ShippingProfile } = require("../models/shipping-profile.model");
const { ShippingProfileTemplate } = require("../models/shipping-profile-template.model");
const { AppError } = require("../../../shared/errors/app-error");
const { SellerOrganizationRepository } = require("../../seller/repositories/seller-organization.repository");

const ADMIN_ROLES = new Set(["admin", "sub-admin", "super-admin", "super_admin"]);

const PROFILE_FIELDS = [
  "name",
  "description",
  "shippingMethod",
  "serviceabilityMode",
  "allowedStates",
  "allowedCities",
  "allowedPincodes",
  "blockedPincodes",
  "codAvailable",
  "shippingCharge",
  "freeShippingThreshold",
  "etaMin",
  "etaMax",
  "isDefault",
  "active",
];

const TEMPLATE_EDITABLE_DEFAULTS = [...PROFILE_FIELDS];
const SERVICEABILITY_MODES_REQUIRING_COVERAGE = {
  selected_states: "allowedStates",
  selected_cities: "allowedCities",
  selected_pincodes: "allowedPincodes",
};

class ShippingProfilesService {
  constructor({ organizationRepository = new SellerOrganizationRepository() } = {}) {
    this.organizationRepository = organizationRepository;
  }

  async list({ sellerId, organizationId, active, search, includeArchived = false, limit = 50, offset = 0 } = {}, actor = null) {
    const where = {};
    const actorSellerId = this._getActorSellerId(actor);

    if (!this._isAdminActor(actor) && actor) {
      if (!actorSellerId) throw new AppError("Seller context is required", 403);
      if (sellerId && String(sellerId) !== String(actorSellerId)) {
        throw new AppError("Access denied to seller shipping profiles", 403);
      }
      sellerId = actorSellerId;
      if (actor?.organizationId && organizationId === undefined) {
        organizationId = actor.organizationId;
      }
    }

    if (sellerId) where.sellerId = sellerId;
    if (organizationId !== undefined) where.organizationId = organizationId || null;
    if (active !== undefined) where.active = active;
    if (!includeArchived) where.archivedAt = null;
    if (search) where.name = { [Op.iLike]: `%${search}%` };

    const { count, rows } = await ShippingProfile.findAndCountAll({
      where,
      order: [
        ["is_default", "DESC"],
        ["created_at", "ASC"],
      ],
      limit,
      offset,
    });

    return {
      total: count,
      limit,
      offset,
      profiles: rows.map((row) => this._serialize(row)),
    };
  }

  async get(profileId, actor = null) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile || profile.archivedAt) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);
    return this._serialize(profile);
  }

  async create(payload, actor) {
    const sellerId = payload.sellerId || this._getActorSellerId(actor);
    if (!sellerId) throw new AppError("sellerId is required", 400);
    this._assertCanManageSeller(sellerId, actor);

    const organizationId = await this._resolveOrganizationId(sellerId, payload.organizationId, actor);
    const normalized = this._normalizeProfilePayload(payload);
    this._validateProfileRules(normalized);

    if (normalized.isDefault) {
      await this._clearDefault(sellerId, organizationId);
    }

    const profile = await ShippingProfile.create({
      id: uuidv4(),
      sellerId,
      organizationId,
      ...this._profileWriteFields(normalized),
      sourceTemplateId: null,
      sourceTemplateVersion: null,
      templateSnapshot: {},
      editableFields: TEMPLATE_EDITABLE_DEFAULTS,
      copiedFromTemplateAt: null,
      archivedAt: null,
      metadata: payload.metadata || {},
      createdBy: this._getActorUserId(actor),
      updatedBy: this._getActorUserId(actor),
    });

    return this._serialize(profile);
  }

  async update(profileId, payload, actor) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile || profile.archivedAt) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);
    this._assertEditableFields(profile, payload, actor);

    if (payload.organizationId !== undefined && String(payload.organizationId || "") !== String(profile.organizationId || "")) {
      throw new AppError("Shipping profiles cannot be moved between organizations. Create a new profile instead.", 409);
    }
    if (payload.sellerId !== undefined && String(payload.sellerId || "") !== String(profile.sellerId || "")) {
      throw new AppError("Shipping profiles cannot be moved between sellers. Create a new profile instead.", 409);
    }

    const normalized = this._normalizeProfilePayload(payload, { partial: true });
    const merged = {
      ...this._serialize(profile),
      ...normalized,
    };
    this._validateProfileRules(merged);

    if (normalized.isDefault && !profile.isDefault) {
      await this._clearDefault(profile.sellerId, profile.organizationId);
    }
    if (normalized.active === false) {
      normalized.isDefault = false;
    }

    const updates = this._profileWriteFields(normalized, { partial: true });
    updates.updatedBy = this._getActorUserId(actor);

    await profile.update(updates);
    return this._serialize(profile);
  }

  async delete(profileId, actor) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile || profile.archivedAt) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);
    await profile.update({
      active: false,
      isDefault: false,
      archivedAt: new Date(),
      updatedBy: this._getActorUserId(actor),
    });
    return { deleted: true, archived: true, profileId };
  }

  async setDefault(profileId, actor) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile || profile.archivedAt) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);
    if (profile.active === false) {
      throw new AppError("Inactive profiles cannot be set as default", 409);
    }

    await this._clearDefault(profile.sellerId, profile.organizationId);
    await profile.update({ isDefault: true, updatedBy: this._getActorUserId(actor) });
    return this._serialize(profile);
  }

  async listTemplates({ status, active, search, limit = 50, offset = 0 } = {}, actor = {}) {
    const where = {};
    if (this._isAdminActor(actor)) {
      if (status) where.status = status;
      if (active !== undefined) where.active = active;
    } else {
      where.status = "published";
      where.active = true;
    }
    if (search) where.name = { [Op.iLike]: `%${search}%` };

    const { count, rows } = await ShippingProfileTemplate.findAndCountAll({
      where,
      order: [
        ["active", "DESC"],
        ["created_at", "DESC"],
      ],
      limit,
      offset,
    });

    return {
      total: count,
      limit,
      offset,
      templates: rows.map((row) => this._serializeTemplate(row)),
    };
  }

  async getTemplate(templateId, actor = {}) {
    const template = await ShippingProfileTemplate.findByPk(templateId);
    if (!template) throw new AppError("Shipping profile template not found", 404);
    if (!this._isAdminActor(actor) && (template.status !== "published" || template.active === false)) {
      throw new AppError("Shipping profile template not found", 404);
    }
    return this._serializeTemplate(template);
  }

  async createTemplate(payload, actor = {}) {
    this._assertAdmin(actor, "Only admin users can create shipping profile templates");
    const normalized = this._normalizeProfilePayload(payload);
    this._validateProfileRules(normalized);
    const template = await ShippingProfileTemplate.create({
      id: uuidv4(),
      ...this._templateWriteFields(normalized, payload),
      version: Number(payload.version || 1),
      status: payload.status || "published",
      active: payload.active !== false,
      metadata: payload.metadata || {},
      createdBy: this._getActorUserId(actor),
      updatedBy: this._getActorUserId(actor),
    });
    return this._serializeTemplate(template);
  }

  async updateTemplate(templateId, payload, actor = {}) {
    this._assertAdmin(actor, "Only admin users can update shipping profile templates");
    const template = await ShippingProfileTemplate.findByPk(templateId);
    if (!template) throw new AppError("Shipping profile template not found", 404);

    const normalized = this._normalizeProfilePayload(payload, { partial: true });
    const merged = {
      ...this._serializeTemplate(template),
      ...normalized,
    };
    this._validateProfileRules(merged);

    const updates = this._templateWriteFields(normalized, payload, { partial: true });
    const changesTemplateRules = Object.keys(updates).some((key) =>
      !["updatedBy", "metadata", "status", "active"].includes(key));
    if (payload.version !== undefined) {
      updates.version = Number(payload.version);
    } else if (changesTemplateRules) {
      updates.version = Number(template.version || 1) + 1;
    }
    updates.updatedBy = this._getActorUserId(actor);

    await template.update(updates);
    return this._serializeTemplate(template);
  }

  async archiveTemplate(templateId, actor = {}) {
    this._assertAdmin(actor, "Only admin users can archive shipping profile templates");
    const template = await ShippingProfileTemplate.findByPk(templateId);
    if (!template) throw new AppError("Shipping profile template not found", 404);
    await template.update({
      status: "archived",
      active: false,
      updatedBy: this._getActorUserId(actor),
    });
    return { archived: true, templateId };
  }

  async cloneTemplate(templateId, payload = {}, actor = {}) {
    const template = await ShippingProfileTemplate.findByPk(templateId);
    if (!template || template.status !== "published" || template.active === false) {
      throw new AppError("Shipping profile template is not available for cloning", 404);
    }

    const sellerId = payload.sellerId || this._getActorSellerId(actor);
    if (!sellerId) throw new AppError("sellerId is required", 400);
    this._assertCanManageSeller(sellerId, actor);
    const organizationId = await this._resolveOrganizationId(sellerId, payload.organizationId, actor);
    const templateData = this._serializeTemplate(template);
    const editableFields = templateData.allowedOverrides?.length
      ? templateData.allowedOverrides
      : TEMPLATE_EDITABLE_DEFAULTS;

    const normalized = this._normalizeProfilePayload({
      ...templateData,
      name: payload.name || templateData.name,
      description: payload.description !== undefined ? payload.description : templateData.description,
      isDefault: payload.isDefault,
      active: payload.active,
    });
    this._validateProfileRules(normalized);

    if (normalized.isDefault) {
      await this._clearDefault(sellerId, organizationId);
    }

    const profile = await ShippingProfile.create({
      id: uuidv4(),
      sellerId,
      organizationId,
      ...this._profileWriteFields(normalized),
      sourceTemplateId: templateData.id,
      sourceTemplateVersion: templateData.version,
      templateSnapshot: templateData,
      editableFields,
      copiedFromTemplateAt: new Date(),
      archivedAt: null,
      metadata: {
        source: "admin_template_clone",
        templateName: templateData.name,
      },
      createdBy: this._getActorUserId(actor),
      updatedBy: this._getActorUserId(actor),
    });

    return this._serialize(profile);
  }

  // Used by delivery.service.js / checkout for serviceability and charge checks.
  async getById(profileId) {
    if (!profileId) return null;
    const profile = await ShippingProfile.findByPk(profileId);
    return profile ? this._serialize(profile) : null;
  }

  async getByIds(profileIds = []) {
    const ids = Array.from(new Set(profileIds.map((id) => String(id || "")).filter(Boolean)));
    if (!ids.length) return new Map();
    const profiles = await ShippingProfile.findAll({ where: { id: { [Op.in]: ids } } });
    return new Map(profiles.map((profile) => {
      const serialized = this._serialize(profile);
      return [String(serialized.id), serialized];
    }));
  }

  // Check if a pincode is serviceable according to a profile's rules.
  checkPincodeAgainstProfile(profile, pincode, city, state) {
    if (!profile) return { allowed: true };
    if (profile.active === false || profile.archivedAt) {
      return { allowed: false, reason: "Shipping profile is inactive" };
    }

    const mode = profile.serviceabilityMode;
    const pin = String(pincode || "").trim();
    const cityStr = String(city || "").trim().toLowerCase();
    const stateStr = String(state || "").trim().toLowerCase();

    if (mode === "all_india") return { allowed: true };

    if (mode === "block_pincodes") {
      const blocked = (profile.blockedPincodes || []).map(String);
      if (blocked.includes(pin)) return { allowed: false, reason: "Pincode is blocked by seller" };
      return { allowed: true };
    }

    if (mode === "selected_pincodes") {
      const allowed = (profile.allowedPincodes || []).map(String);
      if (!allowed.length) return { allowed: false, reason: "Seller profile has no allowed pincodes configured" };
      if (!allowed.includes(pin)) return { allowed: false, reason: "Pincode not in seller's delivery area" };
      return { allowed: true };
    }

    if (mode === "selected_states") {
      const allowed = (profile.allowedStates || []).map((s) => String(s || "").toLowerCase());
      if (!allowed.length) return { allowed: false, reason: "Seller profile has no states configured" };
      if (!allowed.includes(stateStr)) return { allowed: false, reason: "State not in seller's delivery area" };
      return { allowed: true };
    }

    if (mode === "selected_cities") {
      const allowedCities = (profile.allowedCities || []).map((c) => String(c || "").toLowerCase());
      const allowedStates = (profile.allowedStates || []).map((s) => String(s || "").toLowerCase());
      if (!allowedCities.length) return { allowed: false, reason: "Seller profile has no cities configured" };

      const cityMatch = allowedCities.includes(cityStr);
      const stateMatch = !allowedStates.length || allowedStates.includes(stateStr);
      if (!cityMatch || !stateMatch) {
        return { allowed: false, reason: "City/State not in seller's delivery area" };
      }
      return { allowed: true };
    }

    return { allowed: true };
  }

  assertProfileBelongsToSeller(profile, { sellerId, organizationId } = {}) {
    if (!profile) throw new AppError("Shipping profile not found", 404);
    if (profile.archivedAt) throw new AppError("Shipping profile is archived", 409);
    if (sellerId && String(profile.sellerId || "") !== String(sellerId || "")) {
      throw new AppError("Shipping profile does not belong to the product seller", 400);
    }
    if (profile.organizationId && String(profile.organizationId) !== String(organizationId || "")) {
      throw new AppError("Shipping profile does not belong to the selected seller organization", 400);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async _clearDefault(sellerId, organizationId) {
    const where = { sellerId, isDefault: true };
    where.organizationId = organizationId || null;
    await ShippingProfile.update({ isDefault: false }, { where });
  }

  _isAdminActor(actor = {}) {
    return ADMIN_ROLES.has(String(actor?.role || actor?.userType || "").toLowerCase()) || actor?.isSuperAdmin === true;
  }

  _assertAdmin(actor = {}, message = "Only admin users can manage shipping profile templates") {
    if (!this._isAdminActor(actor)) throw new AppError(message, 403);
  }

  _getActorSellerId(actor = {}) {
    return actor?.ownerSellerId || actor?.sellerId || actor?.userId || actor?.id || null;
  }

  _getActorUserId(actor = {}) {
    return actor?.userId || actor?.id || null;
  }

  _assertCanManageSeller(sellerId, actor = null) {
    if (!actor || this._isAdminActor(actor)) return;
    const actorSellerId = this._getActorSellerId(actor);
    if (!actorSellerId || String(actorSellerId) !== String(sellerId)) {
      throw new AppError("Access denied to seller shipping profiles", 403);
    }
  }

  async _resolveOrganizationId(sellerId, organizationId, actor = {}) {
    const selectedOrganizationId = actor?.organizationId || null;
    const requestedOrganizationId = organizationId || selectedOrganizationId || null;
    if (!requestedOrganizationId) return null;

    if (!this._isAdminActor(actor) && selectedOrganizationId && String(selectedOrganizationId) !== String(requestedOrganizationId)) {
      throw new AppError("Selected organization does not match request organization", 403, {
        selectedOrganizationId,
        organizationId: requestedOrganizationId,
      });
    }

    const organization = await this.organizationRepository.findByIdForSeller(sellerId, requestedOrganizationId);
    if (!organization) {
      throw new AppError("Organization does not belong to this seller", 400, {
        sellerId,
        organizationId: requestedOrganizationId,
      });
    }
    return requestedOrganizationId;
  }

  _assertAccess(profile, actor) {
    if (!actor) return;
    if (this._isAdminActor(actor)) return;
    if (String(profile.sellerId) !== String(this._getActorSellerId(actor))) {
      throw new AppError("Access denied to this shipping profile", 403);
    }
    if (actor.organizationId && profile.organizationId && String(profile.organizationId) !== String(actor.organizationId)) {
      throw new AppError("Access denied to this organization's shipping profile", 403);
    }
  }

  _assertEditableFields(profile, payload = {}, actor = {}) {
    if (this._isAdminActor(actor) || !profile.sourceTemplateId) return;
    const editable = new Set(
      (Array.isArray(profile.editableFields) && profile.editableFields.length)
        ? profile.editableFields
        : TEMPLATE_EDITABLE_DEFAULTS,
    );
    const requested = Object.keys(payload || {}).filter((key) => PROFILE_FIELDS.includes(key));
    const blocked = requested.filter((key) => !editable.has(key));
    if (blocked.length) {
      throw new AppError(`This template copy does not allow editing: ${blocked.join(", ")}`, 403);
    }
  }

  _normalizeList(value = []) {
    return Array.from(new Set(
      (Array.isArray(value) ? value : String(value || "").split(","))
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ));
  }

  _normalizePincodes(value = []) {
    return this._normalizeList(value).map((item) => item.replace(/\D/g, "")).filter(Boolean);
  }

  _normalizeProfilePayload(payload = {}, { partial = false } = {}) {
    const normalized = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    const set = (key, value, fallback) => {
      if (has(key)) normalized[key] = value;
      else if (!partial) normalized[key] = fallback;
    };

    set("name", payload.name ? String(payload.name).trim() : payload.name, "");
    set("description", payload.description ? String(payload.description).trim() : payload.description || null, null);
    set("shippingMethod", payload.shippingMethod || "standard", "standard");
    set("serviceabilityMode", payload.serviceabilityMode || "all_india", "all_india");
    if (has("allowedStates") || !partial) normalized.allowedStates = this._normalizeList(payload.allowedStates || []);
    if (has("allowedCities") || !partial) normalized.allowedCities = this._normalizeList(payload.allowedCities || []);
    if (has("allowedPincodes") || !partial) normalized.allowedPincodes = this._normalizePincodes(payload.allowedPincodes || []);
    if (has("blockedPincodes") || !partial) normalized.blockedPincodes = this._normalizePincodes(payload.blockedPincodes || []);
    if (has("codAvailable") || !partial) normalized.codAvailable = payload.codAvailable !== false;
    if (has("shippingCharge") || !partial) normalized.shippingCharge = Number(payload.shippingCharge ?? 0);
    if (has("freeShippingThreshold") || !partial) {
      normalized.freeShippingThreshold = payload.freeShippingThreshold != null && payload.freeShippingThreshold !== ""
        ? Number(payload.freeShippingThreshold)
        : null;
    }
    if (has("etaMin") || !partial) {
      normalized.etaMin = payload.etaMin != null && payload.etaMin !== "" ? Number(payload.etaMin) : null;
    }
    if (has("etaMax") || !partial) {
      normalized.etaMax = payload.etaMax != null && payload.etaMax !== "" ? Number(payload.etaMax) : null;
    }
    set("isDefault", Boolean(payload.isDefault), false);
    if (has("active") || !partial) normalized.active = payload.active !== false;
    return normalized;
  }

  _profileWriteFields(payload = {}, { partial = false } = {}) {
    return PROFILE_FIELDS.reduce((acc, field) => {
      if (payload[field] !== undefined || !partial) acc[field] = payload[field];
      return acc;
    }, {});
  }

  _templateWriteFields(normalized = {}, rawPayload = {}, { partial = false } = {}) {
    const fields = this._profileWriteFields(normalized, { partial });
    delete fields.isDefault;
    fields.allowedOverrides = Array.isArray(rawPayload.allowedOverrides)
      ? rawPayload.allowedOverrides.filter((field) => PROFILE_FIELDS.includes(field))
      : (partial ? undefined : TEMPLATE_EDITABLE_DEFAULTS);
    if (fields.allowedOverrides === undefined) delete fields.allowedOverrides;
    if (rawPayload.status !== undefined) fields.status = rawPayload.status;
    if (rawPayload.active !== undefined) fields.active = rawPayload.active !== false;
    if (rawPayload.metadata !== undefined) fields.metadata = rawPayload.metadata || {};
    return fields;
  }

  _validateProfileRules(profile = {}) {
    if (!String(profile.name || "").trim()) {
      throw new AppError("Shipping profile name is required", 400);
    }
    if (profile.etaMin != null && profile.etaMax != null && Number(profile.etaMin) > Number(profile.etaMax)) {
      throw new AppError("ETA minimum cannot be greater than ETA maximum", 400);
    }
    const requiredList = SERVICEABILITY_MODES_REQUIRING_COVERAGE[profile.serviceabilityMode];
    if (requiredList && !(profile[requiredList] || []).length) {
      throw new AppError(`${requiredList} is required for ${profile.serviceabilityMode}`, 400);
    }
    const allPins = [...(profile.allowedPincodes || []), ...(profile.blockedPincodes || [])];
    const invalidPin = allPins.find((pin) => !/^\d{6}$/.test(String(pin || "")));
    if (invalidPin) {
      throw new AppError(`Invalid Indian pincode: ${invalidPin}`, 400);
    }
  }

  _serialize(profile) {
    const p = profile.toJSON ? profile.toJSON() : profile;
    return {
      id: p.id,
      sellerId: p.sellerId || p.seller_id,
      organizationId: p.organizationId || p.organization_id || null,
      name: p.name,
      description: p.description || null,
      shippingMethod: p.shippingMethod || p.shipping_method || "standard",
      serviceabilityMode: p.serviceabilityMode || p.serviceability_mode || "all_india",
      allowedStates: p.allowedStates || p.allowed_states || [],
      allowedCities: p.allowedCities || p.allowed_cities || [],
      allowedPincodes: p.allowedPincodes || p.allowed_pincodes || [],
      blockedPincodes: p.blockedPincodes || p.blocked_pincodes || [],
      codAvailable: p.codAvailable !== undefined ? p.codAvailable : (p.cod_available !== undefined ? p.cod_available : true),
      shippingCharge: Number(p.shippingCharge ?? p.shipping_charge ?? 0),
      freeShippingThreshold: p.freeShippingThreshold != null ? Number(p.freeShippingThreshold) : (p.free_shipping_threshold != null ? Number(p.free_shipping_threshold) : null),
      etaMin: p.etaMin != null ? Number(p.etaMin) : (p.eta_min != null ? Number(p.eta_min) : null),
      etaMax: p.etaMax != null ? Number(p.etaMax) : (p.eta_max != null ? Number(p.eta_max) : null),
      isDefault: Boolean(p.isDefault ?? p.is_default),
      active: Boolean(p.active),
      sourceTemplateId: p.sourceTemplateId || p.source_template_id || null,
      sourceTemplateVersion: p.sourceTemplateVersion ?? p.source_template_version ?? null,
      templateSnapshot: p.templateSnapshot || p.template_snapshot || {},
      editableFields: p.editableFields || p.editable_fields || [],
      copiedFromTemplateAt: p.copiedFromTemplateAt || p.copied_from_template_at || null,
      archivedAt: p.archivedAt || p.archived_at || null,
      metadata: p.metadata || {},
      createdAt: p.createdAt || p.created_at,
      updatedAt: p.updatedAt || p.updated_at,
    };
  }

  _serializeTemplate(template) {
    const t = template.toJSON ? template.toJSON() : template;
    return {
      id: t.id,
      name: t.name,
      description: t.description || null,
      shippingMethod: t.shippingMethod || t.shipping_method || "standard",
      serviceabilityMode: t.serviceabilityMode || t.serviceability_mode || "all_india",
      allowedStates: t.allowedStates || t.allowed_states || [],
      allowedCities: t.allowedCities || t.allowed_cities || [],
      allowedPincodes: t.allowedPincodes || t.allowed_pincodes || [],
      blockedPincodes: t.blockedPincodes || t.blocked_pincodes || [],
      codAvailable: t.codAvailable !== undefined ? t.codAvailable : (t.cod_available !== undefined ? t.cod_available : true),
      shippingCharge: Number(t.shippingCharge ?? t.shipping_charge ?? 0),
      freeShippingThreshold: t.freeShippingThreshold != null ? Number(t.freeShippingThreshold) : (t.free_shipping_threshold != null ? Number(t.free_shipping_threshold) : null),
      etaMin: t.etaMin != null ? Number(t.etaMin) : (t.eta_min != null ? Number(t.eta_min) : null),
      etaMax: t.etaMax != null ? Number(t.etaMax) : (t.eta_max != null ? Number(t.eta_max) : null),
      allowedOverrides: t.allowedOverrides || t.allowed_overrides || TEMPLATE_EDITABLE_DEFAULTS,
      version: Number(t.version || 1),
      status: t.status || "published",
      active: t.active !== false,
      metadata: t.metadata || {},
      createdAt: t.createdAt || t.created_at,
      updatedAt: t.updatedAt || t.updated_at,
    };
  }
}

module.exports = { ShippingProfilesService };
