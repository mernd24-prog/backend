const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { AppError } = require("../../../shared/errors/app-error");

class SellerOrganizationRepository {
  jsonb(value, fallback = {}) {
    let normalized = value;
    if (normalized === undefined || normalized === null || normalized === "") {
      normalized = fallback;
    }
    if (typeof normalized === "string") {
      try {
        normalized = JSON.parse(normalized);
      } catch {
        normalized = fallback;
      }
    }
    return knex.raw("?::jsonb", [JSON.stringify(normalized)]);
  }

  parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  rowToOrganization(row = {}) {
    if (!row || !row.id) return null;
    return {
      id: row.id,
      organizationId: row.id,
      sellerId: row.seller_id,
      legalBusinessName: row.legal_business_name,
      storeDisplayName: row.store_display_name,
      businessType: row.business_type || null,
      description: row.description || null,
      supportEmail: row.support_email || null,
      supportPhone: row.support_phone || null,
      registrationNumber: row.registration_number || null,
      aadhaarNumber: row.aadhaar_number || null,
      dateOfBirth: row.date_of_birth || null,
      businessWebsite: row.business_website || null,
      primaryContactName: row.primary_contact_name || null,
      gstin: row.gstin || null,
      pan: row.pan || null,
      kycStatus: row.kyc_status || "not_submitted",
      bankVerificationStatus: row.bank_verification_status || "not_submitted",
      approvalStatus: row.approval_status || "draft",
      documents: this.parseJson(row.documents, {}),
      bankDetails: this.parseJson(row.bank_details, {}),
      billingAddress: this.parseJson(row.billing_address, {}),
      pickupAddress: this.parseJson(row.pickup_address, {}),
      returnAddress: this.parseJson(row.return_address, {}),
      taxSettings: this.parseJson(row.tax_settings, {}),
      invoiceSettings: this.parseJson(row.invoice_settings, {}),
      payoutSettings: this.parseJson(row.payout_settings, {}),
      complianceSettings: this.parseJson(row.compliance_settings, {}),
      metadata: this.parseJson(row.metadata, {}),
      rejectionReason: row.rejection_reason || null,
      requiredChanges: this.parseJson(row.required_changes, []),
      verificationHistory: this.parseJson(row.verification_history, []),
      approvedAt: row.approved_at || null,
      approvedBy: row.approved_by || null,
      rejectedAt: row.rejected_at || null,
      rejectedBy: row.rejected_by || null,
      resubmittedAt: row.resubmitted_at || null,
      resubmittedBy: row.resubmitted_by || null,
      blockedAt: row.blocked_at || null,
      blockedBy: row.blocked_by || null,
      goLiveStatus: row.go_live_status || "pending",
      kycReviewedAt: row.kyc_reviewed_at || null,
      kycReviewedBy: row.kyc_reviewed_by || null,
      bankReviewedAt: row.bank_reviewed_at || null,
      bankReviewedBy: row.bank_reviewed_by || null,
      goLiveApprovedAt: row.go_live_approved_at || null,
      goLiveApprovedBy: row.go_live_approved_by || null,
      isDefault: Boolean(row.is_default),
      suspendedAt: row.suspended_at || null,
      createdBy: row.created_by || null,
      updatedBy: row.updated_by || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  buildDbPayload(payload = {}) {
    const invoiceSettings = {
      ...(payload.invoiceSettings || {}),
      ...(payload.invoiceSeries ? { invoiceSeries: payload.invoiceSeries } : {}),
      ...(payload.invoicePrefix ? { invoicePrefix: payload.invoicePrefix } : {}),
    };

    return {
      ...(payload.sellerId !== undefined ? { seller_id: payload.sellerId } : {}),
      ...(payload.legalBusinessName !== undefined ? { legal_business_name: payload.legalBusinessName } : {}),
      ...(payload.storeDisplayName !== undefined ? { store_display_name: payload.storeDisplayName } : {}),
      ...(payload.businessType !== undefined ? { business_type: payload.businessType || null } : {}),
      ...(payload.description !== undefined ? { description: payload.description || null } : {}),
      ...(payload.supportEmail !== undefined ? { support_email: payload.supportEmail || null } : {}),
      ...(payload.supportPhone !== undefined ? { support_phone: payload.supportPhone || null } : {}),
      ...(payload.registrationNumber !== undefined ? { registration_number: payload.registrationNumber || null } : {}),
      ...(payload.aadhaarNumber !== undefined ? { aadhaar_number: payload.aadhaarNumber || null } : {}),
      ...(payload.dateOfBirth !== undefined ? { date_of_birth: payload.dateOfBirth || null } : {}),
      ...(payload.businessWebsite !== undefined ? { business_website: payload.businessWebsite || null } : {}),
      ...(payload.primaryContactName !== undefined ? { primary_contact_name: payload.primaryContactName || null } : {}),
      ...(payload.gstin !== undefined ? { gstin: payload.gstin || null } : {}),
      ...(payload.pan !== undefined ? { pan: payload.pan || null } : {}),
      ...(payload.kycStatus !== undefined ? { kyc_status: payload.kycStatus } : {}),
      ...(payload.bankVerificationStatus !== undefined ? { bank_verification_status: payload.bankVerificationStatus } : {}),
      ...(payload.approvalStatus !== undefined ? { approval_status: payload.approvalStatus } : {}),
      ...(payload.documents !== undefined ? { documents: this.jsonb(payload.documents) } : {}),
      ...(payload.bankDetails !== undefined ? { bank_details: this.jsonb(payload.bankDetails) } : {}),
      ...(payload.billingAddress !== undefined ? { billing_address: this.jsonb(payload.billingAddress) } : {}),
      ...(payload.pickupAddress !== undefined ? { pickup_address: this.jsonb(payload.pickupAddress) } : {}),
      ...(payload.returnAddress !== undefined ? { return_address: this.jsonb(payload.returnAddress) } : {}),
      ...(payload.taxSettings !== undefined ? { tax_settings: this.jsonb(payload.taxSettings) } : {}),
      ...(Object.keys(invoiceSettings).length ? { invoice_settings: this.jsonb(invoiceSettings) } : {}),
      ...(payload.payoutSettings !== undefined ? { payout_settings: this.jsonb(payload.payoutSettings) } : {}),
      ...(payload.complianceSettings !== undefined ? { compliance_settings: this.jsonb(payload.complianceSettings) } : {}),
      ...(payload.metadata !== undefined ? { metadata: this.jsonb(payload.metadata) } : {}),
      ...(payload.rejectionReason !== undefined ? { rejection_reason: payload.rejectionReason || null } : {}),
      ...(payload.requiredChanges !== undefined ? { required_changes: this.jsonb(payload.requiredChanges, []) } : {}),
      ...(payload.verificationHistory !== undefined ? { verification_history: this.jsonb(payload.verificationHistory, []) } : {}),
      ...(payload.approvedAt !== undefined ? { approved_at: payload.approvedAt || null } : {}),
      ...(payload.approvedBy !== undefined ? { approved_by: payload.approvedBy || null } : {}),
      ...(payload.rejectedAt !== undefined ? { rejected_at: payload.rejectedAt || null } : {}),
      ...(payload.rejectedBy !== undefined ? { rejected_by: payload.rejectedBy || null } : {}),
      ...(payload.resubmittedAt !== undefined ? { resubmitted_at: payload.resubmittedAt || null } : {}),
      ...(payload.resubmittedBy !== undefined ? { resubmitted_by: payload.resubmittedBy || null } : {}),
      ...(payload.blockedAt !== undefined ? { blocked_at: payload.blockedAt || null } : {}),
      ...(payload.blockedBy !== undefined ? { blocked_by: payload.blockedBy || null } : {}),
      ...(payload.goLiveStatus !== undefined ? { go_live_status: payload.goLiveStatus || "pending" } : {}),
      ...(payload.kycReviewedAt !== undefined ? { kyc_reviewed_at: payload.kycReviewedAt || null } : {}),
      ...(payload.kycReviewedBy !== undefined ? { kyc_reviewed_by: payload.kycReviewedBy || null } : {}),
      ...(payload.bankReviewedAt !== undefined ? { bank_reviewed_at: payload.bankReviewedAt || null } : {}),
      ...(payload.bankReviewedBy !== undefined ? { bank_reviewed_by: payload.bankReviewedBy || null } : {}),
      ...(payload.goLiveApprovedAt !== undefined ? { go_live_approved_at: payload.goLiveApprovedAt || null } : {}),
      ...(payload.goLiveApprovedBy !== undefined ? { go_live_approved_by: payload.goLiveApprovedBy || null } : {}),
      ...(payload.isDefault !== undefined ? { is_default: Boolean(payload.isDefault) } : {}),
      ...(payload.suspendedAt !== undefined ? { suspended_at: payload.suspendedAt } : {}),
      ...(payload.createdBy !== undefined ? { created_by: payload.createdBy || null } : {}),
      ...(payload.updatedBy !== undefined ? { updated_by: payload.updatedBy || null } : {}),
    };
  }

  async create(payload = {}) {
    const id = payload.id || uuidv4();
    const dbPayload = this.buildDbPayload({
      ...payload,
      legalBusinessName: payload.legalBusinessName,
      storeDisplayName: payload.storeDisplayName || payload.legalBusinessName,
      documents: payload.documents || {},
      bankDetails: payload.bankDetails || {},
      billingAddress: payload.billingAddress || {},
      pickupAddress: payload.pickupAddress || {},
      returnAddress: payload.returnAddress || {},
      taxSettings: payload.taxSettings || {},
      invoiceSettings: payload.invoiceSettings || {},
      payoutSettings: payload.payoutSettings || {},
      complianceSettings: payload.complianceSettings || {},
      metadata: payload.metadata || {},
    });

    try {
      const [row] = await knex("seller_organizations")
        .insert({
          id,
          ...dbPayload,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })
        .returning("*");
      return this.rowToOrganization(row);
    } catch (err) {
      if (err.code === "23505" && err.constraint === "uniq_seller_organizations_gstin") {
        throw AppError.duplicate("GSTIN", dbPayload.gstin);
      }
      throw err;
    }
  }

  async update(organizationId, payload = {}) {
    const dbPayload = this.buildDbPayload(payload);
    if (!Object.keys(dbPayload).length) {
      return this.findById(organizationId);
    }

    try {
      const [row] = await knex("seller_organizations")
        .where("id", organizationId)
        .update({
          ...dbPayload,
          updated_at: knex.fn.now(),
        })
        .returning("*");
      return this.rowToOrganization(row);
    } catch (err) {
      if (err.code === "23505" && err.constraint === "uniq_seller_organizations_gstin") {
        throw AppError.duplicate("GSTIN", dbPayload.gstin);
      }
      throw err;
    }
  }

  async findById(organizationId) {
    const [row] = await knex("seller_organizations")
      .where("id", organizationId)
      .limit(1);
    return this.rowToOrganization(row);
  }

  async findByIdForSeller(sellerId, organizationId) {
    const [row] = await knex("seller_organizations")
      .where("id", organizationId)
      .where("seller_id", sellerId)
      .limit(1);
    return this.rowToOrganization(row);
  }

  async listBySeller(sellerId, filters = {}) {
    const rows = await knex("seller_organizations")
      .where("seller_id", sellerId)
      .modify((builder) => {
        if (filters.approvalStatus) builder.where("approval_status", filters.approvalStatus);
        if (filters.kycStatus) builder.where("kyc_status", filters.kycStatus);
        if (filters.q) {
          const term = `%${String(filters.q).trim()}%`;
          builder.where((q) => {
            q.whereILike("legal_business_name", term)
              .orWhereILike("store_display_name", term)
              .orWhereILike("gstin", term)
              .orWhereILike("pan", term);
          });
        }
      })
      .orderBy([{ column: "is_default", order: "desc" }, { column: "created_at", order: "desc" }]);
    return rows.map((row) => this.rowToOrganization(row));
  }

  async listBySellerIds(sellerIds = []) {
    const ids = Array.from(new Set(sellerIds.map((id) => String(id || "")).filter(Boolean)));
    if (!ids.length) return [];
    const rows = await knex("seller_organizations")
      .whereIn("seller_id", ids)
      .orderBy([
        { column: "seller_id", order: "asc" },
        { column: "is_default", order: "desc" },
        { column: "created_at", order: "desc" },
      ]);
    return rows.map((row) => this.rowToOrganization(row));
  }

  async list(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const sellerIds = Array.isArray(filters.sellerIds)
      ? filters.sellerIds.map((id) => String(id || "")).filter(Boolean)
      : [];
    const buildBase = () => knex("seller_organizations")
      .modify((builder) => {
        if (filters.organizationId) builder.where("id", filters.organizationId);
        if (filters.sellerId) builder.where("seller_id", filters.sellerId);
        if (filters.approvalStatus) builder.where("approval_status", filters.approvalStatus);
        if (filters.kycStatus) builder.where("kyc_status", filters.kycStatus);
        if (filters.bankVerificationStatus) builder.where("bank_verification_status", filters.bankVerificationStatus);
        if (filters.goLiveStatus) builder.where("go_live_status", filters.goLiveStatus);
        if (filters.q || sellerIds.length) {
          const term = `%${String(filters.q).trim()}%`;
          builder.where((q) => {
            if (filters.q) {
              q.whereILike("legal_business_name", term)
                .orWhereILike("store_display_name", term)
                .orWhereILike("gstin", term)
                .orWhereILike("pan", term)
                .orWhereILike("seller_id", term);
            }
            if (sellerIds.length) q.orWhereIn("seller_id", sellerIds);
          });
        }
      });

    const [rows, countRows] = await Promise.all([
      buildBase()
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset),
      buildBase().count({ total: "*" }),
    ]);
    return {
      items: rows.map((row) => this.rowToOrganization(row)),
      total: Number(countRows?.[0]?.total || 0),
      limit,
      offset,
    };
  }

  async findDefaultBySeller(sellerId) {
    const [row] = await knex("seller_organizations")
      .where("seller_id", sellerId)
      .where("is_default", true)
      .orderBy("created_at", "desc")
      .limit(1);
    return this.rowToOrganization(row);
  }

  async findLatestBySeller(sellerId) {
    const [row] = await knex("seller_organizations")
      .where("seller_id", sellerId)
      .orderBy("created_at", "desc")
      .limit(1);
    return this.rowToOrganization(row);
  }

  async findByGstinForSeller(sellerId, gstin) {
    if (!gstin) return null;
    const [row] = await knex("seller_organizations")
      .where("seller_id", sellerId)
      .where("gstin", gstin)
      .limit(1);
    return this.rowToOrganization(row);
  }

  async findOnlyBySeller(sellerId) {
    const rows = await knex("seller_organizations")
      .where("seller_id", sellerId)
      .limit(2);
    return rows.length === 1 ? this.rowToOrganization(rows[0]) : null;
  }

  async listDefaultOrLatestBySellerIds(sellerIds = []) {
    const ids = Array.from(new Set(sellerIds.map((id) => String(id || "")).filter(Boolean)));
    if (!ids.length) return [];
    const rows = await knex("seller_organizations")
      .whereIn("seller_id", ids)
      .orderBy([
        { column: "seller_id", order: "asc" },
        { column: "is_default", order: "desc" },
        { column: "created_at", order: "desc" },
      ]);

    const bySeller = new Map();
    rows.forEach((row) => {
      if (!bySeller.has(String(row.seller_id))) {
        bySeller.set(String(row.seller_id), this.rowToOrganization(row));
      }
    });
    return Array.from(bySeller.values());
  }

  async findByIds(organizationIds = []) {
    const ids = Array.from(new Set(organizationIds.map((id) => String(id || "")).filter(Boolean)));
    if (!ids.length) return [];
    const rows = await knex("seller_organizations").whereIn("id", ids);
    return rows.map((row) => this.rowToOrganization(row));
  }

  async findMapByIds(organizationIds = []) {
    const organizations = await this.findByIds(organizationIds);
    return new Map(organizations.map((organization) => [String(organization.id), organization]));
  }

  async setDefault(sellerId, organizationId, actorId = null) {
    return knex.transaction(async (trx) => {
      await trx("seller_organizations")
        .where("seller_id", sellerId)
        .update({
          is_default: false,
          updated_by: actorId,
          updated_at: knex.fn.now(),
        });

      const [row] = await trx("seller_organizations")
        .where("id", organizationId)
        .where("seller_id", sellerId)
        .update({
          is_default: true,
          updated_by: actorId,
          updated_at: knex.fn.now(),
        })
        .returning("*");
      return this.rowToOrganization(row);
    });
  }
}

module.exports = { SellerOrganizationRepository };
