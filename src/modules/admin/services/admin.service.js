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
const { ReturnModel } = require("../../returns/models/return.model");
const {
  DEFAULT_PLATFORM_MODULES,
  DEFAULT_SELLER_MODULES,
  cleanModuleName,
} = require("../../../shared/auth/module-access");
const {
  PERMISSION_ACTIONS,
  normalizePermissionAction: normalizeRbacPermissionAction,
} = require("../../../shared/auth/rbac-permissions");
const {
  makeSellerOnboardingState,
  SELLER_ONBOARDING_STATUS,
  hasCompleteSellerBankDetails,
} = require("../../../shared/domain/seller-onboarding");

const ADMIN_MANAGED_ROLES = [
  ROLES.SUB_ADMIN,
  ROLES.SELLER,
  ROLES.SELLER_ADMIN,
  ROLES.SELLER_SUB_ADMIN,
];
const SUBORDINATE_ROLES = [
  ROLES.SUB_ADMIN,
];
const SELLER_STAFF_ROLES = [ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN];
const ACCESS_MANAGED_ROLES = [
  ROLES.ADMIN,
  ROLES.SUB_ADMIN,
  ROLES.SELLER,
  ROLES.SELLER_ADMIN,
  ROLES.SELLER_SUB_ADMIN,
];
const SELLER_SIDE_ROLES = [
  ROLES.SELLER,
  ROLES.SELLER_ADMIN,
  ROLES.SELLER_SUB_ADMIN,
];
const ROLE_LEVEL = {
  [ROLES.SUPER_ADMIN]: 0,
  [ROLES.ADMIN]: 1,
  [ROLES.SELLER]: 2,
  [ROLES.SUB_ADMIN]: 2,
  [ROLES.SELLER_ADMIN]: 3,
  [ROLES.SELLER_SUB_ADMIN]: 4,
  [ROLES.BUYER]: 9,
};

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
    const afterApi = apiIndex >= 0 ? parts[apiIndex + 1] : null;
    const startIndex = apiIndex >= 0
      ? (/^v\d+$/i.test(afterApi || "") ? apiIndex + 2 : apiIndex + 1)
      : 0;
    const first = parts[startIndex];
    const second = parts[startIndex + 1];
    const third = parts[startIndex + 2];
    const fourth = parts[startIndex + 3];

    if (first === "auth") return "auth";
    if (first === "admin") {
      if (second === "access") return "rbac";
      if (second === "referral") return third === "fraud" ? "fraud" : "referral";
      if (second === "cms") return "cms_pages";
      if (second === "dashboard") return "admin";
      if (second === "vendors") return "sellers";
      if (second === "sellers" && fourth === "kyc") return "seller_kyc";
      if (second === "sellers" && fourth === "bank") return "seller_bank";
      if (second === "common") {
        return cleanModuleName(third || "platform");
      }
      if (second === "platform") return cleanModuleName(third || "platform");
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

  withActorHierarchyFilter(query = {}, actor = {}) {
    if (!actor.userId || actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      return { ...query };
    }
    if (actor.role === ROLES.ADMIN) {
      return { ...query, ownerAdminId: actor.ownerAdminId || actor.userId };
    }
    if (SELLER_SIDE_ROLES.includes(actor.role)) {
      return { ...query, ownerSellerId: actor.ownerSellerId || actor.userId };
    }
    return { ...query, createdBy: actor.userId };
  }

  assertActorCanSeeUser(user = {}, actor = {}) {
    if (!actor.userId || actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) return;
    if (this.getRecordId(user) === String(actor.userId)) return;
    if (
      actor.role === ROLES.ADMIN &&
      String(user.ownerAdminId || "") === String(actor.ownerAdminId || actor.userId)
    ) {
      return;
    }
    if (
      SELLER_SIDE_ROLES.includes(actor.role) &&
      String(user.ownerSellerId || "") === String(actor.ownerSellerId || actor.userId)
    ) {
      return;
    }
    if (String(user.createdBy || "") === String(actor.userId)) return;
    throw new AppError("Forbidden: user is outside your hierarchy 1", 403);
  }

  async listVendors(query, actor = {}) {
    const result = await this.adminRepository.listVendors(
      this.withActorHierarchyFilter(query, actor),
    );
    return {
      ...result,
      items: await this.enrichSellersForAdmin(result.items),
    };
  }

  async listUsers(query, actor = {}) {
    const result = await this.adminRepository.listUsers(
      this.withActorHierarchyFilter(query, actor),
    );
    return {
      ...result,
      items: await this.enrichSellersForAdmin(result.items),
    };
  }

  getHierarchyPayload(role, actor = {}, payload = {}) {
    const createdBy = actor.userId || null;
    const createdByRole = actor.role || null;
    const parentAdminId =
      payload.parentAdminId ||
      (role === ROLES.ADMIN
        ? null
        : actor.role === ROLES.ADMIN || actor.role === ROLES.SUB_ADMIN
          ? actor.ownerAdminId || actor.userId
          : null);
    const parentSellerId =
      payload.parentSellerId ||
      (SELLER_SIDE_ROLES.includes(role)
        ? payload.ownerSellerId || actor.ownerSellerId || null
        : null);

    return {
      createdBy,
      createdByRole,
      parentAdminId,
      parentSellerId,
      hierarchyLevel: ROLE_LEVEL[role] ?? 9,
      ownerAdminId: parentAdminId,
      ownerSellerId: parentSellerId,
    };
  }

  getAllowedChildRoles(actor = {}) {
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      return [ROLES.ADMIN, ...ADMIN_MANAGED_ROLES];
    }
    if (actor.role === ROLES.ADMIN) {
      return ADMIN_MANAGED_ROLES;
    }
    if (actor.role === ROLES.SELLER) {
      return [ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN];
    }
    if (actor.role === ROLES.SELLER_ADMIN) {
      return [ROLES.SELLER_SUB_ADMIN];
    }
    return [];
  }

  assertCanCreateRole(actor = {}, role) {
    if (!this.getAllowedChildRoles(actor).includes(role)) {
      throw new AppError("Forbidden: invalid hierarchy for requested role", 403);
    }
  }

  async enrichPermissionSummary(items = []) {
    const list = items.map((item) => this.toPlainObject(item));
    const summaries = await Promise.all(
      list.map(async (user) => {
        const userId = this.getRecordId(user);
        if (!userId) return { moduleCount: 0, actionCount: 0, permissions: [] };
        const permissions = await this.rbacService.getUserEffectivePermissions(userId);
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

  async enrichParentAdminInfo(items = []) {
    const list = items.map((item) => this.toPlainObject(item));
    const parentIds = Array.from(
      new Set(
        list
          .map((item) => item.parentAdminId || item.ownerAdminId)
          .filter(Boolean)
          .map(String),
      ),
    );
    if (!parentIds.length) return list;

    const parents = await UserModel.find({ _id: { $in: parentIds } })
      .select("email profile role")
      .lean();
    const parentMap = new Map(parents.map((parent) => [String(parent._id), parent]));

    return list.map((item) => {
      const parent = parentMap.get(String(item.parentAdminId || item.ownerAdminId || ""));
      const parentName =
        [parent?.profile?.firstName, parent?.profile?.lastName].filter(Boolean).join(" ") ||
        parent?.email ||
        "";
      return {
        ...item,
        parentAdmin: parent
          ? {
              id: String(parent._id),
              email: parent.email,
              role: parent.role,
              profile: parent.profile || {},
            }
          : item.parentAdmin || null,
        parentAdminName: parentName || item.parentAdminName || null,
      };
    });
  }

  async createUser(payload, actor = {}) {
    const existing = await this.adminRepository.findUserByEmail(payload.email);
    if (existing) {
      throw new AppError("User already exists", 409);
    }

    const role = payload.role || ROLES.BUYER;
    if (role !== ROLES.BUYER) {
      this.assertCanCreateRole(actor, role);
    }
    const isSeller = role === ROLES.SELLER;
    const allowedModules = isSeller
      ? this.sanitizeModules(payload.allowedModules || DEFAULT_SELLER_MODULES, ROLES.SELLER)
      : [];
    const modulePermissions = isSeller
      ? this.normalizeModulePermissions(payload.modulePermissions, allowedModules)
      : [];
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
      allowedModules,
      ...this.getHierarchyPayload(role, actor, payload),
    });

    // Seller is the root of their own seller-side hierarchy; self-reference so
    // seller-admin/seller-sub-admin filters scope correctly to this seller.
    if (isSeller) {
      const sellerUserId = String(user.id || user._id);
      await this.adminRepository.updateUserById(sellerUserId, { ownerSellerId: sellerUserId });
      user.ownerSellerId = sellerUserId;
    }

    await this.rbacService.assignRoleToUserBySlug(
      String(user.id),
      role,
      actor.userId,
      {
        ignoreMissing: true,
        ignoreExisting: true,
      },
    );

    if (modulePermissions.length) {
      await this.rbacService.syncUserModulePermissions(
        String(user.id),
        modulePermissions,
        actor.userId,
        actor,
      );
    }

    return this.sanitizeUserForAdmin(user);
  }

  async getUser(userId, actor = {}) {
    const user = await this.adminRepository.getUserById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    this.assertActorCanSeeUser(user, actor);
    if (user.role === ROLES.SELLER) {
      const kycBySellerId = await this.getSellerKycByIdMap([userId]);
      return this.enrichSellerForAdmin(
        user,
        kycBySellerId.get(String(userId)) || null,
      );
    }
    return user;
  }

  async updateUser(userId, payload, actor = {}) {
    const existingUser = await this.adminRepository.getUserById(userId);
    if (!existingUser) {
      throw new AppError("User not found", 404);
    }
    this.assertActorCanSeeUser(existingUser, actor);
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

  async deactivateUser(userId, payload, actor = {}) {
    const existingUser = await this.adminRepository.getUserById(userId);
    if (!existingUser) {
      throw new AppError("User not found", 404);
    }
    this.assertActorCanSeeUser(existingUser, actor);
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
    const kycRejected = payload.kycStatus === "rejected";
    const nextSellerProfileBase = {
      ...currentSellerProfile,
      kycStatus: payload.kycStatus,
      rejectionReason: kycRejected ? payload.rejectionReason || null : null,
      verifiedBy: payload.kycStatus === "verified" ? actor.userId || null : null,
      verifiedAt: payload.kycStatus === "verified" ? new Date() : null,
      ...(kycRejected
        ? {
            businessName: null,
            displayName: null,
            legalBusinessName: null,
            businessType: null,
            registrationNumber: null,
            gstNumber: null,
            businessWebsite: null,
            primaryContactName: null,
            businessAddress: null,
            pickupAddress: null,
            returnAddress: null,
            supportEmail: null,
            supportPhone: null,
            bankDetails: null,
            bankVerificationStatus: "not_submitted",
            bankRejectionReason: null,
            goLiveStatus: "pending",
            goLiveApprovedBy: null,
            goLiveApprovedAt: null,
          }
        : {}),
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
    await this.adminRepository.updateUserById(sellerId, {
      sellerProfile: nextSellerProfile,
      ...(kycRejected ? { accountStatus: "pending_approval" } : {}),
    });
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
    const bankRejected = payload.bankVerificationStatus === "rejected";
    const nextSellerProfileBase = {
      ...currentSellerProfile,
      bankVerificationStatus: payload.bankVerificationStatus,
      bankRejectionReason:
        bankRejected ? payload.bankRejectionReason || null : null,
      verifiedBy: payload.bankVerificationStatus === "verified" ? actor.userId || null : currentSellerProfile.verifiedBy || null,
      verifiedAt: payload.bankVerificationStatus === "verified" ? new Date() : currentSellerProfile.verifiedAt || null,
      ...(bankRejected ? { bankDetails: null } : {}),
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
        bankRejected
          ? "pending"
          : currentSellerProfile.goLiveStatus || "pending",
      goLiveApprovedBy: currentSellerProfile.goLiveApprovedBy || null,
      goLiveApprovedAt: currentSellerProfile.goLiveApprovedAt || null,
    };
    await this.adminRepository.updateUserById(sellerId, {
      sellerProfile: nextSellerProfile,
      ...(bankRejected
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
    const filter = {};
    if (query.fromDate || query.toDate) {
      filter.createdAt = {};
      if (query.fromDate) filter.createdAt.$gte = new Date(query.fromDate);
      if (query.toDate) filter.createdAt.$lte = new Date(query.toDate);
    }

    const [summaryRows, statusRows, reasonRows, recentItems] = await Promise.all([
      ReturnModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalReturns: { $sum: 1 },
            approvedReturns: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
            refundedReturns: { $sum: { $cond: [{ $eq: ["$status", "refunded"] }, 1, 0] } },
            rejectedReturns: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
            totalRefundAmount: { $sum: { $ifNull: ["$refundAmount", 0] } },
          },
        },
      ]),
      ReturnModel.aggregate([
        { $match: filter },
        { $group: { _id: "$status", count: { $sum: 1 }, refundAmount: { $sum: { $ifNull: ["$refundAmount", 0] } } } },
        { $sort: { count: -1 } },
      ]),
      ReturnModel.aggregate([
        { $match: filter },
        { $group: { _id: "$reason", count: { $sum: 1 }, refundAmount: { $sum: { $ifNull: ["$refundAmount", 0] } } } },
        { $sort: { count: -1 } },
      ]),
      ReturnModel.find(filter).sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    const summary = summaryRows[0] || {};
    return {
      totalReturns: Number(summary.totalReturns || 0),
      approvedReturns: Number(summary.approvedReturns || 0),
      refundedReturns: Number(summary.refundedReturns || 0),
      rejectedReturns: Number(summary.rejectedReturns || 0),
      totalRefundAmount: Number(summary.totalRefundAmount || 0),
      byStatus: statusRows.map((row) => ({
        status: row._id || "unknown",
        count: Number(row.count || 0),
        refundAmount: Number(row.refundAmount || 0),
      })),
      byReason: reasonRows.map((row) => ({
        reason: row._id || "unknown",
        count: Number(row.count || 0),
        refundAmount: Number(row.refundAmount || 0),
      })),
      recentItems,
    };
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
    if (SELLER_SIDE_ROLES.includes(role)) {
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
          throw new AppError(`Permission assignment includes unavailable module: ${moduleName || "unknown"}`, 403);
        }
        const rawActions = item.actions || [];
        const actions = Array.from(new Set(rawActions.map((action) => {
          const normalized = this.normalizePermissionAction(action);
          if (!normalized) {
            throw new AppError(`Permission assignment includes invalid action: ${action}`, 400);
          }
          return normalized;
        })));

        const normalizedActions = actions.length
          ? Array.from(new Set(["view", ...actions]))
          : ["view"];

        return {
          module: moduleName,
          actions: normalizedActions,
        };
      });
  }

  async listAccessModules(query = {}, actor = {}) {
    const accessUser = query.userId
      ? this.toPlainObject(await this.adminRepository.getUserById(query.userId))
      : null;
    if (query.userId && !accessUser?._id && !accessUser?.id) {
      throw new AppError("User not found", 404);
    }
    if (accessUser) this.assertActorCanSeeUser(accessUser, actor);

    const targetRole =
      accessUser?.role || query.roleSlug || query.role || ROLES.SUB_ADMIN;
    const assignableModuleSlugs = this.getAssignableModuleSlugs(targetRole);
    const roleSlug = query.roleSlug || targetRole;
    const assignedModuleSet = new Set(
      (accessUser?.allowedModules || []).map(cleanModuleName).filter(Boolean),
    );
    const shouldUseAssignedModules =
      Boolean(accessUser) &&
      this.roleUsesAssignedModules(targetRole);
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
    const rbacModulesBySlug = this.getRbacModuleMap(
      permissionMatrix.modules,
    );
    const includePermissions = query.includePermissions !== false;
    const modules = assignableModuleSlugs
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
          forPlatform: metadata.forPlatform !== false,
          forSeller: metadata.forSeller === true,
          apiPath: metadata.apiPath || null,
          apiAliases: metadata.apiAliases || [],
          metadata,
          assignable: true,
          assignableActions: actorActions ? Array.from(actorActions) : undefined,
          assigned: moduleAllowed,
          source: rbacModule ? "rbac" : "platform",
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
    const canAssign = [
      "add",
      "create",
      "edit",
      "update",
      "assign",
      "approval",
      "approve",
      "status",
      "status_change",
      "action",
      "delete",
    ].some(
      (action) => rbacActions.has(action) || userActions.has(action),
    );
    if (!canAssign) {
      throw new AppError("Forbidden: missing permission to manage access", 403);
    }
  }

  assertRoleManagementCapability(actorPermissionMap, targetRole) {
    if (!actorPermissionMap) return;
    const moduleCandidates = SELLER_SIDE_ROLES.includes(targetRole)
      ? ["sellers", "seller-management", "rbac", "users"]
      : ["rbac", "users"];
    const canManageNamedArea = moduleCandidates.some((moduleName) => {
      const actions = actorPermissionMap.get(moduleName) || new Set();
      return [
        "add",
        "create",
        "edit",
        "update",
        "assign",
        "status",
        "status_change",
        "action",
        "approval",
        "approve",
        "delete",
      ].some((action) =>
        actions.has(action),
      );
    });
    const hasDelegatablePermission = Array.from(actorPermissionMap.values()).some((actions) =>
      actions instanceof Set && actions.size > 0,
    );
    const canManage = canManageNamedArea || (
      [ROLES.SUB_ADMIN, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(targetRole) &&
      hasDelegatablePermission
    );
    if (!canManage) {
      throw new AppError("Forbidden: missing permission to manage this role", 403);
    }
  }

  async assertSellerBelongsToActor(parentSellerId, actor = {}) {
    if (!parentSellerId) {
      throw new AppError("Parent seller is required for seller staff", 400);
    }
    const seller = await this.adminRepository.getUserById(parentSellerId);
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      if (!seller || seller.role !== ROLES.SELLER) {
        throw new AppError("Parent seller not found", 404);
      }
      return;
    }
    if (
      !seller ||
      seller.role !== ROLES.SELLER ||
      String(seller.ownerAdminId || "") !== String(actor.ownerAdminId || actor.userId)
    ) {
      throw new AppError("Forbidden: parent seller is outside your hierarchy", 403);
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
      throw new AppError(`Forbidden: cannot assign unavailable modules (${deniedModules.join(", ")})`, 403);
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
            `Forbidden: cannot assign unavailable actions for ${moduleName} (${deniedActions.join(", ")})`,
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

  async createAdmin(payload, actor = {}) {
    this.assertCanCreateRole(actor, ROLES.ADMIN);
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
      ...this.getHierarchyPayload(ROLES.ADMIN, actor, payload),
    });

    // Admin is the root of their own sub-hierarchy; self-reference so filters
    // using ownerAdminId correctly scope sub-admins and sellers to this admin.
    const adminUserId = String(user.id || user._id);
    await this.adminRepository.updateUserById(adminUserId, { ownerAdminId: adminUserId });
    user.ownerAdminId = adminUserId;

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
        actor,
      );
    }

    return user;
  }

  async listAdmins(query = {}, actor = {}) {
    const listQuery = { ...query };
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      listQuery.roles = [ROLES.ADMIN];
    } else if (actor.role === ROLES.ADMIN) {
      listQuery.roles = [ROLES.ADMIN];
      listQuery.ownerAdminId = actor.ownerAdminId || actor.userId;
    } else {
      throw new AppError("Forbidden", 403);
    }
    delete listQuery.role;
    const result = await this.adminRepository.listUsers(listQuery);
    return {
      ...result,
      items: await this.enrichPermissionSummary(await this.enrichSellersForAdmin(result.items)),
    };
  }

  async createPlatformSubAdmin(payload, actor) {
    const targetRole = payload.role || ROLES.SUB_ADMIN;
    this.assertCanCreateRole(actor, targetRole);
    if ([ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(targetRole)) {
      await this.assertSellerBelongsToActor(payload.parentSellerId, actor);
    }
    const existing = await this.adminRepository.findUserByEmail(payload.email);
    if (existing) {
      throw new AppError("User already exists", 409);
    }
    const allowedModules = this.sanitizeModules(payload.allowedModules, targetRole);
    if (!allowedModules.length) {
      throw new AppError("At least one valid module is required", 400);
    }
    let modulePermissions = this.normalizeModulePermissions(
      payload.modulePermissions,
      allowedModules,
    );
    const actorPermissionMap = await this.getActorAssignablePermissionMap(actor);
    this.assertRoleManagementCapability(actorPermissionMap, targetRole);
    const constrained = this.constrainModuleAssignmentByActor(
      actor,
      actorPermissionMap,
      allowedModules,
      modulePermissions,
    );
    const finalAllowedModules = constrained.allowedModules;
    modulePermissions = constrained.modulePermissions;
    const passwordHash = await hashText(payload.password);
    const isSeller = targetRole === ROLES.SELLER;
    const user = await this.adminRepository.createManagedUser({
      email: payload.email,
      phone: payload.phone,
      passwordHash,
      role: targetRole,
      profile: payload.profile,
      ...(isSeller
        ? {
            sellerProfile: {
              displayName: payload.sellerProfile?.displayName || payload.profile?.firstName || "",
              legalBusinessName: payload.sellerProfile?.legalBusinessName || payload.profile?.firstName || "",
              supportEmail: payload.sellerProfile?.supportEmail || payload.email,
              supportPhone: payload.sellerProfile?.supportPhone || payload.phone,
              onboardingStatus: "initiated",
            },
          }
        : {}),
      allowedModules: finalAllowedModules,
      accountStatus: "active",
      emailVerified: true,
      authProviders: [],
      refreshSessions: [],
      ...this.getHierarchyPayload(targetRole, actor, payload),
    });

    // Seller is the root of their own seller-side hierarchy; self-reference so
    // seller-admin/seller-sub-admin filters scope correctly to this seller.
    if (isSeller) {
      const sellerUserId = String(user.id || user._id);
      await this.adminRepository.updateUserById(sellerUserId, { ownerSellerId: sellerUserId });
      user.ownerSellerId = sellerUserId;
    }

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

    return user;
  }

  async listPlatformSubAdmins(query, actor) {
    const listQuery = {
      ...query,
      roles: SUBORDINATE_ROLES,
    };
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      if (query.ownerAdminId) listQuery.ownerAdminId = query.ownerAdminId;
      if (query.ownerSellerId) listQuery.ownerSellerId = query.ownerSellerId;
    } else if (actor.role === ROLES.ADMIN) {
      listQuery.ownerAdminId = actor.ownerAdminId || actor.userId;
    } else {
      throw new AppError("Forbidden", 403);
    }
    const result = await this.adminRepository.listSubAdmins(listQuery);
    const withParentInfo = await this.enrichParentAdminInfo(result.items);
    return {
      ...result,
      items: await this.enrichPermissionSummary(withParentInfo),
    };
  }

  async listSellerUsers(query = {}, actor = {}) {
    const listQuery = { ...query, roles: [ROLES.SELLER] };
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      if (query.ownerAdminId) listQuery.ownerAdminId = query.ownerAdminId;
    } else if (actor.role === ROLES.ADMIN) {
      listQuery.ownerAdminId = actor.ownerAdminId || actor.userId;
    } else {
      throw new AppError("Forbidden", 403);
    }
    delete listQuery.role;
    const result = await this.adminRepository.listUsers(listQuery);
    return {
      ...result,
      items: await this.enrichPermissionSummary(
        await this.enrichSellersForAdmin(result.items),
      ),
    };
  }

  async listSellerStaffByRole(query = {}, actor = {}, role = ROLES.SELLER_ADMIN) {
    if (!SELLER_STAFF_ROLES.includes(role)) {
      throw new AppError("Invalid seller staff role", 400);
    }
    const listQuery = {
      ...query,
      roles: [role],
    };
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) {
      if (query.ownerAdminId) listQuery.ownerAdminId = query.ownerAdminId;
      if (query.ownerSellerId) listQuery.ownerSellerId = query.ownerSellerId;
    } else if (actor.role === ROLES.ADMIN) {
      listQuery.ownerAdminId = actor.ownerAdminId || actor.userId;
    } else {
      throw new AppError("Forbidden", 403);
    }
    const result = await this.adminRepository.listSubAdmins(listQuery);
    return {
      ...result,
      items: await this.enrichPermissionSummary(result.items),
    };
  }

  async createSellerStaff(payload = {}, actor = {}, role = ROLES.SELLER_ADMIN) {
    if (!SELLER_STAFF_ROLES.includes(role)) {
      throw new AppError("Invalid seller staff role", 400);
    }
    return this.createPlatformSubAdmin(
      {
        ...payload,
        role,
      },
      actor,
    );
  }

  async updatePlatformSubAdminModules(userId, payload, actor) {
    const existingUser = await this.adminRepository.getUserById(userId);
    if (!existingUser || !ACCESS_MANAGED_ROLES.includes(existingUser.role)) {
      throw new AppError("Managed user not found", 404);
    }
    if (
      actor.role === ROLES.ADMIN &&
      String(existingUser.ownerAdminId || "") !== String(actor.ownerAdminId || actor.userId)
    ) {
      throw new AppError("Forbidden: user is outside your hierarchy 3", 403);
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
    this.assertRoleManagementCapability(actorPermissionMap, existingUser.role);
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
      actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN || actor.role === ROLES.ADMIN
        ? null
        : actor.ownerAdminId || actor.userId,
      allowedModules,
      [existingUser.role],
      actor.role === ROLES.ADMIN ? null : undefined,
    );
    if (!updated) {
      throw new AppError("Sub-admin not found", 404);
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

module.exports = { AdminService };
