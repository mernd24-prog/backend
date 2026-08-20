const { AuthRepository } = require("../repositories/auth.repository");
const { AppError } = require("../../../shared/errors/app-error");
const { hashText, checkHash } = require("../../../shared/tools/hash");
const {
  makeAccessToken,
  makeRefreshToken,
  makeOnboardingToken,
  readRefreshToken,
} = require("../../../shared/tools/tokens");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { RbacService } = require("../../rbac/services/rbac.service");
const { ROLES } = require("../../../shared/constants/roles");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { socialAuthService } = require("../../../infrastructure/auth/social-auth.service");
const { securityEventService } = require("../../../shared/security/security-event.service");
const { SECURITY_EVENTS } = require("../../../shared/constants/security-events");
const { Role } = require("../../../infrastructure/sequelize/models");
const { WalletService } = require("../../wallet/services/wallet.service");
const { ReferralService } = require("../../referral/services/referral.service");
const { createOtp } = require("../../../shared/tools/otp");
const { redis } = require("../../../infrastructure/redis/redis-client");
const { sendMail } = require("../../../infrastructure/mail/mailer");
const otpEmailTemplate = require("../../../../templates/otp-email.ejs");
const { env } = require("../../../config/env");
const { logger } = require("../../../shared/logger/logger");
const {
  createHash,
  timingSafeEqual,
} = require("crypto");

const {
  sendSmsOtp,
} = require("../../../infrastructure/msg/msg-otp");
const {
  SELLER_ONBOARDING_STATUS,
  makeSellerOnboardingState,
  getSellerKycStatus,
} = require("../../../shared/domain/seller-onboarding");
const { sellerOrganizationService } = require("../../seller/services/seller-organization.service");

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
const {
  AUTH_ERROR_CODES,
  authError,
  getSessionAuthError,
  getStatusAuthError,
  normalizeAccountStatus,
} = require("../../../shared/auth/session-state");
const BUYER_OTP_PURPOSE = "buyer_auth";

const BUYER_OTP_TTL_SECONDS = 300;
const BUYER_OTP_CONTEXT_TTL_SECONDS = 600;
const BUYER_OTP_RESEND_SECONDS = 60;
const BUYER_OTP_MAX_ATTEMPTS = 5;
class AuthService {
  constructor({
    authRepository = new AuthRepository(),
    walletService = new WalletService(),
    referralService = new ReferralService(),
    rbacService = new RbacService(),
  } = {}) {
    this.authRepository = authRepository;
    this.walletService = walletService;
    this.referralService = referralService;
    this.rbacService = rbacService;
  }

  validateSelfSignupRole(role) {
    const allowed = [ROLES.BUYER, ROLES.SELLER];
    if (!allowed.includes(role)) {
      throw new AppError("Role is not allowed for self-registration", 400);
    }
  }

  isSellerRole(role) {
    return [ROLES.SELLER, ROLES.SELLER_SUB_ADMIN].includes(role);
  }

  getOtpPurposeLabel(purpose) {
    const labels = {
      registration: "Account Registration",
      forgot_password: "Password Reset",
      influencer_forgot_password: "Influencer Password Reset",
      login: "Seller Login",
      buyer_auth: "Sam Global Login",

    };
    return labels[purpose] || "Verification";
  }

  normalizeOtpEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  normalizeSignupPhone(phone) {
    let digits = String(phone || "").replace(/\D/g, "");

    if (digits.length === 11 && digits.startsWith("0")) {
      digits = digits.slice(1);
    }

    if (digits.length === 12 && digits.startsWith("91")) {
      digits = digits.slice(2);
    }

    return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : String(phone || "").trim();
  }

  getSignupRoleLabel(role) {
    return role === ROLES.SELLER ? "Seller" : "Customer";
  }

  getRegistrationSuccessMessage(role) {
    return role === ROLES.SELLER
      ? "Seller account created successfully. Please complete seller onboarding."
      : "Customer account created successfully.";
  }

  getRegistrationOtpMessage(role) {
    return `${this.getSignupRoleLabel(role)} registration OTP sent successfully.`;
  }

  async assertSignupIdentityAvailable(payload = {}, requestContext = {}) {
    const roleLabel = this.getSignupRoleLabel(payload.role);
    const email = this.normalizeOtpEmail(payload.email);
    const phone = this.normalizeSignupPhone(payload.phone);

    const existingByEmail = await this.authRepository.findUserByEmail(email);
    if (existingByEmail) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "duplicate_email", role: payload.role },
      });
      throw new AppError(`${roleLabel} email already exists. Please login or use another email.`, 409);
    }

    const existingByPhone = await this.authRepository.findUserByPhone(phone);
    if (existingByPhone) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "duplicate_phone", role: payload.role },
      });
      throw new AppError(`${roleLabel} phone number already exists. Please login or use another phone number.`, 409);
    }
  }

  makeOtpKey(email, purpose) {
    return `otp:${this.normalizeOtpEmail(email)}:${purpose}`;
  }

  makeVerifiedOtpKey(email, purpose) {
    return `otp_verified:${this.normalizeOtpEmail(email)}:${purpose}`;
  }

  makeInitialSellerProfile(payload = {}) {
    const profileName = composeProfileName(
      payload.profile?.firstName,
      payload.profile?.lastName,
    );

    return {
      displayName: profileName,
      supportEmail: payload.email,
      supportPhone: payload.phone,
      onboardingStatus: SELLER_ONBOARDING_STATUS.INITIATED,
    };
  }

  async getSellerLoginFlowState(user) {
    if (!user || user.role !== ROLES.SELLER) {
      return null;
    }

    return this.getAuthStatus(user.id);
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

  formatKycDocuments(documents) {
    if (!documents) return {};
    try {
      return typeof documents === "string" ? JSON.parse(documents) : documents;
    } catch {
      return {};
    }
  }

  formatSellerKycForStatus(kyc) {
    if (!kyc) return null;
    return {
      verificationStatus: kyc.verification_status,
      legalName: kyc.legal_name,
      businessType: kyc.business_type,
      panNumber: kyc.pan_number,
      gstNumber: kyc.gst_number,
      aadhaarNumber: kyc.aadhaar_number,
      panVerified: kyc.pan_verified === true,
      panVerifiedAt: kyc.pan_verified_at || null,
      aadhaarVerified: kyc.aadhaar_verified === true,
      aadhaarReferenceId: kyc.aadhaar_reference_id || null,
      aadhaarVerifiedAt: kyc.aadhaar_verified_at || null,
      rejectionReason: kyc.rejection_reason || null,
      submittedAt: kyc.submitted_at || null,
      reviewedAt: kyc.reviewed_at || null,
      documents: this.formatKycDocuments(kyc.documents),
    };
  }

  async makeOnboardingResponse(user) {
    const flowState = await this.getAuthStatus(user.id);
    const onboardingToken = makeOnboardingToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      isOnboarding: true,
    });

    return {
      user: flowState.user,
      requiresOnboarding: Boolean(flowState.requiresOnboarding),
      onboardingToken,
      flowState,
    };
  }

  sanitizeAuthUser(user, accessSummary = null) {
    const plainUser = this.toPlainObject(user);
    delete plainUser.passwordHash;
    if (Array.isArray(plainUser.refreshSessions)) {
      plainUser.refreshSessions = plainUser.refreshSessions.map((session) => {
        const cleanSession = { ...session };
        delete cleanSession.tokenHash;
        return cleanSession;
      });
    }

    if (!accessSummary) {
      return plainUser;
    }

    return {
      ...plainUser,
      allowedModules: accessSummary.assignedModules?.length
        ? accessSummary.assignedModules
        : plainUser.allowedModules || [],
      assignedModules: accessSummary.assignedModules,
      assignedPermissions: accessSummary.assignedPermissions,
      permissions: accessSummary.effectivePermissions,
      permissionsByAction: accessSummary.permissionsByAction,
      sidebarModules: accessSummary.sidebarModules,
      effectivePermissions: accessSummary.effectivePermissions,
    };
  }

  async makeTokenPayload(user, accessSummary = null) {
    const assignedModules = Array.isArray(accessSummary?.assignedModules)
      ? accessSummary.assignedModules
      : [];
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      roles: user.role ? [user.role] : [],
      isSuperAdmin: false,
      userType: user.role,
      status: user.accountStatus || "active",
      tokenVersion: Number(user.tokenVersion || 0),
      sessionVersion: Number(user.sessionVersion || 0),
      permissionVersion: Number(user.permissionVersion || 0),
      issuedAt: new Date().toISOString(),
      allowedModules: assignedModules.length
        ? assignedModules
        : Array.isArray(user.allowedModules) ? user.allowedModules : [],
      ownerAdminId: user.ownerAdminId || null,
      ownerSellerId: user.ownerSellerId || null,
    };

    try {
      const superAdminRecord = await this.rbacService.getSuperAdminByUserId(user.id);
      if (superAdminRecord && superAdminRecord.isActive !== false) {
        payload.isSuperAdmin = true;
      }
    } catch (error) {
      // Preserve login flow if RBAC lookup fails; authorization middleware still denies by default.
    }

    return payload;
  }

  async assignDefaultRbacRole(user, assignedBy = null) {
    if (!user?.role) {
      return null;
    }

    try {
      return await this.rbacService.assignRoleToUserBySlug(
        String(user.id),
        user.role,
        assignedBy || String(user.id),
        {
          ignoreMissing: true,
          ignoreExisting: true,
          skipSessionInvalidation: true,
        },
      );
    } catch (error) {
      return null;
    }
  }

  async assertActiveRoleForLogin(user) {
    if (!user?.role) {
      throw authError(AUTH_ERROR_CODES.ROLE_CHANGED, 401);
    }
    const role = await Role.findOne({ where: { slug: user.role } }).catch(() => null);
    if (role && role.active === false) {
      throw authError(AUTH_ERROR_CODES.ROLE_INACTIVE, 403);
    }
  }

  async assertUserCanAuthenticate(user, options = {}) {
    if (!user) {
      throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
    }

    const status = normalizeAccountStatus(user.accountStatus);
    const allowSellerOnboarding =
      options.allowSellerOnboarding === true &&
      user.role === ROLES.SELLER &&
      status === "pending_approval";
    const statusError = getStatusAuthError(user);
    if (statusError && !allowSellerOnboarding) {
      throw statusError;
    }

    await this.assertActiveRoleForLogin(user);
  }

  async assertAdminPanelLoginAllowed(user, requestContext = {}) {
    const adminPanelRoles = new Set([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SUB_ADMIN]);
    if (!adminPanelRoles.has(user.role)) {
      return;
    }

    const superAdminRecord = await this.rbacService.getSuperAdminByUserId(user.id);
    if (user.role === ROLES.SUPER_ADMIN) {
      if (superAdminRecord && superAdminRecord.isActive !== false) {
        return;
      }
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "super_admin_not_active" },
      });
      throw new AppError("This super admin account is no longer active", 403);
    }

    const hasActiveRole = await this.rbacService.hasActiveUserRole(user.id);
    if (!hasActiveRole) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "admin_role_not_assigned" },
      });
      throw new AppError("This admin account is no longer active", 403);
    }
  }

  async register(payload, requestContext = {}) {
    this.validateSelfSignupRole(payload.role);
    await this.referralService.getReferrerByCode(payload.referralCode);
    await this.assertSignupIdentityAvailable(payload, requestContext);

    const passwordHash = await hashText(payload.password);
    const isSeller = payload.role === ROLES.SELLER;
    const user = await this.authRepository.createUser({
      email: payload.email,
      phone: payload.phone,
      phoneNormalized: this.normalizeSignupPhone(payload.phone),
      passwordHash,
      role: payload.role,
      profile: payload.profile,
      referralCode: this.makeReferralCode(payload.profile.firstName),
      accountStatus: isSeller ? "pending_approval" : "active",
      ...(isSeller ? { sellerProfile: this.makeInitialSellerProfile(payload) } : {}),
      emailVerified: false,
      authProviders: [],
      refreshSessions: [],
    });

    await this.walletService.ensureWallet(user.id);
    await this.assignDefaultRbacRole(user);
    await this.referralService.rewardReferral(payload.referralCode, user);

    if (isSeller) {
      const result = await this.makeOnboardingResponse(user);
      return {
        ...result,
        message: this.getRegistrationSuccessMessage(payload.role),
      };
    }

    const result = await this.issueTokens(user, requestContext, "password");
    return {
      ...result,
      message: this.getRegistrationSuccessMessage(payload.role),
    };
  }

  async registerWithOtp(payload, requestContext = {}) {
    this.validateSelfSignupRole(payload.role);
    await this.referralService.getReferrerByCode(payload.referralCode);
    await this.assertSignupIdentityAvailable(payload, requestContext);

    // Store registration data in Redis temporarily
    const registrationData = {
      email: payload.email,
      phone: payload.phone,
      password: payload.password,
      role: payload.role,
      profile: payload.profile,
      referralCode: payload.referralCode,
    };
    const regKey = `registration:${payload.email}`;
    await redis.setex(regKey, 600, JSON.stringify(registrationData)); // 10 minutes

    return this.sendOtp(
      {
        email: payload.email,
        mobile: payload.phone,
        purpose: "registration",
      },
      requestContext,
    ).then((result) => ({
      ...result,
      message: this.getRegistrationOtpMessage(payload.role),
    }));
  }

  async verifyRegistration(payload, requestContext = {}) {
    const { email, otp } = payload;

    // Verify OTP
    await this.verifyOtp({ email, otp, purpose: "registration" }, requestContext);

    // Get registration data from Redis
    const regKey = `registration:${email}`;
    const registrationDataStr = await redis.get(regKey);
    if (!registrationDataStr) {
      throw new AppError("Registration session expired", 400);
    }

    const registrationData = JSON.parse(registrationDataStr);
    await this.assertSignupIdentityAvailable(registrationData, requestContext);
    await redis.del(regKey);

    // Create user
    const passwordHash = await hashText(registrationData.password);
    const isSeller = registrationData.role === ROLES.SELLER;
    const user = await this.authRepository.createUser({
      email: registrationData.email,
      phone: registrationData.phone,
      phoneNormalized: this.normalizeSignupPhone(registrationData.phone),
      passwordHash,
      role: registrationData.role,
      profile: registrationData.profile,
      referralCode: this.makeReferralCode(registrationData.profile.firstName),
      emailVerified: true,
      accountStatus: isSeller ? "pending_approval" : "active",
      ...(isSeller ? { sellerProfile: this.makeInitialSellerProfile(registrationData) } : {}),
      authProviders: [],
      refreshSessions: [],
    });

    await this.walletService.ensureWallet(user.id);
    await this.assignDefaultRbacRole(user);
    await this.referralService.rewardReferral(registrationData.referralCode, user);

    if (isSeller) {
      const result = await this.makeOnboardingResponse(user);
      return {
        ...result,
        message: this.getRegistrationSuccessMessage(registrationData.role),
      };
    }

    const result = await this.issueTokens(user, requestContext, "password");
    return {
      ...result,
      message: this.getRegistrationSuccessMessage(registrationData.role),
    };
  }

  async getAuthStatus(userId) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
    }

    const isSeller = user.role === ROLES.SELLER;
    let kyc = null;
    let organization = null;
    let organizations = [];
    let organizationSummary = null;
    if (isSeller) {
      [kyc, organizations] = await Promise.all([
        this.authRepository.findSellerKycBySellerId(user.id),
        sellerOrganizationService.organizationRepository.listBySeller(user.id),
      ]);
      organizationSummary = sellerOrganizationService.buildOrganizationCollectionSummary(organizations);
      const selectedOrganizationId =
        organizationSummary.selectedOrganizationId ||
        organizationSummary.onboardingTargetOrganizationId;
      organization =
        organizations.find((item) => String(item.id) === String(selectedOrganizationId)) ||
        organizations.find((item) => item.isDefault) ||
        organizations[0] ||
        null;
    }

    let sellerProfile = isSeller ? this.toPlainObject(user?.sellerProfile || {}) : {};
    if (isSeller) {
      sellerProfile = sellerOrganizationService.buildSellerProfileMirror(
        sellerProfile,
        organization,
      );
      sellerProfile.businessName =
        sellerProfile.businessName ||
        sellerProfile.legalBusinessName ||
        "";
      sellerProfile.legalBusinessName =
        sellerProfile.legalBusinessName ||
        sellerProfile.businessName ||
        "";
      sellerProfile.businessType =
        sellerProfile.businessType || kyc?.business_type || "";
      if (sellerProfile.kycStatus === "rejected") {
        sellerProfile.businessName = null;
        sellerProfile.displayName = null;
        sellerProfile.legalBusinessName = null;
        sellerProfile.businessType = null;
        sellerProfile.registrationNumber = null;
        sellerProfile.gstNumber = null;
        sellerProfile.businessWebsite = null;
        sellerProfile.primaryContactName = null;
        sellerProfile.businessAddress = null;
        sellerProfile.pickupAddress = null;
        sellerProfile.returnAddress = null;
      }
      if (sellerProfile.bankVerificationStatus === "rejected") {
        sellerProfile.bankDetails = null;
        sellerProfile.goLiveStatus = "pending";
        sellerProfile.goLiveApprovedBy = null;
        sellerProfile.goLiveApprovedAt = null;
      }
    }
    const onboardingState = isSeller
      ? makeSellerOnboardingState({ sellerProfile, user, kyc })
      : null;
    const onboardingChecklist = onboardingState?.checklist || {};
    const kycStatus = onboardingState?.kycStatus || getSellerKycStatus(kyc, onboardingChecklist);
    const onboardingStatus = isSeller
      ? onboardingState.onboardingStatus
      : user?.sellerProfile?.onboardingStatus || "initiated";
    const bankVerificationStatus = sellerProfile.bankVerificationStatus || "not_submitted";
    const goLiveStatus = sellerProfile.goLiveStatus || "pending";
    const organizationApproved = organizationSummary?.hasApprovedOrganization || false;
    const sellerOnboardingComplete =
      organizationSummary?.hasApprovedOrganization === true;
    const flowState = {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        profile: {
          firstName: user.profile?.firstName || "",
          lastName: user.profile?.lastName || "",
        },
      },
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
      accountStatus: user.accountStatus || "active",
      requiresOnboarding: isSeller && !sellerOnboardingComplete,
      onboardingStatus,
      checklist: onboardingChecklist,
      kycStatus,
      kycRejectionReason: kyc?.rejection_reason || null,
      bankVerificationStatus,
      bankRejectionReason: sellerProfile.bankRejectionReason || null,
      goLiveStatus,
      organization: sellerOrganizationService.buildPublicSummary(organization),
      organizations: isSeller
        ? organizations.map((item) => sellerOrganizationService.buildPublicSummary(item))
        : [],
      organizationSummary: organizationSummary || {
        total: 0,
        approvedCount: 0,
        liveCount: 0,
        rejectedCount: 0,
        incompleteCount: 0,
        hasApprovedOrganization: false,
        hasLiveOrganization: false,
        requiresOrganizationOnboarding: true,
        requiresSelection: false,
        selectedOrganizationId: null,
        onboardingTargetOrganizationId: null,
        approvedOrganizationIds: [],
        incompleteOrganizationIds: [],
      },
      organizationApproved,
      sellerProfile: isSeller ? sellerProfile : null,
      kyc: isSeller ? this.formatSellerKycForStatus(kyc) : null,
      requirements: onboardingState?.requirements || {},
      hasApprovedOrganization: organizationSummary?.hasApprovedOrganization || false,
      hasLiveOrganization: organizationSummary?.hasLiveOrganization || false,
      selectedOrganizationId: organizationSummary?.selectedOrganizationId || null,
      onboardingTargetOrganizationId: organizationSummary?.onboardingTargetOrganizationId || null,
    };

    return flowState;
  }


  async login(payload, requestContext = {}, options = {}) {
    const user = await this.authRepository.findUserByEmail(payload.email);
    if (!user) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        email: payload.email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "user_not_found" },
      });
      throw new AppError("Invalid credentials", 401);
    }

    await this.assertUserCanAuthenticate(user, { allowSellerOnboarding: true });

    if (!user.passwordHash) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "password_login_not_enabled" },
      });
      throw new AppError("Password login is not enabled for this account", 401);
    }

    const isMatch = await checkHash(payload.password, user.passwordHash);
    if (!isMatch) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "invalid_password" },
      });
      throw new AppError("Invalid credentials", 401);
    }

    await this.assertAdminPanelLoginAllowed(user, requestContext);

    const influencerSession = options.requireInfluencer
      ? await this.referralService.getInfluencerSessionByUserId(user.id)
      : null;

    const sellerFlowState = await this.getSellerLoginFlowState(user);
    if (sellerFlowState?.requiresOnboarding) {
      return this.makeOnboardingResponse(user);
    }

    if (user.accountStatus !== "active" && !sellerFlowState?.hasApprovedOrganization) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "account_not_active" },
      });
      throw new AppError("Account is not active. Please complete registration or contact support.", 403);
    }

    await this.authRepository.updateLastLogin(user.id, new Date());
    const result = await this.issueTokens(user, requestContext, "password");
    return influencerSession ? { ...result, influencer: influencerSession } : result;
  }

  async loginInfluencer(payload, requestContext = {}) {
    const account = await this.referralService.getInfluencerAccountForLogin(payload.email);
    if (!account) {
      return this.login(payload, requestContext, { requireInfluencer: true });
    }

    if (account.accountStatus && account.accountStatus !== "active") {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: account.id,
        email: account.email,
        provider: "influencer-password",
        ...requestContext,
        metadata: { reason: "account_not_active", role: ROLES.INFLUENCER },
      });
      throw new AppError("Influencer account is not active", 403);
    }

    if (!account.passwordHash) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: account.id,
        email: account.email,
        provider: "influencer-password",
        ...requestContext,
        metadata: { reason: "password_login_not_enabled", role: ROLES.INFLUENCER },
      });
      throw new AppError("Password login is not enabled for this influencer account", 401);
    }

    const isMatch = await checkHash(payload.password, account.passwordHash);
    if (!isMatch) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        userId: account.id,
        email: account.email,
        provider: "influencer-password",
        ...requestContext,
        metadata: { reason: "invalid_password", role: ROLES.INFLUENCER },
      });
      throw new AppError("Invalid credentials", 401);
    }

    const influencerSession = await this.referralService.getInfluencerSessionByUserId(account.id);
    await this.referralService.updateInfluencerAccountLastLogin(account.id, new Date());
    const result = await this.issueInfluencerTokens(account, requestContext);
    return { ...result, influencer: influencerSession };
  }

  sanitizeInfluencerAccount(account) {
    const plainAccount = this.toPlainObject(account);
    delete plainAccount.passwordHash;
    if (Array.isArray(plainAccount.refreshSessions)) {
      plainAccount.refreshSessions = plainAccount.refreshSessions.map((session) => {
        const cleanSession = { ...session };
        delete cleanSession.tokenHash;
        return cleanSession;
      });
    }
    return {
      ...plainAccount,
      role: ROLES.INFLUENCER,
      userType: ROLES.INFLUENCER,
    };
  }

  async issueInfluencerTokens(
    account,
    requestContext = {},
    provider = "influencer-password",
    successEventType = SECURITY_EVENTS.AUTH_LOGIN_SUCCESS,
    replacedSessionId = null,
  ) {
    const tokenPayload = {
      sub: account.id,
      email: account.email,
      role: ROLES.INFLUENCER,
      roles: [ROLES.INFLUENCER],
      userType: ROLES.INFLUENCER,
      status: account.accountStatus || "active",
      tokenVersion: Number(account.tokenVersion || 0),
      sessionVersion: Number(account.sessionVersion || 0),
      permissionVersion: Number(account.permissionVersion || 0),
      authScope: "referral",
      isSuperAdmin: false,
    };
    const accessToken = makeAccessToken(tokenPayload);
    const refreshToken = makeRefreshToken(tokenPayload);
    const refreshPayload = readRefreshToken(refreshToken);
    const tokenHash = await hashText(refreshToken);
    const refreshSessions = (account.refreshSessions || [])
      .filter((session) => session.sessionId !== replacedSessionId)
      .slice(-4);

    refreshSessions.push({
      sessionId: refreshPayload.sessionId,
      tokenHash,
      provider,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      platform: requestContext.platform,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    });

    await this.referralService.updateInfluencerAccountRefreshSessions(account.id, refreshSessions);
    await this.recordSecurityEvent(successEventType, "success", {
      userId: account.id,
      email: account.email,
      provider,
      ...requestContext,
      metadata: { role: ROLES.INFLUENCER },
    });

    return {
      user: this.sanitizeInfluencerAccount(account),
      tokens: {
        accessToken,
        refreshToken,
      },
      flowState: null,
      permissions: null,
    };
  }

  async socialLogin(payload, requestContext = {}) {
    try {
      this.validateSelfSignupRole(payload.role);
      await this.referralService.getReferrerByCode(payload.referralCode);
      const providerProfile = await socialAuthService.verifyIdentityToken(payload);
      let user = await this.authRepository.findUserByProvider(
        providerProfile.provider,
        providerProfile.providerUserId,
      );

      if (!user) {
        user = await this.authRepository.findUserByEmail(providerProfile.email);
      }

      if (!user) {
        const isSeller = payload.role === ROLES.SELLER;
        const profile = {
          firstName: providerProfile.firstName,
          lastName: providerProfile.lastName,
          avatarUrl: providerProfile.avatarUrl,
        };
        user = await this.authRepository.createUser({
          email: providerProfile.email,
          role: payload.role,
          referralCode: this.makeReferralCode(providerProfile.firstName || "user"),
          emailVerified: providerProfile.emailVerified,
          passwordHash: undefined,
          profile,
          accountStatus: isSeller ? "pending_approval" : "active",
          ...(isSeller
            ? {
              sellerProfile: this.makeInitialSellerProfile({
                email: providerProfile.email,
                phone: null,
                profile,
              }),
            }
            : {}),
          authProviders: [
            {
              provider: providerProfile.provider,
              providerUserId: providerProfile.providerUserId,
            },
          ],
          refreshSessions: [],
        });
        await this.walletService.ensureWallet(user.id);
        await this.assignDefaultRbacRole(user);
        await this.referralService.rewardReferral(payload.referralCode, user);
      } else {
        user = await this.authRepository.linkSocialProvider(user.id, providerProfile);
      }

      await this.assertUserCanAuthenticate(user, { allowSellerOnboarding: true });

      const sellerFlowState = await this.getSellerLoginFlowState(user);
      if (sellerFlowState?.requiresOnboarding) {
        return this.makeOnboardingResponse(user);
      }

      await this.authRepository.updateLastLogin(user.id, new Date());
      return this.issueTokens(user, requestContext, providerProfile.provider, SECURITY_EVENTS.AUTH_SOCIAL_LOGIN_SUCCESS);
    } catch (error) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_SOCIAL_LOGIN_FAILED, "failed", {
        email: null,
        provider: payload.provider,
        ...requestContext,
        metadata: { reason: error.message },
      });
      throw error;
    }
  }
  normalizeBuyerOtpIdentity(payload = {}) {
    const rawEmail = String(payload?.email || "").trim();

    const rawMobile = String(
      payload?.mobile ||
      payload?.phone ||
      "",
    ).trim();

    const suppliedCount =
      Number(Boolean(rawEmail)) +
      Number(Boolean(rawMobile));

    if (suppliedCount !== 1) {
      throw new AppError(
        "Provide exactly one of email or mobile",
        400,
      );
    }

    if (rawEmail) {
      const email = rawEmail.toLowerCase();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError(
          "Enter a valid email address",
          400,
        );
      }

      return {
        channel: "email",
        identifier: email,
        email,
        mobile: null,
      };
    }

    let digits = rawMobile.replace(/\D/g, "");

    // 09876543210 -> 9876543210
    if (
      digits.length === 11 &&
      digits.startsWith("0")
    ) {
      digits = digits.slice(1);
    }

    // 919876543210 -> 9876543210
    if (
      digits.length === 12 &&
      digits.startsWith("91")
    ) {
      digits = digits.slice(2);
    }

    if (!/^[6-9]\d{9}$/.test(digits)) {
      throw new AppError(
        "Enter a valid 10-digit Indian mobile number",
        400,
      );
    }

    const mobile = `+91${digits}`;

    return {
      channel: "mobile",
      identifier: mobile,
      email: null,
      mobile,
    };
  }

  makeBuyerOtpSubject(identity) {
    return createHash("sha256")
      .update(
        `${identity.channel}:${identity.identifier}`,
      )
      .digest("hex");
  }

  makeBuyerOtpKeys(identity) {
    const subject = this.makeBuyerOtpSubject(identity);

    return {
      otpKey:
        `buyer_otp:${BUYER_OTP_PURPOSE}:${subject}`,

      contextKey:
        `buyer_otp_context:${BUYER_OTP_PURPOSE}:${subject}`,

      attemptsKey:
        `buyer_otp_attempts:${BUYER_OTP_PURPOSE}:${subject}`,

      cooldownKey:
        `buyer_otp_cooldown:${BUYER_OTP_PURPOSE}:${subject}`,
    };
  }

  maskBuyerOtpIdentifier(identity) {
    if (identity.channel === "email") {
      const [name, domain] =
        identity.identifier.split("@");

      return `${name.slice(0, 2)}***@${domain}`;
    }

    return (
      `${identity.identifier.slice(0, 3)}` +
      `******` +
      `${identity.identifier.slice(-4)}`
    );
  }

  isInternalMobileEmail(email) {
    return String(email || "")
      .toLowerCase()
      .endsWith("@mobile.samglobal.local");
  }

  makeMobileOnlyInternalEmail(mobile) {
    const digits =
      String(mobile || "").replace(/\D/g, "");

    /*
     * Your current refresh-token flow searches users by
     * token email. Mobile-only accounts therefore receive
     * a stable internal email.
     */
    return `mobile-${digits}@mobile.samglobal.local`;
  }

  secureOtpMatches(storedOtp, providedOtp) {
    const stored = Buffer.from(
      String(storedOtp || ""),
    );

    const provided = Buffer.from(
      String(providedOtp || ""),
    );

    if (
      !stored.length ||
      stored.length !== provided.length
    ) {
      return false;
    }

    return timingSafeEqual(stored, provided);
  }

  async findBuyerOtpUser(identity) {
    if (identity.channel === "email") {
      return this.authRepository.findUserByEmail(
        identity.email,
      );
    }

    return this.authRepository.findUserByPhone(
      identity.mobile,
    );
  }

  /*
   * SINGLE PUBLIC SERVICE METHOD
   *
   * Without OTP:
   *   request OTP
   *
   * With OTP:
   *   verify and automatically login/register
   */
  async buyerOtpAuth(
    payload = {},
    requestContext = {},
  ) {
    const hasOtp =
      payload.otp !== undefined &&
      payload.otp !== null &&
      String(payload.otp).trim();

    if (hasOtp) {
      return this.verifyBuyerOtpAuth(
        payload,
        requestContext,
      );
    }

    return this.requestBuyerOtpAuth(
      payload,
      requestContext,
    );
  }

  /*
   * PHASE 1: REQUEST OTP
   */
  async requestBuyerOtpAuth(
    payload = {},
    requestContext = {},
  ) {
    const identity =
      this.normalizeBuyerOtpIdentity(payload);

    const keys = this.makeBuyerOtpKeys(identity);

    const existingUser =
      await this.findBuyerOtpUser(identity);

    /*
     * Buyer OTP endpoint must never authenticate seller,
     * admin, influencer or other account types.
     */
    if (
      existingUser &&
      existingUser.role !== ROLES.BUYER
    ) {
      throw new AppError(
        "This identifier cannot be used for buyer login",
        403,
      );
    }

    if (existingUser) {
      await this.assertUserCanAuthenticate(existingUser);
    }

    const cooldownTtl =
      await redis.ttl(keys.cooldownKey);

    if (cooldownTtl > 0) {
      throw new AppError(
        `Please wait ${cooldownTtl} seconds before requesting another OTP`,
        429,
      );
    }

    const profile = {
      firstName:
        String(
          payload.profile?.firstName ||
          payload.firstName ||
          "Customer",
        ).trim() || "Customer",

      lastName: String(
        payload.profile?.lastName ||
        payload.lastName ||
        "",
      ).trim(),
    };

    const referralCode =
      String(payload.referralCode || "").trim() ||
      null;

    if (!existingUser && referralCode) {
      await this.referralService
        .getReferrerByCode(referralCode);
    }

    if (env.auth.otpMode === "disabled") {
      throw new AppError(
        "OTP delivery is disabled by environment configuration",
        503,
      );
    }

    const isStaticOtp =
      env.auth.otpMode === "static" ||
      (identity.channel === "mobile" && !env.apitxt.smsOtpEnabled);

    const otp = String(
      isStaticOtp
        ? env.auth.staticOtp
        : createOtp(),
    );

    const authContext = {
      channel: identity.channel,
      identifier: identity.identifier,

      /*
       * This is stored for logging/debugging only.
       * Verification still checks the database again.
       */
      intendedAction:
        existingUser ? "login" : "register",

      profile,
      referralCode,
      requestedAt: new Date().toISOString(),
    };

    await Promise.all([
      redis.setex(
        keys.otpKey,
        BUYER_OTP_TTL_SECONDS,
        otp,
      ),

      redis.setex(
        keys.contextKey,
        BUYER_OTP_CONTEXT_TTL_SECONDS,
        JSON.stringify(authContext),
      ),

      redis.setex(
        keys.cooldownKey,
        BUYER_OTP_RESEND_SECONDS,
        "1",
      ),

      redis.del(keys.attemptsKey),
    ]);

    let delivery = null;

    try {
      logger.info(
        {
          purpose: BUYER_OTP_PURPOSE,
          channel: identity.channel,
          staticOtp: isStaticOtp,
        },
        "Buyer OTP delivery selected",
      );

      /*
       * Email OTP
       */
      if (
        !isStaticOtp &&
        identity.channel === "email"
      ) {
        const html = otpEmailTemplate({
          firstName:
            existingUser?.profile?.firstName ||
            profile.firstName,

          otp,

          purpose:
            this.getOtpPurposeLabel(
              BUYER_OTP_PURPOSE,
            ),
        });

        delivery = await sendMail({
          to: identity.email,

          subject:
            `OTP for ${this.getOtpPurposeLabel(
              BUYER_OTP_PURPOSE,
            )}`,

          html,
        });
      }

      /*
       * Mobile OTP
       */
      if (
        !isStaticOtp &&
        identity.channel === "mobile"
      ) {
        delivery = await sendSmsOtp({
          mobile: identity.mobile,
          otp,
          purpose: BUYER_OTP_PURPOSE,
        });
      }
    } catch (error) {
      /*
       * Do not leave a valid OTP when delivery failed.
       */
      await Promise.all([
        redis.del(keys.otpKey),
        redis.del(keys.contextKey),
        redis.del(keys.cooldownKey),
        redis.del(keys.attemptsKey),
      ]);

      logger.error(
        {
          err: error,
          purpose: BUYER_OTP_PURPOSE,
          channel: identity.channel,
        },
        "Buyer OTP delivery failed; local OTP state removed",
      );

      throw new AppError(
        "Unable to send OTP. Please try again.",
        502,
      );
    }

    await eventPublisher
      .publish(
        makeEvent(
          DOMAIN_EVENTS.OTP_SENT_V1,
          {
            email:
              identity.channel === "email"
                ? identity.email
                : null,

            phone:
              identity.channel === "mobile"
                ? identity.mobile
                : null,

            channel: identity.channel,
            purpose: BUYER_OTP_PURPOSE,
          },
          {
            source: "auth-module",
          },
        ),
      )
      .catch(() => null);

    logger.info(
      {
        purpose: BUYER_OTP_PURPOSE,
        channel: identity.channel,
        deliveryMode: isStaticOtp
          ? "static"
          : identity.channel === "email"
            ? "email"
            : "sms",
        requestId: delivery?.requestId || null,
        testMode: delivery?.testMode === true,
      },
      "Buyer OTP delivery completed",
    );

    return {
      message: isStaticOtp
        ? "Static OTP ready"
        : "OTP sent successfully",

      nextStep: "verify_otp",
      channel: identity.channel,

      identifier:
        this.maskBuyerOtpIdentifier(identity),

      expiresIn: BUYER_OTP_TTL_SECONDS,
      resendAfter: BUYER_OTP_RESEND_SECONDS,

      deliveryMode: isStaticOtp
        ? "static"
        : identity.channel === "email"
          ? "email"
          : "sms",

      ...(isStaticOtp &&
        env.auth.exposeStaticOtp
        ? { otp }
        : {}),

      ...(delivery?.requestId
        ? {
          requestId: delivery.requestId,
        }
        : {}),
    };
  }

  /*
   * PHASE 2: VERIFY OTP
   *
   * Existing buyer:
   *   login
   *
   * New email/mobile:
   *   register buyer and login
   */
  async verifyBuyerOtpAuth(
    payload = {},
    requestContext = {},
  ) {
    const identity =
      this.normalizeBuyerOtpIdentity(payload);

    const otp =
      String(payload.otp || "").trim();

    if (!/^\d{4,8}$/.test(otp)) {
      throw new AppError(
        "Enter a valid OTP",
        400,
      );
    }

    const keys = this.makeBuyerOtpKeys(identity);

    const [
      storedOtp,
      contextRaw,
    ] = await Promise.all([
      redis.get(keys.otpKey),
      redis.get(keys.contextKey),
    ]);

    if (!storedOtp || !contextRaw) {
      throw new AppError(
        "OTP is invalid or has expired",
        400,
      );
    }

    let authContext;

    try {
      authContext = JSON.parse(contextRaw);
    } catch {
      throw new AppError(
        "OTP session is invalid. Request a new OTP.",
        400,
      );
    }

    if (
      authContext.channel !== identity.channel ||
      authContext.identifier !== identity.identifier
    ) {
      throw new AppError(
        "OTP session does not match the identifier",
        400,
      );
    }

    const attempts =
      await redis.incr(keys.attemptsKey);

    if (attempts === 1) {
      await redis.expire(
        keys.attemptsKey,
        BUYER_OTP_TTL_SECONDS,
      );
    }

    if (attempts > BUYER_OTP_MAX_ATTEMPTS) {
      await Promise.all([
        redis.del(keys.otpKey),
        redis.del(keys.contextKey),
        redis.del(keys.attemptsKey),
        redis.del(keys.cooldownKey),
      ]);

      throw new AppError(
        "Too many invalid OTP attempts. Request a new OTP.",
        429,
      );
    }

    if (
      !this.secureOtpMatches(
        storedOtp,
        otp,
      )
    ) {
      throw new AppError(
        "OTP is invalid or has expired",
        400,
      );
    }

    /*
     * OTP is single-use.
     */
    await Promise.all([
      redis.del(keys.otpKey),
      redis.del(keys.contextKey),
      redis.del(keys.attemptsKey),
      redis.del(keys.cooldownKey),
    ]);

    let user =
      await this.findBuyerOtpUser(identity);

    let authAction = "login";

    if (
      user &&
      user.role !== ROLES.BUYER
    ) {
      throw new AppError(
        "This identifier cannot be used for buyer login",
        403,
      );
    }

    /*
     * REGISTER NEW BUYER
     */
    if (!user) {
      authAction = "register";

      const profile = {
        firstName:
          String(
            authContext.profile?.firstName ||
            "Customer",
          ).trim() || "Customer",

        lastName:
          String(
            authContext.profile?.lastName ||
            "",
          ).trim(),
      };

      const provider =
        identity.channel === "email"
          ? "email_otp"
          : "mobile_otp";

      const userPayload = {
        /*
         * Keep email populated because your current refresh
         * token flow finds users by token email.
         */
        email:
          identity.channel === "email"
            ? identity.email
            : this.makeMobileOnlyInternalEmail(
              identity.mobile,
            ),

        phone:
          identity.channel === "mobile"
            ? identity.mobile
            : "",

        phoneNormalized:
          identity.channel === "mobile"
            ? identity.mobile
            : undefined,

        phoneVerified:
          identity.channel === "mobile",

        passwordHash: undefined,

        role: ROLES.BUYER,
        profile,

        referralCode:
          this.makeReferralCode(
            profile.firstName || "USER",
          ),

        accountStatus: "active",

        emailVerified:
          identity.channel === "email",

        authProviders: [
          {
            provider,
            providerUserId:
              identity.identifier,
          },
        ],

        refreshSessions: [],
      };

      try {
        user =
          await this.authRepository
            .createUser(userPayload);
      } catch (error) {
        /*
         * Handles two simultaneous verification requests.
         */
        if (Number(error?.code) !== 11000) {
          throw error;
        }

        user =
          await this.findBuyerOtpUser(identity);

        if (!user) {
          throw error;
        }

        authAction = "login";
      }

      if (authAction === "register") {
        await Promise.all([
          this.walletService.ensureWallet(
            user.id,
          ),

          this.assignDefaultRbacRole(user),
        ]);

        if (authContext.referralCode) {
          await this.referralService
            .rewardReferral(
              authContext.referralCode,
              user,
            );
        }
      }
    } else {
      /*
       * LOGIN EXISTING BUYER
       */
      await this.assertUserCanAuthenticate(user);

      const updatedUser =
        await this.authRepository
          .markOtpIdentityVerified(
            user.id,
            {
              channel: identity.channel,
              email: identity.email,
              mobile: identity.mobile,
            },
          );

      user = updatedUser || user;
    }

    await this.authRepository.updateLastLogin(
      user.id,
      new Date(),
    );

    const tokenProvider =
      identity.channel === "email"
        ? "buyer-email-otp"
        : "buyer-mobile-otp";

    const result = await this.issueTokens(
      user,
      requestContext,
      tokenProvider,
    );

    return {
      ...result,

      otpAuth: {
        action: authAction,
        channel: identity.channel,

        identifier:
          this.maskBuyerOtpIdentifier(identity),

        verified: true,
      },
    };
  }
  async sendOtp(payload, requestContext = {}) {
    const { email, mobile, purpose = "registration" } = payload;

    const existingUser = await this.authRepository.findUserByEmail(email);
    if (purpose === "registration" && existingUser) {
      throw new AppError("Customer email already exists. Please login or use another email.", 409);
    }
    const mobileNumber = String(mobile || existingUser?.phone || "").trim();
    if (purpose === "registration" && mobileNumber) {
      const existingByPhone = await this.authRepository.findUserByPhone(mobileNumber);
      if (existingByPhone) {
        throw new AppError("Customer phone number already exists. Please login or use another phone number.", 409);
      }
    }
    if (purpose === "forgot_password" && !existingUser) {
      throw new AppError("User not found", 404);
    }
    if (purpose === "login") {
      if (!existingUser) {
        throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
      }
      if (!this.isSellerRole(existingUser.role)) {
        throw new AppError("OTP login is only available for seller accounts", 403);
      }
      await this.assertUserCanAuthenticate(existingUser, { allowSellerOnboarding: true });
    }
    if (env.auth.otpMode === "disabled") {
      throw new AppError(
        env.auth.liveOtpRequested
          ? "OTP email delivery is not configured. Please configure live email or disable live OTP for testing."
          : "OTP delivery is disabled by environment configuration.",
        503,
      );
    }

    const isStaticOtp = env.auth.otpMode === "static" || (mobileNumber && !env.apitxt.smsOtpEnabled);
    const otp = isStaticOtp ? env.auth.staticOtp : createOtp();
    const otpKey = this.makeOtpKey(email, purpose);

    // Store OTP in Redis with 10 minute expiration
    await redis.setex(otpKey, 600, otp);

    let delivery = null;
    let deliveryMode = isStaticOtp ? "static" : "third_party_email";

    logger.info(
      {
        purpose,
        staticOtp: isStaticOtp,
        hasMobile: Boolean(mobileNumber),
      },
      "Auth OTP generated and stored locally",
    );

    if (!isStaticOtp && mobileNumber) {
      logger.info(
        {
          purpose,
          deliveryMode: "third_party_sms",
        },
        "Auth OTP delivery selected",
      );

      delivery = await sendSmsOtp({
        mobile: mobileNumber,
        otp,
        purpose,
      });
      deliveryMode = delivery?.skipped ? "static_sms" : "third_party_sms";
    } else {
      logger.info(
        {
          purpose,
          deliveryMode: isStaticOtp ? "static" : "third_party_email",
        },
        "Auth OTP delivery selected",
      );

      const html = otpEmailTemplate({
        firstName: existingUser?.profile?.firstName || "User",
        otp,
        purpose: this.getOtpPurposeLabel(purpose),
      });
      delivery = await sendMail({
        to: email,
        subject: `OTP for ${this.getOtpPurposeLabel(purpose)}`,
        html,
      });
    }

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.OTP_SENT_V1,
        {
          email,
          phone: mobileNumber || null,
          purpose,
        },
        {
          source: "auth-module",
        },
      ),
    );

    logger.info(
      {
        purpose,
        deliveryMode,
        requestId: delivery?.requestId || null,
        testMode: delivery?.testMode === true,
      },
      "Auth OTP delivery completed",
    );

    return {
      message: isStaticOtp ? "Static OTP ready" : "OTP sent successfully",
      deliveryMode,
      ...(isStaticOtp && env.auth.exposeStaticOtp ? { otp } : {}),
      ...(delivery?.requestId ? { requestId: delivery.requestId } : {}),
      ...(delivery?.testMode ? { testMode: true } : {}),
    };
  }

  async verifyOtp(payload, requestContext = {}) {
    const { email, otp, purpose = "registration", consumeOtp } = payload;
    const otpKey = this.makeOtpKey(email, purpose);
    const verifiedOtpKey = this.makeVerifiedOtpKey(email, purpose);

    const storedOtp = await redis.get(otpKey);
    if (!storedOtp || storedOtp !== otp) {
      throw new AppError("Invalid or expired OTP", 400);
    }

    const shouldConsumeOtp =
      typeof consumeOtp === "boolean" ? consumeOtp : purpose !== "forgot_password";
    if (["forgot_password", "influencer_forgot_password"].includes(purpose)) {
      await redis.setex(verifiedOtpKey, 600, otp);
    }
    if (shouldConsumeOtp) {
      await redis.del(otpKey);
    }

    if (purpose === "login") {
      const user = await this.authRepository.findUserByEmail(email);
      if (!user) {
        throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
      }
      if (!this.isSellerRole(user.role)) {
        throw new AppError("OTP login is only available for seller accounts", 403);
      }
      await this.assertUserCanAuthenticate(user, { allowSellerOnboarding: true });
      const sellerFlowState = await this.getSellerLoginFlowState(user);
      if (sellerFlowState?.requiresOnboarding) {
        return this.makeOnboardingResponse(user);
      }
      if (user.accountStatus !== "active" && !sellerFlowState?.hasApprovedOrganization) {
        throw new AppError("Account is not active. Please complete onboarding or contact support.", 403);
      }

      await this.authRepository.updateLastLogin(user.id, new Date());
      return this.issueTokens(user, requestContext, "otp");
    }

    return { message: "OTP verified successfully" };
  }

  async resendOtp(payload, requestContext = {}) {
    // Resend is same as send, but we'll check if there's already an OTP
    return this.sendOtp(payload, requestContext);
  }

  async forgotPassword(payload, requestContext = {}) {
    const { email } = payload;
    return this.sendOtp({ email, purpose: "influencer_forgot_password" }, requestContext);
  }

  async influencerForgotPassword(payload, requestContext = {}) {
    const email = this.normalizeOtpEmail(payload.email);
    const account = await this.referralService.referralRepository.findInfluencerAccountByEmail(email);
    if (!account || account.accountStatus !== "active") {
      throw new AppError("No active influencer account was found for this email", 404);
    }
    return this.sendOtp(
      { email, purpose: "influencer_forgot_password" },
      requestContext,
    );
  }

  async influencerVerifyResetOtp(payload, requestContext = {}) {
    const email = this.normalizeOtpEmail(payload.email);
    const account = await this.referralService.referralRepository.findInfluencerAccountByEmail(email);
    if (!account) throw new AppError("Influencer account not found", 404);
    return this.verifyOtp({ email, otp: payload.otp, purpose: "influencer_forgot_password", consumeOtp: false }, requestContext);
  }

  async influencerResetPassword(payload) {
    const email = this.normalizeOtpEmail(payload.email);
    await this.ensureForgotPasswordOtpVerified(email, payload.otp, "influencer_forgot_password");
    const account = await this.referralService.referralRepository.findInfluencerAccountByEmail(email);
    if (!account || account.accountStatus !== "active") {
      throw new AppError("Influencer account not found or inactive", 404);
    }
    const passwordHash = await hashText(payload.newPassword);
    await this.referralService.referralRepository.updateInfluencerAccount(account.id, {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
        refreshSessions: [],
      },
      $inc: { tokenVersion: 1, sessionVersion: 1 },
    });
    await redis.del(this.makeOtpKey(email, "influencer_forgot_password"));
    await redis.del(this.makeVerifiedOtpKey(email, "influencer_forgot_password"));
    return { message: "Influencer password reset successfully" };
  }

  async resetPassword(payload, requestContext = {}) {
    const { email, otp, newPassword } = payload;

    // First verify OTP
    await this.ensureForgotPasswordOtpVerified(email, otp);

    // Update password
    const passwordHash = await hashText(newPassword);
    const user = await this.authRepository.findUserByEmail(email);
    if (!user) {
      throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
    }
    await this.assertUserCanAuthenticate(user);

    await this.authRepository.updatePassword(user.id, passwordHash);
    await redis.del(this.makeOtpKey(email, "forgot_password"));
    await redis.del(this.makeVerifiedOtpKey(email, "forgot_password"));

    return { message: "Password reset successfully" };
  }

  async ensureForgotPasswordOtpVerified(email, otp, purpose = "forgot_password") {
    const otpKey = this.makeOtpKey(email, purpose);
    const verifiedOtpKey = this.makeVerifiedOtpKey(email, purpose);
    const [storedOtp, verifiedOtp] = await Promise.all([
      redis.get(otpKey),
      redis.get(verifiedOtpKey),
    ]);

    if (storedOtp === otp || verifiedOtp === otp) {
      return true;
    }

    throw new AppError("Invalid or expired OTP", 400);
  }

  async changePassword(payload, requestContext = {}) {
    const { userId, currentPassword, newPassword } = payload;

    const user = await this.authRepository.findUserWithPasswordById(userId);
    if (!user) {
      throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
    }
    await this.assertUserCanAuthenticate(user);

    if (!user.passwordHash) {
      throw new AppError("Password login not enabled", 400);
    }

    const isMatch = await checkHash(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError("Current password is incorrect", 400);
    }

    const passwordHash = await hashText(newPassword);
    await this.authRepository.updatePassword(user.id, passwordHash);

    return { message: "Password changed successfully" };
  }

  async refreshToken(refreshToken, requestContext = {}) {
    if (!refreshToken) {
      throw new AppError("Refresh token is required", 400);
    }

    let payload;

    try {
      payload = readRefreshToken(refreshToken);
    } catch (error) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
        provider: "session",
        ...requestContext,
        metadata: { reason: "invalid_signature_or_expired" },
      });
      throw authError(
        error?.name === "TokenExpiredError"
          ? AUTH_ERROR_CODES.TOKEN_EXPIRED
          : AUTH_ERROR_CODES.TOKEN_INVALID,
        401,
      );
    }

    if (payload.role === ROLES.INFLUENCER || payload.authScope === "referral") {
      const account = await this.referralService.getInfluencerAccountForSession(payload.sub);
      if (!account) {
        await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
          email: payload.email,
          provider: "influencer-session",
          ...requestContext,
          metadata: { reason: "influencer_account_not_found", role: ROLES.INFLUENCER },
        });
        throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
      }
      const sessionError = getSessionAuthError(account, payload);
      if (sessionError) {
        throw sessionError;
      }
      const currentSession = (account.refreshSessions || []).find(
        (session) => session.sessionId === payload.sessionId,
      );
      if (!currentSession) {
        await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
          userId: account.id,
          email: account.email,
          provider: "influencer-session",
          ...requestContext,
          metadata: { reason: "session_not_found", role: ROLES.INFLUENCER },
        });
        throw authError(AUTH_ERROR_CODES.SESSION_INVALID, 401);
      }
      const tokenValid = await checkHash(refreshToken, currentSession.tokenHash);
      if (!tokenValid) {
        await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
          userId: account.id,
          email: account.email,
          provider: "influencer-session",
          ...requestContext,
          metadata: { reason: "token_hash_mismatch", role: ROLES.INFLUENCER },
        });
        throw authError(AUTH_ERROR_CODES.SESSION_INVALID, 401);
      }

      const result = await this.issueInfluencerTokens(
        account,
        requestContext,
        currentSession.provider || "influencer-session",
        SECURITY_EVENTS.AUTH_REFRESH_SUCCESS,
        currentSession.sessionId,
      );
      return {
        ...result,
        influencer: await this.referralService.getInfluencerSessionByUserId(account.id),
      };
    }

    const user = await this.authRepository.findUserByEmail(payload.email);
    if (!user) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
        email: payload.email,
        provider: "session",
        ...requestContext,
        metadata: { reason: "user_not_found" },
      });
      throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
    }

    await this.assertUserCanAuthenticate(user, { allowSellerOnboarding: true });

    const sessionError = getSessionAuthError(user, payload);
    if (sessionError) {
      throw sessionError;
    }

    // Look up by sessionId first (bcrypt truncates at 72 bytes, making hash-only
    // lookup unreliable for JWTs — all tokens from the same user share the same
    // first ~72 chars, so bcrypt.compare would return true for any session).
    const currentSession = (user.refreshSessions || []).find(
      (s) => s.sessionId === payload.sessionId,
    );
    if (!currentSession) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "session",
        ...requestContext,
        metadata: { reason: "session_not_found" },
      });
      throw authError(AUTH_ERROR_CODES.SESSION_INVALID, 401);
    }
    // Verify the hash as a secondary integrity check.
    const tokenValid = await checkHash(refreshToken, currentSession.tokenHash);
    if (!tokenValid) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "session",
        ...requestContext,
        metadata: { reason: "token_hash_mismatch" },
      });
      throw authError(AUTH_ERROR_CODES.SESSION_INVALID, 401);
    }

    const sellerFlowState = await this.getSellerLoginFlowState(user);
    if (sellerFlowState?.requiresOnboarding) {
      return this.makeOnboardingResponse(user);
    }

    return this.issueTokens(
      user,
      requestContext,
      currentSession.provider || "session",
      SECURITY_EVENTS.AUTH_REFRESH_SUCCESS,
      currentSession.sessionId,
    );
  }

  async issueTokens(
    user,
    requestContext = {},
    provider = "password",
    successEventType = SECURITY_EVENTS.AUTH_LOGIN_SUCCESS,
    replacedSessionId = null,
  ) {
    const accessSummary = await this.rbacService
      .getUserEffectivePermissionSummary(String(user.id))
      .catch(() => null);
    const tokenPayload = await this.makeTokenPayload(user, accessSummary);

    const accessToken = makeAccessToken(tokenPayload);
    const refreshToken = makeRefreshToken(tokenPayload);
    const refreshPayload = readRefreshToken(refreshToken);
    const tokenHash = await hashText(refreshToken);
    const refreshSessions = (user.refreshSessions || [])
      .filter((session) => session.sessionId !== replacedSessionId)
      .slice(-4);

    refreshSessions.push({
      sessionId: refreshPayload.sessionId,
      tokenHash,
      provider,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      platform: requestContext.platform,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    });

    await this.authRepository.updateRefreshSessions(user.id, refreshSessions);
    await this.recordSecurityEvent(successEventType, "success", {
      userId: user.id,
      email: user.email,
      provider,
      ...requestContext,
      metadata: { role: user.role },
    });

    return {
      user: this.sanitizeAuthUser(user, accessSummary),
      tokens: {
        accessToken,
        refreshToken,
      },
      flowState: await this.getAuthStatus(user.id),
      permissions: accessSummary,
    };
  }

  async findMatchingRefreshSession(refreshSessions, refreshToken) {
    for (const session of refreshSessions) {
      const matches = await checkHash(refreshToken, session.tokenHash);
      if (matches) {
        return session;
      }
    }

    return null;
  }

  async recordSecurityEvent(eventType, outcome, payload) {
    try {
      await securityEventService.record({
        eventType,
        outcome,
        userId: payload.userId || null,
        email: payload.email || null,
        provider: payload.provider || null,
        ipAddress: payload.ipAddress || null,
        userAgent: payload.userAgent || null,
        requestId: payload.requestId || null,
        platform: payload.platform || null,
        metadata: payload.metadata || {},
      });
    } catch (error) {
      return null;
    }
  }

  makeReferralCode(seed) {
    const cleanSeed = (seed || "user").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "USER";
    const randomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${cleanSeed}${randomCode}`;
  }
}

module.exports = { AuthService };
