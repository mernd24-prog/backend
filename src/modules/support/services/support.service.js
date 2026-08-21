const { randomBytes } = require("crypto");
const { AppError } = require("../../../shared/errors/app-error");
const { ROLES } = require("../../../shared/constants/roles");
const { sendMail } = require("../../../infrastructure/mail/mailer");
const { logger } = require("../../../shared/logger/logger");
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
const ADMIN_EMAIL_DELAY_MS = Math.max(
  0,
  Number(process.env.SUPPORT_ADMIN_EMAIL_DELAY_MS || process.env.ADMIN_SUPPORT_EMAIL_DELAY_MS || 30000),
);

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

  escapeHtml(value = "") {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  getAdminSupportRecipients() {
    return String(
      process.env.SUPPORT_ADMIN_EMAIL ||
      process.env.ADMIN_SUPPORT_EMAIL ||
      process.env.ADMIN_EMAIL ||
      process.env.SUPPORT_EMAIL ||
      process.env.EMAIL_FROM ||
      "",
    )
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
  }

  buildAdminQueryEmail(query = {}) {
    const userType = query.userType === "seller" ? "Seller" : "Customer";
    const rows = [
      ["Query ID", query.queryId],
      ["User Type", userType],
      ["Name", query.userName || "N/A"],
      ["Email", query.userEmail || "N/A"],
      ["Phone", query.userPhone || "N/A"],
      ["Category", String(query.category || "OTHER").replace(/_/g, " ")],
      ["Subject", query.subject || "N/A"],
      ...(query.sellerOrganizationName || query.sellerOrganizationId
        ? [["Organization", query.sellerOrganizationName || query.sellerOrganizationId]]
        : []),
    ];
    const tableRows = rows.map(([label, value]) => `
      <tr>
        <td style="width:150px;padding:10px 12px;border-bottom:1px solid #edf2f7;background:#f8fafc;font-weight:700;color:#334155;">${this.escapeHtml(label)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;color:#0f172a;">${this.escapeHtml(value || "N/A")}</td>
      </tr>
    `).join("");
    const subject = `[Support] New ${userType} Query ${query.queryId}`;
    const text = [
      `New ${userType.toLowerCase()} support query received.`,
      `Query ID: ${query.queryId}`,
      `Name: ${query.userName || "N/A"}`,
      `Email: ${query.userEmail || "N/A"}`,
      `Category: ${query.category || "OTHER"}`,
      `Subject: ${query.subject || "N/A"}`,
      "",
      query.message || "",
    ].join("\n");
    const html = `
      <div style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#0f172a;">
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          <div style="background:#111827;color:#ffffff;padding:20px 24px;">
            <div style="font-size:18px;font-weight:700;">New ${this.escapeHtml(userType)} Support Query</div>
            <div style="font-size:13px;margin-top:6px;color:#d1d5db;">${this.escapeHtml(query.queryId)}</div>
          </div>
          <div style="padding:24px;">
            <table style="width:100%;border-collapse:collapse;border:1px solid #edf2f7;">${tableRows}</table>
            <div style="margin-top:20px;">
              <div style="font-size:13px;font-weight:700;color:#334155;text-transform:uppercase;">Message</div>
              <div style="margin-top:8px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;white-space:pre-wrap;line-height:1.5;">${this.escapeHtml(query.message || "No message")}</div>
            </div>
          </div>
        </div>
      </div>
    `;
    return { subject, text, html };
  }

  async notifyAdminsForNewQuery(query = {}) {
    const recipients = this.getAdminSupportRecipients();
    if (!recipients.length) {
      logger.warn({ queryId: query.queryId }, "Support admin email skipped: no admin recipient configured");
      return null;
    }
    const mail = this.buildAdminQueryEmail(query);
    try {
      const result = await sendMail({
        to: recipients.join(","),
        ...mail,
      });
      logger.warn({
        queryId: query.queryId,
        to: recipients,
        messageId: result?.messageId,
        mode: result?.mode,
      }, "Support admin email sent");
      return result;
    } catch (error) {
      logger.error({ err: error, queryId: query.queryId, to: recipients }, "Support admin email failed");
      return null;
    }
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

    const query = await this.supportRepository.create({
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
    setTimeout(() => {
      this.notifyAdminsForNewQuery(query).catch((error) => {
        logger.error({ err: error, queryId: query?.queryId }, "Support admin email async failure");
      });
    }, ADMIN_EMAIL_DELAY_MS).unref?.();
    return query;
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

  async replyMine(queryId, payload = {}, auth = {}) {
    const userType = this.getSubmitterType(auth);
    const userId = this.getSupportOwnerId(auth, userType);
    const existing = await this.supportRepository.findByQueryIdForUser(queryId, userType, userId);
    if (!existing) {
      throw new AppError("Support query not found", 404);
    }

    const message = String(payload.message || "").trim();
    if (!message) {
      throw new AppError("Message is required", 400);
    }

    const updated = await this.supportRepository.addReply(queryId, {
      message,
      senderType: userType,
      senderId: auth.sub || userId,
      senderName: this.getRequesterName(auth.user || {}, userType),
    });
    if (!updated) {
      throw new AppError("Support query not found", 404);
    }
    return updated;
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

  async deleteForAdmin(queryId) {
    const existing = await this.getForAdmin(queryId);
    const deleted = await this.supportRepository.deleteByQueryId(existing.queryId);
    if (!deleted) {
      throw new AppError("Support query not found", 404);
    }
    return {
      deleted: true,
      queryId: deleted.queryId,
    };
  }

  async bulkDeleteForAdmin(payload = {}) {
    const queryIds = Array.from(new Set(
      (Array.isArray(payload.queryIds) ? payload.queryIds : [])
        .map((queryId) => String(queryId || "").trim())
        .filter(Boolean),
    ));

    if (!queryIds.length) {
      throw new AppError("Select at least one support query", 400);
    }

    const result = await this.supportRepository.deleteManyByQueryIds(queryIds);
    return {
      deleted: true,
      ...result,
    };
  }
}

module.exports = { SupportService };
