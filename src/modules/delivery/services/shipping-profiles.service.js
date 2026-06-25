"use strict";

const { v4: uuidv4 } = require("uuid");
const { ShippingProfile } = require("../models/shipping-profile.model");
const { Op } = require("sequelize");
const { AppError } = require("../../../shared/errors/app-error");
const { SellerOrganizationRepository } = require("../../seller/repositories/seller-organization.repository");

const ADMIN_ROLES = new Set(["admin", "sub-admin", "super-admin", "super_admin"]);

class ShippingProfilesService {
  constructor({ organizationRepository = new SellerOrganizationRepository() } = {}) {
    this.organizationRepository = organizationRepository;
  }

  async list({ sellerId, organizationId, active, search, limit = 50, offset = 0 } = {}, actor = null) {
    const where = {};
    const actorSellerId = this._getActorSellerId(actor);

    if (!this._isAdminActor(actor) && actor) {
      if (!actorSellerId) throw new AppError("Seller context is required", 403);
      if (sellerId && String(sellerId) !== String(actorSellerId)) {
        throw new AppError("Access denied to seller shipping profiles", 403);
      }
      sellerId = actorSellerId;
    }

    if (sellerId) where.sellerId = sellerId;
    if (organizationId !== undefined) {
      where.organizationId = organizationId || null;
    }
    if (active !== undefined) where.active = active;
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
      profiles: rows.map(this._serialize),
    };
  }

  async get(profileId, actor = null) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);
    return this._serialize(profile);
  }

  async create(payload, actor) {
    const id = uuidv4();
    const sellerId = payload.sellerId || this._getActorSellerId(actor);
    if (!sellerId) throw new AppError("sellerId is required", 400);
    this._assertCanManageSeller(sellerId, actor);

    const organizationId = await this._resolveOrganizationId(sellerId, payload.organizationId, actor);

    // If marking as default, clear existing default for same seller+org
    if (payload.isDefault) {
      await this._clearDefault(sellerId, organizationId);
    }

    const profile = await ShippingProfile.create({
      id,
      sellerId,
      organizationId,
      name: payload.name,
      description: payload.description || null,
      shippingMethod: payload.shippingMethod || "standard",
      serviceabilityMode: payload.serviceabilityMode || "all_india",
      allowedStates: payload.allowedStates || [],
      allowedCities: payload.allowedCities || [],
      allowedPincodes: payload.allowedPincodes || [],
      blockedPincodes: payload.blockedPincodes || [],
      codAvailable: payload.codAvailable !== false,
      shippingCharge: Number(payload.shippingCharge ?? 0),
      freeShippingThreshold: payload.freeShippingThreshold != null ? Number(payload.freeShippingThreshold) : null,
      etaMin: payload.etaMin != null ? Number(payload.etaMin) : null,
      etaMax: payload.etaMax != null ? Number(payload.etaMax) : null,
      isDefault: Boolean(payload.isDefault),
      active: payload.active !== false,
      createdBy: this._getActorUserId(actor),
      updatedBy: this._getActorUserId(actor),
    });

    return this._serialize(profile);
  }

  async update(profileId, payload, actor) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);

    if (payload.isDefault && !profile.isDefault) {
      await this._clearDefault(profile.sellerId, profile.organizationId);
    }

    const updates = {};
    const fields = [
      "name", "description", "shippingMethod", "serviceabilityMode",
      "allowedStates", "allowedCities", "allowedPincodes", "blockedPincodes",
      "codAvailable", "shippingCharge", "freeShippingThreshold",
      "etaMin", "etaMax", "isDefault", "active",
    ];

    for (const field of fields) {
      if (payload[field] !== undefined) updates[field] = payload[field];
    }

    if (payload.shippingCharge !== undefined) updates.shippingCharge = Number(payload.shippingCharge);
    if (payload.freeShippingThreshold !== undefined) {
      updates.freeShippingThreshold = payload.freeShippingThreshold != null ? Number(payload.freeShippingThreshold) : null;
    }
    if (payload.etaMin !== undefined) updates.etaMin = payload.etaMin != null ? Number(payload.etaMin) : null;
    if (payload.etaMax !== undefined) updates.etaMax = payload.etaMax != null ? Number(payload.etaMax) : null;

    updates.updatedBy = this._getActorUserId(actor);

    await profile.update(updates);
    return this._serialize(profile);
  }

  async delete(profileId, actor) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);
    await profile.destroy();
    return { deleted: true, profileId };
  }

  async setDefault(profileId, actor) {
    const profile = await ShippingProfile.findByPk(profileId);
    if (!profile) throw new AppError("Shipping profile not found", 404);
    this._assertAccess(profile, actor);

    await this._clearDefault(profile.sellerId, profile.organizationId);
    await profile.update({ isDefault: true, updatedBy: this._getActorUserId(actor) });
    return this._serialize(profile);
  }

  // Used by delivery.service.js for serviceability checks
  async getById(profileId) {
    if (!profileId) return null;
    const profile = await ShippingProfile.findByPk(profileId);
    return profile ? this._serialize(profile) : null;
  }

  // Check if a pincode is serviceable according to a profile's rules
  checkPincodeAgainstProfile(profile, pincode, city, state) {
    if (!profile || !profile.active) return { allowed: true };

    const mode = profile.serviceabilityMode;
    const pin = String(pincode || "").trim();
    const cityStr = String(city || "").toLowerCase();
    const stateStr = String(state || "").toLowerCase();

    if (mode === "all_india") return { allowed: true };

    if (mode === "block_pincodes") {
      const blocked = (profile.blockedPincodes || []).map(String);
      if (blocked.includes(pin)) return { allowed: false, reason: "Pincode is blocked by seller" };
      return { allowed: true };
    }

    if (mode === "selected_pincodes") {
      const allowed = (profile.allowedPincodes || []).map(String);
      if (!allowed.length) return { allowed: true };
      if (!allowed.includes(pin)) return { allowed: false, reason: "Pincode not in seller's delivery area" };
      return { allowed: true };
    }

    if (mode === "selected_states") {
      const allowed = (profile.allowedStates || []).map((s) => s.toLowerCase());
      if (!allowed.length) return { allowed: true };
      if (!allowed.includes(stateStr)) return { allowed: false, reason: "State not in seller's delivery area" };
      return { allowed: true };
    }

    if (mode === "selected_cities") {
      const allowedCities = (profile.allowedCities || []).map((c) => c.toLowerCase());
      const allowedStates = (profile.allowedStates || []).map((s) => s.toLowerCase());

      // Must match city; if states also set, must also match state
      const cityMatch = !allowedCities.length || allowedCities.includes(cityStr);
      const stateMatch = !allowedStates.length || allowedStates.includes(stateStr);

      if (!cityMatch || !stateMatch) {
        return { allowed: false, reason: "City/State not in seller's delivery area" };
      }
      return { allowed: true };
    }

    return { allowed: true };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  async _clearDefault(sellerId, organizationId) {
    const where = { sellerId, isDefault: true };
    if (organizationId) {
      where.organizationId = organizationId;
    } else {
      where.organizationId = null;
    }
    await ShippingProfile.update({ isDefault: false }, { where });
  }

  _isAdminActor(actor = {}) {
    return ADMIN_ROLES.has(String(actor?.role || actor?.userType || "").toLowerCase()) || actor?.isSuperAdmin === true;
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
      createdAt: p.createdAt || p.created_at,
      updatedAt: p.updatedAt || p.updated_at,
    };
  }
}

module.exports = { ShippingProfilesService };
