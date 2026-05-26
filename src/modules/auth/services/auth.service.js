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
const {
  SELLER_ONBOARDING_STATUS,
  makeSellerOnboardingChecklist,
  makeSellerOnboardingState,
  getSellerKycStatus,
  hasCompleteSellerBankDetails: hasCompleteSellerBankDetailsForOnboarding,
  hasCompleteSellerProfile: hasCompleteSellerProfileForOnboarding,
  getSellerOnboardingStatus,
} = require("../../../shared/domain/seller-onboarding");
const {
  AUTH_ERROR_CODES,
  authError,
  getSessionAuthError,
  getStatusAuthError,
  normalizeAccountStatus,
} = require("../../../shared/auth/session-state");

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
      login: "Seller Login",
    };
    return labels[purpose] || "Verification";
  }

  normalizeOtpEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  makeOtpKey(email, purpose) {
    return `otp:${this.normalizeOtpEmail(email)}:${purpose}`;
  }

  makeVerifiedOtpKey(email, purpose) {
    return `otp_verified:${this.normalizeOtpEmail(email)}:${purpose}`;
  }

  makeInitialSellerProfile(payload = {}) {
    const profileName = [payload.profile?.firstName, payload.profile?.lastName]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");

    return {
      displayName: profileName,
      supportEmail: payload.email,
      supportPhone: payload.phone,
      onboardingStatus: SELLER_ONBOARDING_STATUS.INITIATED,
    };
  }

  isSellerOnboardingComplete(user) {
    if (!user || user.role !== ROLES.SELLER) {
      return true;
    }

    return (
      user?.sellerProfile?.onboardingStatus === SELLER_ONBOARDING_STATUS.READY_FOR_GO_LIVE &&
      user?.sellerProfile?.bankVerificationStatus === "verified" &&
      user?.sellerProfile?.goLiveStatus === "live" &&
      user?.accountStatus === "active"
    );
  }

  async getSellerLoginFlowState(user) {
    if (!user || user.role !== ROLES.SELLER) {
      return null;
    }

    return this.getAuthStatus(user.id);
  }

  hasCompleteSellerProfile(sellerProfile = {}) {
    return hasCompleteSellerProfileForOnboarding(sellerProfile);
  }

  hasCompleteSellerBankDetails(bankDetails = {}) {
    return hasCompleteSellerBankDetailsForOnboarding(bankDetails);
  }

  makeSellerChecklist(user, kyc) {
    return makeSellerOnboardingChecklist({
      sellerProfile: user?.sellerProfile || {},
      user,
      kyc,
    });
  }

  getSellerAuthStatus(user, checklist, kycStatus) {
    return getSellerOnboardingStatus(
      checklist,
      kycStatus,
      user?.sellerProfile?.onboardingStatus,
    );
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
      user: { id: user.id, email: user.email, role: user.role },
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

    if (user.role === ROLES.SUPER_ADMIN) {
      payload.isSuperAdmin = true;
    }

    try {
      const superAdminRecord = await this.rbacService.getSuperAdminByUserId(user.id);
      if (superAdminRecord) {
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

  async register(payload, requestContext = {}) {
    this.validateSelfSignupRole(payload.role);
    await this.referralService.getReferrerByCode(payload.referralCode);
    const existingUser = await this.authRepository.findUserByEmail(payload.email);
    if (existingUser) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_LOGIN_FAILED, "failed", {
        email: payload.email,
        provider: "password",
        ...requestContext,
        metadata: { reason: "duplicate_account" },
      });
      throw new AppError("User already exists", 409);
    }

    const passwordHash = await hashText(payload.password);
    const isSeller = payload.role === ROLES.SELLER;
    const user = await this.authRepository.createUser({
      email: payload.email,
      phone: payload.phone,
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
      return this.makeOnboardingResponse(user);
    }

    return this.issueTokens(user, requestContext, "password");
  }

  async registerWithOtp(payload, requestContext = {}) {
    this.validateSelfSignupRole(payload.role);
    await this.referralService.getReferrerByCode(payload.referralCode);
    const existingUser = await this.authRepository.findUserByEmail(payload.email);
    if (existingUser) {
      throw new AppError("User already exists", 409);
    }

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

    return this.sendOtp({ email: payload.email, purpose: "registration" }, requestContext);
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
    await redis.del(regKey);

    // Create user
    const passwordHash = await hashText(registrationData.password);
    const isSeller = registrationData.role === ROLES.SELLER;
    const user = await this.authRepository.createUser({
      email: registrationData.email,
      phone: registrationData.phone,
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
      return this.makeOnboardingResponse(user);
    }

    return this.issueTokens(user, requestContext, "password");
  }

  async getAuthStatus(userId) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
    }

    const isSeller = user.role === ROLES.SELLER;
    let kyc = null;
    if (isSeller) {
      kyc = await this.authRepository.findSellerKycBySellerId(user.id);
    }

    const sellerProfile = isSeller ? this.toPlainObject(user?.sellerProfile || {}) : {};
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
    const sellerOnboardingComplete =
      kycStatus === "verified" &&
      onboardingState?.requirements?.profile?.completed === true &&
      onboardingState?.requirements?.bankDetails?.completed === true &&
      bankVerificationStatus !== "rejected" &&
      user.accountStatus === "active";
    const flowState = {
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
      accountStatus: user.accountStatus || "active",
      requiresOnboarding: isSeller && (user.accountStatus !== "active" || !sellerOnboardingComplete),
      onboardingStatus,
      checklist: onboardingChecklist,
      kycStatus,
      kycRejectionReason: kyc?.rejection_reason || null,
      bankVerificationStatus,
      bankRejectionReason: sellerProfile.bankRejectionReason || null,
      goLiveStatus,
      sellerProfile: isSeller ? sellerProfile : null,
      kyc: isSeller ? this.formatSellerKycForStatus(kyc) : null,
      requirements: onboardingState?.requirements || {},
    };

    return flowState;
  }


  async login(payload, requestContext = {}) {
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

    const sellerFlowState = await this.getSellerLoginFlowState(user);
    if (sellerFlowState?.requiresOnboarding) {
      return this.makeOnboardingResponse(user);
    }

    if (user.accountStatus !== "active") {
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
    return this.issueTokens(user, requestContext, "password");
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

  async sendOtp(payload, requestContext = {}) {
    const { email, purpose = "registration" } = payload;

    const existingUser = await this.authRepository.findUserByEmail(email);
    if (purpose === "registration" && existingUser) {
      throw new AppError("User already exists", 409);
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
    const otp = env.production ? createOtp() : env.auth.staticOtp;
    const otpKey = this.makeOtpKey(email, purpose);

    // Store OTP in Redis with 10 minute expiration
    await redis.setex(otpKey, 600, otp);

    // Send OTP email

    const html = otpEmailTemplate({
      firstName: existingUser?.profile?.firstName || "User",
      otp,
      purpose: this.getOtpPurposeLabel(purpose),
    });
    const delivery = await sendMail({
      to: email,
      subject: `OTP for ${this.getOtpPurposeLabel(purpose)}`,
      html,
    });

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.OTP_SENT_V1,
        {
          email,
          purpose,
        },
        {
          source: "auth-module",
        },
      ),
    );

    return {
      message: env.production ? "OTP sent successfully" : "Static OTP ready",
      deliveryMode: env.production ? "third_party_email" : "static",
      ...(env.production ? {} : { otp, emailDelivery: delivery.response }),
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
    if (purpose === "forgot_password") {
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
      if (user.accountStatus !== "active") {
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
    return this.sendOtp({ email, purpose: "forgot_password" }, requestContext);
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

  async ensureForgotPasswordOtpVerified(email, otp) {
    const otpKey = this.makeOtpKey(email, "forgot_password");
    const verifiedOtpKey = this.makeVerifiedOtpKey(email, "forgot_password");
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

    const currentSession = await this.findMatchingRefreshSession(user.refreshSessions || [], refreshToken);
    if (!currentSession || currentSession.sessionId !== payload.sessionId) {
      await this.recordSecurityEvent(SECURITY_EVENTS.AUTH_REFRESH_FAILED, "failed", {
        userId: user.id,
        email: user.email,
        provider: "session",
        ...requestContext,
        metadata: { reason: "session_not_found" },
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
