const { SellerRepository } = require("../repositories/seller.repository");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { KYC_STATUS } = require("../../../shared/domain/commerce-constants");
const { AppError } = require("../../../shared/errors/app-error");
const { auditService } = require("../../../shared/logger/audit.service");
const { hashText } = require("../../../shared/tools/hash");
const { ROLES } = require("../../../shared/constants/roles");
const { DEFAULT_SELLER_MODULES, cleanModuleName } = require("../../../shared/auth/module-access");
const { RbacService } = require("../../rbac/services/rbac.service");
const {
  storageService: defaultStorageService,
} = require("../../../shared/storage/storage-service");
const {
  SELLER_ONBOARDING_STATUS,
  makeSellerOnboardingState,
  getSellerKycStatus,
  hasCompleteSellerBankDetails: hasCompleteSellerBankDetailsForOnboarding,
  hasCompleteSellerProfile: hasCompleteSellerProfileForOnboarding,
  getSellerOnboardingStatus,
} = require("../../../shared/domain/seller-onboarding");

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
  } = {}) {
    this.sellerRepository = sellerRepository;
    this.rbacService = rbacService;
    this.storageService = storageService;
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

  mergeSellerProfile(existingProfile = {}, payload = {}) {
    const profile = this.toPlainObject(existingProfile);
    const profileFields = { ...payload };
    const { bankDetails, businessAddress, pickupAddress } = profileFields;
    delete profileFields.onboardingChecklist;
    delete profileFields.bankDetails;
    delete profileFields.businessAddress;
    delete profileFields.pickupAddress;

    return {
      ...profile,
      ...profileFields,
      ...(bankDetails
        ? { bankDetails: { ...(profile.bankDetails || {}), ...bankDetails } }
        : {}),
      ...(businessAddress
        ? { businessAddress: { ...(profile.businessAddress || {}), ...businessAddress } }
        : {}),
      ...(pickupAddress
        ? { pickupAddress: { ...(profile.pickupAddress || {}), ...pickupAddress } }
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
      businessName: profile.businessName || profile.displayName || profile.legalBusinessName || kyc.legal_name,
      legalBusinessName: profile.legalBusinessName || kyc.legal_name,
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
      supportEmail: profile.supportEmail || user?.email || undefined,
      supportPhone: profile.supportPhone || user?.phone || undefined,
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

  async submitKyc(payload, actor) {
    const sellerId = this.getSellerId(actor);
    const documents = await this.uploadKycDocuments(payload.documents || {}, actor);
    const record = await this.sellerRepository.upsertKyc({
      ...payload,
      documents,
      sellerId,
      verificationStatus: KYC_STATUS.SUBMITTED,
    });

    const seller = await this.sellerRepository.findSellerById(sellerId);
    if (seller) {
      const existingProfile = this.mergeSellerProfile(
        this.mergeKycIntoSellerProfile(seller.sellerProfile || {}, record),
        {
          bankDetails: payload.bankDetails || {},
          ...(payload.dateOfBirth ? { dateOfBirth: payload.dateOfBirth } : {}),
        },
      );
      await this.sellerRepository.updateSellerProfile(
        sellerId,
        this.withOnboardingState(existingProfile, record, seller),
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
    if (
      this.hasCompleteBankDetails(nextProfile.bankDetails) &&
      !["verified", "submitted"].includes(nextProfile.bankVerificationStatus)
    ) {
      nextProfile.bankVerificationStatus = "submitted";
      nextProfile.bankRejectionReason = null;
    }
    const nextProfileWithOnboarding = this.withOnboardingState(nextProfile, kycRecord, existingSeller);
    const updatedSeller = await this.sellerRepository.updateSellerProfile(sellerId, nextProfileWithOnboarding);

    return updatedSeller?.sellerProfile || null;
  }

  async getProfile(actor) {
    const sellerId = this.getSellerId(actor);
    const [seller, kyc] = await Promise.all([
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
    ]);

    if (!seller) {
      throw AppError.notFound("Seller profile");
    }

    return {
      profile: this.withOnboardingState(seller.sellerProfile || {}, kyc, seller),
      settings: seller.sellerSettings || null,
      kyc,
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

  getSellerWebNextSteps(checklist = {}, kycStatus = null) {
    const labels = {
      profileCompleted: "Complete seller profile",
      kycSubmitted: "Submit seller KYC",
      bankLinked: "Complete bank details",
      gstVerified: "Verify GST details if applicable",
      firstProductPublished: "Publish first product from seller panel",
    };

    const nextSteps = Object.entries(labels)
      .filter(([key]) => checklist[key] !== true)
      .map(([, label]) => label);

    if (kycStatus === KYC_STATUS.REJECTED) {
      return ["Review KYC rejection reason in seller panel", ...nextSteps];
    }

    if ([KYC_STATUS.SUBMITTED, KYC_STATUS.UNDER_REVIEW].includes(kycStatus)) {
      return ["Wait for KYC verification", ...nextSteps];
    }

    return nextSteps;
  }

  async getWebStatus(actor) {
    const sellerId = this.assertSellerWebActor(actor);
    const [seller, kyc] = await Promise.all([
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
    ]);

    if (!seller) {
      throw AppError.notFound("Seller profile");
    }

    const onboardingState = makeSellerOnboardingState({
      sellerProfile: seller.sellerProfile || {},
      user: seller || {},
      kyc,
    });
    const profile = this.withOnboardingState(seller.sellerProfile || {}, kyc, seller);

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
        primaryContactName: profile.primaryContactName || null,
      },
      onboarding: {
        status: onboardingState.onboardingStatus,
        complete: onboardingState.onboardingStatus === SELLER_ONBOARDING_STATUS.READY_FOR_GO_LIVE,
        checklist: onboardingState.checklist,
        kycStatus: onboardingState.kycStatus,
        nextSteps: this.getSellerWebNextSteps(onboardingState.checklist, onboardingState.kycStatus),
      },
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
        eWayBillId: row.eway_bill_id || null,
        eWayBillNumber: row.e_way_bill_number || null,
        transporterName: row.transporter_name || null,
        vehicleNumber: row.vehicle_number || null,
        updatedAt: row.delivery_updated_at || null,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  cleanTrackingQuery(query = {}) {
    return {
      status: query.status || null,
      deliveryStatus: query.deliveryStatus || null,
      fromDate: query.fromDate || null,
      toDate: query.toDate || null,
      limit: Number(query.limit || 20),
      offset: Number(query.offset || 0),
    };
  }

  async listWebTracking(query, actor) {
    const sellerId = this.assertSellerWebActor(actor);
    const filters = this.cleanTrackingQuery(query);
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
    const updatedSeller = await this.sellerRepository.updateSellerProfile(
      sellerId,
      this.withOnboardingState(nextProfile, kycRecord, existingSeller),
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
    const fromDate = query.fromDate ? new Date(query.fromDate) : this.getDateBeforeDays(30);
    const toDate = query.toDate ? new Date(query.toDate) : new Date();

    const [summary, topProducts, recentOrders, seller, kyc] = await Promise.all([
      this.sellerRepository.fetchDashboardSummary(sellerId, fromDate, toDate),
      this.sellerRepository.fetchTopProducts(sellerId, fromDate, toDate),
      this.sellerRepository.fetchRecentOrders(sellerId),
      this.sellerRepository.findSellerById(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
    ]);

    const totalOrders = Number(summary?.total_orders || 0);
    const gmv = Number(summary?.gmv || 0);
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: seller?.sellerProfile || {},
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
      },
      metrics: {
        totalOrders,
        unitsSold: Number(summary?.units_sold || 0),
        gmv,
        deliveredRevenue: Number(summary?.delivered_revenue || 0),
        cancelledOrders: Number(summary?.cancelled_orders || 0),
        returnedOrders: Number(summary?.returned_orders || 0),
        averageOrderValue: totalOrders > 0 ? Number((gmv / totalOrders).toFixed(2)) : 0,
        averageItemValue: Number(summary?.avg_item_value || 0),
      },
      topProducts,
      recentOrders,
    };
  }

  getDateBeforeDays(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  async reviewKyc(sellerId, payload, actor) {
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
    const aliases = {
      add: "create",
      edit: "update",
      status: "status_change",
      approval: "approve",
      action: "status_change",
      review: "approve",
      manage: "status_change",
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
    const actions = [
      "view",
      "create",
      "update",
      "delete",
      "approve",
      "reject",
      "assign",
      "export",
      "import",
      "status_change",
      "restore",
      "bulk_action",
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

  async listSellerSubAdmins(actor) {
    const sellerId = this.assertSellerOwnerActor(actor);
    return this.sellerRepository.listSellerSubAdmins(sellerId);
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
