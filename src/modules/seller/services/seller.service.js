const { SellerRepository } = require("../repositories/seller.repository");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { KYC_STATUS } = require("../../../shared/domain/commerce-constants");
const { AppError } = require("../../../shared/errors/app-error");
const { auditService } = require("../../../shared/logger/audit.service");
const { logger } = require("../../../shared/logger/logger");
const { hashText } = require("../../../shared/tools/hash");
const { ROLES } = require("../../../shared/constants/roles");
const { DEFAULT_SELLER_MODULES, cleanModuleName } = require("../../../shared/auth/module-access");
const {
  PERMISSION_ACTIONS,
  normalizePermissionAction: normalizeRbacPermissionAction,
} = require("../../../shared/auth/rbac-permissions");
const { RbacService } = require("../../rbac/services/rbac.service");
const {
  storageService: defaultStorageService,
} = require("../../../shared/storage/storage-service");
const { SellerKycVerificationService } = require("./seller-kyc-verification.service");
const {
  SELLER_ONBOARDING_STATUS,
  makeSellerOnboardingState,
  getSellerKycStatus,
  hasCompleteSellerBankDetails: hasCompleteSellerBankDetailsForOnboarding,
  hasCompleteSellerProfile: hasCompleteSellerProfileForOnboarding,
  getSellerOnboardingStatus,
} = require("../../../shared/domain/seller-onboarding");
const { sellerOrganizationService } = require("./seller-organization.service");
const { UserModel } = require("../../user/models/user.model");
const { env } = require("../../../config/env");

const APITXT_PROVIDER_DAILY_TTL_SECONDS = 24 * 60 * 60;
const APITXT_AADHAAR_SEND_FAILURE_TTL_SECONDS = 10 * 60;
const AADHAAR_OTP_SEND_FAILED_MESSAGE =
  "Aadhaar OTP could not be sent for this number. Please check Aadhaar/mobile linkage or try again later.";

const maskAadhaar = (aadhaarNumber = "") => {
  const normalized = String(aadhaarNumber || "").replace(/\D/g, "");
  if (normalized.length <= 4) return "************";
  return `${"*".repeat(Math.max(normalized.length - 4, 0))}${normalized.slice(-4)}`;
};

const composeProfileName = (firstName = "", lastName = "") => {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  if (!last) return first;
  if (!first) return last;

  const firstParts = first.toLowerCase().split(/\s+/);
  const lastParts = last.toLowerCase().split(/\s+/);
  const alreadyIncludesLast =
    lastParts.length <= firstParts.length &&
    lastParts.every(
      (part, index) =>
        firstParts[firstParts.length - lastParts.length + index] === part,
    );

  return alreadyIncludesLast ? first : `${first} ${last}`;
};

class SellerService {
  constructor({
    sellerRepository = new SellerRepository(),
    rbacService = new RbacService(),
    storageService = defaultStorageService,
    kycVerificationService = new SellerKycVerificationService(),
  } = {}) {
    this.sellerRepository = sellerRepository;
    this.rbacService = rbacService;
    this.storageService = storageService;
    this.kycVerificationService = kycVerificationService;
  }

  getSellerId(actor) {
    return actor.ownerSellerId || actor.userId;
  }

  toPlainObject(value = {}) {
    if (!value) {
      return {};
    }
    if (typeof value.toObject === "function") {
      return value.toObject({ depopulate: true });
    }
    return { ...value };
  }

  parseJsonObject(value = {}) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  buildAadhaarProviderSnapshot(existingKyc = {}, phase, response = {}, extra = {}) {
    const previous = this.parseJsonObject(existingKyc?.aadhaar_verification_response);
    const history = Array.isArray(previous.history) ? previous.history : [];
    const nextEntry = {
      phase,
      provider: response?.provider || "apitxt",
      referenceId:
        response?.reference_id ||
        response?.referenceId ||
        response?.providerReferenceId ||
        extra.referenceId ||
        null,
      verified: response?.verified === true,
      message: response?.message || response?.response?.message || null,
      response,
      recordedAt: new Date().toISOString(),
    };

    return {
      ...previous,
      provider: "apitxt",
      latestPhase: phase,
      latestReferenceId: nextEntry.referenceId,
      latestVerified: nextEntry.verified,
      latestMessage: nextEntry.message,
      latestResponse: response,
      history: [...history, nextEntry].slice(-10),
    };
  }

  buildPanProviderSnapshot(existingKyc = {}, phase, response = {}) {
    const previous = this.parseJsonObject(existingKyc?.pan_verification_response);
    const history = Array.isArray(previous.history) ? previous.history : [];
    const nextEntry = {
      phase,
      provider: response?.provider || "apitxt",
      verified: response?.verified === true,
      message: response?.message || null,
      response,
      recordedAt: new Date().toISOString(),
    };

    return {
      ...previous,
      provider: "apitxt",
      latestPhase: phase,
      latestVerified: nextEntry.verified,
      latestMessage: nextEntry.message,
      latestResponse: response,
      history: [...history, nextEntry].slice(-10),
    };
  }

  isPanAlreadyVerified(existingKyc = {}, panNumber = "") {
    return (
      existingKyc?.pan_verified === true &&
      sellerOrganizationService.normalizeCode(existingKyc.pan_number) ===
        sellerOrganizationService.normalizeCode(panNumber)
    );
  }

  getAadhaarPrefill(verificationResponse = {}) {
    const prefill =
      verificationResponse?.prefill ||
      verificationResponse?.aadhaarProfile ||
      {};
    const fullName = String(prefill.fullName || prefill.legalName || "").trim();
    const dateOfBirth = String(prefill.dateOfBirth || "").trim();

    if (!fullName && !dateOfBirth) return null;

    return {
      ...(fullName ? { fullName, legalName: fullName } : {}),
      ...(dateOfBirth ? { dateOfBirth } : {}),
    };
  }

  isAadhaarAlreadyVerified(existingKyc = {}, { aadhaarNumber = "", referenceId = "" } = {}) {
    if (existingKyc?.aadhaar_verified !== true) return false;

    const storedAadhaar = sellerOrganizationService.normalizeDigits(existingKyc.aadhaar_number);
    const nextAadhaar = sellerOrganizationService.normalizeDigits(aadhaarNumber);
    const storedReferenceId = String(existingKyc.aadhaar_reference_id || "").trim();
    const nextReferenceId = String(referenceId || "").trim();

    if (nextAadhaar) return storedAadhaar === nextAadhaar;

    return !nextReferenceId || storedReferenceId === nextReferenceId;
  }

  async applyAadhaarPrefillToProfile(sellerId, prefill = null, existingKyc = null, actor = {}) {
    if (!prefill?.fullName && !prefill?.dateOfBirth) return null;

    const seller = await this.sellerRepository.findSellerById(sellerId);
    if (!seller) return null;

    const currentProfile = this.toPlainObject(seller.sellerProfile || {});
    const nextProfile = this.mergeSellerProfile(currentProfile, {
      ...(!currentProfile.legalBusinessName && prefill.legalName
        ? { legalBusinessName: prefill.legalName }
        : {}),
      ...(!currentProfile.businessName && prefill.legalName
        ? { businessName: prefill.legalName }
        : {}),
      ...(!currentProfile.primaryContactName && prefill.fullName
        ? { primaryContactName: prefill.fullName }
        : {}),
      ...(!currentProfile.dateOfBirth && prefill.dateOfBirth
        ? { dateOfBirth: prefill.dateOfBirth }
        : {}),
    });

    const nextProfileWithOnboarding = this.withOnboardingState(nextProfile, existingKyc, seller);
    const updatedSeller = await this.sellerRepository.updateSellerProfile(sellerId, nextProfileWithOnboarding);

    return updatedSeller?.sellerProfile || nextProfileWithOnboarding;
  }

  async assertAadhaarAvailableForSeller(sellerId, aadhaarNumber) {
    const normalizedAadhaar = sellerOrganizationService.normalizeDigits(aadhaarNumber);
    if (!normalizedAadhaar) return;

    logger.info(
      {
        sellerId,
        aadhaarNumber: maskAadhaar(normalizedAadhaar),
      },
      "Aadhaar local duplicate precheck started",
    );

    try {
      await sellerOrganizationService.assertNoVerifiedAadhaarConflict(
        normalizedAadhaar,
        {
          sellerId,
          ignoreMissingSellerConflicts: true,
          fieldMap: {
            aadhaarNumber: "aadhaarNumber",
          },
        },
      );
    } catch (error) {
      logger.warn(
        {
          sellerId,
          aadhaarNumber: maskAadhaar(normalizedAadhaar),
          code: error.code || null,
          statusCode: error.statusCode || null,
          fields: Array.isArray(error.details)
            ? error.details.map((field) => field.field || field.path?.join(".")).filter(Boolean)
            : [],
        },
        "Aadhaar local duplicate precheck blocked verification",
      );
      throw error;
    }

    logger.info(
      {
        sellerId,
        aadhaarNumber: maskAadhaar(normalizedAadhaar),
      },
      "Aadhaar local duplicate precheck passed",
    );
  }

  async assertApitxtDailyCallAllowed({ sellerId, action, identity }) {
    const { redis } = require("../../../infrastructure/redis/redis-client");
    const normalizedIdentity = String(identity || sellerId || "unknown")
      .replace(/[^A-Za-z0-9:_-]/g, "")
      .slice(0, 96);
    const key = `apitxt:provider:daily:${action}:${sellerId}:${normalizedIdentity}`;
    const nextCount = await redis.incr(key);
    if (nextCount === 1) {
      await redis.expire(key, APITXT_PROVIDER_DAILY_TTL_SECONDS);
    }
    if (nextCount > env.apitxt.providerDailyLimit) {
      throw new AppError(
        "Daily verification API limit reached for this seller. Try again tomorrow or disable live verification for testing.",
        429,
      );
    }
  }

  getApitxtFailureCooldownKey({ sellerId, action, identity }) {
    const normalizedIdentity = String(identity || sellerId || "unknown")
      .replace(/[^A-Za-z0-9:_-]/g, "")
      .slice(0, 96);
    return `apitxt:provider:cooldown:${action}:${sellerId}:${normalizedIdentity}`;
  }

  async assertApitxtFailureCooldownClear({ sellerId, action, identity, message, field }) {
    const { redis } = require("../../../infrastructure/redis/redis-client");
    const key = this.getApitxtFailureCooldownKey({ sellerId, action, identity });
    const isCoolingDown = await redis.get(key);
    if (!isCoolingDown) return;

    throw AppError.validation(message, [
      {
        field,
        message,
      },
    ]);
  }

  async rememberApitxtFailureCooldown({ sellerId, action, identity }) {
    try {
      const { redis } = require("../../../infrastructure/redis/redis-client");
      const key = this.getApitxtFailureCooldownKey({ sellerId, action, identity });
      await redis.set(key, "1", "EX", APITXT_AADHAAR_SEND_FAILURE_TTL_SECONDS);
    } catch (error) {
      logger.warn(
        {
          err: error,
          sellerId,
          action,
        },
        "Unable to store APITXT failure cooldown",
      );
    }
  }

  mergeSellerProfile(existingProfile = {}, payload = {}) {
    const profile = this.toPlainObject(existingProfile);
    const profileFields = { ...payload };
    const { bankDetails, businessAddress, billingAddress, pickupAddress, returnAddress } = profileFields;
    delete profileFields.onboardingChecklist;
    delete profileFields.bankDetails;
    delete profileFields.businessAddress;
    delete profileFields.billingAddress;
    delete profileFields.pickupAddress;
    delete profileFields.returnAddress;

    return {
      ...profile,
      ...profileFields,
      ...(bankDetails
        ? {
          bankDetails: sellerOrganizationService.normalizeBankDetails({
            ...(profile.bankDetails || {}),
            ...bankDetails,
          }),
        }
        : {}),
      ...(businessAddress
        ? { businessAddress: { ...(profile.businessAddress || {}), ...businessAddress } }
        : {}),
      ...(billingAddress
        ? { billingAddress: { ...(profile.billingAddress || {}), ...billingAddress } }
        : {}),
      ...(pickupAddress
        ? { pickupAddress: { ...(profile.pickupAddress || {}), ...pickupAddress } }
        : {}),
      ...(returnAddress
        ? { returnAddress: { ...(profile.returnAddress || {}), ...returnAddress } }
        : {}),
    };
  }

  mergeKycIntoSellerProfile(sellerProfile = {}, kyc = null) {
    if (!kyc) {
      return this.toPlainObject(sellerProfile);
    }

    const profile = this.toPlainObject(sellerProfile);
    return {
      ...profile,
      businessName: profile.businessName || profile.legalBusinessName || "",
      legalBusinessName: profile.legalBusinessName || profile.businessName || "",
      businessType: profile.businessType || kyc.business_type,
      panNumber: profile.panNumber || kyc.pan_number,
      gstNumber: profile.gstNumber || kyc.gst_number,
      aadhaarNumber: profile.aadhaarNumber || kyc.aadhaar_number,
    };
  }

  applySellerProfileDefaults(sellerProfile = {}, user = {}, kyc = null) {
    const profile = this.mergeKycIntoSellerProfile(sellerProfile, kyc);
    const profileName = composeProfileName(
      user?.profile?.firstName,
      user?.profile?.lastName,
    );

    return {
      ...profile,
      displayName: profile.displayName || profileName || undefined,
      supportEmail: profile.supportEmail || undefined,
      supportPhone: profile.supportPhone || undefined,
    };
  }

  withOnboardingState(sellerProfile = {}, kyc = null, user = {}) {
    const profile = this.applySellerProfileDefaults(sellerProfile, user, kyc);
    const { checklist, onboardingStatus } = makeSellerOnboardingState({
      sellerProfile: profile,
      user,
      kyc,
    });

    return {
      ...profile,
      onboardingChecklist: checklist,
      onboardingStatus,
    };
  }

  async syncDefaultOrganizationFromProfile(sellerId, sellerProfile = {}, user = {}, actor = {}, overrides = {}) {
    if (!sellerId) return null;
    const organization = await sellerOrganizationService.ensureDefaultOrganizationForSeller(
      sellerId,
      sellerProfile,
      actor,
    );

    const nextStatus = {
      ...(sellerProfile.kycStatus ? { kycStatus: sellerProfile.kycStatus } : {}),
      ...(sellerProfile.bankVerificationStatus ? { bankVerificationStatus: sellerProfile.bankVerificationStatus } : {}),
      ...overrides,
    };

    const isSellerActor = ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);
    const isResubmission = isSellerActor && ["rejected", "blocked"].includes(organization.approvalStatus);
    const effectiveStatus = isResubmission
      ? {
          ...nextStatus,
          approvalStatus: "resubmitted",
          kycStatus: nextStatus.kycStatus || "submitted",
        }
      : nextStatus;
    const updatePayload = {
      legalBusinessName:
        sellerProfile.legalBusinessName ||
        sellerProfile.businessName ||
        organization.legalBusinessName,
      storeDisplayName:
        sellerProfile.legalBusinessName ||
        sellerProfile.businessName ||
        organization.storeDisplayName,
      businessType: sellerProfile.businessType || organization.businessType || null,
      description: sellerProfile.description || organization.description || null,
      supportEmail: sellerProfile.supportEmail || organization.supportEmail || null,
      supportPhone: sellerProfile.supportPhone || organization.supportPhone || null,
      registrationNumber: sellerProfile.registrationNumber || organization.registrationNumber || null,
      aadhaarNumber: sellerProfile.aadhaarNumber || organization.aadhaarNumber || null,
      dateOfBirth: sellerProfile.dateOfBirth || organization.dateOfBirth || null,
      businessWebsite: sellerProfile.businessWebsite || organization.businessWebsite || null,
      gstin: sellerProfile.gstNumber || organization.gstin || null,
      pan: sellerProfile.panNumber || organization.pan || null,
      documents: sellerOrganizationService.normalizeDocuments(
        sellerOrganizationService.firstObjectWithValue(
          sellerProfile.documents,
          sellerProfile.kycDocuments,
          organization.documents,
        ),
      ),
      bankDetails: sellerProfile.bankDetails || organization.bankDetails || {},
      billingAddress: sellerOrganizationService.firstObjectWithValue(
        sellerProfile.billingAddress,
        sellerProfile.businessAddress,
        organization.billingAddress,
      ),
      pickupAddress: sellerProfile.pickupAddress || organization.pickupAddress || {},
      returnAddress: sellerProfile.returnAddress || organization.returnAddress || {},
      taxSettings: {
        ...(organization.taxSettings || {}),
        gstin: sellerProfile.gstNumber || organization.gstin || null,
        pan: sellerProfile.panNumber || organization.pan || null,
        state:
          sellerProfile.businessAddress?.state ||
          sellerProfile.pickupAddress?.state ||
          organization.taxSettings?.state ||
          "",
      },
      invoiceSettings: {
        ...(organization.invoiceSettings || {}),
        invoicePrefix: organization.invoiceSettings?.invoicePrefix || "INV",
        state:
          sellerProfile.businessAddress?.state ||
          sellerProfile.pickupAddress?.state ||
          organization.invoiceSettings?.state ||
          "",
      },
      payoutSettings: {
        ...(organization.payoutSettings || {}),
        payoutSchedule: user?.sellerSettings?.payoutSchedule || organization.payoutSettings?.payoutSchedule || "weekly",
      },
      metadata: {
        ...(organization.metadata || {}),
        source: organization.metadata?.source || "seller_profile_default_bridge",
        syncedFromSellerProfileAt: new Date().toISOString(),
      },
      ...effectiveStatus,
      updatedBy: actor.userId || actor.sub || sellerId,
    };
    await sellerOrganizationService.assertNoIdentityConflicts(updatePayload, {
      sellerId,
      organizationId: organization.id,
      aadhaarVerifiedOnly: true,
      panVerifiedOnly: true,
      ignoreMissingSellerConflicts: true,
      fieldMap: {
        gstin: "gstNumber",
        pan: "panNumber",
      },
    });
    return sellerOrganizationService.organizationRepository.update(organization.id, {
      ...updatePayload,
      ...sellerOrganizationService.buildLifecyclePatch(
        organization,
        updatePayload,
        actor,
        { action: isResubmission ? "seller_onboarding_resubmitted" : "seller_profile_organization_sync" },
      ),
    });
  }

  async submitKyc(payload, actor) {
    const sellerId = this.getSellerId(actor);
    const normalizedPayload = {
      ...payload,
      panNumber: sellerOrganizationService.normalizeCode(payload.panNumber),
      gstNumber: sellerOrganizationService.normalizeCode(payload.gstNumber),
      aadhaarNumber: sellerOrganizationService.normalizeDigits(payload.aadhaarNumber),
      bankDetails: sellerOrganizationService.normalizeBankDetails(payload.bankDetails || {}),
    };
    await sellerOrganizationService.assertNoIdentityConflicts(
      {
        gstin: normalizedPayload.gstNumber,
        pan: normalizedPayload.panNumber,
      },
      {
        sellerId,
        panVerifiedOnly: true,
        ignoreMissingSellerConflicts: true,
        fieldMap: {
          gstin: "gstNumber",
          pan: "panNumber",
        },
      },
    );
    await this.assertAadhaarAvailableForSeller(sellerId, normalizedPayload.aadhaarNumber);
    const existingKyc = await this.sellerRepository.findKycBySellerId(sellerId);
    if (
      this.kycVerificationService.enabled &&
      this.kycVerificationService.verifyAadhaar &&
      normalizedPayload.aadhaarNumber &&
      !(
        existingKyc?.aadhaar_verified === true &&
        String(existingKyc.aadhaar_number || "") === normalizedPayload.aadhaarNumber
      )
    ) {
      throw AppError.validation(
        "Aadhaar OTP verification is required before continuing.",
        [
          {
            field: "aadhaarNumber",
            message: "Verify Aadhaar OTP before continuing.",
          },
        ],
      );
    }
    const panAlreadyVerified = this.isPanAlreadyVerified(existingKyc, normalizedPayload.panNumber);
    const shouldVerifyGst =
      this.kycVerificationService.enabled &&
      this.kycVerificationService.verifyGst &&
      Boolean(normalizedPayload.gstNumber);

    logger.info(
      {
        sellerId,
        apitxtEnabled: this.kycVerificationService.enabled,
        verifyPan: this.kycVerificationService.verifyPan,
        verifyGst: this.kycVerificationService.verifyGst,
        hasGstNumber: Boolean(normalizedPayload.gstNumber),
        panAlreadyVerified,
        shouldVerifyGst,
      },
      "Seller KYC submit verification flags resolved",
    );
    console.log("[SellerKYC][GST] flags", {
      sellerId,
      apitxtEnabled: this.kycVerificationService.enabled,
      verifyGst: this.kycVerificationService.verifyGst,
      hasGstNumber: Boolean(normalizedPayload.gstNumber),
      panAlreadyVerified,
      shouldVerifyGst,
    });

    if (
      this.kycVerificationService.enabled &&
      this.kycVerificationService.verifyPan &&
      !panAlreadyVerified
    ) {
      throw AppError.validation(
        "PAN verification is required before continuing.",
        [
          {
            field: "panNumber",
            message: "Verify PAN before continuing.",
          },
        ],
      );
    }

    let verificationResult = null;
    if (panAlreadyVerified) {
      const gstResult = shouldVerifyGst
        ? await this.kycVerificationService.verifyGstDetails({
            gstNumber: normalizedPayload.gstNumber,
          })
        : null;

      logger.info(
        {
          sellerId,
          branch: "pan_cached",
          shouldVerifyGst,
          gstVerified: gstResult?.verified === true,
          gstMessage: gstResult?.message || null,
        },
        "Seller KYC submit verification result resolved",
      );
      console.log("[SellerKYC][GST] result", {
        sellerId,
        branch: "pan_cached",
        shouldVerifyGst,
        gstVerified: gstResult?.verified === true,
        gstMessage: gstResult?.message || null,
      });

      verificationResult = {
        skipped: false,
        provider: "apitxt",
        panVerified: true,
        panResult: this.parseJsonObject(existingKyc?.pan_verification_response),
        cached: true,
        gstVerified: gstResult?.verified === true,
        gstResult,
      };
    } else {
      verificationResult = await this.kycVerificationService.verifyForOnboarding(normalizedPayload, {
        sellerId,
        actor,
      });
      logger.info(
        {
          sellerId,
          branch: "full_onboarding",
          panVerified: verificationResult?.panVerified === true,
          gstVerified: verificationResult?.gstVerified === true,
          gstMessage: verificationResult?.gstResult?.message || null,
        },
        "Seller KYC submit verification result resolved",
      );
      console.log("[SellerKYC][GST] result", {
        sellerId,
        branch: "full_onboarding",
        gstVerified: verificationResult?.gstVerified === true,
        gstMessage: verificationResult?.gstResult?.message || null,
      });
    }
    const documents = await this.uploadKycDocuments(payload.documents || {}, actor);
    const record = await this.sellerRepository.upsertKyc({
      ...normalizedPayload,
      documents,
      sellerId,
      verificationStatus: KYC_STATUS.SUBMITTED,
      panVerified: verificationResult?.panVerified === true,
      panVerifiedAt: verificationResult?.panVerified ? new Date() : null,
      panVerificationResponse: verificationResult?.panResult || null,
    });

    const seller = await this.sellerRepository.findSellerById(sellerId);
    if (seller) {
      const existingProfile = this.mergeSellerProfile(
        this.mergeKycIntoSellerProfile(seller.sellerProfile || {}, record),
        {
          bankDetails: normalizedPayload.bankDetails || {},
          ...(normalizedPayload.dateOfBirth ? { dateOfBirth: normalizedPayload.dateOfBirth } : {}),
          ...(verificationResult?.gstVerified
            ? {
                gstVerified: true,
                gstVerifiedAt: new Date().toISOString(),
                gstVerificationResponse: verificationResult.gstResult || null,
                kycStatus: KYC_STATUS.VERIFIED,
                verificationStatus: KYC_STATUS.VERIFIED,
              }
            : {}),
        },
      );
      await this.sellerRepository.updateSellerProfile(
        sellerId,
        this.withOnboardingState(existingProfile, record, seller),
      );
      await this.syncDefaultOrganizationFromProfile(
        sellerId,
        existingProfile,
        seller,
        actor,
        {
          legalBusinessName: normalizedPayload.legalName,
          gstin: normalizedPayload.gstNumber || existingProfile.gstNumber || null,
          pan: normalizedPayload.panNumber || existingProfile.panNumber || null,
          documents,
          kycStatus: KYC_STATUS.SUBMITTED,
          bankVerificationStatus: this.hasCompleteBankDetails(normalizedPayload.bankDetails || {})
            ? "submitted"
            : existingProfile.bankVerificationStatus || "not_submitted",
          approvalStatus: "pending_review",
        },
      );
    }

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.SELLER_KYC_SUBMITTED_V1,
        {
          sellerId,
          verificationStatus: record.verification_status,
          legalName: record.legal_name,
        },
        {
          source: "seller-module",
          aggregateId: sellerId,
        },
      ),
    );
    return record;
  }

  async sendAadhaarOtp(payload = {}, actor) {
    const sellerId = this.getSellerId(actor);
    const aadhaarNumber = sellerOrganizationService.normalizeDigits(payload.aadhaarNumber);

    if (!aadhaarNumber) {
      throw AppError.validation("Aadhaar number is required", [
        { field: "aadhaarNumber", message: "Aadhaar number is required" },
      ]);
    }

    const existingKyc = await this.sellerRepository.findKycBySellerId(sellerId);
    if (
      existingKyc?.aadhaar_verified === true &&
      String(existingKyc.aadhaar_number || "") === aadhaarNumber
    ) {
      return {
        skipped: true,
        cached: true,
        reason: "aadhaar_already_verified",
        aadhaarVerified: true,
        reference_id: existingKyc.aadhaar_reference_id || null,
        aadhaarVerifiedAt: existingKyc.aadhaar_verified_at || null,
        response: this.parseJsonObject(existingKyc.aadhaar_verification_response),
        message: "Aadhaar is already verified.",
      };
    }

    await this.assertAadhaarAvailableForSeller(sellerId, aadhaarNumber);

    if (this.kycVerificationService.enabled && this.kycVerificationService.verifyAadhaar) {
      await this.assertApitxtFailureCooldownClear({
        sellerId,
        action: "aadhaar_send_otp",
        identity: aadhaarNumber,
        field: "aadhaarNumber",
        message: AADHAAR_OTP_SEND_FAILED_MESSAGE,
      });
      await this.assertApitxtDailyCallAllowed({
        sellerId,
        action: "aadhaar_send_otp",
        identity: aadhaarNumber,
      });
    }

    let response = null;
    try {
      response = await this.kycVerificationService.sendAadhaarOtp(aadhaarNumber, {
        sellerId,
        actor,
      });
    } catch (error) {
      if (this.kycVerificationService.enabled && this.kycVerificationService.verifyAadhaar) {
        await this.rememberApitxtFailureCooldown({
          sellerId,
          action: "aadhaar_send_otp",
          identity: aadhaarNumber,
        });
      }
      throw error;
    }

    const referenceId = String(
      response?.reference_id ||
        response?.referenceId ||
        response?.response?.reference_id ||
        response?.response?.referenceId ||
        "",
    ).trim();
    await this.sellerRepository.upsertAadhaarVerification(sellerId, {
      aadhaarNumber,
      aadhaarVerified: false,
      aadhaarReferenceId: referenceId || existingKyc?.aadhaar_reference_id || null,
      aadhaarVerifiedAt: null,
      aadhaarVerificationResponse: this.buildAadhaarProviderSnapshot(
        existingKyc,
        "send_otp",
        response,
        { referenceId },
      ),
    });

    return response;
  }

  async precheckAadhaar(payload = {}, actor) {
    const sellerId = this.getSellerId(actor);
    const aadhaarNumber = sellerOrganizationService.normalizeDigits(payload.aadhaarNumber);
    const referenceId = String(payload.reference_id || payload.referenceId || "").trim();

    if (!aadhaarNumber) {
      throw AppError.validation("Aadhaar number is required", [
        { field: "aadhaarNumber", message: "Aadhaar number is required" },
      ]);
    }

    const existingKyc = await this.sellerRepository.findKycBySellerId(sellerId);
    if (this.isAadhaarAlreadyVerified(existingKyc, { aadhaarNumber, referenceId })) {
      const cachedResponse = this.parseJsonObject(existingKyc.aadhaar_verification_response);
      const latestResponse =
        cachedResponse.latestResponse ||
        cachedResponse.latestVerificationResponse ||
        cachedResponse;
      const prefill = this.getAadhaarPrefill(latestResponse);

      return {
        canProceed: false,
        skipped: true,
        cached: true,
        reason: "aadhaar_already_verified",
        aadhaarVerified: true,
        aadhaarReferenceId: existingKyc.aadhaar_reference_id || referenceId || null,
        aadhaarVerifiedAt: existingKyc.aadhaar_verified_at || null,
        ...(prefill ? { prefill, aadhaarProfile: prefill } : {}),
        verificationResponse: latestResponse,
        message: "Aadhaar is already verified.",
      };
    }

    await this.assertAadhaarAvailableForSeller(sellerId, aadhaarNumber);

    return {
      canProceed: true,
      aadhaarVerified: false,
      message: "Aadhaar is available for verification.",
    };
  }

  async assertPanAvailableForSeller(sellerId, panNumber) {
    const normalizedPan = sellerOrganizationService.normalizeCode(panNumber);
    if (!normalizedPan) return;

    logger.info(
      {
        sellerId,
        panNumber: `${normalizedPan.slice(0, 2)}*****${normalizedPan.slice(-2)}`,
      },
      "PAN local duplicate precheck started",
    );

    try {
      await sellerOrganizationService.assertNoIdentityConflicts(
        { pan: normalizedPan },
        {
          sellerId,
          panVerifiedOnly: true,
          ignoreMissingSellerConflicts: true,
          fieldMap: {
            pan: "panNumber",
          },
        },
      );
    } catch (error) {
      logger.warn(
        {
          sellerId,
          panNumber: `${normalizedPan.slice(0, 2)}*****${normalizedPan.slice(-2)}`,
          code: error.code || null,
          statusCode: error.statusCode || null,
          fields: Array.isArray(error.details)
            ? error.details.map((field) => field.field || field.path?.join(".")).filter(Boolean)
            : [],
        },
        "PAN local duplicate precheck blocked verification",
      );
      throw error;
    }

    logger.info(
      {
        sellerId,
        panNumber: `${normalizedPan.slice(0, 2)}*****${normalizedPan.slice(-2)}`,
      },
      "PAN local duplicate precheck passed",
    );
  }

  async precheckPan(payload = {}, actor) {
    const sellerId = this.getSellerId(actor);
    const panNumber = sellerOrganizationService.normalizeCode(payload.panNumber);

    if (!panNumber) {
      throw AppError.validation("PAN number is required", [
        { field: "panNumber", message: "PAN number is required" },
      ]);
    }

    const existingKyc = await this.sellerRepository.findKycBySellerId(sellerId);
    if (this.isPanAlreadyVerified(existingKyc, panNumber)) {
      return {
        canProceed: false,
        skipped: true,
        cached: true,
        reason: "pan_already_verified",
        panVerified: true,
        panVerifiedAt: existingKyc.pan_verified_at || null,
        response: this.parseJsonObject(existingKyc.pan_verification_response),
        message: "PAN is already verified.",
      };
    }

    await this.assertPanAvailableForSeller(sellerId, panNumber);

    return {
      canProceed: true,
      panVerified: false,
      message: "PAN is available for verification.",
    };
  }

  async verifyAadhaarOtp(payload = {}, actor) {
    const sellerId = this.getSellerId(actor);
    const referenceId = String(payload.reference_id || payload.referenceId || "").trim();
    const otp = String(payload.otp || "").trim();
    const aadhaarNumber = sellerOrganizationService.normalizeDigits(payload.aadhaarNumber);

    if (!referenceId) {
      throw AppError.validation("Aadhaar OTP reference is required", [
        { field: "reference_id", message: "Aadhaar OTP reference is required" },
      ]);
    }
    if (!otp) {
      throw AppError.validation("OTP is required", [
        { field: "otp", message: "OTP is required" },
      ]);
    }

    let verificationResponse = null;
    try {
      const existingKyc = await this.sellerRepository.findKycBySellerId(sellerId);
      if (this.isAadhaarAlreadyVerified(existingKyc, { aadhaarNumber, referenceId })) {
        const cachedResponse = this.parseJsonObject(existingKyc.aadhaar_verification_response);
        const prefill = this.getAadhaarPrefill(
          cachedResponse.latestResponse ||
            cachedResponse.latestVerificationResponse ||
            cachedResponse,
        );

        return {
          skipped: true,
          cached: true,
          reason: "aadhaar_already_verified",
          aadhaarVerified: true,
          aadhaarReferenceId: existingKyc.aadhaar_reference_id || referenceId,
          aadhaarVerifiedAt: existingKyc.aadhaar_verified_at || null,
          ...(prefill ? { prefill, aadhaarProfile: prefill } : {}),
          verificationResponse:
            cachedResponse.latestResponse ||
            cachedResponse.latestVerificationResponse ||
            cachedResponse,
          message: "Aadhaar is already verified.",
        };
      }

      await this.assertAadhaarAvailableForSeller(
        sellerId,
        aadhaarNumber || existingKyc?.aadhaar_number,
      );

      if (this.kycVerificationService.enabled && this.kycVerificationService.verifyAadhaar) {
        await this.assertApitxtDailyCallAllowed({
          sellerId,
          action: "aadhaar_verify_otp",
          identity: referenceId,
        });
      }
      verificationResponse = await this.kycVerificationService.verifyAadhaarOtp({
        reference_id: referenceId,
        otp,
      });

      const verifiedAt = verificationResponse?.verified ? new Date() : null;
      await this.sellerRepository.upsertAadhaarVerification(sellerId, {
        aadhaarNumber,
        aadhaarVerified: verificationResponse?.verified === true,
        aadhaarReferenceId: referenceId,
        aadhaarVerifiedAt: verifiedAt,
        aadhaarVerificationResponse: this.buildAadhaarProviderSnapshot(
          existingKyc,
          "verify_otp",
          verificationResponse,
          { referenceId },
        ),
      });

      this.kycVerificationService.assertVerified(
        verificationResponse,
        "otp",
        "Invalid Aadhaar OTP. Please check the OTP and try again.",
      );

      const prefill = this.getAadhaarPrefill(verificationResponse);
      const profile = await this.applyAadhaarPrefillToProfile(
        sellerId,
        prefill,
        await this.sellerRepository.findKycBySellerId(sellerId),
        actor,
      );

      return {
        aadhaarVerified: true,
        aadhaarReferenceId: referenceId,
        aadhaarVerifiedAt: verifiedAt,
        ...(prefill ? { prefill, aadhaarProfile: prefill } : {}),
        ...(profile ? { profile } : {}),
        verificationResponse,
      };
    } catch (error) {
      if (
        !verificationResponse &&
        error instanceof AppError &&
        error.code === "DUPLICATE_ENTRY"
      ) {
        throw error;
      }

      if (!verificationResponse) {
        verificationResponse = {
          verified: false,
          message: error.message,
          code: error.code || error.providerCode || null,
          raw: error.response || error.details || null,
        };
      }

      await this.sellerRepository.upsertAadhaarVerification(sellerId, {
        aadhaarNumber,
        aadhaarVerified: false,
        aadhaarReferenceId: referenceId,
        aadhaarVerifiedAt: null,
        aadhaarVerificationResponse: this.buildAadhaarProviderSnapshot(
          await this.sellerRepository.findKycBySellerId(sellerId),
          "verify_otp_failed",
          verificationResponse,
          { referenceId },
        ),
      });

      throw error;
    }
  }

  async verifyPan(payload = {}, actor) {
    const sellerId = this.getSellerId(actor);
    const panNumber = sellerOrganizationService.normalizeCode(payload.panNumber);
    const legalName = String(payload.legalName || payload.name || "").trim();
    const dateOfBirth = String(payload.dateOfBirth || payload.dob || "").trim();

    if (!panNumber) {
      throw AppError.validation("PAN number is required", [
        { field: "panNumber", message: "PAN number is required" },
      ]);
    }

    if (!legalName) {
      throw AppError.validation("Legal name is required for PAN verification", [
        { field: "legalName", message: "Legal name is required for PAN verification" },
      ]);
    }

    if (!dateOfBirth) {
      throw AppError.validation("Date of birth is required for PAN verification", [
        { field: "dateOfBirth", message: "Date of birth is required for PAN verification" },
      ]);
    }

    const existingKyc = await this.sellerRepository.findKycBySellerId(sellerId);
    if (this.isPanAlreadyVerified(existingKyc, panNumber)) {
      return {
        skipped: true,
        cached: true,
        reason: "pan_already_verified",
        panVerified: true,
        panVerifiedAt: existingKyc.pan_verified_at || null,
        response: this.parseJsonObject(existingKyc.pan_verification_response),
        message: "PAN is already verified.",
      };
    }

    await this.assertPanAvailableForSeller(sellerId, panNumber);

    if (this.kycVerificationService.enabled && this.kycVerificationService.verifyPan) {
      await this.assertApitxtDailyCallAllowed({
        sellerId,
        action: "pan_verify",
        identity: panNumber,
      });
    }

    const verificationResponse = await this.kycVerificationService.verifyPanDetails({
      panNumber,
      legalName,
      dateOfBirth,
    });

    const panVerified = verificationResponse?.verified === true;
    const verifiedAt = panVerified ? new Date() : null;
    await this.sellerRepository.upsertPanVerification(sellerId, {
      panNumber,
      panVerified,
      panVerifiedAt: verifiedAt,
      panVerificationResponse: this.buildPanProviderSnapshot(
        existingKyc,
        "verify_pan",
        verificationResponse,
      ),
    });

    if (!panVerified) {
      throw AppError.validation(
        verificationResponse?.message || "PAN verification failed. Please check PAN details.",
        [
          {
            field: "panNumber",
            message: verificationResponse?.message || "PAN verification failed. Please check PAN details.",
          },
        ],
      );
    }

    return {
      panVerified: true,
      panVerifiedAt: verifiedAt,
      verificationResponse,
      message: "PAN verified successfully.",
    };
  }

  async uploadKycDocuments(documents = {}, actor) {
    const sellerId = this.getSellerId(actor);
    return this.storageService.uploadKycDocuments(documents, {
      ownerType: "sellers",
      ownerId: sellerId,
    });
  }

  async updateProfile(payload, actor) {
    const sellerId = this.getSellerId(actor);
    const existingSeller = await this.sellerRepository.findSellerById(sellerId);
    if (!existingSeller) {
      throw AppError.notFound("Seller profile");
    }

    const kycRecord = await this.sellerRepository.findKycBySellerId(sellerId);
    const nextProfile = this.mergeSellerProfile(existingSeller.sellerProfile || {}, payload);
    const existingOrg = await sellerOrganizationService.getDefaultOrOnlyOrganization(sellerId);
    await sellerOrganizationService.assertNoIdentityConflicts(nextProfile, {
      sellerId,
      organizationId: existingOrg?.id || null,
      aadhaarVerifiedOnly: true,
      panVerifiedOnly: true,
      ignoreMissingSellerConflicts: true,
      fieldMap: {
        gstin: "gstNumber",
        pan: "panNumber",
      },
    });
    if (
      this.hasCompleteBankDetails(nextProfile.bankDetails) &&
      !["verified", "submitted"].includes(nextProfile.bankVerificationStatus)
    ) {
      nextProfile.bankVerificationStatus = "submitted";
      nextProfile.bankRejectionReason = null;
    }
    const nextProfileWithOnboarding = this.withOnboardingState(nextProfile, kycRecord, existingSeller);
    const updatedSeller = await this.sellerRepository.updateSellerProfile(sellerId, nextProfileWithOnboarding);
    await this.syncDefaultOrganizationFromProfile(sellerId, nextProfileWithOnboarding, existingSeller, actor);

    return updatedSeller?.sellerProfile || null;
  }

  async getProfile(actor) {
    const sellerId = this.getSellerId(actor);
    const [seller, kyc, organization] = await Promise.all([
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
      sellerOrganizationService.getDefaultOrOnlyOrganization(sellerId),
    ]);

    if (!seller) {
      throw AppError.notFound("Seller profile");
    }

    const organizationBackedProfile = sellerOrganizationService.buildSellerProfileMirror(
      seller.sellerProfile || {},
      organization,
    );
    return {
      profile: this.withOnboardingState(organizationBackedProfile, kyc, seller),
      settings: seller.sellerSettings || null,
      kyc,
      organization: sellerOrganizationService.buildPublicSummary(organization),
    };
  }

  assertSellerWebActor(actor) {
    const allowedRoles = [ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN];
    if (!allowedRoles.includes(actor.role)) {
      throw new AppError("Only seller accounts can access seller web status", 403);
    }

    if ([ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(actor.role)) {
      const allowedModules = (actor.allowedModules || []).map(cleanModuleName);
      const canViewSellerWeb = ["sellers", "orders", "delivery"].some((moduleName) =>
        allowedModules.includes(moduleName),
      );
      if (!canViewSellerWeb) {
        throw new AppError("Seller web status is not assigned to this sub-seller", 403);
      }
    }

    const sellerId = this.getSellerId(actor);
    if (!sellerId) {
      throw new AppError("Seller account could not be found", 403);
    }

    return sellerId;
  }

  assertSellerOwnerActor(actor) {
    if (actor.role === ROLES.SELLER) {
      const sellerId = this.getSellerId(actor);
      if (!sellerId) {
        throw new AppError("Seller account could not be found", 403);
      }
      return sellerId;
    }

    // Seller admins/sub-sellers can manage child access if they have the sellers:create permission.
    // Their owner seller ID is stored in ownerSellerId on the JWT.
    if ([ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(actor.role)) {
      const sellerId = actor.ownerSellerId || actor.sellerId;
      if (!sellerId) {
        throw new AppError("Could not determine parent seller account", 403);
      }
      return sellerId;
    }

    throw new AppError("Only seller owners or authorised seller admins can manage seller access", 403);
  }

  getSellerWebNextSteps(checklist = {}, kycStatus = null, organization = null) {
    const labels = {
      profileCompleted: "Complete seller profile",
      kycSubmitted: "Submit seller KYC",
      bankLinked: "Complete bank details",
      billingAddressCompleted: "Complete billing address",
      documentsSubmitted: "Upload required organization documents",
      gstVerified: "Verify GST details if applicable",
      firstProductPublished: "Publish first product from seller panel",
    };

    const nextSteps = Object.entries(labels)
      .filter(([key]) => checklist[key] !== true)
      .map(([, label]) => label);

    if (kycStatus === KYC_STATUS.REJECTED) {
      return ["Review KYC rejection reason in seller panel", ...nextSteps];
    }

    if (["rejected", "blocked", "suspended"].includes(organization?.approvalStatus)) {
      return ["Update organization verification details", ...nextSteps];
    }

    if (["pending_review", "resubmitted"].includes(organization?.approvalStatus)) {
      return ["Wait for organization approval", ...nextSteps];
    }

    if ([KYC_STATUS.SUBMITTED, KYC_STATUS.UNDER_REVIEW].includes(kycStatus)) {
      return ["Wait for KYC verification", ...nextSteps];
    }

    return nextSteps;
  }

  async getWebStatus(actor) {
    const sellerId = this.assertSellerWebActor(actor);
    const [seller, kyc, organizations] = await Promise.all([
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
      sellerOrganizationService.organizationRepository.listBySeller(sellerId),
    ]);

    if (!seller) {
      throw AppError.notFound("Seller profile");
    }

    const organizationSummary = sellerOrganizationService.buildOrganizationCollectionSummary(organizations);
    const selectedOrganizationId =
      organizationSummary.selectedOrganizationId ||
      organizationSummary.onboardingTargetOrganizationId;
    const organization =
      organizations.find((item) => String(item.id) === String(selectedOrganizationId)) ||
      organizations.find((item) => item.isDefault) ||
      organizations[0] ||
      null;
    const organizationBackedProfile = sellerOrganizationService.buildSellerProfileMirror(
      seller.sellerProfile || {},
      organization,
    );
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: organizationBackedProfile,
      user: seller || {},
      kyc,
    });
    const profile = this.withOnboardingState(organizationBackedProfile, kyc, seller);
    const organizationApproved = organizationSummary.hasApprovedOrganization;

    return {
      sellerId,
      accountStatus: seller.accountStatus || null,
      role: actor.role,
      email: seller.email,
      phone: seller.phone || null,
      profile: {
        displayName: profile.displayName || null,
        legalBusinessName: profile.legalBusinessName || null,
        businessType: profile.businessType || null,
        supportEmail: profile.supportEmail || null,
        supportPhone: profile.supportPhone || null,
        businessWebsite: profile.businessWebsite || null,
      },
      onboarding: {
        status: onboardingState.onboardingStatus,
        complete:
          organizationApproved,
        checklist: onboardingState.checklist,
        kycStatus: onboardingState.kycStatus,
        organizationStatus: organization?.approvalStatus || "not_created",
        organizationApproved,
        hasApprovedOrganization: organizationSummary.hasApprovedOrganization,
        hasLiveOrganization: organizationSummary.hasLiveOrganization,
        organizationSummary,
        nextSteps: this.getSellerWebNextSteps(onboardingState.checklist, onboardingState.kycStatus, organization),
      },
      organization: sellerOrganizationService.buildPublicSummary(organization),
      organizations: organizations.map((item) => sellerOrganizationService.buildPublicSummary(item)),
      kyc: kyc
        ? {
            status: kyc.verification_status,
            legalName: kyc.legal_name,
            businessType: kyc.business_type,
            rejectionReason: kyc.rejection_reason || null,
            submittedAt: kyc.submitted_at || null,
            reviewedAt: kyc.reviewed_at || null,
          }
        : null,
      webAccess: {
        mode: "read_only_status_tracking",
        actionsLiveIn: "dedicated_seller_admin_panel",
        allowedModules: actor.allowedModules || [],
      },
    };
  }

  toTrackingOrder(row = {}) {
    return {
      orderId: row.order_id,
      buyerId: row.buyer_id,
      orderStatus: row.order_status,
      currency: row.currency,
      amounts: {
        payableAmount: Number(row.payable_amount || 0),
        totalAmount: Number(row.total_amount || 0),
        sellerOrderTotal: Number(row.seller_order_total || 0),
      },
      sellerItems: {
        count: Number(row.items_count || 0),
        units: Number(row.units || 0),
      },
      delivery: {
        status: row.delivery_status || "not_created",
        shipmentId: row.shipment_id || null,
        courierName: row.courier_name || null,
        trackingNumber: row.tracking_number || null,
        updatedAt: row.delivery_updated_at || null,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  composeCustomerName(user = {}) {
    const profile = user?.profile || {};
    return [profile.firstName, profile.lastName]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  async attachCustomerProfilesToOrders(orders = []) {
    const buyerIds = Array.from(new Set(
      (Array.isArray(orders) ? orders : [])
        .map((order) => String(order.buyer_id || order.buyerId || ""))
        .filter(Boolean),
    ));
    if (!buyerIds.length) return orders;

    const buyers = await UserModel.find({ _id: { $in: buyerIds } })
      .select("email phone profile")
      .lean()
      .catch(() => []);
    const buyersById = new Map(buyers.map((buyer) => [String(buyer._id || buyer.id), buyer]));

    return orders.map((order) => {
      const buyer = buyersById.get(String(order.buyer_id || order.buyerId || ""));
      const customerName = this.composeCustomerName(buyer);
      return {
        ...order,
        buyerId: order.buyer_id || order.buyerId || null,
        customerName: customerName || buyer?.email || order.customerName || null,
        customerEmail: buyer?.email || order.customerEmail || null,
        customerPhone: buyer?.phone || order.customerPhone || null,
      };
    });
  }

  cleanTrackingQuery(query = {}) {
    return {
      status: query.status || null,
      deliveryStatus: query.deliveryStatus || null,
      organizationId: query.organizationId || null,
      fromDate: query.fromDate || null,
      toDate: query.toDate || null,
      limit: Number(query.limit || 20),
      offset: Number(query.offset || 0),
    };
  }

  async listWebTracking(query, actor) {
    const sellerId = this.assertSellerWebActor(actor);
    const filters = this.cleanTrackingQuery({
      ...query,
      organizationId: query.organizationId || actor.organizationId || null,
    });
    const [orders, summary] = await Promise.all([
      this.sellerRepository.fetchSellerTrackingOrders(sellerId, filters),
      this.sellerRepository.fetchSellerTrackingSummary(sellerId, filters),
    ]);

    return {
      filters,
      summary,
      orders: orders.map((row) => this.toTrackingOrder(row)),
      meta: {
        count: orders.length,
        limit: filters.limit,
        offset: filters.offset,
      },
    };
  }

  async getWebTrackingOrder(orderId, actor) {
    const sellerId = this.assertSellerWebActor(actor);
    const detail = await this.sellerRepository.fetchSellerTrackingOrderDetail(sellerId, orderId);
    if (!detail) {
      throw AppError.notFound("Seller order tracking record");
    }

    return {
      ...this.toTrackingOrder(detail.order),
      items: detail.items.map((item) => ({
        orderItemId: item.id,
        productId: item.product_id,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unit_price || 0),
        lineTotal: Number(item.line_total || 0),
      })),
    };
  }

  async patchProfileSection(section, payload, actor) {
    const sellerId = this.getSellerId(actor);
    const [existingSeller, kycRecord] = await Promise.all([
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
    ]);
    if (!existingSeller) {
      throw AppError.notFound("Seller profile");
    }

    const existingProfile = this.toPlainObject(existingSeller.sellerProfile || {});
    const nextProfile = {
      ...existingProfile,
      [section]: {
        ...(existingProfile[section] || {}),
        ...payload,
      },
    };
    if (
      section === "bankDetails" &&
      this.hasCompleteBankDetails(nextProfile.bankDetails) &&
      !["verified", "submitted"].includes(nextProfile.bankVerificationStatus)
    ) {
      nextProfile.bankVerificationStatus = "submitted";
      nextProfile.bankRejectionReason = null;
    }
    const updatedSeller = await this.sellerRepository.updateSellerProfile(
      sellerId,
      this.withOnboardingState(nextProfile, kycRecord, existingSeller),
    );
    await this.syncDefaultOrganizationFromProfile(
      sellerId,
      updatedSeller?.sellerProfile || nextProfile,
      existingSeller,
      actor,
    );

    return updatedSeller?.sellerProfile || null;
  }

  async updateMoreInfo(payload, actor) {
    const sellerId = this.getSellerId(actor);
    const [existingSeller, kycRecord] = await Promise.all([
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
    ]);
    if (!existingSeller) {
      throw AppError.notFound("Seller profile");
    }

    const nextProfile = this.mergeSellerProfile(existingSeller.sellerProfile || {}, payload);
    const existingOrgMoreInfo = await sellerOrganizationService.getDefaultOrOnlyOrganization(sellerId);
    await sellerOrganizationService.assertNoIdentityConflicts(nextProfile, {
      sellerId,
      organizationId: existingOrgMoreInfo?.id || null,
      aadhaarVerifiedOnly: true,
      panVerifiedOnly: true,
      ignoreMissingSellerConflicts: true,
      fieldMap: {
        gstin: "gstNumber",
        pan: "panNumber",
      },
    });
    const updatedSeller = await this.sellerRepository.updateSellerProfile(
      sellerId,
      this.withOnboardingState(nextProfile, kycRecord, existingSeller),
    );
    await this.syncDefaultOrganizationFromProfile(
      sellerId,
      updatedSeller?.sellerProfile || nextProfile,
      existingSeller,
      actor,
    );

    return updatedSeller?.sellerProfile || null;
  }

  getOnboardingStatus(checklist, kycStatus = null, currentStatus = SELLER_ONBOARDING_STATUS.INITIATED) {
    const nextKycStatus =
      kycStatus || (checklist?.gstVerified === true ? KYC_STATUS.VERIFIED : getSellerKycStatus(null, checklist));

    return getSellerOnboardingStatus(checklist, nextKycStatus, currentStatus);
  }

  hasCompleteBankDetails(bankDetails = {}) {
    return hasCompleteSellerBankDetailsForOnboarding(bankDetails);
  }

  hasCompleteProfileDetails(profile = {}) {
    return hasCompleteSellerProfileForOnboarding(profile);
  }

  async updateSettings(payload, actor) {
    const sellerId = this.getSellerId(actor);
    const existingSeller = await this.sellerRepository.findSellerById(sellerId);
    if (!existingSeller) {
      throw AppError.notFound("Seller profile");
    }

    const nextSettings = {
      ...(existingSeller.sellerSettings || {}),
      ...payload,
    };

    const updatedSeller = await this.sellerRepository.updateSellerSettings(sellerId, nextSettings);
    return updatedSeller?.sellerSettings || null;
  }

  async getDashboard(query, actor) {
    const sellerId = this.getSellerId(actor);
    const organizationId = query.organizationId || actor.organizationId || null;
    const fromDate = query.fromDate ? new Date(query.fromDate) : this.getDateBeforeDays(30);
    const toDate = query.toDate ? new Date(query.toDate) : new Date();

    const [summary, topProducts, recentOrdersRaw, orderPerformance, orderStatusRows, seller, kyc, organization] = await Promise.all([
      this.sellerRepository.fetchDashboardSummary(sellerId, fromDate, toDate, organizationId),
      this.sellerRepository.fetchTopProducts(sellerId, fromDate, toDate, 5, organizationId),
      this.sellerRepository.fetchRecentOrders(sellerId, 10, organizationId),
      this.sellerRepository.fetchOrderPerformance(sellerId, fromDate, toDate, organizationId),
      this.sellerRepository.fetchOrderStatusBreakdown(sellerId, fromDate, toDate, organizationId),
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
      organizationId
        ? sellerOrganizationService.assertOrganizationForSeller(sellerId, organizationId)
        : sellerOrganizationService.getDefaultOrOnlyOrganization(sellerId),
    ]);
    const recentOrders = await this.attachCustomerProfilesToOrders(recentOrdersRaw);

    const totalOrders = Number(summary?.total_orders || 0);
    const gmv = Number(summary?.gmv || 0);
    const organizationBackedProfile = sellerOrganizationService.buildSellerProfileMirror(
      seller?.sellerProfile || {},
      organization,
    );
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: organizationBackedProfile,
      user: seller || {},
      kyc,
    });

    return {
      window: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      },
      onboarding: {
        status: onboardingState.onboardingStatus,
        checklist: onboardingState.checklist,
        kycStatus: onboardingState.kycStatus,
        organizationStatus: organization?.approvalStatus || "not_created",
        organizationApproved: ["approved", "active"].includes(
          String(organization?.approvalStatus || "").toLowerCase(),
        ),
      },
      organization: sellerOrganizationService.buildPublicSummary(organization),
      metrics: {
        totalOrders,
        ordersToday: Number(summary?.orders_today || 0),
        unitsSold: Number(summary?.units_sold || 0),
        gmv,
        deliveredRevenue: Number(summary?.delivered_revenue || 0),
        cancelledOrders: Number(summary?.cancelled_orders || 0),
        returnedOrders: Number(summary?.returned_orders || 0),
        averageOrderValue: totalOrders > 0 ? Number((gmv / totalOrders).toFixed(2)) : 0,
        averageItemValue: Number(summary?.avg_item_value || 0),
      },
      topProducts: topProducts.map((product) => ({
        ...product,
        productId: product.product_id,
        name: product.name || product.title || product.product_id,
        unitsSold: Number(product.units_sold || product.unitsSold || 0),
        revenue: Number(product.revenue || 0),
      })),
      orderPerformance: orderPerformance.map((row) => ({
        label: row.label,
        value: Number(row.value || 0),
        revenue: Number(row.revenue || 0),
      })),
      orderStatus: orderStatusRows.map((row) => ({
        name: row.status,
        label: String(row.status || "pending").replace(/_/g, " "),
        value: Number(row.count || 0),
      })),
      statusBreakdown: orderStatusRows.map((row) => ({
        name: row.status,
        label: String(row.status || "pending").replace(/_/g, " "),
        value: Number(row.count || 0),
      })),
      recentOrders,
    };
  }

  getDateBeforeDays(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  async reviewKyc(sellerId, payload, actor) {
    if (payload.verificationStatus === KYC_STATUS.REJECTED && !payload.rejectionReason) {
      throw new AppError("Rejection reason is required when KYC is rejected", 400);
    }
    const existing = await this.sellerRepository.findKycBySellerId(sellerId);
    const record = await this.sellerRepository.reviewKyc(sellerId, {
      ...payload,
      reviewedBy: actor.userId,
    });

    if (!record) {
      throw AppError.notFound("Seller KYC record");
    }

    const seller = await this.sellerRepository.findSellerById(sellerId);
    if (seller) {
      const existingProfile = this.mergeKycIntoSellerProfile(seller.sellerProfile || {}, record);
      const nextProfile = this.withOnboardingState(existingProfile, record, seller);

      await this.sellerRepository.updateSellerOnboardingState(
        sellerId,
        nextProfile,
        seller.accountStatus || "pending_approval",
      );
      await this.syncDefaultOrganizationFromProfile(
        sellerId,
        nextProfile,
        seller,
        actor,
        {
          kycStatus: record.verification_status,
          approvalStatus:
            record.verification_status === KYC_STATUS.REJECTED
                ? "rejected"
                : "pending_review",
          ...(record.verification_status === KYC_STATUS.REJECTED
            ? { rejectionReason: record.rejection_reason || null }
            : {}),
        },
      );
    }

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.KYC_STATUS_UPDATED_V1,
        {
          sellerId,
          verificationStatus: record.verification_status,
          rejectionReason: record.rejection_reason,
        },
        {
          source: "seller-module",
          aggregateId: sellerId,
        },
      ),
    );

    const action = payload.verificationStatus === KYC_STATUS.VERIFIED ? "approve" : "reject";
    auditService[action](actor._req, {
      module:     "seller_kyc",
      entityId:   sellerId,
      entityType: "SellerKyc",
      oldData:    existing ? { verificationStatus: existing.verification_status } : undefined,
      newData:    { verificationStatus: record.verification_status },
      reason:     payload.rejectionReason || payload.notes || undefined,
    });

    return record;
  }

  formatModuleName(moduleName) {
    return String(moduleName || "")
      .split("/")
      .pop()
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  getRbacModuleMap(modules = []) {
    const lookup = new Map();
    const aliases = {
      product: "products",
      products: "product",
      order: "orders",
      orders: "order",
      seller: "sellers",
      sellers: "seller",
    };

    modules.forEach((module) => {
      lookup.set(module.slug, module);
      if (aliases[module.slug]) {
        lookup.set(aliases[module.slug], module);
      }
    });

    return lookup;
  }

  normalizePermissionAction(action) {
    const normalized = normalizeRbacPermissionAction(action);
    return PERMISSION_ACTIONS.includes(normalized) ? normalized : null;
  }

  normalizeModulePermissions(modulePermissions, allowedModules) {
    const allowedModuleSet = new Set(allowedModules);
    const source = Array.isArray(modulePermissions) && modulePermissions.length
      ? modulePermissions
      : allowedModules.map((module) => ({
          module,
          actions: ["view"],
        }));

    return source
      .map((item) => {
        const moduleName = cleanModuleName(item.module || item.slug);
        if (!moduleName || !allowedModuleSet.has(moduleName)) {
          throw new AppError(`Permission assignment includes unavailable seller module: ${moduleName || "unknown"}`, 403);
        }
        const actions = Array.from(new Set((item.actions || []).map((action) => {
          const normalized = this.normalizePermissionAction(action);
          if (!normalized) {
            throw new AppError(`Permission assignment includes invalid action: ${action}`, 400);
          }
          return normalized;
        })));

        return {
          module: moduleName,
          actions: actions.length
            ? Array.from(new Set(["view", ...actions]))
            : ["view"],
        };
      });
  }

  getPermissionAssignmentData(permissions = [], moduleAllowed, forceAssigned) {
    const byAction = new Map();
    permissions.forEach((permission) => {
      const action = this.normalizePermissionAction(permission.action);
      if (!action) return;

      const assigned = moduleAllowed && (forceAssigned || Boolean(permission.assigned));
      const current = byAction.get(action);
      const preferCanonicalRow = !current || permission.action === action;
      const nextPermission = preferCanonicalRow
        ? { ...permission, action, assigned }
        : { ...current, assigned: Boolean(current.assigned || assigned) };

      nextPermission.assigned = Boolean((current?.assigned || false) || assigned);
      byAction.set(action, nextPermission);
    });
    const normalizedPermissions = Array.from(byAction.values());
    const actions = PERMISSION_ACTIONS;
    const permissionsByAction = actions.reduce((lookup, action) => {
      lookup[action] =
        normalizedPermissions.find((permission) => permission.action === action) ||
        null;
      return lookup;
    }, {});
    const permissionKeys = actions.reduce((lookup, action) => {
      lookup[action] = Boolean(permissionsByAction[action]?.assigned);
      return lookup;
    }, {});

    return {
      permissions: normalizedPermissions,
      permissionsByAction,
      permissionKeys,
      assignedPermissionCount: normalizedPermissions.filter(
        (permission) => permission.assigned,
      ).length,
    };
  }

  async getSellerAccessUser(query = {}, actor = {}) {
    if (!query.userId) {
      return null;
    }

    const sellerId = this.assertSellerOwnerActor(actor);
    if (String(query.userId) === String(actor.userId)) {
      return {
        _id: actor.userId,
        id: actor.userId,
        role: actor.role,
        allowedModules: actor.allowedModules || [],
        ownerAdminId: actor.ownerAdminId || null,
        ownerSellerId: actor.ownerSellerId || sellerId,
      };
    }

    const accessUser = await this.sellerRepository.findSellerSubAdminById(
      sellerId,
      query.userId,
    );
    if (!accessUser) {
      throw AppError.notFound("Seller sub-admin");
    }
    return this.toPlainObject(accessUser);
  }

  async listAccessModules(query = {}, actor = {}) {
    this.assertSellerOwnerActor(actor);
    const accessUser = await this.getSellerAccessUser(query, actor);
    const targetRole =
      accessUser?.role || query.roleSlug || query.role || ROLES.SELLER_SUB_ADMIN;
    const roleSlug = query.roleSlug || targetRole;
    const assignedModuleSet = new Set(
      (accessUser?.allowedModules || []).map(cleanModuleName).filter(Boolean),
    );
    const shouldUseAssignedModules =
      Boolean(accessUser) && [ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(targetRole);
    let permissionMatrix = null;

    try {
      permissionMatrix = await this.rbacService.getPermissionManagementMatrix({
        roleId: query.roleId,
        ...(shouldUseAssignedModules && accessUser
          ? { userId: String(accessUser._id || accessUser.id) }
          : { roleSlug }),
        active: query.active,
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 404) {
        throw error;
      }
      permissionMatrix = await this.rbacService.getPermissionManagementMatrix({
        active: query.active,
      });
    }

    const assignedModulesFromPermissions = new Set(
      (permissionMatrix?.modules || [])
        .filter((module) =>
          (module.permissions || []).some((permission) => permission.assigned),
        )
        .map((module) => cleanModuleName(module.slug || module.moduleSlug || module.moduleKey))
        .filter(Boolean),
    );
    const effectiveAssignedModuleSet = new Set([
      ...assignedModuleSet,
      ...assignedModulesFromPermissions,
    ]);

    const actorPermissionMap = await this.getActorAssignablePermissionMap(actor);
    const rbacModulesBySlug = this.getRbacModuleMap(permissionMatrix.modules);
    const includePermissions = query.includePermissions !== false;
    const modules = DEFAULT_SELLER_MODULES
      .filter((moduleSlug) => {
        if (!actorPermissionMap) return true;
        const actorActions = actorPermissionMap.get(cleanModuleName(moduleSlug));
        return Boolean(actorActions?.has("view"));
      })
      .map((moduleSlug) => {
        const rbacModule = rbacModulesBySlug.get(moduleSlug) || null;
        const metadata = rbacModule?.metadata || {};
        const actorActions = actorPermissionMap?.get(cleanModuleName(moduleSlug)) || null;
        const moduleAllowed =
          !shouldUseAssignedModules ||
          effectiveAssignedModuleSet.has(cleanModuleName(moduleSlug));
        const forceAssigned =
          moduleAllowed && targetRole === ROLES.SELLER && !permissionMatrix.role;
        const assignmentData = includePermissions
          ? this.getPermissionAssignmentData(
              rbacModule?.permissions || [],
              moduleAllowed,
              forceAssigned,
            )
          : {};
        const permissions = includePermissions
          ? (assignmentData.permissions || []).map((permission) => ({
              ...permission,
              assignable: !actorActions || actorActions.has(permission.action),
            }))
          : undefined;
        const permissionsByAction = includePermissions
          ? Object.keys(assignmentData.permissionsByAction || {}).reduce(
              (lookup, action) => {
                const permission =
                  permissions.find((item) => item.action === action) || null;
                lookup[action] = permission;
                return lookup;
              },
              {},
            )
          : undefined;

        return {
          slug: moduleSlug,
          name: rbacModule?.name || this.formatModuleName(moduleSlug),
          icon: rbacModule?.icon || null,
          description: rbacModule?.description || null,
          tab: metadata.tab || null,
          forPlatform: false,
          forSeller: true,
          apiPath: metadata.apiPath || null,
          apiAliases: metadata.apiAliases || [],
          metadata,
          assignable: true,
          assignableActions: actorActions ? Array.from(actorActions) : undefined,
          assigned: moduleAllowed,
          source: rbacModule ? "rbac" : "seller",
          permissions,
          permissionsByAction,
          permissionKeys: includePermissions
            ? assignmentData.permissionKeys
            : undefined,
          assignedPermissionCount: assignmentData.assignedPermissionCount || 0,
        };
      });

    return {
      role: targetRole,
      rbacRole: permissionMatrix.role,
      user: accessUser
        ? {
            id: String(accessUser._id || accessUser.id),
            role: accessUser.role,
            allowedModules: accessUser.allowedModules || [],
          }
        : null,
      modules,
      totals: {
        modules: modules.length,
        permissions: modules.reduce(
          (total, module) => total + (module.permissions?.length || 0),
          0,
        ),
        assignedPermissions: modules.reduce(
          (total, module) => total + (module.assignedPermissionCount || 0),
          0,
        ),
      },
      actions: permissionMatrix.actions,
    };
  }

  async listSidebarModules(query = {}, actor = {}) {
    if (![ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(actor.role)) {
      throw new AppError("Forbidden: seller access required", 403);
    }

    return this.rbacService.listSidebarModules(query, actor);
  }

  sanitizeModules(modules) {
    const normalized = Array.from(new Set((modules || []).map(cleanModuleName).filter(Boolean)));
    return normalized.filter((moduleName) => DEFAULT_SELLER_MODULES.includes(moduleName));
  }

  async getActorAssignablePermissionMap(actor = {}) {
    if (actor.role === ROLES.SELLER) {
      return null;
    }
    if (![ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(actor.role)) {
      throw AppError.forbidden();
    }
    const matrix = await this.rbacService.getPermissionManagementMatrix({
      userId: actor.userId,
      active: true,
    });
    const grants = new Map();
    (matrix.modules || []).forEach((module) => {
      const slug = cleanModuleName(module.slug);
      if (!slug) return;
      const actions = new Set(
        (module.permissions || [])
          .filter((permission) => permission.assigned)
          .map((permission) => this.normalizePermissionAction(permission.action))
          .filter(Boolean),
      );
      if (!actions.has("view")) return;
      grants.set(slug, actions);
    });
    return grants;
  }

  assertRbacAssignmentCapability(actorPermissionMap) {
    if (!actorPermissionMap) return;
    const sellerActions = actorPermissionMap.get("sellers") || new Set();
    const canAssign = ["add", "edit", "update", "approval", "status"].some((action) =>
      sellerActions.has(action),
    );
    if (!canAssign) {
      throw AppError.forbidden("You do not have permission to manage seller access.");
    }
  }

  constrainModuleAssignmentByActor(
    actor = {},
    actorPermissionMap,
    allowedModules = [],
    modulePermissions = [],
  ) {
    if (!actorPermissionMap) {
      return { allowedModules, modulePermissions };
    }

    const actorModuleScope = new Set((actor.allowedModules || []).map(cleanModuleName));
    const deniedModules = allowedModules.filter(
      (module) => !actorModuleScope.has(module) || !actorPermissionMap.has(module),
    );
    if (deniedModules.length) {
      throw new AppError(`Forbidden: cannot assign unavailable seller modules (${deniedModules.join(", ")})`, 403);
    }
    const scopedAllowed = allowedModules;
    if (!scopedAllowed.length) {
      throw new AppError("Forbidden: no assignable modules in request", 403);
    }

    const scopedPermissions = modulePermissions
      .map((entry) => {
        const moduleName = cleanModuleName(entry.module);
        if (!moduleName || !scopedAllowed.includes(moduleName)) return null;
        const grantActions = actorPermissionMap.get(moduleName) || new Set();
        const deniedActions = (entry.actions || []).filter(
          (action) => !grantActions.has(action),
        );
        if (deniedActions.length) {
          throw new AppError(
            `Forbidden: cannot assign unavailable seller actions for ${moduleName} (${deniedActions.join(", ")})`,
            403,
          );
        }
        const actions = Array.from(new Set(entry.actions || []));
        if (!actions.includes("view")) actions.unshift("view");
        return { module: moduleName, actions };
      })
      .filter(Boolean);

    return {
      allowedModules: scopedAllowed,
      modulePermissions: scopedPermissions.length
        ? scopedPermissions
        : scopedAllowed.map((module) => ({ module, actions: ["view"] })),
    };
  }

  async createSellerSubAdmin(payload, actor) {
    if (actor.role === ROLES.SELLER_SUB_ADMIN) {
      throw AppError.forbidden("Seller sub-admins cannot create staff.");
    }
    const req = actor._req;
    const sellerId = this.assertSellerOwnerActor(actor);
    const existing = await this.sellerRepository.findUserByEmail(payload.email);
    if (existing) {
      throw AppError.duplicate("User email", payload.email);
    }
    const allowedModules = this.sanitizeModules(payload.allowedModules);
    if (!allowedModules.length) {
      throw new AppError("At least one valid seller module is required", 400);
    }
    let modulePermissions = this.normalizeModulePermissions(
      payload.modulePermissions,
      allowedModules,
    );
    const actorPermissionMap = await this.getActorAssignablePermissionMap(actor);
    this.assertRbacAssignmentCapability(actorPermissionMap);
    const constrained = this.constrainModuleAssignmentByActor(
      actor,
      actorPermissionMap,
      allowedModules,
      modulePermissions,
    );
    const finalAllowedModules = constrained.allowedModules;
    modulePermissions = constrained.modulePermissions;
    const targetRole = actor.role === ROLES.SELLER
      ? (payload.role || ROLES.SELLER_ADMIN)
      : ROLES.SELLER_SUB_ADMIN;
    const passwordHash = await hashText(payload.password);
    const user = await this.sellerRepository.createManagedUser({
      email: payload.email,
      phone: payload.phone,
      passwordHash,
      role: targetRole,
      profile: payload.profile,
      createdBy: actor.userId || null,
      createdByRole: actor.role || null,
      parentSellerId: sellerId,
      parentAdminId: actor.ownerAdminId || null,
      hierarchyLevel: targetRole === ROLES.SELLER_ADMIN ? 3 : 4,
      ownerAdminId: actor.ownerAdminId || null,
      ownerSellerId: sellerId,
      allowedModules: finalAllowedModules,
      accountStatus: "active",
      emailVerified: true,
      authProviders: [],
      refreshSessions: [],
    });

    await this.rbacService.assignRoleToUserBySlug(
      String(user.id),
      targetRole,
      actor.userId,
      {
        ignoreMissing: true,
        ignoreExisting: true,
      },
    );

    await this.rbacService.syncUserModulePermissions(
      String(user.id),
      modulePermissions,
      actor.userId,
      actor,
    );

    auditService.create(req, {
      module:     "seller-management",
      entityId:   String(user.id),
      entityType: "SellerSubAdmin",
      newData:    { email: payload.email, role: targetRole, allowedModules: finalAllowedModules },
    });

    return user;
  }

  async enrichPermissionSummary(items = []) {
    const list = items.map((item) => this.toPlainObject(item));
    const summaries = await Promise.all(
      list.map(async (user) => {
        const userId = user._id || user.id;
        if (!userId) return { moduleCount: 0, actionCount: 0, permissions: [] };
        const permissions = await this.rbacService.getUserEffectivePermissions(String(userId));
        const slugs = permissions.map((permission) => permission.slug).filter(Boolean);
        return {
          moduleCount: new Set(slugs.map((slug) => slug.split(":")[0]).filter(Boolean)).size,
          actionCount: slugs.length,
          permissions: slugs,
        };
      }),
    );
    return list.map((user, index) => ({
      ...user,
      permissionSummary: summaries[index],
      assignedModuleCount: summaries[index].moduleCount || (user.allowedModules || []).length,
      assignedActionCount: summaries[index].actionCount,
    }));
  }

  async listSellerSubAdmins(actor) {
    const sellerId = this.assertSellerOwnerActor(actor);
    return this.enrichPermissionSummary(
      await this.sellerRepository.listSellerSubAdmins(sellerId),
    );
  }

  async updateSellerSubAdminStatus(userId, payload, actor) {
    const sellerId = this.assertSellerOwnerActor(actor);
    const accountStatus = payload.accountStatus || payload.status;
    const updated = await this.sellerRepository.updateSellerSubAdminStatus(
      sellerId,
      userId,
      accountStatus,
    );
    if (!updated) {
      throw AppError.notFound("Seller sub-admin");
    }
    return updated;
  }

  async deleteSellerSubAdmin(userId, actor) {
    const sellerId = this.assertSellerOwnerActor(actor);
    const deleted = await this.sellerRepository.deleteSellerSubAdmin(sellerId, userId);
    if (!deleted) {
      throw AppError.notFound("Seller sub-admin");
    }
    auditService.remove(actor._req, {
      module:     "seller-management",
      entityId:   userId,
      entityType: "SellerSubAdmin",
    });
    return { success: true, userId };
  }

  async updateSellerSubAdminModules(userId, payload, actor) {
    const sellerId = this.assertSellerOwnerActor(actor);
    let allowedModules = this.sanitizeModules(payload.allowedModules);
    if (!allowedModules.length) {
      throw new AppError("At least one valid seller module is required", 400);
    }
    let modulePermissions = this.normalizeModulePermissions(
      payload.modulePermissions,
      allowedModules,
    );
    const actorPermissionMap = await this.getActorAssignablePermissionMap(actor);
    this.assertRbacAssignmentCapability(actorPermissionMap);
    const constrained = this.constrainModuleAssignmentByActor(
      actor,
      actorPermissionMap,
      allowedModules,
      modulePermissions,
    );
    allowedModules = constrained.allowedModules;
    modulePermissions = constrained.modulePermissions;
    const updated = await this.sellerRepository.updateSellerSubAdminModules(sellerId, userId, allowedModules);
    if (!updated) {
      throw AppError.notFound("Seller sub-admin");
    }
    await this.rbacService.syncUserModulePermissions(
      String(userId),
      modulePermissions,
      actor.userId,
      actor,
    );
    return updated;
  }
}

module.exports = { SellerService };
