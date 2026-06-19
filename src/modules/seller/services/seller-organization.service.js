const { AppError } = require("../../../shared/errors/app-error");
const { SellerOrganizationRepository } = require("../repositories/seller-organization.repository");
const { UserModel } = require("../../user/models/user.model");

const SELLER_ROLES = ["seller", "seller-admin", "seller-sub-admin"];
const ADMIN_ROLES = ["admin", "sub-admin", "super-admin"];
const APPROVED_STATUSES = new Set(["approved", "active"]);
const RESUBMITTABLE_STATUSES = new Set(["rejected", "blocked"]);

class SellerOrganizationService {
  constructor({
    organizationRepository = new SellerOrganizationRepository(),
  } = {}) {
    this.organizationRepository = organizationRepository;
  }

  isSellerActor(actor = {}) {
    return SELLER_ROLES.includes(actor.role);
  }

  isAdminActor(actor = {}) {
    return actor.isSuperAdmin || ADMIN_ROLES.includes(actor.role);
  }

  getSellerId(actor = {}) {
    return actor.ownerSellerId || actor.sellerId || actor.userId || actor.sub || null;
  }

  normalizeText(value, fallback = "") {
    const text = String(value || "").trim();
    return text || fallback;
  }

  normalizeCode(value) {
    const text = String(value || "").trim().toUpperCase();
    return text || null;
  }

  normalizeAddress(address = {}) {
    return {
      line1: address.line1 || "",
      line2: address.line2 || "",
      city: address.city || "",
      state: address.state || "",
      country: address.country || "India",
      postalCode: address.postalCode || address.pincode || "",
    };
  }

  normalizeOrganizationPayload(payload = {}, actor = {}, { admin = false, create = false } = {}) {
    const legalBusinessName = this.normalizeText(
      payload.legalBusinessName || payload.legalName || payload.businessName,
    );
    const storeDisplayName = this.normalizeText(
      payload.storeDisplayName || payload.displayName || payload.storeName,
      legalBusinessName,
    );

    const normalized = {
      ...(legalBusinessName ? { legalBusinessName } : {}),
      ...(storeDisplayName ? { storeDisplayName } : {}),
      ...(payload.businessType !== undefined ? { businessType: payload.businessType || null } : {}),
      ...(payload.gstin !== undefined || payload.gstNumber !== undefined
        ? { gstin: this.normalizeCode(payload.gstin || payload.gstNumber) }
        : {}),
      ...(payload.pan !== undefined || payload.panNumber !== undefined
        ? { pan: this.normalizeCode(payload.pan || payload.panNumber) }
        : {}),
      ...(payload.documents !== undefined || payload.kycDocuments !== undefined
        ? { documents: payload.documents || payload.kycDocuments || {} }
        : {}),
      ...(payload.bankDetails !== undefined ? { bankDetails: payload.bankDetails || {} } : {}),
      ...(payload.billingAddress !== undefined || payload.businessAddress !== undefined
        ? { billingAddress: this.normalizeAddress(payload.billingAddress || payload.businessAddress || {}) }
        : {}),
      ...(payload.pickupAddress !== undefined ? { pickupAddress: this.normalizeAddress(payload.pickupAddress || {}) } : {}),
      ...(payload.returnAddress !== undefined ? { returnAddress: this.normalizeAddress(payload.returnAddress || {}) } : {}),
      ...(payload.taxSettings !== undefined ? { taxSettings: payload.taxSettings || {} } : {}),
      ...(payload.invoiceSettings !== undefined ? { invoiceSettings: payload.invoiceSettings || {} } : {}),
      ...(payload.payoutSettings !== undefined ? { payoutSettings: payload.payoutSettings || {} } : {}),
      ...(payload.metadata !== undefined ? { metadata: payload.metadata || {} } : {}),
      updatedBy: actor.userId || actor.sub || null,
    };

    if (create) {
      normalized.kycStatus = payload.kycStatus || "submitted";
      normalized.bankVerificationStatus = payload.bankVerificationStatus || "submitted";
      normalized.approvalStatus = admin
        ? payload.approvalStatus || "pending_review"
        : "pending_review";
      normalized.createdBy = actor.userId || actor.sub || null;
      if (payload.isDefault !== undefined) normalized.isDefault = Boolean(payload.isDefault);
    }

    if (admin) {
      if (payload.kycStatus !== undefined) normalized.kycStatus = payload.kycStatus;
      if (payload.bankVerificationStatus !== undefined) normalized.bankVerificationStatus = payload.bankVerificationStatus;
      if (payload.approvalStatus !== undefined) normalized.approvalStatus = payload.approvalStatus;
      if (payload.rejectionReason !== undefined) normalized.rejectionReason = payload.rejectionReason || null;
      if (payload.requiredChanges !== undefined) normalized.requiredChanges = payload.requiredChanges || [];
      if (payload.isDefault !== undefined) normalized.isDefault = Boolean(payload.isDefault);
      if (payload.suspendedAt !== undefined) normalized.suspendedAt = payload.suspendedAt;
    }

    return normalized;
  }

  buildVerificationEvent(existing = {}, updates = {}, actor = {}, { action = "organization_update", notes = null } = {}) {
    return {
      action,
      status: updates.approvalStatus || existing.approvalStatus || "draft",
      kycStatus: updates.kycStatus || existing.kycStatus || "not_submitted",
      bankVerificationStatus:
        updates.bankVerificationStatus ||
        existing.bankVerificationStatus ||
        "not_submitted",
      rejectionReason:
        updates.rejectionReason !== undefined
          ? updates.rejectionReason || null
          : existing.rejectionReason || null,
      requiredChanges:
        updates.requiredChanges !== undefined
          ? updates.requiredChanges || []
          : existing.requiredChanges || [],
      actorId: actor.userId || actor.sub || null,
      actorRole: actor.role || null,
      notes: notes || updates.notes || null,
      at: new Date().toISOString(),
    };
  }

  appendVerificationEvent(existing = {}, updates = {}, actor = {}, options = {}) {
    const previous = Array.isArray(existing.verificationHistory)
      ? existing.verificationHistory
      : [];
    const event = this.buildVerificationEvent(existing, updates, actor, options);
    return [...previous, event].slice(-100);
  }

  buildLifecyclePatch(existing = {}, updates = {}, actor = {}, options = {}) {
    const status = updates.approvalStatus || existing.approvalStatus || "draft";
    const now = new Date();
    const actorId = actor.userId || actor.sub || null;
    const hasStatusUpdate = Object.prototype.hasOwnProperty.call(updates, "approvalStatus");
    const event = this.buildVerificationEvent(existing, updates, actor, options);
    const verificationHistory = [
      ...(Array.isArray(existing.verificationHistory) ? existing.verificationHistory : []),
      event,
    ].slice(-100);
    const metadata = {
      ...(existing.metadata || {}),
      ...(updates.metadata || {}),
      lastVerificationEvent: event,
    };

    const patch = {
      metadata,
      verificationHistory,
    };

    if (hasStatusUpdate && (status === "approved" || status === "active")) {
      Object.assign(patch, {
        approvedAt: now,
        approvedBy: actorId,
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: null,
        requiredChanges: [],
        blockedAt: null,
        blockedBy: null,
        suspendedAt: null,
      });
    } else if (hasStatusUpdate && status === "rejected") {
      Object.assign(patch, {
        rejectedAt: now,
        rejectedBy: actorId,
        rejectionReason: updates.rejectionReason || null,
        requiredChanges: updates.requiredChanges || [],
        approvedAt: null,
        approvedBy: null,
      });
    } else if (hasStatusUpdate && status === "resubmitted") {
      Object.assign(patch, {
        resubmittedAt: now,
        resubmittedBy: actorId,
        rejectionReason: null,
        requiredChanges: [],
      });
    } else if (hasStatusUpdate && (status === "blocked" || status === "suspended")) {
      Object.assign(patch, {
        blockedAt: now,
        blockedBy: actorId,
        suspendedAt: status === "suspended" ? now : updates.suspendedAt || existing.suspendedAt || null,
      });
    } else if (hasStatusUpdate && status === "pending_review") {
      Object.assign(patch, {
        blockedAt: null,
        blockedBy: null,
      });
    }

    return patch;
  }

  validateCreatePayload(payload = {}) {
    const missing = [];
    if (!payload.legalBusinessName) missing.push("legalBusinessName");
    if (!payload.storeDisplayName) missing.push("storeDisplayName");
    if (!payload.pan) missing.push("pan");
    if (!payload.billingAddress?.state) missing.push("billingAddress.state");
    if (!payload.pickupAddress?.state) missing.push("pickupAddress.state");
    if (!payload.bankDetails?.accountNumber) missing.push("bankDetails.accountNumber");
    if (!payload.bankDetails?.ifscCode) missing.push("bankDetails.ifscCode");
    if (missing.length) {
      throw new AppError(`Organization is missing required fields: ${missing.join(", ")}`, 400, { missing });
    }
  }

  buildSnapshot(organization = {}) {
    if (!organization?.id) return null;
    return {
      organizationId: organization.id,
      sellerId: organization.sellerId,
      legalBusinessName: organization.legalBusinessName,
      storeDisplayName: organization.storeDisplayName,
      businessType: organization.businessType || null,
      gstin: organization.gstin || null,
      pan: organization.pan || null,
      billingAddress: organization.billingAddress || {},
      pickupAddress: organization.pickupAddress || {},
      taxSettings: organization.taxSettings || {},
      invoiceSettings: organization.invoiceSettings || {},
      payoutSettings: organization.payoutSettings || {},
      approvalStatus: organization.approvalStatus || null,
      kycStatus: organization.kycStatus || null,
      bankVerificationStatus: organization.bankVerificationStatus || null,
    };
  }

  hasObjectValue(value = {}) {
    return value && typeof value === "object" && Object.values(value).some((item) => {
      if (item === null || item === undefined) return false;
      if (typeof item === "object") return Object.keys(item).length > 0;
      return String(item).trim().length > 0;
    });
  }

  buildSellerProfileMirror(sellerProfile = {}, organization = null) {
    const profile = { ...(sellerProfile || {}) };
    if (!organization?.id) return profile;

    const bankDetails = this.hasObjectValue(organization.bankDetails)
      ? organization.bankDetails
      : profile.bankDetails;
    const billingAddress = this.hasObjectValue(organization.billingAddress)
      ? organization.billingAddress
      : profile.businessAddress;
    const pickupAddress = this.hasObjectValue(organization.pickupAddress)
      ? organization.pickupAddress
      : profile.pickupAddress;
    const returnAddress = this.hasObjectValue(organization.returnAddress)
      ? organization.returnAddress
      : profile.returnAddress;

    return {
      ...profile,
      businessName: profile.businessName || organization.legalBusinessName || organization.storeDisplayName || "",
      displayName: organization.storeDisplayName || profile.displayName,
      legalBusinessName: organization.legalBusinessName || profile.legalBusinessName,
      businessType: organization.businessType || profile.businessType,
      gstNumber: organization.gstin || profile.gstNumber,
      panNumber: organization.pan || profile.panNumber,
      bankDetails,
      businessAddress: billingAddress,
      pickupAddress,
      returnAddress,
      kycStatus: organization.kycStatus || profile.kycStatus,
      bankVerificationStatus: organization.bankVerificationStatus || profile.bankVerificationStatus,
      rejectionReason: organization.rejectionReason || profile.rejectionReason,
      organizationId: organization.id,
      organizationApprovalStatus: organization.approvalStatus,
      organizationRejectionReason: organization.rejectionReason || null,
      organizationRequiredChanges: organization.requiredChanges || [],
      organizationVerificationHistory: organization.verificationHistory || [],
    };
  }

  buildPublicSummary(organization = null) {
    if (!organization?.id) return null;
    return {
      id: organization.id,
      legalBusinessName: organization.legalBusinessName,
      storeDisplayName: organization.storeDisplayName,
      businessType: organization.businessType || null,
      gstin: organization.gstin || null,
      pan: organization.pan || null,
      approvalStatus: organization.approvalStatus || "draft",
      kycStatus: organization.kycStatus || "not_submitted",
      bankVerificationStatus: organization.bankVerificationStatus || "not_submitted",
      rejectionReason: organization.rejectionReason || null,
      requiredChanges: organization.requiredChanges || [],
      approvedAt: organization.approvedAt || null,
      rejectedAt: organization.rejectedAt || null,
      resubmittedAt: organization.resubmittedAt || null,
      blockedAt: organization.blockedAt || null,
      isDefault: Boolean(organization.isDefault),
    };
  }

  assertApproved(organization = {}) {
    if (!APPROVED_STATUSES.has(String(organization.approvalStatus || ""))) {
      throw new AppError("Organization must be approved before products can be listed", 403, {
        organizationId: organization.id,
        approvalStatus: organization.approvalStatus,
      });
    }
    if (organization.kycStatus !== "verified") {
      throw new AppError("Organization KYC must be verified before products can be listed", 403, {
        organizationId: organization.id,
        kycStatus: organization.kycStatus,
      });
    }
    if (organization.bankVerificationStatus !== "verified") {
      throw new AppError("Organization bank details must be verified before products can be listed", 403, {
        organizationId: organization.id,
        bankVerificationStatus: organization.bankVerificationStatus,
      });
    }
  }

  async assertOrganizationForSeller(sellerId, organizationId, options = {}) {
    if (!sellerId) {
      throw new AppError("Seller account could not be resolved", 403);
    }
    if (!organizationId) {
      throw new AppError("organizationId is required for seller products", 400);
    }
    const organization = await this.organizationRepository.findByIdForSeller(sellerId, organizationId);
    if (!organization) {
      throw new AppError("Organization not found for seller", 404);
    }
    if (options.requireApproved) {
      this.assertApproved(organization);
    }
    return organization;
  }

  async getDefaultOrOnlyOrganization(sellerId) {
    return (
      await this.organizationRepository.findDefaultBySeller(sellerId)
    ) || (
      await this.organizationRepository.findOnlyBySeller(sellerId)
    );
  }

  async getDefaultOrganizationMap(sellerIds = []) {
    const ids = Array.from(new Set(sellerIds.map((id) => String(id || "")).filter(Boolean)));
    if (!ids.length) return new Map();
    const rows = await this.organizationRepository.listDefaultOrLatestBySellerIds(ids);
    return new Map(rows.map((organization) => [String(organization.sellerId), organization]));
  }

  async ensureDefaultOrganizationForSeller(sellerId, sellerProfile = {}, actor = {}) {
    const targetGstin = this.normalizeCode(sellerProfile.gstNumber);

    // If the profile has a GSTIN, prefer the org that already owns it — avoids
    // updating a different org row with a GSTIN that the first row already holds.
    if (targetGstin) {
      const gstinOwner = await this.organizationRepository.findByGstinForSeller(
        sellerId,
        targetGstin,
      );
      if (gstinOwner) {
        if (!gstinOwner.isDefault) {
          await this.organizationRepository.update(gstinOwner.id, {
            isDefault: true,
            updatedBy: actor.userId || actor.sub || sellerId,
          });
        }
        return this.organizationRepository.findById(gstinOwner.id);
      }
    }

    const existing = await this.organizationRepository.findDefaultBySeller(sellerId);
    if (existing) return existing;

    // No default org — check if any org exists at all before creating a new one.
    // This prevents duplicate orgs when is_default was not set correctly on older records.
    const anyExisting = await this.organizationRepository.findLatestBySeller(sellerId);
    if (anyExisting) {
      await this.organizationRepository.update(anyExisting.id, {
        isDefault: true,
        updatedBy: actor.userId || actor.sub || sellerId,
      });
      return this.organizationRepository.findById(anyExisting.id);
    }

    const legalBusinessName =
      sellerProfile.legalBusinessName ||
      sellerProfile.businessName ||
      sellerProfile.displayName ||
      `Seller ${sellerId}`;
    const organizationPayload = {
      sellerId,
      legalBusinessName,
      storeDisplayName: sellerProfile.displayName || sellerProfile.businessName || legalBusinessName,
      businessType: sellerProfile.businessType || null,
      gstin: this.normalizeCode(sellerProfile.gstNumber),
      pan: this.normalizeCode(sellerProfile.panNumber),
      kycStatus: sellerProfile.kycStatus === "verified" ? "verified" : "submitted",
      bankVerificationStatus: sellerProfile.bankVerificationStatus || "submitted",
      approvalStatus: "pending_review",
      documents: {},
      bankDetails: sellerProfile.bankDetails || {},
      billingAddress: this.normalizeAddress(sellerProfile.businessAddress || {}),
      pickupAddress: this.normalizeAddress(sellerProfile.pickupAddress || {}),
      returnAddress: this.normalizeAddress(sellerProfile.returnAddress || {}),
      taxSettings: {
        gstin: this.normalizeCode(sellerProfile.gstNumber),
        pan: this.normalizeCode(sellerProfile.panNumber),
        state: sellerProfile.businessAddress?.state || sellerProfile.pickupAddress?.state || "",
      },
      invoiceSettings: {
        invoicePrefix: "INV",
        state: sellerProfile.businessAddress?.state || sellerProfile.pickupAddress?.state || "",
      },
      payoutSettings: {
        payoutSchedule: sellerProfile.payoutSchedule || "weekly",
      },
      isDefault: true,
      metadata: { source: "seller_profile_default_bridge" },
      createdBy: actor.userId || actor.sub || sellerId,
      updatedBy: actor.userId || actor.sub || sellerId,
    };
    const organization = await this.organizationRepository.create({
      ...organizationPayload,
      ...this.buildLifecyclePatch(
        {},
        organizationPayload,
        actor,
        { action: "default_organization_created_from_onboarding" },
      ),
    });
    return organization;
  }

  async listMine(query = {}, actor = {}) {
    const sellerId = this.getSellerId(actor);
    if (!this.isSellerActor(actor) || !sellerId) {
      throw new AppError("Only seller accounts can view organizations", 403);
    }
    const organizations = await this.organizationRepository.listBySeller(sellerId, query);
    return {
      sellerId,
      organizations,
      selectedOrganizationId:
        organizations.length === 1 ? organizations[0].id : query.organizationId || null,
      requiresSelection: organizations.length > 1,
    };
  }

  async createMine(payload = {}, actor = {}) {
    const sellerId = this.getSellerId(actor);
    if (!this.isSellerActor(actor) || !sellerId) {
      throw new AppError("Only seller accounts can create organizations", 403);
    }
    const normalized = this.normalizeOrganizationPayload(payload, actor, { create: true });
    this.validateCreatePayload(normalized);
    const existing = await this.organizationRepository.listBySeller(sellerId);
    const organizationPayload = {
      ...normalized,
      sellerId,
      isDefault: existing.length === 0 || payload.isDefault === true,
    };
    const lifecyclePatch = this.buildLifecyclePatch(
      {},
      organizationPayload,
      actor,
      { action: "seller_organization_created" },
    );
    return this.organizationRepository.create({
      ...organizationPayload,
      ...lifecyclePatch,
    });
  }

  async updateMine(organizationId, payload = {}, actor = {}) {
    const sellerId = this.getSellerId(actor);
    if (!this.isSellerActor(actor) || !sellerId) {
      throw new AppError("Only seller accounts can update organizations", 403);
    }
    const existing = await this.assertOrganizationForSeller(sellerId, organizationId);
    if (APPROVED_STATUSES.has(String(existing.approvalStatus || ""))) {
      throw new AppError("Approved organizations require admin review for legal/KYC changes", 409);
    }
    const normalized = this.normalizeOrganizationPayload(payload, actor, { create: false });
    const approvalStatus = RESUBMITTABLE_STATUSES.has(existing.approvalStatus)
      ? "resubmitted"
      : "pending_review";
    const updates = {
      ...normalized,
      approvalStatus,
      kycStatus: "submitted",
    };
    const lifecyclePatch = this.buildLifecyclePatch(
      existing,
      updates,
      actor,
      { action: approvalStatus === "resubmitted" ? "seller_organization_resubmitted" : "seller_organization_updated" },
    );
    return this.organizationRepository.update(organizationId, {
      ...updates,
      ...lifecyclePatch,
    });
  }

  async setMineDefault(organizationId, actor = {}) {
    const sellerId = this.getSellerId(actor);
    await this.assertOrganizationForSeller(sellerId, organizationId);
    return this.organizationRepository.setDefault(sellerId, organizationId, actor.userId || actor.sub || null);
  }

  async adminList(query = {}, actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can list seller organizations", 403);
    }
    const sellerIds = await this.findSellerIdsForSearch(query.q);
    const result = await this.organizationRepository.list({
      ...query,
      sellerIds,
    });
    const sellerMap = await this.getSellerSummaryMap(result.items.map((item) => item.sellerId));
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        seller: sellerMap.get(String(item.sellerId)) || null,
      })),
    };
  }

  async findSellerIdsForSearch(term = "") {
    const q = String(term || "").trim();
    if (!q) return [];
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const sellers = await UserModel.find({
      role: "seller",
      $or: [
        { email: regex },
        { phone: regex },
        { "profile.firstName": regex },
        { "profile.lastName": regex },
        { "sellerProfile.displayName": regex },
        { "sellerProfile.businessName": regex },
        { "sellerProfile.legalBusinessName": regex },
      ],
    }).select("_id").limit(50).lean();
    return sellers.map((seller) => String(seller._id));
  }

  async getSellerSummaryMap(sellerIds = []) {
    const ids = Array.from(new Set(sellerIds.map((id) => String(id || "")).filter(Boolean)));
    if (!ids.length) return new Map();
    const sellers = await UserModel.find({ _id: { $in: ids } })
      .select("email phone profile sellerProfile accountStatus")
      .lean();
    return new Map(sellers.map((seller) => [
      String(seller._id),
      {
        id: String(seller._id),
        email: seller.email || null,
        phone: seller.phone || null,
        accountStatus: seller.accountStatus || null,
        displayName:
          seller.sellerProfile?.displayName ||
          seller.sellerProfile?.businessName ||
          [seller.profile?.firstName, seller.profile?.lastName].filter(Boolean).join(" ") ||
          seller.email ||
          String(seller._id),
      },
    ]));
  }

  async adminListForSeller(sellerId, query = {}, actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can view seller organizations", 403);
    }
    const seller = await UserModel.findById(sellerId).select("email role sellerProfile accountStatus").lean();
    if (!seller) throw AppError.notFound("Seller");
    const organizations = await this.organizationRepository.listBySeller(sellerId, query);
    return {
      sellerId,
      seller,
      organizations,
    };
  }

  async adminCreate(sellerId, payload = {}, actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can create seller organizations", 403);
    }
    const seller = await UserModel.findById(sellerId).select("email role sellerProfile accountStatus").lean();
    if (!seller) throw AppError.notFound("Seller");

    const normalized = this.normalizeOrganizationPayload(payload, actor, { admin: true, create: true });
    this.validateCreatePayload(normalized);
    const existing = await this.organizationRepository.listBySeller(sellerId);
    const organizationPayload = {
      ...normalized,
      sellerId,
      isDefault: existing.length === 0 || payload.isDefault === true,
    };
    const lifecyclePatch = this.buildLifecyclePatch(
      {},
      organizationPayload,
      actor,
      { action: "admin_organization_created" },
    );

    return this.organizationRepository.create({
      ...organizationPayload,
      ...lifecyclePatch,
    });
  }

  async adminGet(sellerId, organizationId, actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can view seller organizations", 403);
    }
    const organization = await this.organizationRepository.findByIdForSeller(sellerId, organizationId);
    if (!organization) throw AppError.notFound("Seller organization");
    return organization;
  }

  async adminUpdate(sellerId, organizationId, payload = {}, actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can update seller organizations", 403);
    }
    const existing = await this.organizationRepository.findByIdForSeller(sellerId, organizationId);
    if (!existing) throw AppError.notFound("Seller organization");
    const normalized = this.normalizeOrganizationPayload(payload, actor, { admin: true });
    if (normalized.approvalStatus === "rejected" && !normalized.rejectionReason) {
      throw new AppError("Rejection reason is required when organization is rejected", 400);
    }
    const action = payload.approvalStatus || payload.status || payload.kycStatus || payload.bankVerificationStatus
      ? "admin_organization_review"
      : "admin_organization_update";
    return this.organizationRepository.update(organizationId, {
      ...normalized,
      ...this.buildLifecyclePatch(existing, normalized, actor, { action, notes: payload.notes || null }),
    });
  }

  async adminReview(sellerId, organizationId, payload = {}, actor = {}) {
    const status = payload.approvalStatus || payload.status;
    if (status === "rejected" && !payload.rejectionReason) {
      throw new AppError("Rejection reason is required when organization is rejected", 400);
    }
    const kycStatus = payload.kycStatus;
    const bankVerificationStatus = payload.bankVerificationStatus;
    return this.adminUpdate(sellerId, organizationId, {
      ...(status ? { approvalStatus: status } : {}),
      ...(kycStatus ? { kycStatus } : {}),
      ...(bankVerificationStatus ? { bankVerificationStatus } : {}),
      ...(payload.rejectionReason !== undefined ? { rejectionReason: payload.rejectionReason || null } : {}),
      ...(payload.requiredChanges !== undefined ? { requiredChanges: payload.requiredChanges || [] } : {}),
      ...(status === "suspended" ? { suspendedAt: new Date() } : {}),
      ...(status && status !== "suspended" ? { suspendedAt: null } : {}),
      metadata: payload.metadata || {},
      notes: payload.notes || null,
    }, actor);
  }
}

const sellerOrganizationService = new SellerOrganizationService();

module.exports = {
  SellerOrganizationService,
  sellerOrganizationService,
};
