const { AppError } = require("../../../shared/errors/app-error");
const { SellerOrganizationRepository } = require("../repositories/seller-organization.repository");
const { UserModel } = require("../../user/models/user.model");
const { storageService: defaultStorageService } = require("../../../shared/storage/storage-service");
const { v4: uuidv4 } = require("uuid");

const SELLER_ROLES = ["seller", "seller-admin", "seller-sub-admin"];
const ADMIN_ROLES = ["admin", "sub-admin", "super-admin"];
const APPROVED_STATUSES = new Set(["approved", "active"]);
const RESUBMITTABLE_STATUSES = new Set(["rejected", "blocked"]);
const BUSINESS_BLOCKING_GO_LIVE_STATUSES = new Set(["blocked", "rejected"]);
const REQUIRED_ADDRESS_FIELDS = ["line1", "city", "state", "postalCode"];
const REQUIRED_BANK_FIELDS = ["accountHolderName", "accountNumber", "ifscCode", "bankName"];
const REQUIRED_DOCUMENT_FIELDS = [
  "panDocumentUrl",
  "gstCertificateUrl",
  "aadhaarFrontUrl",
  "aadhaarBackUrl",
  "bankProofUrl",
  "addressProofUrl",
];

class SellerOrganizationService {
  constructor({
    organizationRepository = new SellerOrganizationRepository(),
    storageService = defaultStorageService,
  } = {}) {
    this.organizationRepository = organizationRepository;
    this.storageService = storageService;
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

  isOrganizationApprovedForBusiness(organization = {}) {
    return (
      APPROVED_STATUSES.has(String(organization.approvalStatus || "")) &&
      organization.kycStatus === "verified" &&
      organization.bankVerificationStatus === "verified" &&
      !BUSINESS_BLOCKING_GO_LIVE_STATUSES.has(String(organization.goLiveStatus || ""))
    );
  }

  isOrganizationLiveForBusiness(organization = {}) {
    return (
      this.isOrganizationApprovedForBusiness(organization) &&
      organization.goLiveStatus === "live"
    );
  }

  getOrganizationMissingRequiredFields(organization = {}) {
    const missing = [];
    if (!this.normalizeText(organization.legalBusinessName)) missing.push("legalBusinessName");
    if (!this.normalizeText(organization.storeDisplayName)) missing.push("storeDisplayName");
    if (!this.normalizeText(organization.businessType)) missing.push("businessType");
    if (!this.normalizeText(organization.supportEmail)) missing.push("supportEmail");
    if (!this.normalizeText(organization.supportPhone)) missing.push("supportPhone");
    if (!this.normalizeText(organization.primaryContactName)) missing.push("primaryContactName");
    if (!this.normalizeText(organization.gstin)) missing.push("gstin");
    if (!this.normalizeText(organization.pan)) missing.push("pan");
    if (!this.normalizeText(organization.aadhaarNumber)) missing.push("aadhaarNumber");
    if (!organization.dateOfBirth) missing.push("dateOfBirth");

    REQUIRED_ADDRESS_FIELDS.forEach((field) => {
      if (!this.normalizeText(organization.billingAddress?.[field])) {
        missing.push(`billingAddress.${field}`);
      }
      if (!this.normalizeText(organization.pickupAddress?.[field])) {
        missing.push(`pickupAddress.${field}`);
      }
    });

    REQUIRED_BANK_FIELDS.forEach((field) => {
      if (!this.normalizeText(organization.bankDetails?.[field])) {
        missing.push(`bankDetails.${field}`);
      }
    });

    REQUIRED_DOCUMENT_FIELDS.forEach((field) => {
      if (!this.normalizeText(organization.documents?.[field])) {
        missing.push(`documents.${field}`);
      }
    });

    return missing;
  }

  assertOrganizationRequiredFields(organization = {}) {
    const missing = this.getOrganizationMissingRequiredFields(organization);
    if (missing.length) {
      throw new AppError(`Organization is missing required fields: ${missing.join(", ")}`, 400, { missing });
    }
  }

  mergeOrganizationPatch(existing = {}, patch = {}) {
    const mergeObject = (key) =>
      patch[key] !== undefined
        ? { [key]: { ...(existing[key] || {}), ...(patch[key] || {}) } }
        : {};

    return {
      ...existing,
      ...patch,
      ...mergeObject("documents"),
      ...mergeObject("bankDetails"),
      ...mergeObject("billingAddress"),
      ...mergeObject("pickupAddress"),
      ...mergeObject("returnAddress"),
      ...mergeObject("taxSettings"),
      ...mergeObject("invoiceSettings"),
      ...mergeObject("payoutSettings"),
      ...mergeObject("complianceSettings"),
      ...mergeObject("metadata"),
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
      ...(payload.description !== undefined ? { description: this.normalizeText(payload.description) || null } : {}),
      ...(payload.supportEmail !== undefined ? { supportEmail: this.normalizeText(payload.supportEmail).toLowerCase() } : {}),
      ...(payload.supportPhone !== undefined ? { supportPhone: this.normalizeText(payload.supportPhone) } : {}),
      ...(payload.registrationNumber !== undefined ? { registrationNumber: this.normalizeText(payload.registrationNumber) || null } : {}),
      ...(payload.aadhaarNumber !== undefined ? { aadhaarNumber: this.normalizeText(payload.aadhaarNumber) || null } : {}),
      ...(payload.dateOfBirth !== undefined ? { dateOfBirth: payload.dateOfBirth || null } : {}),
      ...(payload.businessWebsite !== undefined ? { businessWebsite: this.normalizeText(payload.businessWebsite) || null } : {}),
      ...(payload.primaryContactName !== undefined ? { primaryContactName: this.normalizeText(payload.primaryContactName) } : {}),
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
      ...(payload.complianceSettings !== undefined ? { complianceSettings: payload.complianceSettings || {} } : {}),
      ...(payload.metadata !== undefined ? { metadata: payload.metadata || {} } : {}),
      updatedBy: actor.userId || actor.sub || null,
    };

    if (create) {
      normalized.kycStatus = "submitted";
      normalized.bankVerificationStatus = "submitted";
      normalized.goLiveStatus = "pending";
      normalized.approvalStatus = "pending_review";
      normalized.createdBy = actor.userId || actor.sub || null;
      if (payload.isDefault !== undefined) normalized.isDefault = Boolean(payload.isDefault);
    }

    if (admin && !create) {
      if (payload.kycStatus !== undefined) normalized.kycStatus = payload.kycStatus;
      if (payload.bankVerificationStatus !== undefined) normalized.bankVerificationStatus = payload.bankVerificationStatus;
      if (payload.goLiveStatus !== undefined) normalized.goLiveStatus = payload.goLiveStatus;
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
      goLiveStatus: updates.goLiveStatus || existing.goLiveStatus || "pending",
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
    this.assertOrganizationRequiredFields(payload);
  }

  async uploadOrganizationDocuments(organizationId, documents = {}, existingDocuments = {}) {
    if (!documents || !Object.keys(documents).length) return existingDocuments || {};
    const uploaded = await this.storageService.uploadKycDocuments(documents, {
      ownerType: "seller-organizations",
      ownerId: organizationId,
      folder: `ecommerce/kyc/seller-organizations/${organizationId}`,
    });
    return { ...(existingDocuments || {}), ...uploaded };
  }

  assertBankDetailsComplete(organization = {}) {
    const missing = ["accountHolderName", "accountNumber", "ifscCode", "bankName"]
      .filter((key) => !String(organization.bankDetails?.[key] || "").trim());
    if (missing.length) {
      throw new AppError("Complete organization bank details before bank verification", 400, {
        missingFields: missing.map((key) => `bankDetails.${key}`),
      });
    }
  }

  buildStageReviewPatch(existing = {}, payload = {}, actor = {}) {
    const now = new Date();
    const actorId = actor.userId || actor.sub || null;
    const patch = {};

    if (payload.kycStatus !== undefined) {
      patch.kycStatus = payload.kycStatus;
      patch.kycReviewedAt = now;
      patch.kycReviewedBy = actorId;
      if (payload.kycStatus !== "verified") {
        patch.bankVerificationStatus = existing.bankVerificationStatus === "verified"
          ? "submitted"
          : existing.bankVerificationStatus;
        patch.goLiveStatus = "pending";
        patch.approvalStatus = payload.kycStatus === "rejected" ? "rejected" : "pending_review";
      }
    }

    const effectiveKycStatus = patch.kycStatus || existing.kycStatus;
    if (payload.bankVerificationStatus !== undefined) {
      if (payload.bankVerificationStatus === "verified" && effectiveKycStatus !== "verified") {
        throw new AppError("Organization KYC must be verified before bank approval", 409);
      }
      if (payload.bankVerificationStatus === "verified") this.assertBankDetailsComplete(existing);
      patch.bankVerificationStatus = payload.bankVerificationStatus;
      patch.bankReviewedAt = now;
      patch.bankReviewedBy = actorId;
      if (payload.bankVerificationStatus !== "verified") {
        patch.goLiveStatus = "pending";
        patch.approvalStatus = payload.bankVerificationStatus === "rejected" ? "rejected" : "pending_review";
      } else if (effectiveKycStatus === "verified") {
        if (APPROVED_STATUSES.has(String(existing.approvalStatus || ""))) {
          patch.approvalStatus = existing.approvalStatus;
          patch.goLiveStatus = existing.goLiveStatus === "live" ? "live" : "ready";
        } else {
          patch.goLiveStatus = "ready";
          patch.approvalStatus = "pending_review";
        }
      }
    }

    const effectiveBankStatus = patch.bankVerificationStatus || existing.bankVerificationStatus;
    const requestedApprovalStatus = payload.approvalStatus || payload.status;
    if (["approved", "active"].includes(requestedApprovalStatus)) {
      if (effectiveKycStatus !== "verified" || effectiveBankStatus !== "verified") {
        throw new AppError("KYC and bank must be verified before organization approval", 409, {
          kycStatus: effectiveKycStatus,
          bankVerificationStatus: effectiveBankStatus,
        });
      }
      this.validateCreatePayload(existing);
      patch.approvalStatus = requestedApprovalStatus;
      if (!patch.goLiveStatus && existing.goLiveStatus !== "live") {
        patch.goLiveStatus = "ready";
      }
    }

    if (payload.goLiveStatus !== undefined) {
      if (payload.goLiveStatus === "live") {
        const effectiveApprovalStatus = patch.approvalStatus || existing.approvalStatus;
        if (!APPROVED_STATUSES.has(String(effectiveApprovalStatus || ""))) {
          throw new AppError("Organization must be approved before go-live", 409, {
            approvalStatus: effectiveApprovalStatus || "pending_review",
          });
        }
        if (effectiveKycStatus !== "verified" || effectiveBankStatus !== "verified") {
          throw new AppError("KYC and bank must be verified before organization go-live", 409, {
            kycStatus: effectiveKycStatus,
            bankVerificationStatus: effectiveBankStatus,
          });
        }
        this.validateCreatePayload(existing);
        patch.goLiveStatus = "live";
        patch.approvalStatus = effectiveApprovalStatus;
        patch.goLiveApprovedAt = now;
        patch.goLiveApprovedBy = actorId;
      } else {
        patch.goLiveStatus = payload.goLiveStatus;
        if (["blocked", "rejected"].includes(payload.goLiveStatus)) {
          patch.approvalStatus = payload.goLiveStatus === "blocked" ? "blocked" : "rejected";
        }
      }
    }

    return patch;
  }

  buildSnapshot(organization = {}) {
    if (!organization?.id) return null;
    return {
      organizationId: organization.id,
      sellerId: organization.sellerId,
      legalBusinessName: organization.legalBusinessName,
      storeDisplayName: organization.storeDisplayName,
      businessType: organization.businessType || null,
      registrationNumber: organization.registrationNumber || null,
      supportEmail: organization.supportEmail || null,
      supportPhone: organization.supportPhone || null,
      gstin: organization.gstin || null,
      pan: organization.pan || null,
      billingAddress: organization.billingAddress || {},
      pickupAddress: organization.pickupAddress || {},
      taxSettings: organization.taxSettings || {},
      invoiceSettings: organization.invoiceSettings || {},
      payoutSettings: organization.payoutSettings || {},
      complianceSettings: organization.complianceSettings || {},
      approvalStatus: organization.approvalStatus || null,
      kycStatus: organization.kycStatus || null,
      bankVerificationStatus: organization.bankVerificationStatus || null,
      goLiveStatus: organization.goLiveStatus || "pending",
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
      description: organization.description || profile.description,
      supportEmail: organization.supportEmail || profile.supportEmail,
      supportPhone: organization.supportPhone || profile.supportPhone,
      registrationNumber: organization.registrationNumber || profile.registrationNumber,
      aadhaarNumber: organization.aadhaarNumber || profile.aadhaarNumber,
      dateOfBirth: organization.dateOfBirth || profile.dateOfBirth,
      businessWebsite: organization.businessWebsite || profile.businessWebsite,
      primaryContactName: organization.primaryContactName || profile.primaryContactName,
      gstNumber: organization.gstin || profile.gstNumber,
      panNumber: organization.pan || profile.panNumber,
      bankDetails,
      businessAddress: billingAddress,
      pickupAddress,
      returnAddress,
      billingAddress,
      documents: organization.documents || profile.documents || profile.kycDocuments || {},
      kycStatus: organization.kycStatus || profile.kycStatus,
      bankVerificationStatus: organization.bankVerificationStatus || profile.bankVerificationStatus,
      rejectionReason: organization.rejectionReason || profile.rejectionReason,
      organizationId: organization.id,
      organizationApprovalStatus: organization.approvalStatus,
      organizationGoLiveStatus: organization.goLiveStatus || "pending",
      organizationRejectionReason: organization.rejectionReason || null,
      organizationRequiredChanges: organization.requiredChanges || [],
      organizationVerificationHistory: organization.verificationHistory || [],
    };
  }

  buildPublicSummary(organization = null) {
    if (!organization?.id) return null;
    const canSell = this.isOrganizationApprovedForBusiness(organization);
    return {
      id: organization.id,
      legalBusinessName: organization.legalBusinessName,
      storeDisplayName: organization.storeDisplayName,
      businessType: organization.businessType || null,
      supportEmail: organization.supportEmail || null,
      supportPhone: organization.supportPhone || null,
      registrationNumber: organization.registrationNumber || null,
      gstin: organization.gstin || null,
      pan: organization.pan || null,
      approvalStatus: organization.approvalStatus || "draft",
      kycStatus: organization.kycStatus || "not_submitted",
      bankVerificationStatus: organization.bankVerificationStatus || "not_submitted",
      goLiveStatus: organization.goLiveStatus || "pending",
      businessStatus: canSell ? "approved" : organization.approvalStatus || "draft",
      canSell,
      canOperate: canSell,
      rejectionReason: organization.rejectionReason || null,
      requiredChanges: organization.requiredChanges || [],
      missingRequiredFields: this.getOrganizationMissingRequiredFields(organization),
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
    if (BUSINESS_BLOCKING_GO_LIVE_STATUSES.has(String(organization.goLiveStatus || ""))) {
      throw new AppError("Organization is not enabled for selling", 403, {
        organizationId: organization.id,
        goLiveStatus: organization.goLiveStatus || "pending",
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

  async getOrganizationGroupsMap(sellerIds = []) {
    const ids = Array.from(new Set(sellerIds.map((id) => String(id || "")).filter(Boolean)));
    if (!ids.length) return new Map();
    const rows = await this.organizationRepository.listBySellerIds(ids);
    return rows.reduce((map, organization) => {
      const sellerId = String(organization.sellerId || "");
      if (!map.has(sellerId)) map.set(sellerId, []);
      map.get(sellerId).push(organization);
      return map;
    }, new Map());
  }

  buildOrganizationCollectionSummary(organizations = []) {
    const items = Array.isArray(organizations) ? organizations.filter(Boolean) : [];
    const approvedOrganizations = items.filter((organization) =>
      this.isOrganizationApprovedForBusiness(organization),
    );
    const liveOrganizations = items.filter((organization) =>
      this.isOrganizationLiveForBusiness(organization),
    );
    const rejectedOrganizations = items.filter((organization) =>
      ["rejected", "blocked", "suspended"].includes(String(organization.approvalStatus || "")) ||
      organization.kycStatus === "rejected" ||
      organization.bankVerificationStatus === "rejected" ||
      organization.goLiveStatus === "rejected",
    );
    const incompleteOrganizations = items.filter((organization) =>
      !this.isOrganizationApprovedForBusiness(organization),
    );
    const selected =
      approvedOrganizations.find((organization) => organization.isDefault) ||
      approvedOrganizations[0] ||
      items.find((organization) => organization.isDefault) ||
      items[0] ||
      null;
    const onboardingTarget =
      incompleteOrganizations.find((organization) => organization.isDefault) ||
      incompleteOrganizations.find((organization) => ["rejected", "blocked"].includes(organization.approvalStatus)) ||
      incompleteOrganizations[0] ||
      null;

    return {
      total: items.length,
      approvedCount: approvedOrganizations.length,
      liveCount: liveOrganizations.length,
      rejectedCount: rejectedOrganizations.length,
      incompleteCount: incompleteOrganizations.length,
      hasApprovedOrganization: approvedOrganizations.length > 0,
      hasLiveOrganization: liveOrganizations.length > 0,
      requiresOrganizationOnboarding: approvedOrganizations.length === 0,
      requiresSelection: approvedOrganizations.length > 1,
      selectedOrganizationId: selected?.id || null,
      onboardingTargetOrganizationId: onboardingTarget?.id || null,
      approvedOrganizationIds: approvedOrganizations.map((organization) => organization.id),
      incompleteOrganizationIds: incompleteOrganizations.map((organization) => organization.id),
    };
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
          return this.organizationRepository.setDefault(
            sellerId,
            gstinOwner.id,
            actor.userId || actor.sub || sellerId,
          );
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
      return this.organizationRepository.setDefault(
        sellerId,
        anyExisting.id,
        actor.userId || actor.sub || sellerId,
      );
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
      description: sellerProfile.description || null,
      supportEmail: sellerProfile.supportEmail || null,
      supportPhone: sellerProfile.supportPhone || null,
      registrationNumber: sellerProfile.registrationNumber || null,
      aadhaarNumber: sellerProfile.aadhaarNumber || null,
      dateOfBirth: sellerProfile.dateOfBirth || null,
      businessWebsite: sellerProfile.businessWebsite || null,
      primaryContactName: sellerProfile.primaryContactName || null,
      gstin: this.normalizeCode(sellerProfile.gstNumber),
      pan: this.normalizeCode(sellerProfile.panNumber),
      kycStatus: sellerProfile.kycStatus === "verified" ? "verified" : "submitted",
      bankVerificationStatus: sellerProfile.bankVerificationStatus || "submitted",
      approvalStatus: "pending_review",
      goLiveStatus: "pending",
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
    const organizationSummary = this.buildOrganizationCollectionSummary(organizations);
    return {
      sellerId,
      organizations,
      organizationSummary,
      selectedOrganizationId:
        query.organizationId || organizationSummary.selectedOrganizationId,
      requiresSelection: organizationSummary.requiresSelection,
      hasApprovedOrganization: organizationSummary.hasApprovedOrganization,
      hasLiveOrganization: organizationSummary.hasLiveOrganization,
      onboardingTargetOrganizationId: organizationSummary.onboardingTargetOrganizationId,
    };
  }

  async createMine(payload = {}, actor = {}) {
    const sellerId = this.getSellerId(actor);
    if (!this.isSellerActor(actor) || !sellerId) {
      throw new AppError("Only seller accounts can create organizations", 403);
    }
    const normalized = this.normalizeOrganizationPayload(payload, actor, { create: true });
    const organizationId = uuidv4();
    normalized.documents = await this.uploadOrganizationDocuments(
      organizationId,
      normalized.documents || {},
    );
    this.validateCreatePayload(normalized);
    const existing = await this.organizationRepository.listBySeller(sellerId);
    const shouldSetDefault = existing.length === 0 || payload.isDefault === true;
    const organizationPayload = {
      ...normalized,
      id: organizationId,
      sellerId,
      isDefault: existing.length === 0,
    };
    const lifecyclePatch = this.buildLifecyclePatch(
      {},
      organizationPayload,
      actor,
      { action: "seller_organization_created" },
    );
    const organization = await this.organizationRepository.create({
      ...organizationPayload,
      ...lifecyclePatch,
    });
    if (shouldSetDefault && !organization.isDefault) {
      return this.organizationRepository.setDefault(
        sellerId,
        organization.id,
        actor.userId || actor.sub || sellerId,
      );
    }
    return organization;
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
    if (payload.documents !== undefined || payload.kycDocuments !== undefined) {
      normalized.documents = await this.uploadOrganizationDocuments(
        organizationId,
        normalized.documents || {},
        existing.documents || {},
      );
    }
    const approvalStatus = RESUBMITTABLE_STATUSES.has(existing.approvalStatus)
      ? "resubmitted"
      : "pending_review";
    const updates = {
      ...normalized,
      approvalStatus,
      kycStatus: "submitted",
      bankVerificationStatus: "submitted",
      goLiveStatus: "pending",
    };
    const mergedForReview = this.mergeOrganizationPatch(existing, updates);
    this.validateCreatePayload(mergedForReview);
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
    await this.assertOrganizationForSeller(sellerId, organizationId, { requireApproved: true });
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
    const organizationId = uuidv4();
    normalized.documents = await this.uploadOrganizationDocuments(
      organizationId,
      normalized.documents || {},
    );
    this.validateCreatePayload(normalized);
    const existing = await this.organizationRepository.listBySeller(sellerId);
    const shouldSetDefault = existing.length === 0 || payload.isDefault === true;
    const organizationPayload = {
      ...normalized,
      id: organizationId,
      sellerId,
      isDefault: existing.length === 0,
    };
    const lifecyclePatch = this.buildLifecyclePatch(
      {},
      organizationPayload,
      actor,
      { action: "admin_organization_created" },
    );

    const organization = await this.organizationRepository.create({
      ...organizationPayload,
      ...lifecyclePatch,
    });
    if (shouldSetDefault && !organization.isDefault) {
      return this.organizationRepository.setDefault(
        sellerId,
        organization.id,
        actor.userId || actor.sub || sellerId,
      );
    }
    return organization;
  }

  async adminGet(sellerId, organizationId, actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can view seller organizations", 403);
    }
    const organization = await this.organizationRepository.findByIdForSeller(sellerId, organizationId);
    if (!organization) throw AppError.notFound("Seller organization");
    return organization;
  }

  async adminUpdate(sellerId, organizationId, payload = {}, actor = {}, { review = false } = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can update seller organizations", 403);
    }
    const existing = await this.organizationRepository.findByIdForSeller(sellerId, organizationId);
    if (!existing) throw AppError.notFound("Seller organization");
    const statusFields = ["approvalStatus", "status", "kycStatus", "bankVerificationStatus", "goLiveStatus"];
    if (!review && statusFields.some((field) => payload[field] !== undefined)) {
      throw new AppError("Use the organization review endpoint for approval status changes", 409);
    }
    const normalized = this.normalizeOrganizationPayload(payload, actor, { admin: true });
    if (payload.documents !== undefined || payload.kycDocuments !== undefined) {
      normalized.documents = await this.uploadOrganizationDocuments(
        organizationId,
        normalized.documents || {},
        existing.documents || {},
      );
    }
    const shouldSetDefault = normalized.isDefault === true && !existing.isDefault;
    if (normalized.isDefault !== undefined) {
      delete normalized.isDefault;
    }
    if (normalized.approvalStatus === "rejected" && !normalized.rejectionReason) {
      throw new AppError("Rejection reason is required when organization is rejected", 400);
    }
    if (!review && ["approved", "active"].includes(normalized.approvalStatus) && normalized.goLiveStatus !== "live") {
      throw new AppError("Use organization go-live approval after KYC and bank verification", 409);
    }
    const action = payload.approvalStatus || payload.status || payload.kycStatus || payload.bankVerificationStatus || payload.goLiveStatus
      ? "admin_organization_review"
      : "admin_organization_update";
    const updated = await this.organizationRepository.update(organizationId, {
      ...normalized,
      ...this.buildLifecyclePatch(existing, normalized, actor, { action, notes: payload.notes || null }),
    });
    if (
      this.isOrganizationApprovedForBusiness(updated) &&
      (await UserModel.findById(sellerId).select("accountStatus").lean())?.accountStatus !== "active"
    ) {
      await UserModel.findByIdAndUpdate(sellerId, { $set: { accountStatus: "active" } });
    }
    if (shouldSetDefault) {
      return this.organizationRepository.setDefault(
        sellerId,
        organizationId,
        actor.userId || actor.sub || null,
      );
    }
    return updated;
  }

  async adminReview(sellerId, organizationId, payload = {}, actor = {}) {
    const status = payload.approvalStatus || payload.status;
    const hasRejection = status === "rejected" ||
      payload.kycStatus === "rejected" ||
      payload.bankVerificationStatus === "rejected" ||
      payload.goLiveStatus === "rejected";
    if (hasRejection && !payload.rejectionReason) {
      throw new AppError("Rejection reason is required when organization is rejected", 400);
    }
    const existing = await this.adminGet(sellerId, organizationId, actor);
    const stagePatch = this.buildStageReviewPatch(existing, payload, actor);
    return this.adminUpdate(sellerId, organizationId, {
      ...stagePatch,
      ...(status && !stagePatch.approvalStatus ? { approvalStatus: status } : {}),
      ...(payload.rejectionReason !== undefined ? { rejectionReason: payload.rejectionReason || null } : {}),
      ...(payload.requiredChanges !== undefined ? { requiredChanges: payload.requiredChanges || [] } : {}),
      ...(status === "suspended" ? { suspendedAt: new Date() } : {}),
      ...(status && status !== "suspended" ? { suspendedAt: null } : {}),
      metadata: payload.metadata || {},
      notes: payload.notes || null,
    }, actor, { review: true });
  }
}

const sellerOrganizationService = new SellerOrganizationService();

module.exports = {
  SellerOrganizationService,
  sellerOrganizationService,
};
