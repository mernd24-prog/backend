const { AppError } = require("../../../shared/errors/app-error");
const { AdminRepository } = require("../repositories/admin.repository");
const { ProductService } = require("../../product/services/product.service");
const { TaxService } = require("../../tax/services/tax.service");
const {
  SubscriptionService,
} = require("../../subscription/services/subscription.service");
const { RbacService } = require("../../rbac/services/rbac.service");
const { createQueue } = require("../../../shared/queues/queue-factory");
const { redis } = require("../../../infrastructure/redis/redis-client");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const {
  postgresPool,
} = require("../../../infrastructure/postgres/postgres-client");
const { hashText } = require("../../../shared/tools/hash");
const { ROLES } = require("../../../shared/constants/roles");
const { AuditLogModel } = require("../../../shared/logger/audit-log.model");
const { UserModel } = require("../../user/models/user.model");
const {
  DEFAULT_PLATFORM_MODULES,
  DEFAULT_SELLER_MODULES,
  cleanModuleName,
} = require("../../../shared/auth/module-access");
const {
  makeSellerOnboardingState,
  SELLER_ONBOARDING_STATUS,
  hasCompleteSellerBankDetails,
} = require("../../../shared/domain/seller-onboarding");

class AdminService {
  constructor({
    adminRepository = new AdminRepository(),
    productService = new ProductService(),
    taxService = new TaxService(),
    subscriptionService = new SubscriptionService(),
    rbacService = new RbacService(),
  } = {}) {
    this.adminRepository = adminRepository;
    this.productService = productService;
    this.taxService = taxService;
    this.subscriptionService = subscriptionService;
    this.rbacService = rbacService;
    this.queues = {
      notifications: createQueue("notifications"),
    };
  }

  async getOverview() {
    return this.adminRepository.getOverviewStats();
  }

  inferActivityAction(log = {}) {
    const method = String(log.method || "").toUpperCase();
    const path = String(log.path || "").toLowerCase();
    if (path.includes("/auth/login")) return "login";
    if (path.includes("/logout")) return "logout";
    if (path.includes("approve") || path.includes("approval")) return "approve";
    if (path.includes("reject")) return "reject";
    if (method === "POST") return "create";
    if (method === "PATCH" || method === "PUT") return "update";
    if (method === "DELETE") return "delete";
    return "view";
  }

  inferActivityModule(path = "") {
    const parts = String(path || "").split("?")[0].split("/").filter(Boolean);
    const apiIndex = parts.indexOf("api");
    const first = apiIndex >= 0 ? parts[apiIndex + 1] : parts[0];
    const second = apiIndex >= 0 ? parts[apiIndex + 2] : parts[1];
    const third = apiIndex >= 0 ? parts[apiIndex + 3] : parts[2];

    if (first === "auth") return "auth";
    if (first === "admin") {
      if (second === "access") return "rbac";
      if (second === "referral") return third === "fraud" ? "fraud" : "referral";
      if (second === "cms") return "cms";
      if (second === "dashboard") return "admin";
      if (second === "vendors") return "sellers";
      if (second === "common" || second === "platform") return "platform";
      return second || "admin";
    }
    return cleanModuleName(first || "system");
  }

  formatActivityDescription(log = {}, action, moduleName) {
    const method = String(log.method || "").toUpperCase();
    const status = Number(log.statusCode || 0);
    const result = status >= 400 ? "failed" : "completed";
    return `${action} ${moduleName} ${result} via ${method} ${log.path}`;
  }

  async listActivityLogs({
    page = 1,
    limit = 30,
    search = "",
    action = "",
    module = "",
    statusCode,
    dateFrom,
    dateTo,
  } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
    const filter = {};

    if (search) {
      filter.$or = [
        { path: { $regex: search, $options: "i" } },
        { method: { $regex: search, $options: "i" } },
        { actorId: { $regex: search, $options: "i" } },
        { requestId: { $regex: search, $options: "i" } },
      ];
    }

    if (statusCode) filter.statusCode = Number(statusCode);

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    if (action && action !== "all") {
      const actionFilters = {
        login: { path: /\/auth\/login/i },
        logout: { path: /logout/i },
        create: { method: "POST" },
        update: { method: { $in: ["PATCH", "PUT"] } },
        delete: { method: "DELETE" },
        approve: { path: /approve|approval/i },
        reject: { path: /reject/i },
        view: { method: "GET" },
      };
      Object.assign(filter, actionFilters[action] || {});
    }

    const skip = (safePage - 1) * safeLimit;
    const [items, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      AuditLogModel.countDocuments(filter),
    ]);

    const actorIds = Array.from(new Set(
      items
        .map((item) => item.actorId)
        .filter((actorId) => /^[a-f0-9]{24}$/i.test(String(actorId || ""))),
    ));
    const actors = actorIds.length
      ? await UserModel.find({ _id: { $in: actorIds } })
          .select("email role profile")
          .lean()
      : [];
    const actorMap = new Map(actors.map((actor) => [String(actor._id), actor]));

    const logs = items
      .map((item) => {
        const actor = actorMap.get(String(item.actorId));
        const inferredAction = this.inferActivityAction(item);
        const inferredModule = this.inferActivityModule(item.path);
        return {
          id: String(item._id),
          _id: String(item._id),
          actorId: item.actorId || null,
          actorName: actor
            ? [actor.profile?.firstName, actor.profile?.lastName].filter(Boolean).join(" ") || actor.email
            : item.actorId || "System",
          actorRole: actor?.role || "",
          action: inferredAction,
          module: inferredModule,
          description: this.formatActivityDescription(item, inferredAction, inferredModule),
          method: item.method,
          path: item.path,
          statusCode: item.statusCode,
          ip: item.ip || "",
          userAgent: item.userAgent || "",
          requestId: item.requestId || "",
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      })
      .filter((item) => !module || module === "all" || item.module === module);

    return {
      logs,
      total: module && module !== "all" ? logs.length : total,
      page: safePage,
      limit: safeLimit,
    };
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

  getRecordId(record = {}) {
    return String(record._id || record.id || "");
  }

  sanitizeUserForAdmin(user = {}) {
    const plainUser = this.toPlainObject(user);
    delete plainUser.passwordHash;
    if (Array.isArray(plainUser.refreshSessions)) {
      plainUser.refreshSessions = plainUser.refreshSessions.map((session) => {
        const cleanSession = { ...session };
        delete cleanSession.tokenHash;
        return cleanSession;
      });
    }
    return plainUser;
  }

  async getSellerKycByIdMap(sellerIds = []) {
    const rows = await this.adminRepository.findSellerKycBySellerIds(sellerIds);
    return new Map(rows.map((row) => [String(row.seller_id), row]));
  }

  formatKycDocuments(documents) {
    if (!documents) return {};
    try {
      return typeof documents === "string" ? JSON.parse(documents) : documents;
    } catch {
      return {};
    }
  }

  formatKycForAdmin(kyc) {
    if (!kyc) return null;
    return {
      verificationStatus: kyc.verification_status,
      legalName: kyc.legal_name,
      businessType: kyc.business_type,
      panNumber: kyc.pan_number,
      gstNumber: kyc.gst_number,
      aadhaarNumber: kyc.aadhaar_number,
      rejectionReason: kyc.rejection_reason || null,
      reviewedBy: kyc.reviewed_by || null,
      submittedAt: kyc.submitted_at || null,
      reviewedAt: kyc.reviewed_at || null,
      documents: this.formatKycDocuments(kyc.documents),
    };
  }

  enrichSellerForAdmin(seller, kyc = null) {
    const plainSeller = this.toPlainObject(seller);
    const sellerProfile = this.toPlainObject(plainSeller.sellerProfile || {});
    const onboardingState = makeSellerOnboardingState({
      sellerProfile,
      user: plainSeller,
      kyc,
    });
    const bankVerificationStatus = sellerProfile.bankVerificationStatus || "not_submitted";
    const goLiveStatus =
      plainSeller.accountStatus === "active"
        ? "live"
        : sellerProfile.goLiveStatus || "pending";

    return {
      ...plainSeller,
      sellerProfile: {
        ...sellerProfile,
        kycStatus: onboardingState.kycStatus,
        bankVerificationStatus,
        onboardingChecklist: onboardingState.checklist,
        onboardingStatus: onboardingState.onboardingStatus,
        goLiveStatus,
      },
      onboarding: {
        status: onboardingState.onboardingStatus,
        checklist: onboardingState.checklist,
        kycStatus: onboardingState.kycStatus,
        bankVerificationStatus,
        goLiveStatus,
        kycRejectionReason: kyc?.rejection_reason || null,
        kycSubmittedAt: kyc?.submitted_at || null,
        kycReviewedAt: kyc?.reviewed_at || null,
        requirements: onboardingState.requirements,
      },
      kyc: this.formatKycForAdmin(kyc),
    };
  }

  async getSellerKyc(sellerId) {
    const seller = await this.adminRepository.getUserById(sellerId);
    if (!seller || seller.role !== ROLES.SELLER) {
      throw new AppError("Seller not found", 404);
    }
    const kyc = await this.adminRepository.getSellerKycById(sellerId);
    return {
      sellerId,
      kyc: this.formatKycForAdmin(kyc),
    };
  }

  async enrichSellersForAdmin(items = []) {
    const plainItems = items.map((item) => this.toPlainObject(item));
    const sellerIds = plainItems
      .filter((item) => item.role === ROLES.SELLER || !item.role)
      .map((item) => this.getRecordId(item))
      .filter(Boolean);
    const kycBySellerId = await this.getSellerKycByIdMap(sellerIds);

    return plainItems.map((item) => {
      if (item.role && item.role !== ROLES.SELLER) {
        return item;
      }
      return this.enrichSellerForAdmin(
        item,
        kycBySellerId.get(this.getRecordId(item)) || null,
      );
    });
  }

  async listVendors(query) {
    const result = await this.adminRepository.listVendors(query);
    return {
      ...result,
      items: await this.enrichSellersForAdmin(result.items),
    };
  }

  async listUsers(query) {
    const result = await this.adminRepository.listUsers(query);
    return {
      ...result,
      items: await this.enrichSellersForAdmin(result.items),
    };
  }

  async createUser(payload, actor = {}) {
    const existing = await this.adminRepository.findUserByEmail(payload.email);
    if (existing) {
      throw new AppError("User already exists", 409);
    }

    const role = payload.role || ROLES.BUYER;
    const isSeller = role === ROLES.SELLER;
    const passwordHash = await hashText(payload.password);
    const user = await this.adminRepository.createManagedUser({
      email: payload.email,
      phone: payload.phone,
      passwordHash,
      role,
      profile: payload.profile,
      accountStatus:
        payload.accountStatus || (isSeller ? "pending_approval" : "active"),
      ...(isSeller
        ? {
            sellerProfile: {
              displayName:
                payload.sellerProfile?.displayName ||
                payload.profile?.firstName ||
                "",
              legalBusinessName:
                payload.sellerProfile?.legalBusinessName ||
                payload.sellerProfile?.displayName ||
                "",
              description: payload.sellerProfile?.description || "",
              supportEmail: payload.sellerProfile?.supportEmail || payload.email,
              supportPhone: payload.sellerProfile?.supportPhone || payload.phone,
              businessType: payload.sellerProfile?.businessType || "",
              registrationNumber:
                payload.sellerProfile?.registrationNumber || "",
              gstNumber: payload.sellerProfile?.gstNumber || "",
              panNumber: payload.sellerProfile?.panNumber || "",
              onboardingStatus: "initiated",
            },
          }
        : {}),
      emailVerified: true,
      authProviders: [],
      refreshSessions: [],
      allowedModules: [],
    });

    await this.rbacService.assignRoleToUserBySlug(
      String(user.id),
      role,
      actor.userId,
      {
        ignoreMissing: true,
        ignoreExisting: true,
      },
    );

    return this.sanitizeUserForAdmin(user);
  }

  async getUser(userId) {
    const user = await this.adminRepository.getUserById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    if (user.role === ROLES.SELLER) {
      const kycBySellerId = await this.getSellerKycByIdMap([userId]);
      return this.enrichSellerForAdmin(
        user,
        kycBySellerId.get(String(userId)) || null,
      );
    }
    return user;
  }

  async updateUser(userId, payload) {
    const existingUser = await this.adminRepository.getUserById(userId);
    if (!existingUser) {
      throw new AppError("User not found", 404);
    }
    const nextPayload = { ...payload };
    let kyc = null;

    if (existingUser.role === ROLES.SELLER) {
      kyc = await this.adminRepository.getSellerKycById(userId);
      if (payload.sellerProfile) {
        const nextSellerProfileBase = {
          ...this.toPlainObject(existingUser.sellerProfile || {}),
          ...payload.sellerProfile,
        };
        const onboardingState = makeSellerOnboardingState({
          sellerProfile: nextSellerProfileBase,
          user: { ...this.toPlainObject(existingUser), sellerProfile: nextSellerProfileBase },
          kyc,
        });
        nextPayload.sellerProfile = {
          ...nextSellerProfileBase,
          kycStatus: onboardingState.kycStatus,
          onboardingChecklist: onboardingState.checklist,
          onboardingStatus: onboardingState.onboardingStatus,
        };
      }
    }

    const user = await this.adminRepository.updateUserById(userId, nextPayload);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    if (user.role === ROLES.SELLER) {
      return this.enrichSellerForAdmin(user, kyc);
    }
    return user;
  }

  async deactivateUser(userId, payload) {
    const user = await this.adminRepository.deactivateUserById(
      userId,
      payload?.reason || null,
    );
    if (!user) {
      throw new AppError("User not found", 404);
    }
    return user;
  }

  async updateVendorStatus(sellerId, payload) {
    const currentSeller = await this.adminRepository.getUserById(sellerId);
    if (!currentSeller || currentSeller.role !== ROLES.SELLER) {
      throw new AppError("Seller not found", 404);
    }

    const requestedAccountStatus = payload.accountStatus || payload.status;
    const kycBySellerId = await this.getSellerKycByIdMap([sellerId]);
    const kyc = kycBySellerId.get(String(sellerId)) || null;
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: currentSeller.sellerProfile || {},
      user: currentSeller,
      kyc,
    });

    const seller = await this.adminRepository.updateVendorStatus(sellerId, {
      accountStatus: requestedAccountStatus,
      onboardingStatus: onboardingState.onboardingStatus,
    });
    if (!seller) {
      throw new AppError("Seller not found", 404);
    }
    return this.enrichSellerForAdmin(seller, kyc);
  }

  async getSeller(sellerId) {
    const user = await this.adminRepository.getUserById(sellerId);
    if (!user || user.role !== ROLES.SELLER) {
      throw new AppError("Seller not found", 404);
    }
    const kycBySellerId = await this.getSellerKycByIdMap([sellerId]);
    return this.enrichSellerForAdmin(user, kycBySellerId.get(String(sellerId)) || null);
  }

  async updateSellerKycStatus(sellerId, payload, actor = {}) {
    if (payload.kycStatus === "rejected" && !payload.rejectionReason) {
      throw new AppError("Rejection reason is required when KYC is rejected", 400);
    }
    const seller = await this.adminRepository.getUserById(sellerId);
    if (!seller || seller.role !== ROLES.SELLER) {
      throw new AppError("Seller not found", 404);
    }

    const reviewedKyc = await this.adminRepository.reviewSellerKycByAdmin(sellerId, {
      ...payload,
      reviewedBy: actor.userId || null,
    });

    const currentSellerProfile = this.toPlainObject(seller.sellerProfile || {});
    const nextSellerProfileBase = {
      ...currentSellerProfile,
      kycStatus: payload.kycStatus,
      rejectionReason: payload.kycStatus === "rejected" ? payload.rejectionReason || null : null,
      verifiedBy: payload.kycStatus === "verified" ? actor.userId || null : null,
      verifiedAt: payload.kycStatus === "verified" ? new Date() : null,
    };
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: nextSellerProfileBase,
      user: seller,
      kyc: reviewedKyc || {
        verification_status: payload.kycStatus,
        rejection_reason: payload.rejectionReason || null,
      },
    });
    const nextSellerProfile = {
      ...nextSellerProfileBase,
      onboardingChecklist: onboardingState.checklist,
      onboardingStatus: onboardingState.onboardingStatus,
    };
    await this.adminRepository.updateUserById(sellerId, { sellerProfile: nextSellerProfile });
    return this.getSeller(sellerId);
  }

  async updateSellerBankStatus(sellerId, payload, actor = {}) {
    if (payload.bankVerificationStatus === "rejected" && !payload.bankRejectionReason) {
      throw new AppError("Bank rejection reason is required when bank verification is rejected", 400);
    }
    const seller = await this.adminRepository.getUserById(sellerId);
    if (!seller || seller.role !== ROLES.SELLER) {
      throw new AppError("Seller not found", 404);
    }
    if (
      payload.bankVerificationStatus === "verified" &&
      !hasCompleteSellerBankDetails(seller?.sellerProfile?.bankDetails || {})
    ) {
      throw new AppError("Bank details must be submitted before bank can be verified", 400, {
        missingFields: makeSellerOnboardingState({
          sellerProfile: seller.sellerProfile || {},
          user: seller,
          kyc: null,
        }).requirements.bankDetails.missingFields,
      });
    }
    const kycBySellerId = await this.getSellerKycByIdMap([sellerId]);
    const kyc = kycBySellerId.get(String(sellerId)) || null;
    const currentSellerProfile = this.toPlainObject(seller.sellerProfile || {});
    const nextSellerProfileBase = {
      ...currentSellerProfile,
      bankVerificationStatus: payload.bankVerificationStatus,
      bankRejectionReason:
        payload.bankVerificationStatus === "rejected" ? payload.bankRejectionReason || null : null,
      verifiedBy: payload.bankVerificationStatus === "verified" ? actor.userId || null : currentSellerProfile.verifiedBy || null,
      verifiedAt: payload.bankVerificationStatus === "verified" ? new Date() : currentSellerProfile.verifiedAt || null,
    };
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: nextSellerProfileBase,
      user: seller,
      kyc,
    });
    const readyForGoLive =
      payload.bankVerificationStatus === "verified" &&
      onboardingState.kycStatus === "verified" &&
      onboardingState.requirements.profile.completed === true &&
      onboardingState.requirements.bankDetails.completed === true;
    const nextSellerProfile = {
      ...nextSellerProfileBase,
      onboardingChecklist: onboardingState.checklist,
      onboardingStatus: readyForGoLive
        ? SELLER_ONBOARDING_STATUS.READY_FOR_GO_LIVE
        : onboardingState.onboardingStatus,
      goLiveStatus:
        payload.bankVerificationStatus === "rejected"
          ? "pending"
          : currentSellerProfile.goLiveStatus || "pending",
      goLiveApprovedBy: currentSellerProfile.goLiveApprovedBy || null,
      goLiveApprovedAt: currentSellerProfile.goLiveApprovedAt || null,
    };
    await this.adminRepository.updateUserById(sellerId, {
      sellerProfile: nextSellerProfile,
      ...(payload.bankVerificationStatus === "rejected"
        ? { accountStatus: "pending_approval" }
        : {}),
    });
    return this.getSeller(sellerId);
  }

  async updateSellerOnboardingStatus(sellerId, payload) {
    const seller = await this.adminRepository.getUserById(sellerId);
    if (!seller || seller.role !== ROLES.SELLER) {
      throw new AppError("Seller not found", 404);
    }
    const nextSellerProfile = {
      ...(seller.sellerProfile || {}),
      onboardingStatus: payload.onboardingStatus,
    };
    await this.adminRepository.updateUserById(sellerId, { sellerProfile: nextSellerProfile });
    return this.getSeller(sellerId);
  }

  async updateSellerGoLiveStatus(sellerId, payload, actor = {}) {
    const seller = await this.adminRepository.getUserById(sellerId);
    if (!seller || seller.role !== ROLES.SELLER) {
      throw new AppError("Seller not found", 404);
    }
    const profile = this.toPlainObject(seller.sellerProfile || {});
    const kyc = await this.adminRepository.getSellerKycById(sellerId);
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: profile,
      user: seller,
      kyc,
    });
    const kycStatus = onboardingState.kycStatus;
    const bankVerificationStatus = profile.bankVerificationStatus || "not_submitted";
    const accountStatus = seller.accountStatus;
    const bankDetailsComplete = onboardingState.requirements.bankDetails.completed === true;
    const profileCompleted =
      profile.profileCompleted === true ||
      profile.onboardingChecklist?.profileCompleted === true ||
      onboardingState.requirements.profile.completed === true ||
      Boolean(profile.displayName && profile.legalBusinessName && profile.supportEmail && profile.supportPhone);
    const bankReady =
      bankVerificationStatus === "verified" ||
      (bankVerificationStatus === "submitted" && bankDetailsComplete);
    const canGoLive =
      kycStatus === "verified" &&
      bankReady &&
      profileCompleted;

    if (payload.goLiveStatus === "live" && !canGoLive) {
      throw new AppError(
        "Seller can go live only when KYC and bank are verified, and profile is completed",
        400,
        {
          kycStatus,
          bankVerificationStatus,
          profileCompleted,
          accountStatus,
          onboardingStatus: onboardingState.onboardingStatus,
          missingBankFields: onboardingState.requirements.bankDetails.missingFields,
          missingProfileFields: onboardingState.requirements.profile.missingFields,
        },
      );
    }

    const nextSellerProfile = {
      ...profile,
      kycStatus,
      bankVerificationStatus:
        payload.goLiveStatus === "live" && bankReady ? "verified" : bankVerificationStatus,
      bankRejectionReason: payload.goLiveStatus === "live" && bankReady ? null : profile.bankRejectionReason || null,
      onboardingChecklist: onboardingState.checklist,
      onboardingStatus:
        payload.goLiveStatus === "live"
          ? SELLER_ONBOARDING_STATUS.READY_FOR_GO_LIVE
          : onboardingState.onboardingStatus,
      goLiveStatus: payload.goLiveStatus,
      verifiedBy:
        payload.goLiveStatus === "live" && bankReady
          ? actor.userId || profile.verifiedBy || null
          : profile.verifiedBy || null,
      verifiedAt:
        payload.goLiveStatus === "live" && bankReady
          ? profile.verifiedAt || new Date()
          : profile.verifiedAt || null,
      goLiveApprovedBy: payload.goLiveStatus === "live" ? actor.userId || null : null,
      goLiveApprovedAt: payload.goLiveStatus === "live" ? new Date() : null,
    };
    await this.adminRepository.updateUserById(sellerId, {
      sellerProfile: nextSellerProfile,
      ...(payload.goLiveStatus === "live" ? { accountStatus: "active" } : {}),
    });
    return this.getSeller(sellerId);
  }

  async listProductModerationQueue(query) {
    return this.adminRepository.listProductsForModeration(query);
  }

  async moderateProduct(productId, payload, actor) {
    return this.productService.reviewProduct(productId, payload, actor);
  }

  async listOrders(query) {
    return this.adminRepository.listOrders({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async listPayments(query) {
    return this.adminRepository.listPayments({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async createPayout(payload) {
    const grossAmount = Number(payload.grossAmount);
    const commissionAmount = Number(payload.commissionAmount || 0);
    const processingFeeAmount = Number(payload.processingFeeAmount || 0);
    const taxWithheldAmount = Number(payload.taxWithheldAmount || 0);
    const netPayoutAmount = Number(
      payload.netPayoutAmount ??
        (
          grossAmount -
          commissionAmount -
          processingFeeAmount -
          taxWithheldAmount
        ).toFixed(2),
    );

    return this.adminRepository.createPayout({
      ...payload,
      grossAmount,
      commissionAmount,
      processingFeeAmount,
      taxWithheldAmount,
      netPayoutAmount,
    });
  }

  async listPayouts(query) {
    return this.adminRepository.listPayouts({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async getTaxReport(query) {
    return this.taxService.getTaxReport(query);
  }

  async createInvoice(orderId) {
    return this.taxService.createInvoice(orderId);
  }

  async createApiKey(payload, actor) {
    return this.adminRepository.createApiKey({
      ownerId: payload.ownerId || actor.userId,
      keyName: payload.keyName,
      scopes: payload.scopes || [],
      expiresAt: payload.expiresAt || null,
    });
  }

  async listApiKeys(query) {
    return this.adminRepository.listApiKeys({
      ownerId: query.ownerId || null,
      status: query.status || null,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async createWebhookSubscription(payload, actor) {
    return this.adminRepository.createWebhookSubscription({
      ownerId: payload.ownerId || actor.userId,
      endpointUrl: payload.endpointUrl,
      secret: payload.secret,
      eventTypes: payload.eventTypes || [],
      retryPolicy: payload.retryPolicy || {},
    });
  }

  async listWebhookSubscriptions(query) {
    return this.adminRepository.listWebhookSubscriptions({
      ownerId: query.ownerId || null,
      status: query.status || null,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async upsertFeatureFlag(payload, actor) {
    return this.adminRepository.upsertFeatureFlag({
      flagKey: payload.flagKey,
      description: payload.description || null,
      enabled: Boolean(payload.enabled),
      rolloutPercentage: Number(payload.rolloutPercentage || 0),
      targetRules: payload.targetRules || {},
      actorId: actor.userId,
    });
  }

  async listFeatureFlags(query) {
    const enabled =
      query.enabled === undefined
        ? null
        : String(query.enabled).toLowerCase() === "true";
    return this.adminRepository.listFeatureFlags({
      enabled,
      limit: Number(query.limit || 100),
      offset: Number(query.offset || 0),
    });
  }

  async getRealtimeAnalytics(query) {
    return this.adminRepository.getRealtimeAnalytics({
      hours: Number(query.hours || 24),
    });
  }

  async getReturnsAnalytics(query) {
    return this.adminRepository.getReturnsAnalytics(query);
  }

  async listChargebacks(query) {
    return this.adminRepository.listChargebacks({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async getSystemHealth() {
    const checks = {
      postgres: { status: "unknown" },
      redis: { status: "unknown" },
      mongo: { status: "unknown" },
    };

    try {
      await postgresPool.query("SELECT 1");
      checks.postgres.status = "ok";
    } catch (error) {
      checks.postgres = { status: "down", error: error.message };
    }

    try {
      const pong = await redis.ping();
      checks.redis.status = pong === "PONG" ? "ok" : "degraded";
    } catch (error) {
      checks.redis = { status: "down", error: error.message };
    }

    checks.mongo = {
      status: mongoose.connection.readyState === 1 ? "ok" : "down",
      readyState: mongoose.connection.readyState,
    };

    const overall = Object.values(checks).every(
      (check) => check.status === "ok",
    )
      ? "ok"
      : "degraded";
    return { overall, checks };
  }

  async getQueueStatus() {
    const entries = await Promise.all(
      Object.entries(this.queues).map(async ([name, queue]) => {
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "completed",
          "failed",
          "delayed",
          "paused",
        );
        return { queue: name, counts };
      }),
    );

    return { queues: entries };
  }

  async pauseQueue(queueName) {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new AppError("Unsupported queue", 404);
    }
    await queue.pause();
    return { queue: queueName, paused: true };
  }

  async resumeQueue(queueName) {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new AppError("Unsupported queue", 404);
    }
    await queue.resume();
    return { queue: queueName, paused: false };
  }

  async listDeadLetterEvents(query) {
    return this.adminRepository.listDeadLetterEvents({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async retryDeadLetterEvent(eventId) {
    const result = await this.adminRepository.retryDeadLetterEvent(eventId);
    if (!result) {
      throw new AppError("Dead letter event not found", 404);
    }
    return result;
  }

  async discardDeadLetterEvent(eventId, payload) {
    const result = await this.adminRepository.discardDeadLetterEvent(
      eventId,
      payload?.reason || null,
    );
    if (!result) {
      throw new AppError("Dead letter event not found", 404);
    }
    return result;
  }

  async createSubscriptionPlan(payload) {
    return this.subscriptionService.createPlan(payload);
  }

  async listSubscriptionPlans(query) {
    return this.subscriptionService.listPlansAdmin(query);
  }

  async getSubscriptionPlan(planId) {
    return this.subscriptionService.getPlan(planId);
  }

  async updateSubscriptionPlan(planId, payload) {
    return this.subscriptionService.updatePlan(planId, payload);
  }

  async deleteSubscriptionPlan(planId) {
    return this.subscriptionService.deletePlan(planId);
  }

  async listPlatformSubscriptions(query) {
    return this.subscriptionService.listSubscriptionsAdmin(query);
  }

  async updatePlatformSubscriptionStatus(subscriptionId, status) {
    return this.subscriptionService.updateSubscriptionStatusAdmin(
      subscriptionId,
      status,
    );
  }

  async createPlatformFeeConfig(payload) {
    return this.subscriptionService.createPlatformFeeConfig(payload);
  }

  async listPlatformFeeConfigs(query) {
    return this.subscriptionService.listPlatformFeeConfigs(query);
  }

  async getPlatformFeeConfig(configId) {
    return this.subscriptionService.getPlatformFeeConfig(configId);
  }

  async updatePlatformFeeConfig(configId, payload) {
    return this.subscriptionService.updatePlatformFeeConfig(configId, payload);
  }

  async deletePlatformFeeConfig(configId) {
    return this.subscriptionService.deletePlatformFeeConfig(configId);
  }

  formatModuleName(moduleName) {
    return String(moduleName || "")
      .split("/")
      .pop()
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  getAssignableModuleSlugs(role) {
    if ([ROLES.SELLER, ROLES.SELLER_SUB_ADMIN].includes(role)) {
      return DEFAULT_SELLER_MODULES;
    }
    if (role === ROLES.BUYER) {
      return [];
    }
    return DEFAULT_PLATFORM_MODULES;
  }

  roleUsesAssignedModules(role) {
    return [ROLES.ADMIN, ROLES.SUB_ADMIN, ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(role);
  }

  roleHasFullModuleAccess(role) {
    return role === ROLES.SUPER_ADMIN;
  }

  getRbacModuleMap(modules = []) {
    const lookup = new Map();
    const aliases = {
      product: "products",
      products: "product",
      user: "users",
      users: "user",
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

  getPermissionAssignmentData(permissions = [], moduleAllowed, forceAssigned) {
    const normalizedPermissions = permissions.map((permission) => ({
      ...permission,
      assigned: moduleAllowed && (forceAssigned || Boolean(permission.assigned)),
    }));
    const actions = [
      "view",
      "create",
      "add",
      "edit",
      "update",
      "delete",
      "approve",
      "approval",
      "reject",
      "assign",
      "export",
      "import",
      "status_change",
      "status",
      "restore",
      "bulk_action",
      "action",
    ];
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

  normalizePermissionAction(action) {
    const aliases = {
      review: "approval",
      manage: "status",
    };
    const normalized = aliases[action] || action;
    const allowed = new Set([
      "view",
      "create",
      "add",
      "edit",
      "update",
      "delete",
      "approve",
      "approval",
      "reject",
      "assign",
      "export",
      "import",
      "status_change",
      "status",
      "restore",
      "bulk_action",
      "action",
    ]);
    return allowed.has(normalized) ? normalized : null;
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
        const actions = Array.from(
          new Set(
            (item.actions || [])
              .map((action) => this.normalizePermissionAction(action))
              .filter(Boolean),
          ),
        );

        if (!moduleName || !allowedModuleSet.has(moduleName)) {
          return null;
        }

        const normalizedActions = actions.length
          ? Array.from(new Set(["view", ...actions]))
          : ["view"];

        return {
          module: moduleName,
          actions: normalizedActions,
        };
      })
      .filter(Boolean);
  }

  async listAccessModules(query = {}) {
    const accessUser = query.userId
      ? this.toPlainObject(await this.adminRepository.getUserById(query.userId))
      : null;
    if (query.userId && !accessUser?._id && !accessUser?.id) {
      throw new AppError("User not found", 404);
    }

    const targetRole =
      accessUser?.role || query.roleSlug || query.role || ROLES.SUB_ADMIN;
    const assignableModuleSlugs = this.getAssignableModuleSlugs(targetRole);
    const roleSlug = query.roleSlug || targetRole;
    const assignedModuleSet = new Set(
      (accessUser?.allowedModules || []).map(cleanModuleName).filter(Boolean),
    );
    const shouldUseAssignedModules =
      Boolean(accessUser) &&
      this.roleUsesAssignedModules(targetRole) &&
      !(targetRole === ROLES.ADMIN && assignedModuleSet.size === 0);
    let permissionMatrix = null;

    try {
      permissionMatrix = await this.rbacService.getPermissionManagementMatrix({
        roleId: query.roleId,
        ...(shouldUseAssignedModules && accessUser
          ? { userId: this.getRecordId(accessUser) }
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

    const rbacModulesBySlug = this.getRbacModuleMap(
      permissionMatrix.modules,
    );
    const includePermissions = query.includePermissions !== false;
    const modules = assignableModuleSlugs.map((moduleSlug) => {
      const rbacModule = rbacModulesBySlug.get(moduleSlug) || null;
      const metadata = rbacModule?.metadata || {};
      const moduleAllowed =
        !shouldUseAssignedModules ||
        assignedModuleSet.has(cleanModuleName(moduleSlug));
      const forceAssigned =
        moduleAllowed &&
        this.roleHasFullModuleAccess(targetRole) &&
        !permissionMatrix.role;
      const assignmentData = includePermissions
        ? this.getPermissionAssignmentData(
            rbacModule?.permissions || [],
            moduleAllowed,
            forceAssigned,
          )
        : {};

      return {
        slug: moduleSlug,
        name: rbacModule?.name || this.formatModuleName(moduleSlug),
        icon: rbacModule?.icon || null,
        description: rbacModule?.description || null,
        tab: metadata.tab || null,
        forPlatform: metadata.forPlatform !== false,
        forSeller: metadata.forSeller === true,
        apiPath: metadata.apiPath || null,
        apiAliases: metadata.apiAliases || [],
        metadata,
        assignable: true,
        assigned: moduleAllowed,
        source: rbacModule ? "rbac" : "platform",
        permissions: includePermissions
          ? assignmentData.permissions
          : undefined,
        permissionsByAction: includePermissions
          ? assignmentData.permissionsByAction
          : undefined,
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
            id: this.getRecordId(accessUser),
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

  sanitizeModules(modules, role = ROLES.SUB_ADMIN) {
    const assignableModules = this.getAssignableModuleSlugs(role);
    const normalized = Array.from(
      new Set((modules || []).map(cleanModuleName).filter(Boolean)),
    );
    return normalized.filter((moduleName) =>
      assignableModules.includes(moduleName),
    );
  }

  async getActorAssignablePermissionMap(actor = {}) {
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      return null;
    }
    if (![ROLES.ADMIN, ROLES.SUB_ADMIN].includes(actor.role)) {
      throw new AppError("Forbidden", 403);
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
      if (!actions.has("view")) {
        return;
      }
      grants.set(slug, actions);
    });
    return grants;
  }

  assertRbacAssignmentCapability(actorPermissionMap) {
    if (!actorPermissionMap) return;
    const rbacActions = actorPermissionMap.get("rbac") || new Set();
    const userActions = actorPermissionMap.get("users") || new Set();
    const canAssign = ["add", "edit", "update", "approval", "status"].some(
      (action) => rbacActions.has(action) || userActions.has(action),
    );
    if (!canAssign) {
      throw new AppError("Forbidden: missing permission to manage access", 403);
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
    const scopedAllowed = allowedModules.filter(
      (module) =>
        actorModuleScope.has(module) &&
        actorPermissionMap.has(module),
    );
    if (!scopedAllowed.length) {
      throw new AppError("Forbidden: no assignable modules in request", 403);
    }

    const scopedPermissions = modulePermissions
      .map((entry) => {
        const moduleName = cleanModuleName(entry.module);
        if (!moduleName || !scopedAllowed.includes(moduleName)) return null;
        const grantActions = actorPermissionMap.get(moduleName) || new Set();
        const actions = Array.from(
          new Set(
            (entry.actions || []).filter(
              (action) => action === "view" || grantActions.has(action),
            ),
          ),
        );
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

  async createAdmin(payload, actor = {}) {
    const existing = await this.adminRepository.findUserByEmail(payload.email);
    if (existing) {
      throw new AppError("User already exists", 409);
    }
    const allowedModules = this.sanitizeModules(payload.allowedModules || [], ROLES.ADMIN);
    const modulePermissions = this.normalizeModulePermissions(
      payload.modulePermissions,
      allowedModules,
    );
    const passwordHash = await hashText(payload.password);
    const user = await this.adminRepository.createManagedUser({
      email: payload.email,
      phone: payload.phone,
      passwordHash,
      role: ROLES.ADMIN,
      profile: payload.profile,
      accountStatus: "active",
      emailVerified: true,
      authProviders: [],
      refreshSessions: [],
      allowedModules,
    });

    await this.rbacService.assignRoleToUserBySlug(
      String(user.id),
      ROLES.ADMIN,
      actor.userId,
      {
        ignoreMissing: true,
        ignoreExisting: true,
      },
    );

    if (allowedModules.length) {
      await this.rbacService.syncUserModulePermissions(
        String(user.id),
        modulePermissions,
        actor.userId,
      );
    }

    return user;
  }

  async listAdmins(query = {}) {
    return this.adminRepository.listUsers({
      ...query,
      role: ROLES.ADMIN,
    });
  }

  async createPlatformSubAdmin(payload, actor) {
    const existing = await this.adminRepository.findUserByEmail(payload.email);
    if (existing) {
      throw new AppError("User already exists", 409);
    }
    const allowedModules = this.sanitizeModules(payload.allowedModules, ROLES.SUB_ADMIN);
    if (!allowedModules.length) {
      throw new AppError("At least one valid module is required", 400);
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
    const passwordHash = await hashText(payload.password);
    const user = await this.adminRepository.createManagedUser({
      email: payload.email,
      phone: payload.phone,
      passwordHash,
      role: ROLES.SUB_ADMIN,
      profile: payload.profile,
      ownerAdminId: actor.ownerAdminId || actor.userId,
      allowedModules: finalAllowedModules,
      accountStatus: "active",
      emailVerified: true,
      authProviders: [],
      refreshSessions: [],
    });

    await this.rbacService.assignRoleToUserBySlug(
      String(user.id),
      ROLES.SUB_ADMIN,
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
    );

    return user;
  }

  async listPlatformSubAdmins(query, actor) {
    const ownerAdminId = actor.isSuperAdmin || actor.role === ROLES.ADMIN
      ? query.ownerAdminId || null
      : actor.ownerAdminId || actor.userId;
    return this.adminRepository.listSubAdmins({ ownerAdminId });
  }

  async updatePlatformSubAdminModules(userId, payload, actor) {
    const existingUser = await this.adminRepository.getUserById(userId);
    if (!existingUser || existingUser.role !== ROLES.SUB_ADMIN) {
      throw new AppError("Sub-admin not found", 404);
    }

    let allowedModules = this.sanitizeModules(payload.allowedModules, existingUser.role);
    if (!allowedModules.length) {
      throw new AppError("At least one valid module is required", 400);
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
    const updated = await this.adminRepository.updateSubAdminModules(
      userId,
      actor.isSuperAdmin || actor.role === ROLES.ADMIN || existingUser.role === ROLES.SELLER_SUB_ADMIN
        ? null
        : actor.ownerAdminId || actor.userId,
      allowedModules,
      [existingUser.role],
    );
    if (!updated) {
      throw new AppError("Sub-admin not found", 404);
    }
    await this.rbacService.syncUserModulePermissions(
      String(userId),
      modulePermissions,
      actor.userId,
    );
    return updated;
  }
}

module.exports = { AdminService };
