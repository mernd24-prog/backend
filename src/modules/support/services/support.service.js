const { randomBytes } = require("crypto");
const { AppError } = require("../../../shared/errors/app-error");
const { ROLES } = require("../../../shared/constants/roles");
const { SellerOrganizationRepository } = require("../../seller/repositories/seller-organization.repository");
const { SupportRepository } = require("../repositories/support.repository");
const {
  CUSTOMER_QUERY_CATEGORIES,
  SELLER_QUERY_CATEGORIES,
  SUPPORT_QUERY_STATUSES,
} = require("../validation/support.validation");

const SELLER_ROLES = new Set([
  ROLES.SELLER,
  ROLES.SELLER_ADMIN,
  ROLES.SELLER_SUB_ADMIN,
]);

const customerCategorySet = new Set(CUSTOMER_QUERY_CATEGORIES);
const sellerCategorySet = new Set(SELLER_QUERY_CATEGORIES);
const statusSet = new Set(SUPPORT_QUERY_STATUSES);

class SupportService {
  constructor({
    supportRepository = new SupportRepository(),
    sellerOrganizationRepository = new SellerOrganizationRepository(),
  } = {}) {
    this.supportRepository = supportRepository;
    this.sellerOrganizationRepository = sellerOrganizationRepository;
  }

  getSubmitterType(auth = {}) {
    if (SELLER_ROLES.has(auth.role)) return "seller";
    if (auth.role === ROLES.BUYER || !auth.role) return "customer";
    throw new AppError("Only customers and sellers can submit support queries", 403);
  }

  getSupportOwnerId(auth = {}, userType) {
    if (userType === "seller") {
      return String(auth.ownerSellerId || auth.parentSellerId || auth.sub || "");
    }
    return String(auth.sub || "");
  }

  getRequesterName(user = {}, userType) {
    if (userType === "seller") {
      return (
        user.sellerProfile?.displayName ||
        user.sellerProfile?.businessName ||
        user.sellerProfile?.legalBusinessName ||
        user.sellerProfile?.primaryContactName ||
        [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ") ||
        user.email ||
        "Seller"
      );
    }

    return (
      [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ") ||
      user.email ||
      "Customer"
    );
  }

  async getSellerOrganizationSnapshot(auth = {}, sellerId = "") {
    const organizationId = auth.selectedOrganizationId || null;
    if (!organizationId || !sellerId) {
      return { sellerOrganizationId: organizationId, sellerOrganizationName: null };
    }

    const organization = await this.sellerOrganizationRepository
      .findByIdForSeller(sellerId, organizationId)
      .catch(() => null);

    return {
      sellerOrganizationId: organizationId,
      sellerOrganizationName:
        organization?.storeDisplayName ||
        organization?.legalBusinessName ||
        null,
    };
  }

  assertCategoryAllowed(userType, category) {
    const allowed = userType === "seller" ? sellerCategorySet : customerCategorySet;
    if (!allowed.has(category)) {
      throw new AppError("Selected category is not available for this user type", 400);
    }
  }

  generateQueryId(userType) {
    const prefix = userType === "seller" ? "SQ" : "CQ";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = randomBytes(3).toString("hex").toUpperCase();
    return `${prefix}-${date}-${suffix}`;
  }

  async createQuery(payload = {}, auth = {}) {
    const userType = this.getSubmitterType(auth);
    const userId = this.getSupportOwnerId(auth, userType);
    if (!userId) {
      throw new AppError("Authenticated user context is required", 401);
    }

    const category = String(payload.category || "").trim().toUpperCase();
    this.assertCategoryAllowed(userType, category);

    const user = auth.user || {};
    const organizationSnapshot = userType === "seller"
      ? await this.getSellerOrganizationSnapshot(auth, userId)
      : { sellerOrganizationId: null, sellerOrganizationName: null };

    return this.supportRepository.create({
      queryId: this.generateQueryId(userType),
      userId,
      requesterId: auth.sub || userId,
      userType,
      userName: this.getRequesterName(user, userType),
      userEmail: user.email || auth.email || null,
      userPhone: user.phone || user.sellerProfile?.supportPhone || null,
      ...organizationSnapshot,
      category,
      subject: payload.subject,
      message: payload.message,
      attachmentUrls: payload.attachmentUrls || [],
      metadata: {
        ...(payload.metadata || {}),
        requesterRole: auth.role || null,
        requesterUserId: auth.sub || null,
      },
    });
  }

  async listMine(query = {}, auth = {}) {
    const userType = this.getSubmitterType(auth);
    const userId = this.getSupportOwnerId(auth, userType);
    return this.supportRepository.list({
      ...query,
      userType,
      userId,
    });
  }

  async getMine(queryId, auth = {}) {
    const userType = this.getSubmitterType(auth);
    const userId = this.getSupportOwnerId(auth, userType);
    const query = await this.supportRepository.findByQueryIdForUser(queryId, userType, userId);
    if (!query) {
      throw new AppError("Support query not found", 404);
    }
    return query;
  }

  async listForAdmin(filters = {}) {
    if (!["customer", "seller"].includes(filters.userType)) {
      throw new AppError("User type is required", 400);
    }
    return this.supportRepository.list(filters);
  }

  async getForAdmin(queryId) {
    const query = await this.supportRepository.findByQueryId(queryId);
    if (!query) {
      throw new AppError("Support query not found", 404);
    }
    return query;
  }

  async updateStatus(queryId, payload = {}, actor = {}) {
    if (!statusSet.has(payload.status)) {
      throw new AppError("Unsupported query status", 400);
    }
    const existing = await this.getForAdmin(queryId);
    if (existing.status === payload.status && payload.adminNotes === undefined) {
      return existing;
    }
    const updated = await this.supportRepository.updateStatus(queryId, {
      status: payload.status,
      adminNotes: payload.adminNotes,
      actorId: actor.userId,
    });
    if (!updated) {
      throw new AppError("Support query not found", 404);
    }
    return updated;
  }
}

module.exports = { SupportService };
