const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../../shared/logger/logger");
const { AppError } = require("../../../shared/errors/app-error");
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");
const {
  ORDER_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
} = require("../../../shared/domain/commerce-constants");
const { documentRendererService } = require("../../../shared/services/document-renderer.service");
const { UserModel } = require("../../user/models/user.model");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { env } = require("../../../config/env");
const { sendMail } = require("../../../infrastructure/mail/mailer");
const { RazorpayXPayoutProvider } = require("../../../infrastructure/payouts/providers/razorpayx.provider");
const { WalletService } = require("../../wallet/services/wallet.service");
const {
  calculateInclusiveShippingTax,
  resolveShippingPolicy,
} = require("../../../shared/domain/seller-payout-rules");

class SellerCommissionService {
  constructor({ razorpayXProvider = new RazorpayXPayoutProvider(), walletService = new WalletService() } = {}) {
    this.razorpayXProvider = razorpayXProvider;
    this.walletService = walletService;
  }

  async publishPayoutEvent(payout = {}, actor = {}) {
    if (!payout?.id || !payout?.seller_id) return;
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.SELLER_PAYOUT_STATUS_UPDATED_V1,
        {
          payoutId: payout.id,
          sellerId: payout.seller_id,
          organizationId: payout.organization_id || null,
          status: payout.status,
          netAmount: payout.net_amount,
          totalAmount: payout.total_amount,
          currency: payout.currency || "INR",
          paymentReference: payout.payment_reference || null,
          processedAt: payout.processed_at || null,
          viewUrl: `/app/seller-payouts?payoutId=${encodeURIComponent(payout.id)}`,
          updatedBy: actor.userId || actor.sub || null,
        },
        {
          source: "seller-commission-module",
          aggregateId: payout.id,
        },
      ),
    );
  }

  round(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  sanitizeRazorpayXName(value, fallback = "Seller") {
    const cleaned = String(value || "")
      .replace(/@/g, " ")
      .replace(/[^a-zA-Z0-9 .,&()'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    if (cleaned.length >= 3) return cleaned;
    const fallbackName = String(fallback || "Seller")
      .replace(/[^a-zA-Z0-9 .,&()'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return fallbackName.length >= 3 ? fallbackName : "Seller";
  }

  escapeMailHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  formatPayoutDate(value) {
    if (!value) return "-";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(date);
  }

  payoutMethodLabel(paymentMethod) {
    const value = String(paymentMethod || "").toLowerCase();
    if (this.isSellerWalletRequested(value)) return "Seller Wallet";
    if (this.isRazorpayXRequested(value) || value === "razorpayx") return "Bank Transfer via RazorpayX";
    return value ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Manual Transfer";
  }

  getRazorpayXFailureReason(entity = {}, providerStatus = "failed") {
    const statusDetails = entity.status_details || {};
    const statusDetailText = typeof statusDetails === "string"
      ? statusDetails
      : statusDetails.description || statusDetails.reason || statusDetails.message;
    return [
      entity.failure_reason,
      entity.failure_description,
      entity.error?.description,
      entity.error?.reason,
      statusDetailText,
      entity.reason,
      `RazorpayX ${providerStatus}`,
    ].find((value) => String(value || "").trim()) || `RazorpayX ${providerStatus}`;
  }

  getRazorpayXReversalId(entity = {}) {
    return entity.reversal_id ||
      entity.reversal?.id ||
      entity.reversal?.entity?.id ||
      entity.reversals?.items?.[0]?.id ||
      null;
  }

  getRazorpayXValidationFailureReason(validation = {}) {
    const statusDetails = validation.status_details || validation.validation_results?.status_details || {};
    const resultDetails = validation.results || validation.validation_results || {};
    return [
      validation.failure_reason,
      validation.failure_description,
      validation.error?.description,
      statusDetails.description,
      statusDetails.reason,
      statusDetails.message,
      resultDetails.description,
      resultDetails.reason,
      resultDetails.message,
      validation.status ? `RazorpayX fund account validation ${validation.status}` : null,
    ].find((value) => String(value || "").trim()) || "RazorpayX fund account validation failed";
  }

  bankFingerprint(bank = {}) {
    return [
      String(bank.accountHolderName || "").trim().toLowerCase(),
      String(bank.accountNumber || "").replace(/\D/g, ""),
      String(bank.ifscCode || "").trim().toUpperCase(),
    ].join(":");
  }

  async sendSellerPayoutCompletedEmail(payout = {}) {
    if (!payout?.id || !payout?.seller_id) return null;
    const seller = await UserModel.findById(String(payout.seller_id))
      .select("email profile sellerProfile")
      .lean()
      .catch((error) => {
        logger.warn({ err: error, sellerId: payout.seller_id, payoutId: payout.id }, "Unable to load seller for payout email");
        return null;
      });
    const organizationSnapshot = this.parseJson(payout.organization_snapshot, {});
    const to = seller?.email || seller?.sellerProfile?.supportEmail || organizationSnapshot.supportEmail || organizationSnapshot.email;
    if (!to) {
      logger.warn({ sellerId: payout.seller_id, payoutId: payout.id }, "Seller payout email skipped because seller email is missing");
      return null;
    }

    const sellerName = organizationSnapshot.storeDisplayName ||
      organizationSnapshot.legalBusinessName ||
      seller?.sellerProfile?.displayName ||
      seller?.sellerProfile?.businessName ||
      [seller?.profile?.firstName, seller?.profile?.lastName].filter(Boolean).join(" ") ||
      "Seller";
    const currency = payout.currency || "INR";
    const method = this.payoutMethodLabel(payout.payment_method);
    const processedAt = this.formatPayoutDate(payout.processed_at || new Date());
    const period = `${this.formatPayoutDate(payout.period_start)} - ${this.formatPayoutDate(payout.period_end)}`;
    const reference = payout.payment_reference || payout.id;
    const amount = this.renderMoney(payout.net_amount, currency);
    const rows = [
      ["Payout ID", payout.id],
      ["Amount Credited", amount],
      ["Payment Method", method],
      ["Payment Reference", reference],
      ["Status", "Completed"],
      ["Processed At", processedAt],
      ["Settlement Period", period],
      ["Gross Sales", this.renderMoney(payout.total_amount, currency)],
      ["Platform Commission", this.renderMoney(payout.commission_amount, currency)],
      ["Tax / TCS / TDS", this.renderMoney(payout.tax_amount, currency)],
      ["Refunds / Adjustments", this.renderMoney((Number(payout.refund_amount || 0) + Number(payout.adjustment_amount || 0)), currency)],
    ];
    const tableRows = rows.map(([label, value]) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e8edf5;color:#64748b;">${this.escapeMailHtml(label)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8edf5;color:#0f172a;font-weight:600;">${this.escapeMailHtml(value)}</td>
      </tr>
    `).join("");
    const subject = `Seller payout completed - ${amount}`;
    const text = [
      `Hi ${sellerName},`,
      "",
      `Your seller payout has been completed.`,
      `Amount: ${amount}`,
      `Method: ${method}`,
      `Reference: ${reference}`,
      `Payout ID: ${payout.id}`,
      `Processed at: ${processedAt}`,
      `Period: ${period}`,
      "",
      "You can check the payout status in your seller finance dashboard.",
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:24px;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <div style="padding:22px 24px;background:#0f1b4c;color:#ffffff;">
            <div style="font-size:18px;font-weight:700;">Seller payout completed</div>
            <div style="font-size:14px;margin-top:6px;color:#dbeafe;">${this.escapeMailHtml(amount)} has been settled to ${this.escapeMailHtml(method)}.</div>
          </div>
          <div style="padding:24px;">
            <p style="margin:0 0 16px;">Hi ${this.escapeMailHtml(sellerName)},</p>
            <p style="margin:0 0 18px;color:#475569;">Your payout is now marked completed. Here are the payout details:</p>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e8edf5;border-radius:6px;overflow:hidden;">${tableRows}</table>
            <p style="margin:18px 0 0;color:#64748b;font-size:13px;">You can check the full status and settlement details in your seller finance dashboard.</p>
          </div>
        </div>
      </div>
    `;

    logger.warn({
      payoutId: payout.id,
      sellerId: payout.seller_id,
      to,
      smtpMode: env.smtp.mode,
      smtpLive: env.smtp.live,
    }, "Sending seller payout completion email");

    const result = await sendMail({ to, subject, text, html });
    logger.warn({
      payoutId: payout.id,
      sellerId: payout.seller_id,
      to,
      messageId: result?.messageId,
      mode: result?.mode,
      accepted: result?.accepted || [],
      rejected: result?.rejected || [],
    }, "Seller payout completion email sent");
    return result;
  }

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

  isRazorpayXRequested(paymentMethod) {
    return ["razorpayx", "razorpay_x", "bank_transfer_auto"].includes(String(paymentMethod || "").toLowerCase());
  }

  isSellerWalletRequested(paymentMethod) {
    return ["seller_wallet", "wallet", "internal_wallet"].includes(String(paymentMethod || "").toLowerCase());
  }

  normalizePayoutDestination(destination) {
    const value = String(destination || "").toLowerCase();
    return this.isSellerWalletRequested(value) ? "seller_wallet" : "razorpayx";
  }

  async ensureSellerPayoutProfilesTable() {
    if (this.sellerPayoutProfilesReady) return;
    await knex.schema.raw(`
      CREATE TABLE IF NOT EXISTS seller_payout_profiles (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL,
        organization_id UUID,
        payout_destination VARCHAR(32) NOT NULL DEFAULT 'razorpayx',
        bank_details JSONB NOT NULL DEFAULT '{}'::jsonb,
        bank_verification_status VARCHAR(32) NOT NULL DEFAULT 'submitted',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_payout_profiles_org
      ON seller_payout_profiles(seller_id, organization_id)
      WHERE organization_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_payout_profiles_default
      ON seller_payout_profiles(seller_id)
      WHERE organization_id IS NULL;
    `);
    this.sellerPayoutProfilesReady = true;
  }

  async getSellerPayoutProfile(sellerId, organizationId = null) {
    await this.ensureSellerPayoutProfilesTable();
    const query = knex("seller_payout_profiles").where("seller_id", sellerId);
    if (organizationId) query.where("organization_id", organizationId);
    else query.whereNull("organization_id");
    return query.first();
  }

  async findSellerPayoutProfile(sellerId, organizationId = null) {
    const scoped = organizationId ? await this.getSellerPayoutProfile(sellerId, organizationId) : null;
    if (scoped) return scoped;
    return this.getSellerPayoutProfile(sellerId, null);
  }

  async saveSellerPayoutProfile(sellerId, organizationId = null, payload = {}, actor = {}) {
    await this.ensureSellerPayoutProfilesTable();
    const existing = await this.getSellerPayoutProfile(sellerId, organizationId);
    const now = new Date().toISOString();
    const bankDetails = payload.bankDetails !== undefined
      ? {
        accountHolderName: String(payload.bankDetails?.accountHolderName || "").trim(),
        accountNumber: String(payload.bankDetails?.accountNumber || "").replace(/\D/g, ""),
        ifscCode: String(payload.bankDetails?.ifscCode || "").trim().toUpperCase(),
        bankName: String(payload.bankDetails?.bankName || "").trim(),
        branchName: String(payload.bankDetails?.branchName || "").trim(),
      }
      : this.parseJson(existing?.bank_details, {});
    const destination = this.normalizePayoutDestination(payload.payoutDestination || payload.destination || existing?.payout_destination);
    const data = {
      payout_destination: destination,
      bank_details: this.jsonb(bankDetails),
      bank_verification_status: payload.bankDetails !== undefined ? "submitted" : existing?.bank_verification_status || "submitted",
      metadata: this.jsonb({
        ...this.parseJson(existing?.metadata, {}),
        updatedBy: actor.userId || actor.sub || sellerId,
        updatedAt: now,
      }),
      updated_at: knex.fn.now(),
    };
    if (existing) {
      const [updated] = await knex("seller_payout_profiles")
        .where("id", existing.id)
        .update(data)
        .returning("*");
      return updated;
    }
    const [created] = await knex("seller_payout_profiles")
      .insert({
        id: uuidv4(),
        seller_id: sellerId,
        organization_id: organizationId || null,
        ...data,
        created_at: knex.fn.now(),
      })
      .returning("*");
    return created;
  }

  async resolveSellerPayoutPreference(sellerId, organizationId = null, settings = null) {
    const commerceSettings = settings || await commerceSettingsService.getSettings();
    const finance = commerceSettings.finance || {};
    let organization = null;
    if (organizationId) {
      organization = await knex("seller_organizations")
        .where({ id: organizationId, seller_id: sellerId })
        .first();
    } else {
      organization = await knex("seller_organizations")
        .where("seller_id", sellerId)
        .orderByRaw("CASE WHEN is_default THEN 0 ELSE 1 END")
        .orderBy("created_at", "asc")
        .first();
    }
    const payoutProfile = await this.findSellerPayoutProfile(sellerId, organization?.id || organizationId || null);
    const sellerChoice = payoutProfile?.payout_destination || null;
    const destination = finance.allowSellerPayoutDestinationChoice !== false && sellerChoice
      ? sellerChoice
      : finance.defaultPayoutDestination;
    return {
      sellerId,
      organizationId: organization?.id || organizationId || null,
      destination: this.normalizePayoutDestination(destination),
      sellerChoice: sellerChoice ? this.normalizePayoutDestination(sellerChoice) : null,
      platformDefault: this.normalizePayoutDestination(finance.defaultPayoutDestination),
      sellerCanChoose: finance.allowSellerPayoutDestinationChoice !== false,
      bankDetails: this.parseJson(payoutProfile?.bank_details, {}),
      bankVerificationStatus: payoutProfile?.bank_verification_status || null,
    };
  }

  async updateSellerPayoutPreference(sellerId, payload = {}, actor = {}) {
    const commerceSettings = await commerceSettingsService.getSettings();
    if (commerceSettings.finance?.allowSellerPayoutDestinationChoice === false) {
      throw new AppError("Seller payout destination choice is disabled by admin", 403);
    }
    const destination = this.normalizePayoutDestination(payload.destination || payload.payoutDestination);
    const organizationId = payload.organizationId || actor.selectedOrganizationId || null;
    const organization = organizationId
      ? await knex("seller_organizations").where({ id: organizationId, seller_id: sellerId }).first()
      : await knex("seller_organizations")
        .where("seller_id", sellerId)
        .orderByRaw("CASE WHEN is_default THEN 0 ELSE 1 END")
        .orderBy("created_at", "asc")
        .first();
    const payoutOrganizationId = organization?.id || null;
    const updated = await this.saveSellerPayoutProfile(sellerId, payoutOrganizationId, {
      payoutDestination: destination,
      bankDetails: payload.bankDetails,
    }, actor);
    return {
      sellerId,
      organizationId: payoutOrganizationId,
      destination,
      payoutSettings: {
        payoutDestination: destination,
        bankVerificationStatus: updated.bank_verification_status,
        bankDetails: this.parseJson(updated.bank_details, {}),
      },
      updatedAt: updated?.updated_at || new Date().toISOString(),
    };
  }

  async resolvePayoutBankDetails(payout = {}) {
    let organization = null;
    if (payout.organization_id) {
      organization = await knex("seller_organizations").where("id", payout.organization_id).first();
    }
    const seller = await UserModel.findById(payout.seller_id).lean().catch(() => null);
    const payoutProfile = await this.findSellerPayoutProfile(payout.seller_id, payout.organization_id || null);
    const orgBank = this.parseJson(payoutProfile?.bank_details, {});
    const organizationBank = this.parseJson(organization?.bank_details, {});
    const profileBank = seller?.sellerProfile?.bankDetails || {};
    const bank = Object.keys(orgBank || {}).length
      ? orgBank
      : Object.keys(organizationBank || {}).length
        ? organizationBank
        : profileBank;
    const accountHolderName = bank.accountHolderName || bank.holderName || bank.account_holder_name;
    const accountNumber = bank.accountNumber || bank.account_number;
    const ifscCode = bank.ifscCode || bank.ifsc || bank.ifsc_code;
    const bankName = bank.bankName || bank.bank_name;
    const bankVerificationStatus = String(
      payoutProfile?.bank_verification_status ||
        organization?.bank_verification_status ||
        seller?.sellerProfile?.bankVerificationStatus ||
        "",
    ).toLowerCase();
    const rejected = ["rejected", "failed", "invalid"].includes(bankVerificationStatus);
    if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
      throw new AppError("Seller bank details are incomplete. Complete seller onboarding bank details before RazorpayX payout.", 409);
    }
    if (rejected) {
      throw new AppError("Seller bank account is rejected. Update and verify bank details before RazorpayX payout.", 409);
    }
    return {
      seller,
      organization,
      payoutProfile,
      bankVerificationStatus,
      bank: { accountHolderName, accountNumber, ifscCode, bankName },
    };
  }

  async ensureRazorpayXFundAccount(payout = {}, seller = {}, organization = {}, bank = {}, payoutProfile = null, actor = {}) {
    const existingProfile = payoutProfile || await this.findSellerPayoutProfile(payout.seller_id, payout.organization_id || null);
    const profileMetadata = this.parseJson(existingProfile?.metadata, {});
    const cached = profileMetadata.razorpayX || {};
    const fingerprint = this.bankFingerprint(bank);
    if (
      cached.bankFingerprint === fingerprint &&
      cached.mode === env.razorpayX.mode &&
      cached.contactId &&
      cached.fundAccountId &&
      cached.validationId &&
      cached.validationStatus !== "completed"
    ) {
      const validation = await this.razorpayXProvider.fetchFundAccountValidation(cached.validationId);
      const validationStatus = String(validation.status || cached.validationStatus || "created").toLowerCase();
      const validationMetadata = {
        ...profileMetadata,
        razorpayX: {
          ...cached,
          mode: env.razorpayX.mode,
          validationStatus,
          validatedAt: validationStatus === "completed" ? new Date().toISOString() : cached.validatedAt || null,
          validation,
          updatedAt: new Date().toISOString(),
          updatedBy: actor?.userId || actor?.sub || null,
        },
      };
      await knex("seller_payout_profiles")
        .where("id", existingProfile.id)
        .update({
          bank_verification_status: validationStatus === "completed" ? "verified" : validationStatus,
          metadata: this.jsonb(validationMetadata),
          updated_at: knex.fn.now(),
        });
      if (validationStatus === "completed") {
        return {
          contactId: cached.contactId,
          fundAccountId: cached.fundAccountId,
          validation,
          reused: true,
        };
      }
      const reason = this.getRazorpayXValidationFailureReason(validation);
      throw new AppError(
        validationStatus === "failed"
          ? `Seller bank account validation failed: ${reason}`
          : "Seller bank account validation is still pending. Retry the payout after RazorpayX confirms the fund account.",
        409,
      );
    }
    if (
      cached.bankFingerprint === fingerprint &&
      cached.mode === env.razorpayX.mode &&
      cached.contactId &&
      cached.fundAccountId &&
      cached.validationStatus === "completed"
    ) {
      return {
        contactId: cached.contactId,
        fundAccountId: cached.fundAccountId,
        validation: cached.validation || { status: "completed" },
        reused: true,
      };
    }

    const organizationSnapshot = this.parseJson(payout.organization_snapshot, {});
    const sellerName = this.sanitizeRazorpayXName(
      organization?.legal_business_name ||
        organization?.store_display_name ||
        organizationSnapshot.legalBusinessName ||
        organizationSnapshot.storeDisplayName ||
        seller?.profile?.name ||
        seller?.name ||
        seller?.email ||
        payout.seller_id,
      "Seller",
    );
    const accountHolderName = this.sanitizeRazorpayXName(bank.accountHolderName, sellerName);
    const contact = await this.razorpayXProvider.createContact({
      name: sellerName,
      email: seller?.email || organization?.support_email || undefined,
      contact: seller?.phone || organization?.support_phone || undefined,
      referenceId: String(payout.seller_id),
      notes: { sellerId: String(payout.seller_id), organizationId: payout.organization_id || "" },
    });
    const fundAccount = await this.razorpayXProvider.createFundAccount({
      contactId: contact.id,
      accountHolderName,
      accountNumber: bank.accountNumber,
      ifsc: bank.ifscCode,
      notes: { sellerId: String(payout.seller_id), organizationId: payout.organization_id || "" },
    });
    const validation = await this.razorpayXProvider.validateFundAccount({
      fundAccountId: fundAccount.id,
      referenceId: `fav_${String(payout.id).slice(0, 32)}`,
      notes: { sellerPayoutId: payout.id, sellerId: String(payout.seller_id) },
    });
    const validationStatus = String(validation.status || "created").toLowerCase();
    const validationMetadata = {
      ...profileMetadata,
      razorpayX: {
        bankFingerprint: fingerprint,
        mode: env.razorpayX.mode,
        contactId: contact.id,
        fundAccountId: fundAccount.id,
        validationId: validation.id || null,
        validationStatus,
        validatedAt: validationStatus === "completed" ? new Date().toISOString() : null,
        validation,
        updatedAt: new Date().toISOString(),
        updatedBy: actor?.userId || actor?.sub || null,
      },
    };
    if (existingProfile?.id) {
      await knex("seller_payout_profiles")
        .where("id", existingProfile.id)
        .update({
          bank_verification_status: validationStatus === "completed" ? "verified" : validationStatus,
          metadata: this.jsonb(validationMetadata),
          updated_at: knex.fn.now(),
        });
    } else {
      await knex("seller_payout_profiles")
        .insert({
          id: uuidv4(),
          seller_id: payout.seller_id,
          organization_id: payout.organization_id || null,
          payout_destination: "razorpayx",
          bank_details: this.jsonb(bank),
          bank_verification_status: validationStatus === "completed" ? "verified" : validationStatus,
          metadata: this.jsonb(validationMetadata),
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })
        .catch((error) => {
          if (error?.code !== "23505") throw error;
        });
    }
    if (validationStatus !== "completed") {
      const reason = this.getRazorpayXValidationFailureReason(validation);
      logger.warn({
        payoutId: payout.id,
        sellerId: payout.seller_id,
        organizationId: payout.organization_id || null,
        fundAccountId: fundAccount.id,
        validationId: validation.id || null,
        validationStatus,
        reason,
      }, "RazorpayX fund account validation did not complete");
      throw new AppError(
        validationStatus === "failed"
          ? `Seller bank account validation failed: ${reason}`
          : "Seller bank account validation is still pending. Retry the payout after RazorpayX confirms the fund account.",
        409,
      );
    }
    return {
      contactId: contact.id,
      fundAccountId: fundAccount.id,
      validation,
      reused: false,
    };
  }

  async initiateRazorpayXPayout(payoutId, options = {}) {
    let payout = await knex("seller_payouts").where("id", payoutId).first();
    if (!payout) throw new AppError("Payout not found", 404);
    if (payout.status === "completed") return payout;
    if (["pending", "on_hold"].includes(payout.status)) {
      const metadata = {
        ...this.parseJson(payout.metadata, {}),
        approvedBy: options.actor?.userId || options.actor?.sub || null,
        approvedAt: new Date().toISOString(),
        approvalNote: options.note || "Approved for RazorpayX payout",
        autoApprovedForRazorpayX: true,
      };
      const [approved] = await knex("seller_payouts").where("id", payoutId).update({
        status: "processing",
        payment_method: "razorpayx",
        metadata: this.jsonb(metadata),
        updated_at: knex.fn.now(),
      }).returning("*");
      await knex("seller_commissions")
        .where("payout_id", payoutId)
        .whereIn("status", ["pending", "approved"])
        .update({ status: "approved", updated_at: knex.fn.now() });
      payout = approved;
    }
    if (!["processing", "approved"].includes(payout.status)) {
      throw new AppError(`RazorpayX payout cannot be initiated from ${payout.status}`, 409);
    }
    if (!env.razorpayX.enabled) {
      throw new AppError("RazorpayX payouts are not enabled. Use manual payout or configure RazorpayX.", 503);
    }

    const metadata = this.parseJson(payout.metadata, {});
    if (metadata.razorpayX?.payoutId) return payout;
    const { seller, organization, bank, payoutProfile } = await this.resolvePayoutBankDetails(payout);
    let fundAccountContext;
    try {
      fundAccountContext = await this.ensureRazorpayXFundAccount(
        payout,
        seller,
        organization,
        bank,
        payoutProfile,
        options.actor,
      );
    } catch (error) {
      const holdMetadata = {
        ...this.parseJson((await knex("seller_payouts").where("id", payoutId).first())?.metadata, metadata),
        razorpayXValidationError: {
          message: error.message,
          statusCode: error.statusCode || error.status || null,
          at: new Date().toISOString(),
        },
      };
      await knex("seller_payouts")
        .where("id", payoutId)
        .update({
          status: "on_hold",
          metadata: this.jsonb(holdMetadata),
          updated_at: knex.fn.now(),
        });
      await knex("seller_commissions")
        .where("payout_id", payoutId)
        .whereIn("status", ["pending", "approved"])
        .update({ status: "approved", updated_at: knex.fn.now() });
      throw error;
    }
    const payoutMetadata = await knex("seller_payouts").where("id", payoutId).first();
    const latestMetadata = this.parseJson(payoutMetadata?.metadata, metadata);
    const idempotencyKey = latestMetadata.razorpayX?.idempotencyKey || uuidv4();
    let providerPayout;
    try {
      providerPayout = await this.razorpayXProvider.createPayout({
        fundAccountId: fundAccountContext.fundAccountId,
        amount: payout.net_amount,
        currency: payout.currency || "INR",
        referenceId: payout.id,
        narration: "Seller payout",
        notes: { sellerPayoutId: payout.id, sellerId: String(payout.seller_id) },
        idempotencyKey,
      });
    } catch (error) {
      await knex("seller_payouts")
        .where("id", payoutId)
        .update({
          status: "on_hold",
          metadata: this.jsonb({
            ...latestMetadata,
            razorpayX: {
              ...(latestMetadata.razorpayX || {}),
              contactId: fundAccountContext.contactId,
              fundAccountId: fundAccountContext.fundAccountId,
              idempotencyKey,
              fundAccountValidation: fundAccountContext.validation,
              payoutCreateError: {
                message: error.message,
                statusCode: error.statusCode || error.status || null,
                at: new Date().toISOString(),
              },
            },
          }),
          updated_at: knex.fn.now(),
        });
      throw error;
    }
    const providerStatus = String(providerPayout.status || "processing").toLowerCase();
    const providerFailureReason = this.getRazorpayXFailureReason(providerPayout, providerStatus);
    const providerReversalId = this.getRazorpayXReversalId(providerPayout);
    const providerMeta = {
      provider: "razorpayx",
      mode: env.razorpayX.mode,
      contactId: fundAccountContext.contactId,
      fundAccountId: fundAccountContext.fundAccountId,
      payoutId: providerPayout.id,
      status: providerStatus,
      idempotencyKey,
      failureReason: ["failed", "rejected", "cancelled", "reversed"].includes(providerStatus) ? providerFailureReason : null,
      reversalId: providerReversalId,
      fundAccountValidation: fundAccountContext.validation,
      initiatedAt: new Date().toISOString(),
      initiatedBy: options.actor?.userId || options.actor?.sub || null,
      bank: {
        accountHolderName: bank.accountHolderName,
        accountNumberLast4: String(bank.accountNumber).slice(-4),
        ifscCode: bank.ifscCode,
        bankName: bank.bankName,
      },
      raw: providerPayout,
    };
    logger.warn({
      payoutId,
      sellerId: payout.seller_id,
      organizationId: payout.organization_id || null,
      providerPayoutId: providerPayout.id,
      providerStatus,
      reversalId: providerReversalId,
      failureReason: providerMeta.failureReason,
      amount: payout.net_amount,
      bankName: bank.bankName,
      accountNumberLast4: String(bank.accountNumber).slice(-4),
    }, "RazorpayX seller payout created");
    if (["processed", "completed"].includes(providerStatus)) {
      await knex("seller_payouts").where("id", payoutId).update({
        status: "processing",
        payment_method: "razorpayx",
        payment_reference: providerPayout.id,
        metadata: this.jsonb({ ...latestMetadata, razorpayX: providerMeta }),
        updated_at: knex.fn.now(),
      });
      return this.processPayout(payoutId, providerPayout.id, {
        paymentMethod: "razorpayx",
        notes: "RazorpayX payout processed",
        actor: options.actor,
      });
    }
    if (["failed", "rejected", "cancelled", "reversed"].includes(providerStatus)) {
      await knex("seller_payouts").where("id", payoutId).update({
        status: "processing",
        payment_method: "razorpayx",
        payment_reference: providerPayout.id,
        metadata: this.jsonb({ ...latestMetadata, razorpayX: providerMeta }),
        updated_at: knex.fn.now(),
      });
      return this.failPayout(payoutId, providerFailureReason, options.actor, {
        providerStatus,
        providerPayoutId: providerPayout.id,
        reversalId: providerReversalId,
      });
    }
    const [updated] = await knex("seller_payouts").where("id", payoutId).update({
      status: "processing",
      payment_method: "razorpayx",
      payment_reference: providerPayout.id,
      metadata: this.jsonb({ ...latestMetadata, razorpayX: providerMeta }),
      updated_at: knex.fn.now(),
    }).returning("*");
    await this.publishPayoutEvent(updated, options.actor);
    return updated;
  }

  async handleRazorpayXPayoutWebhook(entity = {}, eventType = "payout.processed", actor = {}) {
    const providerPayoutId = entity.id;
    if (!providerPayoutId) throw new AppError("RazorpayX payout ID is missing", 400);
    const payout = await knex("seller_payouts")
      .where("payment_reference", providerPayoutId)
      .orWhereRaw("COALESCE(metadata, '{}'::jsonb) #>> '{razorpayX,payoutId}' = ?", [providerPayoutId])
      .first();
    if (!payout) return { acknowledged: true, ignored: true };
    const providerStatus = String(entity.status || eventType.split(".")[1] || "processing").toLowerCase();
    const failureReason = this.getRazorpayXFailureReason(entity, providerStatus);
    const reversalId = this.getRazorpayXReversalId(entity);
    const metadata = {
      ...this.parseJson(payout.metadata, {}),
      razorpayX: {
        ...(this.parseJson(payout.metadata, {}).razorpayX || {}),
        payoutId: providerPayoutId,
        status: providerStatus,
        failureReason: ["failed", "rejected", "cancelled", "reversed"].includes(providerStatus) ? failureReason : null,
        reversalId,
        lastWebhookEvent: eventType,
        lastWebhookAt: new Date().toISOString(),
        rawWebhook: entity,
      },
    };
    logger.warn({
      payoutId: payout.id,
      sellerId: payout.seller_id,
      organizationId: payout.organization_id || null,
      currentStatus: payout.status,
      providerPayoutId,
      providerStatus,
      eventType,
      reversalId,
      failureReason: ["failed", "rejected", "cancelled", "reversed"].includes(providerStatus) ? failureReason : null,
    }, "RazorpayX seller payout status received");
    await knex("seller_payouts").where("id", payout.id).update({
      payment_method: "razorpayx",
      payment_reference: providerPayoutId,
      metadata: this.jsonb(metadata),
      updated_at: knex.fn.now(),
    });
    if (["processed", "completed"].includes(providerStatus)) {
      if (payout.status === "completed") return { ...payout, metadata, status: "completed" };
      return this.processPayout(payout.id, providerPayoutId, {
        paymentMethod: "razorpayx",
        notes: "RazorpayX payout confirmed by webhook",
        actor,
      });
    }
    if (["failed", "rejected", "cancelled", "reversed"].includes(providerStatus)) {
      return this.failPayout(
        payout.id,
        failureReason,
        actor,
        {
          allowCompleted: providerStatus === "reversed",
          providerStatus,
          providerPayoutId,
          reversalId,
        },
      );
    }
    const [updated] = await knex("seller_payouts").where("id", payout.id).update({
      status: "processing",
      metadata: this.jsonb(metadata),
      updated_at: knex.fn.now(),
    }).returning("*");
    await this.publishPayoutEvent(updated, actor);
    return updated;
  }

  async syncRazorpayXPayoutStatus(payoutId, actor = {}) {
    const payout = await knex("seller_payouts").where("id", payoutId).first();
    if (!payout) throw new AppError("Payout not found", 404);
    const metadata = this.parseJson(payout.metadata, {});
    const providerPayoutId = payout.payment_reference || metadata.razorpayX?.payoutId;
    if (String(payout.payment_method || "").toLowerCase() !== "razorpayx" && !providerPayoutId) {
      throw new AppError("This payout was not initiated through RazorpayX", 409);
    }
    if (!providerPayoutId) {
      throw new AppError("RazorpayX provider payout ID is missing. Start payout first.", 409);
    }
    if (!env.razorpayX.enabled) {
      throw new AppError("RazorpayX payouts are not enabled. Configure RazorpayX before syncing status.", 503);
    }
    logger.warn({
      payoutId,
      sellerId: payout.seller_id,
      organizationId: payout.organization_id || null,
      providerPayoutId,
      currentStatus: payout.status,
    }, "Syncing RazorpayX seller payout status");
    const providerPayout = await this.razorpayXProvider.fetchPayout(providerPayoutId);
    return this.handleRazorpayXPayoutWebhook(
      providerPayout,
      `payout.${String(providerPayout.status || "pending").toLowerCase()}`,
      actor,
    );
  }

  async syncPendingRazorpayXPayouts(options = {}) {
    if (!env.razorpayX.enabled) {
      return { skipped: true, reason: "razorpayx_disabled", checked: 0, updated: 0, failed: [] };
    }
    const limit = Math.min(Math.max(Number(options.limit || 50), 1), 100);
    const rows = await knex("seller_payouts")
      .where("status", "processing")
      .andWhere((builder) => {
        builder
          .whereRaw("LOWER(COALESCE(payment_method, '')) = 'razorpayx'")
          .orWhereRaw("COALESCE(metadata, '{}'::jsonb) #>> '{razorpayX,payoutId}' IS NOT NULL");
      })
      .orderBy("updated_at", "asc")
      .limit(limit);

    const synced = [];
    const failed = [];
    for (const row of rows) {
      try {
        const result = await this.syncRazorpayXPayoutStatus(row.id, options.actor || {
          userId: "system:razorpayx-payout-sync",
          role: "system",
        });
        synced.push({
          payoutId: row.id,
          providerPayoutId: row.payment_reference || this.parseJson(row.metadata, {}).razorpayX?.payoutId || null,
          previousStatus: row.status,
          status: result?.status || null,
          providerStatus: this.parseJson(result?.metadata, {}).razorpayX?.status || null,
        });
      } catch (error) {
        failed.push({
          payoutId: row.id,
          providerPayoutId: row.payment_reference || this.parseJson(row.metadata, {}).razorpayX?.payoutId || null,
          error: error.message,
          statusCode: error.statusCode || error.status || null,
        });
      }
    }

    logger.warn({
      checked: rows.length,
      synced: synced.length,
      failed: failed.length,
      syncedPayouts: synced,
      failedPayouts: failed,
    }, "RazorpayX processing seller payouts sync completed");
    return { checked: rows.length, synced, failed };
  }

  async completeSellerWalletPayout(payoutId, options = {}) {
    const payout = await knex("seller_payouts").where("id", payoutId).first();
    if (!payout) throw new AppError("Payout not found", 404);
    if (payout.status === "completed") return payout;
    if (payout.status !== "processing") {
      throw new AppError(`Seller wallet payout cannot be completed from ${payout.status}`, 409);
    }
    const metadata = this.parseJson(payout.metadata, {});
    const walletReference = `seller_payout:${payoutId}`;
    await this.walletService.credit(payout.seller_id, Number(payout.net_amount || 0), {
      referenceType: "seller_payout",
      referenceId: payoutId,
      metadata: {
        sellerId: payout.seller_id,
        organizationId: payout.organization_id || null,
        payoutId,
        source: "seller_wallet_payout",
        creditedBy: options.actor?.userId || options.actor?.sub || "system",
      },
    });
    await knex("seller_payouts").where("id", payoutId).update({
      payment_method: "seller_wallet",
      payment_reference: walletReference,
      metadata: this.jsonb({
        ...metadata,
        sellerWallet: {
          credited: true,
          walletReference,
          creditedAt: new Date().toISOString(),
          creditedBy: options.actor?.userId || options.actor?.sub || "system",
        },
      }),
      updated_at: knex.fn.now(),
    });
    return this.processPayout(payoutId, walletReference, {
      paymentMethod: "seller_wallet",
      notes: options.notes || "Seller payout credited to seller wallet",
      actor: options.actor,
    });
  }

  async startPayoutTransfer(payoutId, options = {}) {
    const payout = await knex("seller_payouts").where("id", payoutId).first();
    if (!payout) throw new AppError("Payout not found", 404);
    const commerceSettings = await commerceSettingsService.getSettings();
    const preference = await this.resolveSellerPayoutPreference(
      payout.seller_id,
      payout.organization_id || null,
      commerceSettings,
    );
    const paymentMethod = options.paymentMethod || payout.payment_method || preference.destination;
    if (this.isSellerWalletRequested(paymentMethod)) {
      if (["pending", "on_hold", "approved"].includes(payout.status)) {
        await knex("seller_payouts").where("id", payoutId).update({
          status: "processing",
          payment_method: "seller_wallet",
          updated_at: knex.fn.now(),
        });
        await knex("seller_commissions")
          .where("payout_id", payoutId)
          .whereIn("status", ["pending", "approved"])
          .update({ status: "approved", updated_at: knex.fn.now() });
      }
      return this.completeSellerWalletPayout(payoutId, {
        ...options,
        paymentMethod: "seller_wallet",
      });
    }
    if (this.isRazorpayXRequested(paymentMethod) || paymentMethod === "razorpayx") {
      return this.initiateRazorpayXPayout(payoutId, {
        ...options,
        paymentMethod: "razorpayx",
      });
    }
    return this.processPayout(
      payoutId,
      options.paymentReference || `manual_${Date.now()}`,
      { ...options, paymentMethod },
    );
  }

  normalizeMoney(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  numberOrNull(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  async listPromotionFundingLedger(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const base = knex("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .leftJoin("seller_commissions as sc", function joinCommission() {
        this.on("sc.order_id", "=", "oi.order_id")
          .andOn("sc.seller_id", "=", "oi.seller_id")
          .andOn(knex.raw(
            "COALESCE(sc.organization_id::text, '') = COALESCE(oi.organization_id::text, '')",
          ));
      })
      .whereRaw(
        "(COALESCE((oi.pricing_snapshot->>'marketplaceFundedDiscountAmount')::numeric, 0) > 0 OR " +
        "COALESCE((oi.pricing_snapshot->>'paymentPartnerFundedDiscountAmount')::numeric, 0) > 0 OR " +
        "COALESCE((oi.pricing_snapshot->>'sellerFundedDiscountAmount')::numeric, 0) > 0)",
      );

    if (filters.sellerId) base.where("oi.seller_id", String(filters.sellerId));
    if (filters.organizationId) base.where("oi.organization_id", String(filters.organizationId));
    if (filters.orderId) base.where("oi.order_id", String(filters.orderId));
    if (filters.fundingType) {
      base.whereRaw("oi.pricing_snapshot->>'discountFundingType' = ?", [String(filters.fundingType)]);
    }
    if (filters.fromDate) base.where("o.created_at", ">=", new Date(filters.fromDate));
    if (filters.toDate) base.where("o.created_at", "<=", new Date(filters.toDate));
    if (filters.search) {
      const search = `%${String(filters.search).trim()}%`;
      base.where((builder) => builder
        .whereILike("o.order_number", search)
        .orWhereILike("oi.product_title", search)
        .orWhereILike("oi.product_sku", search));
    }

    const countRow = await base.clone().clearSelect().clearOrder().countDistinct({ total: "oi.id" }).first();
    const summaryRow = await base.clone().clearSelect().clearOrder().select([
      knex.raw("COALESCE(SUM(COALESCE((oi.pricing_snapshot->>'discountAmount')::numeric, oi.discount_amount, 0)), 0) AS customer_discount_amount"),
      knex.raw("COALESCE(SUM(COALESCE((oi.pricing_snapshot->>'sellerFundedDiscountAmount')::numeric, 0)), 0) AS seller_funded_discount_amount"),
      knex.raw("COALESCE(SUM(COALESCE((oi.pricing_snapshot->>'marketplaceFundedDiscountAmount')::numeric, 0)), 0) AS marketplace_contribution_amount"),
      knex.raw("COALESCE(SUM(COALESCE((oi.pricing_snapshot->>'paymentPartnerFundedDiscountAmount')::numeric, 0)), 0) AS payment_partner_contribution_amount"),
      knex.raw(
        "COALESCE(SUM(CASE WHEN LOWER(COALESCE(oi.payout_status, '')) = 'refunded' THEN " +
        "COALESCE((oi.pricing_snapshot->>'marketplaceFundedDiscountAmount')::numeric, 0) + " +
        "COALESCE((oi.pricing_snapshot->>'paymentPartnerFundedDiscountAmount')::numeric, 0) ELSE 0 END), 0) AS reversal_amount",
      ),
    ]).first();
    const rows = await base.clone()
      .select([
        "oi.id as order_item_id",
        "oi.order_id",
        "o.order_number",
        "o.status as order_status",
        "o.payment_status",
        "o.currency",
        "o.created_at",
        "oi.product_id",
        "oi.product_title",
        "oi.product_sku",
        "oi.quantity",
        "oi.seller_id",
        "oi.organization_id",
        "oi.line_total",
        "oi.discount_amount",
        "oi.payout_status as item_payout_status",
        "oi.pricing_snapshot",
        "sc.id as commission_id",
        "sc.status as commission_status",
        "sc.payout_id",
        "sc.refund_amount",
      ])
      .orderBy("o.created_at", "desc")
      .limit(limit)
      .offset(offset);

    const items = rows.map((row) => {
      const pricing = this.parseJson(row.pricing_snapshot, {});
      const marketplaceContribution = this.round(pricing.marketplaceFundedDiscountAmount);
      const paymentPartnerContribution = this.round(pricing.paymentPartnerFundedDiscountAmount);
      const sellerFundedDiscount = this.round(pricing.sellerFundedDiscountAmount);
      const contributionAmount = this.round(marketplaceContribution + paymentPartnerContribution);
      const refunded = String(row.item_payout_status || "").toLowerCase() === "refunded";
      const settled = Boolean(row.payout_id) || ["paid", "completed", "settled"].includes(
        String(row.commission_status || "").toLowerCase(),
      );
      const status = refunded ? "reversed" : settled ? "settled" :
        ["paid", "captured", "completed", "fulfilled"].includes(String(row.payment_status || "").toLowerCase())
          ? "earned"
          : "reserved";
      const reversalAmount = refunded ? contributionAmount : 0;
      return {
        id: row.order_item_id,
        orderItemId: row.order_item_id,
        orderId: row.order_id,
        orderNumber: row.order_number,
        orderStatus: row.order_status,
        paymentStatus: row.payment_status,
        productId: row.product_id,
        productTitle: row.product_title,
        productSku: row.product_sku,
        quantity: Number(row.quantity || 0),
        sellerId: row.seller_id,
        organizationId: row.organization_id,
        currency: row.currency || "INR",
        customerDiscountAmount: this.round(pricing.discountAmount ?? row.discount_amount),
        sellerFundedDiscountAmount: sellerFundedDiscount,
        marketplaceContributionAmount: marketplaceContribution,
        paymentPartnerContributionAmount: paymentPartnerContribution,
        contributionAmount,
        reversalAmount,
        netPlatformContributionAmount: this.round(contributionAmount - reversalAmount),
        sellerInvoiceAmount: this.round(
          Number(pricing.sellerGrossLineTotal || row.line_total || 0) - sellerFundedDiscount,
        ),
        fundingType: pricing.discountFundingType || "marketplace",
        status,
        commissionId: row.commission_id || null,
        payoutId: row.payout_id || null,
        createdAt: row.created_at,
      };
    });
    const marketplaceContributionAmount = this.round(summaryRow?.marketplace_contribution_amount);
    const paymentPartnerContributionAmount = this.round(summaryRow?.payment_partner_contribution_amount);
    const reversalAmount = this.round(summaryRow?.reversal_amount);
    const totals = {
      customerDiscountAmount: this.round(summaryRow?.customer_discount_amount),
      sellerFundedDiscountAmount: this.round(summaryRow?.seller_funded_discount_amount),
      marketplaceContributionAmount,
      paymentPartnerContributionAmount,
      reversalAmount,
      netPlatformContributionAmount: this.round(
        marketplaceContributionAmount + paymentPartnerContributionAmount - reversalAmount,
      ),
    };

    return { items, total: Number(countRow?.total || 0), limit, offset, totals };
  }

  firstNumber(...values) {
    for (const value of values) {
      const number = this.numberOrNull(value);
      if (number !== null) return number;
    }
    return 0;
  }

resolveSellerFeeAmount(row = {}, pricing = {}) {
  const orderMetadata = this.parseJson(row.order_metadata, {});
  const platformSettings =
    orderMetadata.commerceSettings?.platformFees || {};

  // 1. Always prefer the immutable checkout snapshot.
  const componentFee =
    this.firstNumber(pricing.commissionFee) +
    this.firstNumber(pricing.fixedFee) +
    this.firstNumber(pricing.closingFee);

  if (componentFee > 0) {
    return this.round(componentFee);
  }

  // 2. Check other saved seller fee fields.
  const explicitSellerFee = this.numberOrNull(
    pricing.sellerPlatformFeeAmount ??
    pricing.sellerFeeAmount ??
    pricing.sellerFeeTotal,
  );

  if (explicitSellerFee !== null && explicitSellerFee > 0) {
    return this.round(explicitSellerFee);
  }

  const rowSellerFee = this.numberOrNull(row.platform_fee_amount);

  if (rowSellerFee !== null && rowSellerFee > 0) {
    return this.round(rowSellerFee);
  }

  const platformFee = this.firstNumber(
    pricing.platformFeeAmount,
  );

  const customerFee = this.firstNumber(
    pricing.customerPlatformFeeAmount,
    pricing.customerPlatformFee,
    pricing.customerFeeTotal,
  );

  const storedFee = this.round(
    Math.max(0, platformFee - customerFee),
  );

  if (storedFee > 0) {
    return storedFee;
  }

  // 3. Legacy fallback: recalculate only when snapshot is missing.
  const feeType =
    platformSettings.sellerCommissionType ||
    platformSettings.sellerFeeType;

  const feeValue = this.numberOrNull(
    platformSettings.sellerCommissionValue ??
    platformSettings.sellerFeeValue,
  );

  if (feeValue === null || feeValue <= 0) {
    return 0;
  }

  if (feeType === "fixed") {
    return this.round(
      feeValue * Number(row.quantity || 1),
    );
  }

  // Use the saved commission base first, not line_total.
  const commissionBase = this.firstNumber(
    pricing.sellerCommissionBaseAmount,
    pricing.taxableAmount,
    pricing.sellerPayoutBaseAmount,
    row.line_total,
  );

  return this.round(
    (commissionBase * feeValue) / 100,
  );
}

resolveSellerFeeTaxAmount(
  row = {},
  pricing = {},
  financeSnapshot = {},
) {
  const chargeToSeller =
    pricing.chargePlatformFeeTaxToSeller ??
    financeSnapshot.chargePlatformFeeTaxToSeller ??
    true;

  if (chargeToSeller === false) {
    return 0;
  }

  // First use checkout snapshot.
  const explicitTax = this.numberOrNull(
    pricing.platformFeeTaxAmount,
  );

  if (explicitTax !== null) {
    return this.round(explicitTax);
  }

  // Legacy fallback only.
  const taxRate = this.firstNumber(
    pricing.platformFeeTaxRate,
    financeSnapshot.platformFeeTaxRate,
  );

  if (taxRate <= 0) {
    return 0;
  }

  return this.round(
    (
      this.resolveSellerFeeAmount(
        row,
        pricing,
      ) *
      taxRate
    ) / 100,
  );
}

  normalizePagination(query = {}) {
    return {
      limit: Math.min(Math.max(Number(query.limit || 50), 1), 200),
      offset: Math.max(Number(query.offset || 0), 0),
    };
  }

  async enrichFinanceRecords(records = []) {
    if (!records.length) return records;
    const sellerIds = Array.from(new Set(
      records.map((record) => String(record.seller_id || record.sellerId || "")).filter((id) =>
        UserModel.base.Types.ObjectId.isValid(id)),
    ));
    const orderIds = Array.from(new Set(
      records.map((record) => String(record.order_id || record.orderId || "")).filter(Boolean),
    ));
    const [users, orders] = await Promise.all([
      sellerIds.length
        ? UserModel.find({ _id: { $in: sellerIds } })
          .select("email phone profile sellerProfile")
          .lean()
          .catch(() => [])
        : [],
      orderIds.length
        ? knex("orders").select("id", "order_number").whereIn("id", orderIds).catch(() => [])
        : [],
    ]);
    const usersById = new Map(users.map((user) => {
      const fullName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ").trim();
      const displayName = user.sellerProfile?.displayName || user.sellerProfile?.businessName || fullName || user.email || "Seller";
      return [String(user._id), {
        id: String(user._id),
        displayName,
        businessName: user.sellerProfile?.businessName || null,
        email: user.email || null,
        phone: user.phone || null,
      }];
    }));
    const ordersById = new Map(orders.map((order) => [String(order.id), order.order_number]));
    return records.map((record) => ({
      ...record,
      seller: usersById.get(String(record.seller_id || record.sellerId || "")) || null,
      sellerName: usersById.get(String(record.seller_id || record.sellerId || ""))?.displayName || null,
      orderNumber: ordersById.get(String(record.order_id || record.orderId || "")) || null,
    }));
  }

  buildDateRange(periodStart, periodEnd) {
    const now = new Date();
    const toDateOnly = (value, fallback) => {
      if (!value) return fallback;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
    };
    return {
      periodStart: toDateOnly(periodStart, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)),
      periodEnd: toDateOnly(periodEnd, now.toISOString().slice(0, 10)),
    };
  }

  getPayoutPolicy(settings = {}) {
    const finance = settings.finance || settings || {};
    const mode = finance.payoutMode || (finance.payoutManualApprovalRequired === false ? "auto_razorpayx" : "manual");
    const autoRazorpayX = mode === "auto_razorpayx";
    return {
      mode,
      autoRazorpayX,
      releaseMilestone: finance.payoutReleaseMilestone || "return_window_closed",
      schedule: finance.payoutSchedule || "manual",
      manualApprovalRequired: autoRazorpayX ? false : finance.payoutManualApprovalRequired !== false,
      minimumPayoutAmount: this.round(finance.minimumPayoutAmount || 0),
      codPayoutRequiresCapture: settings.cod?.payoutRequiresCapture !== false,
    };
  }

  getScheduledPayoutWindow(schedule = "manual", now = new Date()) {
    const today = now.toISOString().slice(0, 10);
    if (["daily", "weekly", "monthly"].includes(schedule)) {
      return { periodStart: "1970-01-01", periodEnd: today };
    }
    return { periodStart: "1970-01-01", periodEnd: today };
  }

  shouldRunScheduledPayout(policy = {}, now = new Date(), options = {}) {
    if (options.force === true) return true;
    if (policy.schedule === "daily") return true;
    if (policy.schedule === "weekly") return now.getUTCDay() === 1;
    if (policy.schedule === "monthly") return now.getUTCDate() === 1;
    return false;
  }

  toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  addDays(value, days = 0) {
    const date = this.toDate(value);
    if (!date) return null;
    return new Date(date.getTime() + Math.max(Number(days || 0), 0) * 24 * 60 * 60 * 1000);
  }

  async transitionPayoutItems(trx, payoutId, toStatus, context = {}) {
    const commissions = await trx("seller_commissions")
      .where("payout_id", payoutId)
      .whereNotNull("order_item_id")
      .select("id", "seller_id", "order_id", "order_item_id");
    if (!commissions.length) return;
    const itemIds = commissions.map((row) => row.order_item_id);
    const items = await trx("order_items").whereIn("id", itemIds).select("id", "payout_status");
    const currentById = new Map(items.map((item) => [String(item.id), item.payout_status]));
    await trx("order_items").whereIn("id", itemIds).update({
      payout_status: toStatus,
      payout_id: payoutId,
      payout_hold_reason: toStatus === "held" ? context.reason || "manual_hold" : null,
    });
    await trx("payout_status_history").insert(commissions.map((row) => ({
      id: uuidv4(), seller_id: row.seller_id, order_id: row.order_id,
      order_item_id: row.order_item_id, commission_id: row.id, payout_id: payoutId,
      from_status: currentById.get(String(row.order_item_id)) || null,
      to_status: toStatus, reason: context.reason || null,
      actor_id: context.actor?.userId || context.actor?.sub || "system",
      actor_role: context.actor?.role || "system",
      metadata: this.jsonb(context.metadata || {}),
    })));
  }

  isReleasedOrderStatus(status) {
    return [ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED, ORDER_STATUS.PARTIALLY_RETURNED].includes(status);
  }

  isConfirmedOrLaterStatus(status) {
    return [
      ORDER_STATUS.CONFIRMED,
      ORDER_STATUS.PACKED,
      ORDER_STATUS.SHIPPED,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.PARTIALLY_RETURNED,
    ].includes(status);
  }

  isBlockedOrderStatus(status) {
    return [
      ORDER_STATUS.PENDING_PAYMENT,
      ORDER_STATUS.PAYMENT_FAILED,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.RETURN_REQUESTED,
      ORDER_STATUS.RETURNED,
    ].includes(status);
  }

  async getCommissionOrderReleaseData(commissions = [], client = knex) {
    const orderIds = Array.from(new Set(
      commissions.map((commission) => String(commission.order_id || "")).filter(Boolean),
    ));
    if (!orderIds.length) return new Map();

    const itemIds = Array.from(new Set(commissions.map((commission) => commission.order_item_id).filter(Boolean)));
    const [orders, releaseRows, codCollections, orderItems] = await Promise.all([
      client("orders")
        .select("id", "status", "payment_status", "payment_provider", "return_eligible_until", "fulfillment_eligible_at", "created_at", "updated_at")
        .whereIn("id", orderIds),
      client("order_status_history")
        .select("order_id")
        .min({ release_status_at: "created_at" })
        .whereIn("order_id", orderIds)
        .whereIn("to_status", [ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED])
        .groupBy("order_id")
        .catch(() => []),
      client("cod_collections")
        .select("order_id", "seller_id", "collection_mode", "status")
        .whereIn("order_id", orderIds)
        .catch(() => []),
      itemIds.length
        ? client("order_items").select("id", "payout_status", "payout_eligible_at", "return_eligible_until").whereIn("id", itemIds)
        : [],
    ]);

    const releaseData = new Map();
    orders.forEach((order) => {
      releaseData.set(String(order.id), {
        order,
        releaseStatusAt: null,
        codCollections: [],
      });
    });
    releaseRows.forEach((row) => {
      const key = String(row.order_id);
      const current = releaseData.get(key) || { order: { id: row.order_id }, releaseStatusAt: null };
      current.releaseStatusAt = row.release_status_at || null;
      releaseData.set(key, current);
    });
    codCollections.forEach((collection) => {
      const key = String(collection.order_id);
      const current = releaseData.get(key) || { order: { id: collection.order_id }, releaseStatusAt: null, codCollections: [] };
      current.codCollections = current.codCollections || [];
      current.codCollections.push(collection);
      releaseData.set(key, current);
    });
    const itemsById = new Map(orderItems.map((item) => [String(item.id), item]));
    releaseData.itemsById = itemsById;

    return releaseData;
  }

  evaluateCommissionRelease(commission = {}, releaseData = new Map(), policy = {}, now = new Date(), options = {}) {
    const status = String(commission.status || "pending");
    const netAmount = this.round(commission.net_amount || 0);
    const orderData = releaseData.get(String(commission.order_id || "")) || {};
    const order = orderData.order || {};
    const orderItem = commission.order_item_id
      ? releaseData.itemsById?.get(String(commission.order_item_id))
      : null;
    const orderStatus = String(order.status || commission.source_status || "");
    const codCollections = (orderData.codCollections || []).filter((row) =>
      String(row.seller_id || "") === String(commission.seller_id || ""));
    const deliveredAt =
      this.toDate(orderData.releaseStatusAt) ||
      (this.isReleasedOrderStatus(orderStatus)
        ? this.toDate(order.updated_at || commission.updated_at || commission.created_at)
        : null);
    const base = {
      commissionId: commission.id,
      orderId: commission.order_id || null,
      status,
      orderStatus: orderStatus || null,
      netAmount,
      releaseStatus: "pending",
      available: false,
      eligibleAt: null,
      reason: null,
    };

    if (netAmount <= 0) {
      return { ...base, releaseStatus: "blocked", reason: "no_payable_amount" };
    }
    if (status === "paid") {
      return { ...base, releaseStatus: "paid", reason: "already_paid" };
    }
    if (commission.payout_id || status === "processing") {
      return { ...base, releaseStatus: "in_process", reason: "payout_in_process" };
    }
    if (!["pending", "approved"].includes(status)) {
      return { ...base, reason: `status_${status}` };
    }
    const itemScopedReturn = Boolean(orderItem) && [
      ORDER_STATUS.RETURN_REQUESTED,
      ORDER_STATUS.PARTIALLY_RETURNED,
      ORDER_STATUS.RETURNED,
    ].includes(orderStatus);
    if (this.isBlockedOrderStatus(orderStatus) && !itemScopedReturn) {
      return { ...base, releaseStatus: "blocked", reason: `order_${orderStatus}` };
    }
    if (
      policy.codPayoutRequiresCapture &&
      order.payment_provider === PAYMENT_PROVIDER.COD &&
      order.payment_status !== PAYMENT_STATUS.CAPTURED
    ) {
      return { ...base, releaseStatus: "blocked", reason: "waiting_for_cod_collection_confirmation" };
    }

    if (orderItem) {
      const eligibleAt = this.toDate(orderItem.payout_eligible_at || orderItem.return_eligible_until);
      if (
        options.allowFailedPayoutItems === true &&
        ["failed", "cancelled"].includes(String(orderItem.payout_status || "").toLowerCase())
      ) {
        return {
          ...base,
          releaseStatus: "available",
          available: true,
          eligibleAt: (eligibleAt || now).toISOString(),
          reason: "retry_after_failed_payout",
        };
      }
      if (orderItem.payout_status === "refunded" || (Number(commission.net_amount || 0) <= 0 && Number(commission.refund_amount || 0) > 0)) {
        return {
          ...base,
          releaseStatus: "refunded",
          available: false,
          eligibleAt: null,
          reason: "customer_refund_completed_no_seller_payout",
        };
      }
      if (orderItem.payout_status !== "eligible") {
        return {
          ...base,
          releaseStatus: orderItem.payout_status === "held" ? "held" : "pending",
          eligibleAt: eligibleAt?.toISOString() || null,
          reason: orderItem.payout_status === "held" ? "item_on_hold" : "waiting_for_item_return_window",
        };
      }
      return {
        ...base,
        releaseStatus: "available",
        available: true,
        eligibleAt: (eligibleAt || now).toISOString(),
      };
    }

    if (order.payment_provider === PAYMENT_PROVIDER.COD && codCollections.length) {
      const pendingDirectCollection = codCollections.some((collection) =>
        ["seller_direct", "hybrid"].includes(collection.collection_mode) &&
        !["verified", "remitted"].includes(collection.status));
      if (pendingDirectCollection) {
        return { ...base, releaseStatus: "blocked", reason: "waiting_for_seller_cod_reconciliation" };
      }
    }

    const eligibleAt = this.toDate(order.fulfillment_eligible_at || order.return_eligible_until);
    if (orderStatus !== ORDER_STATUS.FULFILLED) {
      return {
        ...base,
        eligibleAt: eligibleAt?.toISOString() || null,
        reason: eligibleAt ? "waiting_for_return_window" : "waiting_for_delivery_or_fulfillment",
      };
    }

    return {
      ...base,
      releaseStatus: "available",
      available: true,
      eligibleAt: (eligibleAt || deliveredAt || new Date()).toISOString(),
    };
  }

  async evaluateCommissionsRelease(commissions = [], settings = {}, client = knex, options = {}) {
    const policy = this.getPayoutPolicy(settings);
    const releaseData = await this.getCommissionOrderReleaseData(commissions, client);
    const now = new Date();
    return commissions.map((commission) => ({
      commission,
      release: this.evaluateCommissionRelease(commission, releaseData, policy, now, options),
    }));
  }

  async filterPayoutEligibleCommissions(commissions = [], options = {}) {
    const evaluations = await this.evaluateCommissionsRelease(
      commissions,
      options.settings || {},
      options.trx || knex,
      { allowFailedPayoutItems: options.allowFailedPayoutItems === true },
    );
    const eligible = evaluations
      .filter(({ release }) => release.available)
      .map(({ commission }) => commission);
    return { eligible, evaluations };
  }

  async getCommissionInputs(orderId, sellerId, orderAmount) {
    if (sellerId && orderAmount > 0) {
      return { sellerId, orderAmount };
    }

    const orderItem = await knex("order_items")
      .select("seller_id")
      .where("order_id", orderId)
      .first();
    const order = await knex("orders")
      .select("subtotal_amount")
      .where("id", orderId)
      .first();

    if (!orderItem?.seller_id || Number(order?.subtotal_amount || 0) <= 0) {
      throw new AppError("Unable to get order commission data", 400);
    }

    return {
      sellerId: orderItem.seller_id,
      orderAmount: Number(order.subtotal_amount),
    };
  }

  isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value || "").trim(),
    );
  }

  async resolveCommissionOrderId(orderId) {
    const raw = String(orderId || "").trim();
    if (!raw) return raw;
    const orderNumber = raw.replace(/^#/, "");
    const order = await knex("orders")
      .select("id")
      .modify((query) => {
        if (this.isUuidLike(raw)) query.where("id", raw);
        query.orWhere("order_number", raw).orWhere("order_number", orderNumber);
      })
      .first();
    if (!order?.id) {
      logger.warn(
        { requestedOrderId: raw, normalizedOrderNumber: orderNumber },
        "Commission order id could not be resolved",
      );
    } else if (String(order.id) !== raw) {
      logger.info(
        { requestedOrderId: raw, resolvedOrderId: order.id },
        "Commission order id resolved from order number",
      );
    }
    return order?.id || raw;
  }

  async getOrderSellerGroups(orderId, sellerId = null, orderAmount = null, sellerTier = null, organizationId = null) {
    if (!orderId) {
      throw new AppError("Invalid commission input", 400);
    }

    if (sellerId && Number(orderAmount || 0) > 0) {
      const amount = this.round(orderAmount);
      return [{
        sellerId,
        organizationId: organizationId || null,
        organizationSnapshot: {},
        orderId,
        orderItemIds: [],
        amount,
        commissionRate: 0,
        commissionAmount: 0,
        taxAmount: 0,
        refundAmount: 0,
        netAmount: amount,
        currency: "INR",
        sourceStatus: "manual",
        metadata: {
          source: "manual_commission_input",
          organizationId: organizationId || null,
          note: "Manual payouts use the supplied seller receivable amount without recalculating commission.",
        },
      }];
    }

    const rows = await knex("order_items as oi")
      .innerJoin("orders as o", "o.id", "oi.order_id")
      .select(
        "oi.id",
        "oi.seller_id",
        "oi.organization_id",
        "oi.organization_snapshot",
        "oi.line_total",
        "oi.discount_amount",
        "oi.platform_fee_amount",
        "oi.quantity",
        "oi.product_id",
        "oi.variant_id",
        "oi.variant_sku",
        "oi.tax_breakup",
        "oi.pricing_snapshot",
        "o.status as order_status",
        "o.currency",
        "o.metadata as order_metadata",
      )
      .where("oi.order_id", orderId)
      .modify((query) => {
        if (sellerId) query.andWhere("oi.seller_id", sellerId);
        if (organizationId) query.andWhere("oi.organization_id", organizationId);
      });

    if (!rows.length) {
      const [order, unfilteredItemCount, sellerItemCount, organizationItemCount] = await Promise.all([
        knex("orders").select("id", "order_number", "status").where("id", orderId).first(),
        knex("order_items").where("order_id", orderId).count({ count: "*" }).first(),
        sellerId
          ? knex("order_items").where({ order_id: orderId, seller_id: sellerId }).count({ count: "*" }).first()
          : Promise.resolve({ count: null }),
        organizationId
          ? knex("order_items").where({ order_id: orderId, organization_id: organizationId }).count({ count: "*" }).first()
          : Promise.resolve({ count: null }),
      ]);
      logger.warn(
        {
          orderId,
          sellerId,
          organizationId,
          orderFound: Boolean(order?.id),
          orderNumber: order?.order_number || null,
          orderStatus: order?.status || null,
          orderItemCount: Number(unfilteredItemCount?.count || 0),
          sellerMatchedItemCount: sellerId ? Number(sellerItemCount?.count || 0) : null,
          organizationMatchedItemCount: organizationId ? Number(organizationItemCount?.count || 0) : null,
        },
        "Commission calculation found no matching order items",
      );
      throw new AppError("No order items found for commission calculation. Use the real order ID/order number and check seller or organization filters.", 400);
    }

    const grouped = new Map();
    rows.forEach((row) => {
      if (!row.seller_id) return;
      const organizationId = row.organization_id ? String(row.organization_id) : null;
      const key = `${String(row.seller_id)}:${organizationId || "default"}:${row.id}`;
      const current = grouped.get(key) || {
        sellerId: String(row.seller_id),
        organizationId,
        organizationSnapshot: this.parseJson(
          row.organization_snapshot,
          {},
        ),
        orderId,
        orderItemIds: [],
        orderItemId: row.id,

        amount: 0,
        productTaxableAmount: 0,
        productTaxAmount: 0,
        commissionBaseAmount: 0,

        platformFeeAmount: 0,
        platformFeeTaxAmount: 0,
        commissionFeeAmount: 0,
        fixedFeeAmount: 0,
        closingFeeAmount: 0,
        sellerReceivableAmount: 0,
        hasPricingSnapshot: false,
        quantity: 0,
        currency: row.currency || "INR",
        sourceStatus: row.order_status || "order",
        orderMetadata: this.parseJson(row.order_metadata, {}),
        products: [],
      };
      const lineTotal = Number(row.line_total || 0);
      const discountAmount = Number(row.discount_amount || 0);
      const grossAfterDiscount = Math.max(lineTotal - discountAmount, 0);
      const pricing = this.parseJson(row.pricing_snapshot, {});
      const taxBreakup = this.parseJson(row.tax_breakup, {});
      const orderMetadata = this.parseJson(row.order_metadata, {});
      const financeSnapshot = orderMetadata?.commerceSettings?.finance || {};
      // Product amount excluding GST.
      // Use this for commission, TCS and TDS calculation.
      const productTaxableAmount = this.round(
        taxBreakup.taxableAmount ?? (
          taxBreakup.gstInclusive &&
            Number(taxBreakup.gstRate || 0) + Number(taxBreakup.cessRate || 0) > 0
            ? (grossAfterDiscount * 100) /
            (
              100 +
              Number(taxBreakup.gstRate || 0) +
              Number(taxBreakup.cessRate || 0)
            )
            : grossAfterDiscount
        ),
      );

      // Product GST amount.
      const productTaxAmount = this.round(
        taxBreakup.taxAmount ??
        Math.max(0, grossAfterDiscount - productTaxableAmount),
      );

      // Seller's complete product invoice amount, including GST.
      // The seller payout must start from this amount.
      const grossSellerInvoiceAmount = this.round(
        productTaxableAmount + productTaxAmount,
      );

      // Keep this separately because commission may be calculated excluding GST.
     const commissionBaseAmount = this.firstNumber(
  pricing.sellerCommissionBaseAmount,
  productTaxableAmount,
);
      const sellerFeeAmount = this.resolveSellerFeeAmount(row, pricing);
      const sellerFeeTaxAmount = this.resolveSellerFeeTaxAmount(row, pricing, financeSnapshot);
      const customerFeeAmount = this.firstNumber(
        pricing.customerPlatformFeeAmount,
        pricing.customerPlatformFee,
        pricing.customerFeeTotal,
      );
      const customerFeeTaxAmount = this.firstNumber(pricing.customerPlatformFeeTaxAmount);
      const itemSellerReceivable = this.round(
        Math.max(
          0,
          grossSellerInvoiceAmount -
          sellerFeeAmount -
          sellerFeeTaxAmount,
        ),
      );
      current.orderItemIds.push(row.id);
      current.amount += grossSellerInvoiceAmount;
      current.productTaxableAmount += productTaxableAmount;
      current.productTaxAmount += productTaxAmount;
      current.commissionBaseAmount += commissionBaseAmount;
      current.platformFeeAmount += sellerFeeAmount;
      current.platformFeeTaxAmount += sellerFeeTaxAmount;
      current.customerPlatformFeeAmount = Number(current.customerPlatformFeeAmount || 0) + customerFeeAmount;
      current.customerPlatformFeeTaxAmount = Number(current.customerPlatformFeeTaxAmount || 0) + customerFeeTaxAmount;
      current.commissionFeeAmount += Number(pricing.commissionFee || 0);
      current.fixedFeeAmount += Number(pricing.fixedFee || 0);
      current.closingFeeAmount += Number(pricing.closingFee || 0);
      current.sellerReceivableAmount += itemSellerReceivable;
      current.hasPricingSnapshot = current.hasPricingSnapshot || Object.keys(pricing).length > 0;
      current.quantity += Number(row.quantity || 0);
      const snapshotGstRate = Number(taxBreakup.gstRate ?? row.gst_rate ?? 0);
      const snapshotCessRate = Number(taxBreakup.cessRate ?? 0);
      const taxableAmount = this.round(taxBreakup.taxableAmount ?? (
        taxBreakup.gstInclusive && snapshotGstRate + snapshotCessRate > 0
          ? (grossAfterDiscount * 100) / (100 + snapshotGstRate + snapshotCessRate)
          : grossAfterDiscount
      ));

      current.products.push({
        productId: row.product_id,
        variantId: row.variant_id,
        variantSku: row.variant_sku,
       amount: grossSellerInvoiceAmount,
grossSellerInvoiceAmount,
commissionBaseAmount,
        grossAfterDiscount: this.round(grossAfterDiscount),
        discountAmount: this.round(discountAmount),
        discountFundingType: pricing.discountFundingType || "marketplace",
        marketplaceFundedDiscountAmount: this.round(pricing.marketplaceFundedDiscountAmount),
        paymentPartnerFundedDiscountAmount: this.round(pricing.paymentPartnerFundedDiscountAmount),
        sellerFundedDiscountAmount: this.round(pricing.sellerFundedDiscountAmount),
        taxableAmount,
        taxAmount: productTaxAmount,
        sellerPayoutBase: pricing.sellerPayoutBase || "gross_customer_price",
        platformFeeAmount: this.round(sellerFeeAmount),
        platformFeeTaxAmount: this.round(sellerFeeTaxAmount),
        customerPlatformFeeAmount: this.round(customerFeeAmount),
        customerPlatformFeeTaxAmount: this.round(customerFeeTaxAmount),
        sellerReceivable: this.round(itemSellerReceivable),
      });
      grouped.set(key, current);
    });

    const commissionGroups = Array.from(grouped.values());
    const allocationBySeller = new Map();
    for (const group of commissionGroups) {
      const sellerKey = `${group.sellerId}:${group.organizationId || "default"}`;
      const current = allocationBySeller.get(sellerKey) || {
        totalAmount: 0,
        remainingAmount: 0,
        remainingShipping: null,
      };
      current.totalAmount += Number(group.amount || 0);
      current.remainingAmount += Number(group.amount || 0);
      allocationBySeller.set(sellerKey, current);
    }

    return commissionGroups.map((group) => {
      const amount = this.round(group.amount);
      const financeSnapshot = group.orderMetadata?.commerceSettings?.finance || {};
      const platformFeeAmount = this.round(group.platformFeeAmount);
      const commissionAmount = platformFeeAmount;
      const effectiveRate = amount > 0 ? this.round(commissionAmount / amount) : 0;
      const taxAmount = this.round(group.platformFeeTaxAmount);
      const deliveryEntries = Array.isArray(group.orderMetadata?.deliveryCharge?.sellers)
        ? group.orderMetadata.deliveryCharge.sellers
        : [];
      const deliveryEntry = deliveryEntries.find((entry) =>
        String(entry.sellerId) === String(group.sellerId) &&
        String(entry.organizationId || "default") === String(group.organizationId || "default"),
      ) || deliveryEntries.find((entry) => String(entry.sellerId) === String(group.sellerId)) || {};
      const sellerKey = `${group.sellerId}:${group.organizationId || "default"}`;
      const allocation = allocationBySeller.get(sellerKey);
      if (allocation.remainingShipping === null) {
        allocation.remainingShipping = this.round(deliveryEntry.chargeAmount);
      }
      const sellerDeliveryChargeAmount = allocation.remainingAmount <= amount
        ? allocation.remainingShipping
        : this.round(
          Number(deliveryEntry.chargeAmount || 0) * amount / Math.max(allocation.totalAmount, 1),
        );
      allocation.remainingShipping = this.round(allocation.remainingShipping - sellerDeliveryChargeAmount);
      allocation.remainingAmount = this.round(allocation.remainingAmount - amount);
    const shippingPolicy =
  financeSnapshot.shippingPolicy ||
  resolveShippingPolicy(
    financeSnapshot.shippingPolicy,
    deliveryEntry,
  );

const shippingReimbursementAmount =
  shippingPolicy === "reimburse_seller"
    ? sellerDeliveryChargeAmount
    : 0;

const shippingDeductionAmount =
  shippingPolicy === "deduct_from_seller"
    ? sellerDeliveryChargeAmount
    : 0;

const productTaxableSupplyAmount = this.round(
  group.products.reduce(
    (sum, product) =>
      sum + Number(product.taxableAmount || 0),
    0,
  ),
);

const productTaxAmount = this.round(
  group.products.reduce(
    (sum, product) =>
      sum + Number(product.taxAmount || 0),
    0,
  ),
);

const shippingTax = calculateInclusiveShippingTax(
  sellerDeliveryChargeAmount,
  productTaxableSupplyAmount,
  productTaxAmount,
);

const gstTcsRate = financeSnapshot.gstTcsEnabled
  ? Number(financeSnapshot.gstTcsRate || 0)
  : 0;

const incomeTaxTdsRate =
  financeSnapshot.incomeTaxTdsEnabled
    ? Number(financeSnapshot.incomeTaxTdsRate || 0)
    : 0;

const gstTcsTaxableAmount =
  productTaxableSupplyAmount;

const gstTcsAmount = this.round(
  (
    gstTcsTaxableAmount *
    gstTcsRate
  ) / 100,
);

const incomeTaxTdsTaxableAmount =
  productTaxableSupplyAmount;

const incomeTaxTdsAmount = this.round(
  (
    incomeTaxTdsTaxableAmount *
    incomeTaxTdsRate
  ) / 100,
);
      const netAmount = this.round(Math.max(
        0,
        group.sellerReceivableAmount +
        shippingReimbursementAmount -
        shippingDeductionAmount -
        gstTcsAmount -
        incomeTaxTdsAmount,
      ));
      return {
        sellerId: group.sellerId,
        organizationId: group.organizationId || null,
        organizationSnapshot: group.organizationSnapshot || {},
        orderId,
        orderItemIds: group.orderItemIds,
        orderItemId: group.orderItemId,
        amount,
        commissionRate: effectiveRate,
        commissionAmount,
        taxAmount,
        refundAmount: 0,
        netAmount,
        currency: group.currency,
        sourceStatus: group.sourceStatus,
        metadata: {
          source: "order_items",
          organizationId: group.organizationId || null,
          itemCount: group.orderItemIds.length,
          quantity: group.quantity,
          platformFeeAmount,
          commissionFeeAmount: this.round(group.commissionFeeAmount),
          fixedFeeAmount: this.round(group.fixedFeeAmount),
          closingFeeAmount: this.round(group.closingFeeAmount),
          platformFeeTaxAmount: taxAmount,
          customerPlatformFeeAmount: this.round(group.customerPlatformFeeAmount),
          customerPlatformFeeTaxAmount: this.round(group.customerPlatformFeeTaxAmount),
          sellerPayoutBase: financeSnapshot.sellerPayoutBase,
          platformFeeTaxRate: Number(financeSnapshot.platformFeeTaxRate || 0),
          chargePlatformFeeTaxToSeller: Boolean(financeSnapshot.chargePlatformFeeTaxToSeller),
          shippingPolicy,
          sellerDeliveryChargeAmount,
          shippingReimbursementAmount,
          shippingDeductionAmount,
          shippingTaxableAmount: shippingTax.taxableAmount,
          shippingTaxAmount: shippingTax.taxAmount,
          sellerCommissionBaseAmount: this.round(group.products.reduce(
            (sum, product) => sum + Number(product.sellerCommissionBaseAmount || product.taxableAmount || 0),
            0,
          )),
taxableSupplyAmount:
  productTaxableSupplyAmount,
          gstTcsEnabled: Boolean(financeSnapshot.gstTcsEnabled),
        gstTcsRate,
gstTcsTaxableAmount,
gstTcsAmount,
          incomeTaxTdsEnabled: Boolean(financeSnapshot.incomeTaxTdsEnabled),
          incomeTaxTdsRate,
          incomeTaxTdsTaxableAmount,
          incomeTaxTdsAmount,
          statutoryDeductionAmount: this.round(gstTcsAmount + incomeTaxTdsAmount),
          pricingSource: "checkout_snapshot",
          sellerReceivable: netAmount,
          products: group.products,
        },
      };
    });
  }

  normalizeCalculateArgs(sellerIdOrOptions, orderAmount, sellerTier) {
    if (sellerIdOrOptions && typeof sellerIdOrOptions === "object" && !Array.isArray(sellerIdOrOptions)) {
      return {
        sellerId: sellerIdOrOptions.sellerId,
        organizationId: sellerIdOrOptions.organizationId,
        orderAmount: sellerIdOrOptions.orderAmount,
        sellerTier: sellerIdOrOptions.sellerTier || sellerTier || null,
        actor: sellerIdOrOptions.actor || {},
        sourceStatus: sellerIdOrOptions.sourceStatus,
      };
    }
    return {
      sellerId: sellerIdOrOptions,
      organizationId: null,
      orderAmount,
      sellerTier: sellerTier || null,
      actor: {},
      sourceStatus: null,
    };
  }

  async calculateCommission(orderId, sellerIdOrOptions, orderAmount, sellerTier = null) {
    const commissionOrderId = await this.resolveCommissionOrderId(orderId);
    const options = this.normalizeCalculateArgs(sellerIdOrOptions, orderAmount, sellerTier);
    const groups = await this.getOrderSellerGroups(
      commissionOrderId,
      options.sellerId,
      options.orderAmount,
      options.sellerTier,
      options.organizationId,
    );

    const result = await knex.transaction(async (trx) => {
      const items = [];
      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const group of groups) {
        const existingQuery = trx("seller_commissions")
          .where({ seller_id: group.sellerId, order_id: commissionOrderId });
        if (group.orderItemId) existingQuery.where("order_item_id", group.orderItemId);
        if (group.organizationId) {
          existingQuery.where("organization_id", group.organizationId);
        } else {
          existingQuery.whereNull("organization_id");
        }
        const existing = await existingQuery
          .first()
          .forUpdate();

        const metadata = {
          ...this.parseJson(existing?.metadata, {}),
          ...group.metadata,
          calculatedBy: options.actor?.userId || options.actor?.sub || null,
          calculatedAt: new Date().toISOString(),
        };
        const refundAmount = this.round(existing?.refund_amount || group.refundAmount || 0);
        const netAmount = this.round(group.netAmount - refundAmount);

        if (
          existing?.status === "paid" ||
          existing?.status === "refunded" ||
          existing?.payout_id ||
          Number(existing?.refund_amount || 0) > 0
        ) {
          skipped += 1;
          items.push(existing);
          continue;
        }

        const payload = {
          seller_id: group.sellerId,
          organization_id: group.organizationId || null,
          organization_snapshot: this.jsonb(group.organizationSnapshot || {}),
          order_id: commissionOrderId,
          order_item_ids: this.jsonb(group.orderItemIds, []),
          order_item_id: group.orderItemId || null,
          amount: group.amount,
          commission_rate: group.commissionRate,
          commission_amount: group.commissionAmount,
          tax_amount: group.taxAmount,
          refund_amount: refundAmount,
          net_amount: netAmount,
          currency: group.currency || "INR",
          status: existing?.status || "pending",
          source_status: options.sourceStatus || group.sourceStatus || existing?.source_status || null,
          metadata: this.jsonb(metadata),
          updated_at: knex.fn.now(),
        };

        if (existing) {
          const [row] = await trx("seller_commissions")
            .where("id", existing.id)
            .update(payload)
            .returning("*");
          updated += 1;
          items.push(row);
          if (group.orderItemId) await trx("order_items").where("id", group.orderItemId).update({ commission_id: row.id });
        } else {
          const [row] = await trx("seller_commissions")
            .insert({
              id: uuidv4(),
              ...payload,
              created_at: knex.fn.now(),
            })
            .returning("*");
          created += 1;
          items.push(row);
          if (group.orderItemId) await trx("order_items").where("id", group.orderItemId).update({ commission_id: row.id });
        }
      }

      return {
        orderId: commissionOrderId,
        requestedOrderId: orderId,
        created,
        updated,
        skipped,
        items,
        summary: this.summarizeCommissions(items),
      };
    });

    logger.info(
      {
        orderId: commissionOrderId,
        requestedOrderId: orderId,
        sellers: result.items.map((item) => item.seller_id),
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      },
      "Seller commissions calculated",
    );

    return result;
  }

  summarizeCommissions(commissions = []) {
    return commissions.reduce(
      (acc, row) => {
        acc.totalAmount = this.round(acc.totalAmount + Number(row.amount || 0));
        acc.commissionAmount = this.round(acc.commissionAmount + Number(row.commission_amount || 0));
        acc.taxAmount = this.round(acc.taxAmount + Number(row.tax_amount || 0));
        acc.refundAmount = this.round(acc.refundAmount + Number(row.refund_amount || 0));
        acc.netAmount = this.round(acc.netAmount + Number(row.net_amount || 0));
        acc.count += 1;
        return acc;
      },
      { totalAmount: 0, commissionAmount: 0, taxAmount: 0, refundAmount: 0, netAmount: 0, count: 0 },
    );
  }

  async getSellerEarnings(sellerId, startDate, endDate) {
    const result = await knex("seller_commissions")
      .where("seller_id", sellerId)
      .whereBetween("created_at", [startDate, endDate])
      .whereIn("status", ["paid", "pending"])
      .sum({ total_earned: "net_amount" })
      .sum({ total_commission: "commission_amount" })
      .count({ order_count: "*" })
      .first();

    return result || {
      total_earned: 0,
      total_commission: 0,
      order_count: 0,
    };
  }

  async initiatePayout(sellerId, periodStart, periodEnd, options = {}) {
    const range = this.buildDateRange(periodStart, periodEnd);
    const commerceSettings = await commerceSettingsService.getSettings();
    const payoutPolicy = this.getPayoutPolicy(commerceSettings);
    const organizationId = options.organizationId || null;
    logger.info(
      {
        sellerId,
        organizationId,
        periodStart: range.periodStart,
        periodEnd: range.periodEnd,
        commissionIdsCount: Array.isArray(options.commissionIds) ? options.commissionIds.length : 0,
        skipPrePayoutRefresh: options.skipPrePayoutRefresh === true,
        source: options.source || "batch_payout",
        paymentMethod: options.paymentMethod || null,
        autoProcess: options.autoProcess === true,
      },
      "Seller payout initiation started",
    );
    if (!options.commissionIds?.length && options.skipPrePayoutRefresh !== true) {
      const pendingOrders = await knex("seller_commissions")
        .where("seller_id", sellerId)
        .whereIn("status", ["pending", "approved"])
        .whereNull("payout_id")
        .modify((builder) => {
          if (organizationId) builder.where("organization_id", organizationId);
          else if (options.organizationId === null) builder.whereNull("organization_id");
        })
        .whereBetween("created_at", [range.periodStart, `${range.periodEnd} 23:59:59`])
        .distinct("order_id");
      logger.info(
        { sellerId, organizationId, pendingOrderCount: pendingOrders.length },
        "Refreshing commissions before payout",
      );
      for (const row of pendingOrders) {
        try {
          await this.calculateCommission(row.order_id, {
            sellerId,
            organizationId,
            actor: options.actor || {},
            sourceStatus: "pre_payout_refresh",
          });
        } catch (error) {
          logger.warn(
            { err: error, orderId: row.order_id, sellerId, organizationId },
            "Skipping commission refresh before payout; existing commission row will be used",
          );
        }
      }
    }
    return await knex.transaction(async (trx) => {
      const commissions = await trx("seller_commissions")
        .where("seller_id", sellerId)
        .modify((builder) => {
          if (organizationId) builder.where("organization_id", organizationId);
          else if (options.organizationId === null) builder.whereNull("organization_id");
        })
        .whereIn("status", ["pending", "approved"])
        .whereNull("payout_id")
        .modify((builder) => {
          if (options.commissionIds?.length) builder.whereIn("id", options.commissionIds);
        })
        .modify((builder) => {
          if (!options.commissionIds?.length) {
            builder.whereBetween("created_at", [range.periodStart, `${range.periodEnd} 23:59:59`]);
          }
        })
        .forUpdate();

      logger.info(
        {
          sellerId,
          organizationId,
          source: options.source || "batch_payout",
          commissionIds: options.commissionIds || null,
          matchedCommissionCount: commissions.length,
          matchedStatuses: commissions.reduce((acc, row) => {
            const status = row.status || "unknown";
            acc[status] = (acc[status] || 0) + 1;
            return acc;
          }, {}),
        },
        "Seller payout matched commission rows",
      );

      if (!commissions.length) {
        throw new AppError("No commissions to payout", 400);
      }
      const payoutRange = options.commissionIds?.length
        ? this.buildDateRange(
          commissions.reduce((earliest, row) => !earliest || new Date(row.created_at) < new Date(earliest) ? row.created_at : earliest, null),
          commissions.reduce((latest, row) => !latest || new Date(row.created_at) > new Date(latest) ? row.created_at : latest, null),
        )
        : range;

      const { eligible: payoutCommissions, evaluations } = await this.filterPayoutEligibleCommissions(commissions, {
        settings: commerceSettings,
        trx,
        allowFailedPayoutItems: options.source === "failed_payout_retry",
      });

      logger.info(
        {
          sellerId,
          organizationId,
          payoutCandidateCount: commissions.length,
          eligibleCommissionCount: payoutCommissions.length,
          blockedCommissions: evaluations
            .filter(({ release }) => !release.available)
            .map(({ commission, release }) => ({
              commissionId: commission.id,
              orderId: commission.order_id,
              orderItemId: commission.order_item_id,
              status: commission.status,
              reason: release.reason,
              eligibleAt: release.eligibleAt,
              releaseStatus: release.releaseStatus,
            })),
        },
        "Seller payout eligibility evaluated",
      );

      if (!payoutCommissions.length) {
        throw new AppError("No released commissions to payout for the selected period", 400);
      }

      const totals = payoutCommissions.reduce(
        (acc, c) => {
          acc.totalAmount += Number(c.amount || 0);
          acc.commissionAmount += Number(c.commission_amount || 0);
          acc.taxAmount += Number(c.tax_amount || 0);
          acc.refundAmount += Number(c.refund_amount || 0);
          acc.adjustmentAmount += Number(c.adjustment_amount || 0);
          acc.netAmount += Number(c.net_amount || 0);
          return acc;
        },
        { totalAmount: 0, commissionAmount: 0, taxAmount: 0, refundAmount: 0, adjustmentAmount: 0, netAmount: 0 }
      );
      const financialBreakdown = payoutCommissions.reduce((acc, commission) => {
        const metadata = this.parseJson(commission.metadata, {});
        acc.sellerDeliveryChargeAmount += Number(metadata.sellerDeliveryChargeAmount || 0);
        acc.shippingReimbursementAmount += Number(metadata.shippingReimbursementAmount || 0);
        acc.shippingDeductionAmount += Number(metadata.shippingDeductionAmount || 0);
        acc.shippingTaxableAmount += Number(metadata.shippingTaxableAmount || 0);
        acc.shippingTaxAmount += Number(metadata.shippingTaxAmount || 0);
        acc.gstTcsTaxableAmount += Number(metadata.taxableSupplyAmount || 0);
        acc.gstTcsAmount += Number(metadata.gstTcsAmount || 0);
        acc.incomeTaxTdsTaxableAmount += Number(metadata.incomeTaxTdsTaxableAmount || 0);
        acc.incomeTaxTdsAmount += Number(metadata.incomeTaxTdsAmount || 0);
        return acc;
      }, {
        sellerDeliveryChargeAmount: 0,
        shippingReimbursementAmount: 0,
        shippingDeductionAmount: 0,
        shippingTaxableAmount: 0,
        shippingTaxAmount: 0,
        gstTcsTaxableAmount: 0,
        gstTcsAmount: 0,
        incomeTaxTdsTaxableAmount: 0,
        incomeTaxTdsAmount: 0,
      });
      Object.keys(financialBreakdown).forEach((field) => {
        financialBreakdown[field] = this.round(financialBreakdown[field]);
      });
      const recoveryRows = await trx("seller_settlements")
        .where("seller_id", sellerId)
        .modify((builder) => {
          if (organizationId) builder.where("organization_id", organizationId);
          else if (options.organizationId === null) builder.whereNull("organization_id");
        })
        .where("net_amount", "<", 0)
        .where("status", "pending")
        .forUpdate();
      const recoveryAdjustment = this.round(
        recoveryRows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0),
      );
      if (recoveryAdjustment < 0) {
        totals.adjustmentAmount = this.round(totals.adjustmentAmount + recoveryAdjustment);
        totals.netAmount = this.round(totals.netAmount + recoveryAdjustment);
      }

      if (totals.netAmount <= 0) {
        throw new AppError("Invalid payout amount", 400);
      }

      if (payoutPolicy.minimumPayoutAmount > 0 && totals.netAmount < payoutPolicy.minimumPayoutAmount) {
        throw new AppError(`Payout amount is below the minimum threshold of ${payoutPolicy.minimumPayoutAmount}`, 400);
      }

      const payoutId = uuidv4();
      const walletSelected = this.isSellerWalletRequested(options.paymentMethod);
      const razorpayXSelected = !walletSelected && (this.isRazorpayXRequested(options.paymentMethod) || options.autoProcess === true);
      const payoutStatus = options.forceManualApproval
        ? "pending"
        : (razorpayXSelected || walletSelected) ? "processing" : (payoutPolicy.manualApprovalRequired ? "pending" : "processing");
      const skippedCommissions = evaluations
        .filter(({ release }) => !release.available)
        .map(({ release }) => ({
          commissionId: release.commissionId,
          orderId: release.orderId,
          netAmount: release.netAmount,
          releaseStatus: release.releaseStatus,
          reason: release.reason,
          eligibleAt: release.eligibleAt,
        }));
      const payoutOrganizationIds = Array.from(
        new Set(
          payoutCommissions
            .map((commission) => commission.organization_id || null)
            .filter(Boolean),
        ),
      );
      const payoutOrganizationId = organizationId || (payoutOrganizationIds.length === 1 ? payoutOrganizationIds[0] : null);

      await trx("seller_payouts").insert({
        id: payoutId,
        seller_id: sellerId,
        organization_id: payoutOrganizationId,
        organization_snapshot: this.jsonb(payoutCommissions[0]?.organization_snapshot || {}),
        period_start: payoutRange.periodStart,
        period_end: payoutRange.periodEnd,
        total_amount: this.round(totals.totalAmount),
        commission_amount: this.round(totals.commissionAmount),
        tax_amount: this.round(totals.taxAmount),
        refund_amount: this.round(totals.refundAmount || 0),
        adjustment_amount: this.round(totals.adjustmentAmount || 0),
        net_amount: this.round(totals.netAmount),
        currency: options.currency || payoutCommissions[0]?.currency || "INR",
        status: payoutStatus,
        payment_method: options.paymentMethod || null,
        payment_reference: options.paymentReference || null,
        metadata: this.jsonb({
          source: options.source || "batch_payout",
          commissionIds: payoutCommissions.map((commission) => commission.id),
          skippedCommissions,
          recoverySettlementIds: recoveryRows.map((row) => row.id),
          recoveryAdjustment,
          financialBreakdown,
          payoutPolicy,
          note: options.note || null,
          createdBy: options.actor?.userId || options.actor?.sub || null,
        }),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

      await trx("seller_commissions")
        .whereIn(
          "id",
          payoutCommissions.map((c) => c.id)
        )
        .update({
          status: "approved",
          payout_id: payoutId,
          updated_at: knex.fn.now(),
        });
      await this.transitionPayoutItems(trx, payoutId, "eligible", {
        reason: "payout_prepared",
        actor: options.actor,
        metadata: { payoutStatus },
      });

      if (recoveryRows.length) {
        await trx("seller_settlements")
          .whereIn("id", recoveryRows.map((row) => row.id))
          .update({
            status: "processing",
            metadata: this.jsonb({
              source: "negative_balance_offset",
              offsetPayoutId: payoutId,
              offsetAmount: recoveryAdjustment,
              updatedBy: options.actor?.userId || options.actor?.sub || null,
              updatedAt: new Date().toISOString(),
            }),
            updated_at: knex.fn.now(),
          });
      }

      logger.info(
        { sellerId, payoutId, amount: totals.netAmount, commissionCount: payoutCommissions.length },
        "Payout initiated"
      );

      await this.publishPayoutEvent({
        id: payoutId,
        seller_id: sellerId,
        organization_id: organizationId,
        status: payoutStatus,
        net_amount: this.round(totals.netAmount),
        total_amount: this.round(totals.totalAmount),
        currency: options.currency || payoutCommissions[0]?.currency || "INR",
      }, options.actor);

      return payoutId;
    });
  }

  async processPayout(payoutId, paymentReference, options = {}) {
    let shouldSendCompletionEmail = false;
    const completedPayout = await knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts")
        .where("id", payoutId)
        .first()
        .forUpdate();

      if (!payout) {
        throw new AppError("Payout not found", 404);
      }

      if (payout.status === "completed") {
        return payout; // idempotent
      }

      if (payout.status !== "processing") {
        throw new AppError(`Payout cannot be completed from ${payout.status}`, 409);
      }

      await trx("seller_payouts")
        .where("id", payoutId)
        .update({
          status: "completed",
          payment_reference: paymentReference,
          payment_method: options.paymentMethod || payout.payment_method || null,
          processed_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });

      await trx("seller_commissions")
        .where("payout_id", payoutId)
        .whereIn("status", ["approved", "processing", "pending"])
        .update({
          status: "paid",
          updated_at: knex.fn.now(),
        });
      await this.transitionPayoutItems(trx, payoutId, "released", {
        reason: "payout_completed",
        actor: options.actor,
        metadata: { paymentReference },
      });

      const payoutMetadata = this.parseJson(payout.metadata, {});
      await trx("seller_settlements").insert({
        id: uuidv4(),
        seller_id: payout.seller_id,
        organization_id: payout.organization_id || null,
        organization_snapshot: this.jsonb(payout.organization_snapshot || {}),
        payout_id: payoutId,
        settlement_date: knex.fn.now(),
        period_start: payout.period_start,
        period_end: payout.period_end,
        gross_amount: payout.total_amount || 0,
        commission_amount: payout.commission_amount || 0,
        tax_amount: payout.tax_amount || 0,
        refund_amount: payout.refund_amount || 0,
        adjustment_amount: payout.adjustment_amount || 0,
        net_amount: payout.net_amount || 0,
        currency: payout.currency || "INR",
        status: "completed",
        notes: options.notes || "Seller payout completed",
        metadata: this.jsonb({
          paymentReference,
          paymentMethod: options.paymentMethod || payout.payment_method || null,
          financialBreakdown: payoutMetadata.financialBreakdown || {},
          processedBy: options.actor?.userId || options.actor?.sub || null,
        }),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

      if (Array.isArray(payoutMetadata.recoverySettlementIds) && payoutMetadata.recoverySettlementIds.length) {
        await trx("seller_settlements")
          .whereIn("id", payoutMetadata.recoverySettlementIds)
          .update({
            status: "completed",
            notes: "Negative balance recovered through payout offset",
            metadata: this.jsonb({
              ...payoutMetadata,
              recoveredByPayoutId: payoutId,
              recoveredAt: new Date().toISOString(),
            }),
            updated_at: knex.fn.now(),
          });
      }

      logger.info(
        { payoutId, reference: paymentReference },
        "Payout completed"
      );

      const result = { ...payout, status: "completed", payment_reference: paymentReference, payment_method: options.paymentMethod || payout.payment_method || null, processed_at: new Date() };
      await this.publishPayoutEvent(result, options.actor);
      shouldSendCompletionEmail = true;
      return result;
    });

    if (shouldSendCompletionEmail) {
      await this.sendSellerPayoutCompletedEmail(completedPayout).catch((error) => {
        logger.error({ err: error, payoutId }, "Seller payout completion email failed");
      });
    }

    return completedPayout;
  }

  async failPayout(payoutId, reason, actor = {}, options = {}) {
    return knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts").where("id", payoutId).first().forUpdate();
      if (!payout) throw new AppError("Payout not found", 404);
      if (payout.status === "completed" && options.allowCompleted !== true) {
        throw new AppError("Completed payouts cannot be failed", 409);
      }

      await trx("seller_payouts").where("id", payoutId).update({
        status: "failed",
        metadata: this.jsonb({
          ...this.parseJson(payout.metadata, {}),
          failedReason: reason || "payout_failed",
          failedBy: actor.userId || actor.sub || null,
          failedAt: new Date().toISOString(),
          failedFromStatus: payout.status,
          providerStatus: options.providerStatus || null,
          providerPayoutId: options.providerPayoutId || payout.payment_reference || null,
          reversalId: options.reversalId || null,
        }),
        updated_at: knex.fn.now(),
      });
      await this.transitionPayoutItems(trx, payoutId, "failed", {
        reason: reason || "payout_failed",
        actor,
      });
      await trx("seller_commissions")
        .where("payout_id", payoutId)
        .update({ status: "pending", payout_id: null, updated_at: knex.fn.now() });
      await trx("seller_settlements")
        .where("payout_id", payoutId)
        .update({
          status: "failed",
          notes: reason || "Seller payout failed",
          metadata: this.jsonb({
            ...this.parseJson(payout.metadata, {}),
            failedPayoutId: payoutId,
            failedReason: reason || "payout_failed",
            providerStatus: options.providerStatus || null,
            providerPayoutId: options.providerPayoutId || payout.payment_reference || null,
            reversalId: options.reversalId || null,
            failedAt: new Date().toISOString(),
          }),
          updated_at: knex.fn.now(),
        });
      const payoutMetadata = this.parseJson(payout.metadata, {});
      if (Array.isArray(payoutMetadata.recoverySettlementIds) && payoutMetadata.recoverySettlementIds.length) {
        await trx("seller_settlements")
          .whereIn("id", payoutMetadata.recoverySettlementIds)
          .update({
            status: "pending",
            metadata: this.jsonb({
              ...payoutMetadata,
              releasedFromFailedPayoutId: payoutId,
              releasedAt: new Date().toISOString(),
            }),
            updated_at: knex.fn.now(),
          });
      }
      logger.warn({
        payoutId,
        sellerId: payout.seller_id,
        organizationId: payout.organization_id || null,
        previousStatus: payout.status,
        reason: reason || "payout_failed",
        providerStatus: options.providerStatus || null,
        providerPayoutId: options.providerPayoutId || payout.payment_reference || null,
        reversalId: options.reversalId || null,
        allowCompleted: options.allowCompleted === true,
      }, "Seller payout marked failed");
      const result = { ...payout, status: "failed" };
      await this.publishPayoutEvent(result, actor);
      return result;
    });
  }

  async cancelPayout(payoutId, reason, actor = {}) {
    if (!String(reason || "").trim()) throw new AppError("Cancellation reason is required", 400);
    return knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts").where("id", payoutId).first().forUpdate();
      if (!payout) throw new AppError("Payout not found", 404);
      if (["completed", "cancelled"].includes(payout.status)) {
        throw new AppError(`Payout cannot be cancelled from ${payout.status}`, 409);
      }
      const [updated] = await trx("seller_payouts").where("id", payoutId).update({
        status: "cancelled",
        metadata: this.jsonb({
          ...this.parseJson(payout.metadata, {}), cancellationReason: reason,
          cancelledBy: actor.userId || actor.sub || null, cancelledAt: new Date().toISOString(),
        }),
        updated_at: trx.fn.now(),
      }).returning("*");
      await this.transitionPayoutItems(trx, payoutId, "cancelled", { reason, actor });
      await trx("seller_commissions").where("payout_id", payoutId).whereNot("status", "paid").update({
        status: "cancelled", updated_at: trx.fn.now(),
      });
      await this.publishPayoutEvent(updated, actor);
      return updated;
    });
  }

  async approvePayout(payoutId, options = {}) {
    const shouldStartTransfer =
      this.isSellerWalletRequested(options.paymentMethod) ||
      this.isRazorpayXRequested(options.paymentMethod) ||
      options.autoProcess === true;
    const updated = await knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts").where("id", payoutId).first().forUpdate();
      if (!payout) throw new AppError("Payout not found", 404);
      if (payout.status === "processing" && shouldStartTransfer) {
        return payout;
      }
      if (!["pending", "on_hold"].includes(payout.status)) {
        throw new AppError(`Payout cannot be approved from ${payout.status}`, 409);
      }

      const metadata = {
        ...this.parseJson(payout.metadata, {}),
        approvedBy: options.actor?.userId || options.actor?.sub || null,
        approvedAt: new Date().toISOString(),
        approvalNote: options.note || null,
      };
      const [updated] = await trx("seller_payouts")
        .where("id", payoutId)
        .update({
          status: "processing",
          payment_method: options.paymentMethod || payout.payment_method || null,
          metadata: this.jsonb(metadata),
          updated_at: knex.fn.now(),
        })
        .returning("*");

      await trx("seller_commissions")
        .where("payout_id", payoutId)
        .whereIn("status", ["pending", "approved"])
        .update({ status: "approved", updated_at: knex.fn.now() });

      await this.publishPayoutEvent(updated, options.actor);
      return updated;
    });
    if (shouldStartTransfer) {
      return this.startPayoutTransfer(payoutId, options);
    }
    return updated;
  }

  async holdPayout(payoutId, reason, actor = {}) {
    return knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts").where("id", payoutId).first().forUpdate();
      if (!payout) throw new AppError("Payout not found", 404);
      if (payout.status === "completed") throw new AppError("Completed payouts cannot be held", 409);

      const [updated] = await trx("seller_payouts")
        .where("id", payoutId)
        .update({
          status: "on_hold",
          metadata: this.jsonb({
            ...this.parseJson(payout.metadata, {}),
            holdReason: reason || "manual_hold",
            heldBy: actor.userId || actor.sub || null,
            heldAt: new Date().toISOString(),
          }),
          updated_at: knex.fn.now(),
        })
        .returning("*");
      await this.transitionPayoutItems(trx, payoutId, "held", { reason, actor });
      await this.publishPayoutEvent(updated, actor);
      return updated;
    });
  }

  async releasePayoutHold(payoutId, options = {}) {
    const updated = await knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts").where("id", payoutId).first().forUpdate();
      if (!payout) throw new AppError("Payout not found", 404);
      if (payout.status !== "on_hold") throw new AppError(`Payout is not on hold`, 409);

      const nextStatus = options.approve === true ? "processing" : "pending";
      const [updated] = await trx("seller_payouts")
        .where("id", payoutId)
        .update({
          status: nextStatus,
          metadata: this.jsonb({
            ...this.parseJson(payout.metadata, {}),
            holdReleasedBy: options.actor?.userId || options.actor?.sub || null,
            holdReleasedAt: new Date().toISOString(),
            holdReleaseNote: options.note || null,
          }),
          updated_at: knex.fn.now(),
        })
        .returning("*");
      await this.transitionPayoutItems(trx, payoutId, "eligible", {
        reason: options.note || "payout_hold_released",
        actor: options.actor,
      });
      await this.publishPayoutEvent(updated, options.actor);
      return updated;
    });
    if (options.approve === true && (this.isRazorpayXRequested(options.paymentMethod) || (env.razorpayX.enabled && options.autoProcess === true))) {
      return this.startPayoutTransfer(payoutId, options);
    }
    return updated;
  }

  resolvePayoutIdFromRetryResult(result) {
    if (!result) return null;
    if (typeof result === "string") return result;
    if (result.id) return result.id;
    if (result.payout?.id) return result.payout.id;
    if (Array.isArray(result.results)) {
      const first = result.results.find(Boolean);
      return this.resolvePayoutIdFromRetryResult(first);
    }
    return null;
  }

  async retryFailedPayout(payoutId, options = {}) {
    const payout = await knex("seller_payouts").where("id", payoutId).first();
    if (!payout) throw new AppError("Payout not found", 404);
    if (payout.status !== "failed") {
      throw new AppError(`Only failed payouts can be retried`, 409);
    }
    const payoutMetadata = this.parseJson(payout.metadata, {});
    const retryCommissionIds = Array.isArray(payoutMetadata.commissionIds)
      ? payoutMetadata.commissionIds.filter(Boolean)
      : undefined;
    if (!retryCommissionIds?.length) {
      logger.warn({
        payoutId,
        sellerId: payout.seller_id,
        organizationId: payout.organization_id || null,
        metadataKeys: Object.keys(payoutMetadata || {}),
      }, "Failed seller payout retry blocked because commission IDs are missing");
      throw new AppError("Cannot retry this payout because the original commission IDs are missing. Rebuild the seller payout from eligible commissions.", 409);
    }
    logger.info(
      {
        payoutId,
        sellerId: payout.seller_id,
        organizationId: payout.organization_id || null,
        status: payout.status,
        paymentMethod: options.paymentMethod || payout.payment_method || null,
        autoProcess: options.autoProcess === true,
        retryCommissionIds,
        retryCommissionIdsCount: retryCommissionIds?.length || 0,
        previousRazorpayXStatus: payoutMetadata.razorpayX?.status || null,
        previousRazorpayXPayoutId: payoutMetadata.razorpayX?.payoutId || null,
        previousFailureReason: payoutMetadata.failedReason || payoutMetadata.razorpayX?.rawWebhook?.failure_reason || null,
      },
      "Retrying failed seller payout",
    );
    let retryResult;
    try {
      retryResult = await this.processBatchPayouts(payout.seller_id, {
        periodStart: payout.period_start,
        periodEnd: payout.period_end,
        organizationId: payout.organization_id || null,
        commissionIds: retryCommissionIds,
        skipPrePayoutRefresh: true,
        source: "failed_payout_retry",
        previousPayoutId: payoutId,
        paymentReference: options.paymentReference,
        paymentMethod: options.paymentMethod || payout.payment_method || null,
        autoProcess: options.autoProcess === true,
        actor: options.actor,
      });
    } catch (error) {
      logger.error({
        err: error,
        payoutId,
        sellerId: payout.seller_id,
        organizationId: payout.organization_id || null,
        paymentMethod: options.paymentMethod || payout.payment_method || null,
        autoProcess: options.autoProcess === true,
        retryCommissionIds,
        previousProviderPayoutId: payoutMetadata.razorpayX?.payoutId || payout.payment_reference || null,
        previousProviderStatus: payoutMetadata.razorpayX?.status || payoutMetadata.providerStatus || null,
      }, "Failed seller payout retry could not create a replacement payout");
      throw error;
    }
    const newPayoutId = this.resolvePayoutIdFromRetryResult(retryResult);
    if (!newPayoutId) {
      logger.error({
        payoutId,
        sellerId: payout.seller_id,
        organizationId: payout.organization_id || null,
        retryResult,
      }, "Failed seller payout retry returned no replacement payout ID");
      throw new AppError("Payout retry could not resolve the replacement payout ID. Check server logs for retryResult.", 500);
    }
    logger.info({
      previousPayoutId: payoutId,
      newPayoutId,
      sellerId: payout.seller_id,
      organizationId: payout.organization_id || null,
      autoProcess: options.autoProcess === true,
      paymentMethod: options.paymentMethod || payout.payment_method || null,
    }, "Failed seller payout replacement payout created");
    if (this.isSellerWalletRequested(options.paymentMethod || payout.payment_method) || this.isRazorpayXRequested(options.paymentMethod || payout.payment_method) || options.autoProcess === true) {
      return this.startPayoutTransfer(newPayoutId, options);
    }
    return retryResult;
  }

  async getSellerCommissions(sellerId, query = {}) {
    return this.listSellerCommissions({ ...query, sellerId });
  }

  async getSellerPayouts(sellerId, query = {}) {
    return this.listSellerPayouts({ ...query, sellerId });
  }

  async exportSellerCommissions(filters = {}) {
    const result = await this.listSellerCommissions({
      ...filters,
      limit: Number(filters.limit || 500),
      offset: Number(filters.offset || 0),
    });
    return documentRendererService.render(this.buildCommissionsExportDocument(result.items || [], result.summary), {
      format: filters.format || "csv",
      fileBaseName: "seller-commissions-export",
    });
  }

  async exportSellerPayouts(filters = {}) {
    const result = await this.listSellerPayouts({
      ...filters,
      limit: Number(filters.limit || 500),
      offset: Number(filters.offset || 0),
    });
    return documentRendererService.render(this.buildPayoutsExportDocument(result.items || [], result.summary), {
      format: filters.format || "csv",
      fileBaseName: "seller-payouts-export",
    });
  }

  async exportSettlements(filters = {}) {
    const result = await this.getSettlements({
      ...filters,
      limit: Number(filters.limit || 500),
      offset: Number(filters.offset || 0),
    });
    return documentRendererService.render(this.buildSettlementsExportDocument(result.items || []), {
      format: filters.format || "csv",
      fileBaseName: "seller-settlements-export",
    });
  }

  async getSellerWalletSummary(sellerId, query = {}) {
    const { limit, offset } = this.normalizePagination(query);
    const buildCommissionQuery = () => knex("seller_commissions")
      .where("seller_id", sellerId)
      .modify((builder) => {
        if (query.organizationId) builder.where("organization_id", query.organizationId);
        if (query.fromDate) builder.where("created_at", ">=", query.fromDate);
        if (query.toDate) builder.where("created_at", "<=", query.toDate);
      });

    const [commerceSettings, commissions, paidPayoutRow, inProcessPayoutRow, adjustmentRow, walletRow, walletTransactions] = await Promise.all([
      commerceSettingsService.getSettings(),
      buildCommissionQuery().orderBy("created_at", "desc"),
      knex("seller_payouts")
        .where({ seller_id: sellerId, status: "completed" })
        .modify((builder) => {
          if (query.organizationId) builder.where("organization_id", query.organizationId);
        })
        .sum({ paid_amount: "net_amount" })
        .count({ count: "*" })
        .first(),
      knex("seller_payouts")
        .where("seller_id", sellerId)
        .whereIn("status", ["pending", "processing"])
        .modify((builder) => {
          if (query.organizationId) builder.where("organization_id", query.organizationId);
        })
        .sum({ in_process_amount: "net_amount" })
        .count({ count: "*" })
        .first(),
      knex("seller_settlements")
        .where("seller_id", sellerId)
        .whereIn("status", ["pending", "processing"])
        .where("net_amount", "<", 0)
        .modify((builder) => {
          if (query.organizationId) builder.where("organization_id", query.organizationId);
        })
        .sum({ adjustment_balance: "net_amount" })
        .count({ count: "*" })
        .first(),
      this.walletService.ensureWallet(sellerId),
      knex("wallet_transactions")
        .where("user_id", sellerId)
        .where("reference_type", "seller_payout")
        .orderBy("created_at", "desc")
        .limit(20),
    ]);

    const payoutPolicy = this.getPayoutPolicy(commerceSettings);
    const payoutPreference = await this.resolveSellerPayoutPreference(sellerId, query.organizationId || null, commerceSettings);
    const evaluations = await this.evaluateCommissionsRelease(commissions, commerceSettings);
    const balances = {
      pendingBalance: 0,
      availableBalance: 0,
      inProcessBalance: 0,
      paidBalance: this.round(paidPayoutRow?.paid_amount || 0),
      blockedBalance: 0,
      refundAdjustmentBalance: this.round(adjustmentRow?.adjustment_balance || 0),
    };
    const counts = {
      pending: 0,
      available: 0,
      inProcess: 0,
      paid: 0,
      blocked: 0,
      totalCommissions: evaluations.length,
    };
    const nextEligibleDates = [];

    evaluations.forEach(({ release }) => {
      if (release.releaseStatus === "available") {
        balances.availableBalance = this.round(balances.availableBalance + release.netAmount);
        counts.available += 1;
        return;
      }
      if (release.releaseStatus === "in_process") {
        balances.inProcessBalance = this.round(balances.inProcessBalance + release.netAmount);
        counts.inProcess += 1;
        return;
      }
      if (release.releaseStatus === "paid") {
        counts.paid += 1;
        return;
      }
      if (release.releaseStatus === "blocked") {
        balances.blockedBalance = this.round(balances.blockedBalance + release.netAmount);
        counts.blocked += 1;
        return;
      }
      balances.pendingBalance = this.round(balances.pendingBalance + release.netAmount);
      counts.pending += 1;
      if (release.eligibleAt && new Date(release.eligibleAt).getTime() > Date.now()) {
        nextEligibleDates.push(release.eligibleAt);
      }
    });

    const nextEligibleAt = nextEligibleDates.sort()[0] || null;
    const minimumPayoutShortfall = Math.max(
      0,
      this.round(payoutPolicy.minimumPayoutAmount - balances.availableBalance),
    );
    const items = evaluations.slice(offset, offset + limit).map(({ commission, release }) => ({
      commissionId: commission.id,
      orderId: commission.order_id,
      payoutId: commission.payout_id || null,
      status: commission.status,
      orderStatus: release.orderStatus,
      amount: this.round(commission.amount || 0),
      commissionAmount: this.round(commission.commission_amount || 0),
      taxAmount: this.round(commission.tax_amount || 0),
      refundAmount: this.round(commission.refund_amount || 0),
      netAmount: release.netAmount,
      currency: commission.currency || "INR",
      releaseStatus: release.releaseStatus,
      releaseReason: release.reason,
      eligibleAt: release.eligibleAt,
      createdAt: commission.created_at,
      updatedAt: commission.updated_at,
    }));

    return {
      sellerId,
      organizationId: query.organizationId || null,
      currency: commissions[0]?.currency || "INR",
      balances: {
        ...balances,
        sellerWalletAvailableBalance: this.round(walletRow?.available_balance || 0),
        sellerWalletLockedBalance: this.round(walletRow?.locked_balance || 0),
        totalOpenBalance: this.round(
          balances.pendingBalance +
          balances.availableBalance +
          balances.inProcessBalance +
          balances.blockedBalance,
        ),
      },
      counts,
      payoutPolicy,
      payoutPreference,
      sellerWallet: {
        availableBalance: this.round(walletRow?.available_balance || 0),
        lockedBalance: this.round(walletRow?.locked_balance || 0),
        transactions: walletTransactions.map((transaction) => ({
          id: transaction.id,
          amount: this.round(transaction.amount || 0),
          type: transaction.type,
          status: transaction.status,
          referenceId: transaction.reference_id,
          metadata: this.parseJson(transaction.metadata, {}),
          createdAt: transaction.created_at,
        })),
      },
      nextEligibleAt,
      canRequestPayout: balances.availableBalance > 0 && minimumPayoutShortfall === 0,
      minimumPayoutShortfall,
      payouts: {
        paidCount: Number(paidPayoutRow?.count || 0),
        inProcessCount: Number(inProcessPayoutRow?.count || 0),
        inProcessAmount: this.round(inProcessPayoutRow?.in_process_amount || 0),
      },
      items,
      total: evaluations.length,
      limit,
      offset,
    };
  }

  applyCommissionFilters(query, filters = {}) {
    const { sellerId, organizationId, status, orderId, payoutId, fromDate, toDate, search } = filters;
    if (sellerId) query.where("seller_id", sellerId);
    if (organizationId) query.where("organization_id", organizationId);
    if (status === "return_window_open") query.whereExists(function openReturnWindowItem() {
      this.select(1)
        .from("order_items")
        .whereRaw("order_items.id = seller_commissions.order_item_id")
        .where("order_items.payout_status", "pending")
        .whereNotNull("order_items.delivered_at")
        .where("order_items.payout_eligible_at", ">", knex.fn.now());
    });
    else if (status === "eligible") query.whereExists(function eligibleItem() {
      this.select(1).from("order_items").whereRaw("order_items.id = seller_commissions.order_item_id").where("order_items.payout_status", "eligible");
    });
    else if (status === "held") query.whereExists(function heldItem() {
      this.select(1).from("order_items").whereRaw("order_items.id = seller_commissions.order_item_id").where("order_items.payout_status", "held");
    });
    else if (status === "released") query.where("status", "paid");
    else if (status) query.where("status", status);
    if (orderId) query.where("order_id", orderId);
    if (payoutId) query.where("payout_id", payoutId);
    if (fromDate) query.where("created_at", ">=", fromDate);
    if (toDate) query.where("created_at", "<=", toDate);
    if (search) {
      const rawSearch = String(search).trim();
      const normalizedSearch = rawSearch.replace(/^#/, "");
      const term = `%${rawSearch}%`;
      const normalizedTerm = `%${normalizedSearch}%`;
      query.where((builder) => {
        builder
          .whereILike("seller_id", term)
          .orWhereRaw("order_id::text ILIKE ?", [normalizedTerm])
          .orWhereRaw("COALESCE(payout_id::text, '') ILIKE ?", [normalizedTerm])
          .orWhereRaw("COALESCE(metadata, '{}'::jsonb)::text ILIKE ?", [term])
          .orWhereExists(function matchingOrderNumber() {
            this.select(1)
              .from("orders")
              .whereRaw("orders.id = seller_commissions.order_id")
              .where((orderQuery) => {
                orderQuery
                  .whereILike("orders.order_number", term)
                  .orWhereILike("orders.order_number", normalizedTerm);
              });
          });
      });
    }
  }

  async listSellerCommissions(filters = {}) {
    const { limit, offset } = this.normalizePagination(filters);
    const buildBase = () => {
      const query = knex("seller_commissions");
      this.applyCommissionFilters(query, filters);
      return query;
    };

    const [items, countRows, summaryRows] = await Promise.all([
      buildBase().orderBy("created_at", "desc").limit(limit).offset(offset),
      buildBase().count({ total: "*" }),
      buildBase()
        .sum({ total_amount: "amount" })
        .sum({ commission_amount: "commission_amount" })
        .sum({ tax_amount: "tax_amount" })
        .sum({ refund_amount: "refund_amount" })
        .sum({ net_amount: "net_amount" })
        .first(),
    ]);

    const settings = await commerceSettingsService.getSettings();
    const evaluations = await this.evaluateCommissionsRelease(items, settings);
    const releaseById = new Map(evaluations.map(({ commission, release }) => [String(commission.id), release]));
    const orderItemIds = items.map((item) => item.order_item_id).filter(Boolean);
    const orderItems = orderItemIds.length
      ? await knex("order_items")
        .whereIn("id", orderItemIds)
        .select("id", "delivered_at", "return_eligible_until", "payout_eligible_at", "payout_status", "payout_hold_reason")
      : [];
    const orderItemsById = new Map(orderItems.map((item) => [String(item.id), item]));
    const enrichedItems = (await this.enrichFinanceRecords(items)).map((item) => {
      const release = releaseById.get(String(item.id)) || {};
      const orderItem = orderItemsById.get(String(item.order_item_id || "")) || {};
      return {
        ...item,
        deliveredAt: orderItem.delivered_at || null,
        returnWindowStartsAt: orderItem.delivered_at || null,
        returnWindowEndsAt: orderItem.return_eligible_until || orderItem.payout_eligible_at || null,
        itemPayoutStatus: orderItem.payout_status || null,
        payoutHoldReason: orderItem.payout_hold_reason || null,
        releaseStatus: release.releaseStatus,
        releaseReason: release.reason,
        eligibleAt: release.eligibleAt,
        lifecycleStatus: release.releaseStatus === "available" ? "eligible"
          : release.releaseStatus === "paid" ? "released"
            : release.releaseStatus === "in_process" ? "pending"
              : release.releaseStatus === "held" ? "held"
                : release.releaseStatus || "pending",
      };
    });
    return {
      items: enrichedItems,
      total: Number(countRows?.[0]?.total || 0),
      limit,
      offset,
      summary: {
        totalAmount: this.round(summaryRows?.total_amount || 0),
        commissionAmount: this.round(summaryRows?.commission_amount || 0),
        taxAmount: this.round(summaryRows?.tax_amount || 0),
        refundAmount: this.round(summaryRows?.refund_amount || 0),
        netAmount: this.round(summaryRows?.net_amount || 0),
      },
    };
  }

  applyPayoutFilters(query, filters = {}) {
    const { sellerId, organizationId, status, payoutId, fromDate, toDate, search } = filters;
    if (sellerId) query.where("seller_id", sellerId);
    if (organizationId) query.where("organization_id", organizationId);
    const statusMap = { pending: ["pending", "processing"], held: ["on_hold"], released: ["completed"], failed: ["failed"], cancelled: ["cancelled"] };
    if (statusMap[status]) query.whereIn("status", statusMap[status]);
    else if (status) query.where("status", status);
    if (payoutId) query.where("id", payoutId);
    if (fromDate) query.where("created_at", ">=", fromDate);
    if (toDate) query.where("created_at", "<=", toDate);
    if (search) {
      const term = `%${String(search).trim()}%`;
      query.where((builder) => {
        builder
          .whereILike("seller_id", term)
          .orWhereILike("payment_reference", term)
          .orWhereRaw("id::text ILIKE ?", [term])
          .orWhereRaw("COALESCE(metadata, '{}'::jsonb)::text ILIKE ?", [term]);
      });
    }
  }

  async listSellerPayouts(filters = {}) {
    const { limit, offset } = this.normalizePagination(filters);
    const buildBase = () => {
      const query = knex("seller_payouts");
      this.applyPayoutFilters(query, filters);
      return query;
    };

    const [items, countRows, summaryRows] = await Promise.all([
      buildBase().orderBy("created_at", "desc").limit(limit).offset(offset),
      buildBase().count({ total: "*" }),
      buildBase()
        .sum({ total_amount: "total_amount" })
        .sum({ commission_amount: "commission_amount" })
        .sum({ tax_amount: "tax_amount" })
        .sum({ refund_amount: "refund_amount" })
        .sum({ net_amount: "net_amount" })
        .first(),
    ]);

    return {
      items: (await this.enrichFinanceRecords(items)).map((item) => ({
        ...item,
        lifecycleStatus: item.status === "completed" ? "released"
          : item.status === "on_hold" ? "held"
            : item.status === "failed" ? "failed"
              : item.status === "cancelled" ? "cancelled"
                : "pending",
      })),
      total: Number(countRows?.[0]?.total || 0),
      limit,
      offset,
      summary: {
        totalAmount: this.round(summaryRows?.total_amount || 0),
        commissionAmount: this.round(summaryRows?.commission_amount || 0),
        taxAmount: this.round(summaryRows?.tax_amount || 0),
        refundAmount: this.round(summaryRows?.refund_amount || 0),
        netAmount: this.round(summaryRows?.net_amount || 0),
      },
    };
  }

  async processBatchPayouts(sellerId, options = {}) {
    const range = this.buildDateRange(options.periodStart, options.periodEnd);
    const commerceSettings = await commerceSettingsService.getSettings();
    if (options.organizationId === undefined && !options.commissionIds?.length) {
      const organizationRows = await knex("seller_commissions")
        .distinct("organization_id")
        .where("seller_id", sellerId)
        .whereIn("status", ["pending", "approved"])
        .whereNull("payout_id")
        .whereBetween("created_at", [range.periodStart, `${range.periodEnd} 23:59:59`])
        .orderBy("organization_id", "asc");
      const results = [];
      for (const row of organizationRows) {
        results.push(await this.processBatchPayouts(sellerId, {
          ...options,
          organizationId: row.organization_id || null,
        }));
      }
      return {
        sellerId,
        organizationWise: true,
        periodStart: range.periodStart,
        periodEnd: range.periodEnd,
        results,
      };
    }
    const preference = await this.resolveSellerPayoutPreference(sellerId, options.organizationId || null, commerceSettings);
    const resolvedOptions = {
      ...options,
      paymentMethod: options.paymentMethod || preference.destination,
      payoutDestination: options.payoutDestination || preference.destination,
    };
    const payoutId = await this.initiatePayout(sellerId, range.periodStart, range.periodEnd, resolvedOptions);
    const payoutPolicy = this.getPayoutPolicy(commerceSettings);
    if (payoutPolicy.manualApprovalRequired) {
      const payout = await knex("seller_payouts").where("id", payoutId).first();
      return {
        payout,
        approvalRequired: true,
        payoutPolicy,
        message: "Payout is pending manual approval",
      };
    }
    if (this.isSellerWalletRequested(resolvedOptions.paymentMethod)) {
      return this.completeSellerWalletPayout(payoutId, resolvedOptions);
    }
    if (this.isRazorpayXRequested(resolvedOptions.paymentMethod) || (env.razorpayX.enabled && resolvedOptions.autoProcess === true)) {
      return this.initiateRazorpayXPayout(payoutId, resolvedOptions);
    }
    return this.processPayout(payoutId, resolvedOptions.paymentReference || `batch_${Date.now()}`, resolvedOptions);
  }

  async requestSellerPayout(sellerId, options = {}) {
    if (options.organizationId === undefined && !options.commissionIds?.length) {
      const organizations = await knex("seller_commissions")
        .distinct("organization_id")
        .where("seller_id", sellerId)
        .whereIn("status", ["pending", "approved"])
        .whereNull("payout_id");
      if (!organizations.length) throw new AppError("No commissions to payout", 400);
      const results = [];
      for (const row of organizations) {
        results.push(await this.requestSellerPayout(sellerId, {
          ...options,
          organizationId: row.organization_id || null,
        }));
      }
      return {
        sellerId,
        organizationWise: true,
        results,
        approvalRequired: true,
        message: "Payout requests submitted for admin approval and manual transfer",
      };
    }
    const range = this.buildDateRange(options.periodStart, options.periodEnd);
    const payoutId = await this.initiatePayout(sellerId, range.periodStart, range.periodEnd, {
      ...options,
      source: "seller_request",
      forceManualApproval: true,
      paymentMethod: null,
      autoProcess: false,
    });
    const payout = await knex("seller_payouts").where("id", payoutId).first();
    return {
      payout,
      approvalRequired: true,
      message: "Payout request submitted for admin approval and manual transfer",
    };
  }

  async processScheduledPayouts(options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const commerceSettings = await commerceSettingsService.getSettings();
    const payoutPolicy = this.getPayoutPolicy(commerceSettings);

    if (!payoutPolicy.autoRazorpayX && options.autoProcess !== true) {
      return {
        skipped: true,
        reason: "auto_payout_disabled",
        payoutPolicy,
        processed: [],
        failed: [],
      };
    }

    if ((payoutPolicy.autoRazorpayX || options.autoProcess === true) && !env.razorpayX.enabled) {
      return {
        skipped: true,
        reason: "razorpayx_disabled",
        payoutPolicy,
        processed: [],
        failed: [],
      };
    }

    if (!this.shouldRunScheduledPayout(payoutPolicy, now, options)) {
      return {
        skipped: true,
        reason: "schedule_not_due",
        payoutPolicy,
        processed: [],
        failed: [],
      };
    }

    const range = {
      ...this.getScheduledPayoutWindow(payoutPolicy.schedule, now),
      ...(options.periodStart ? { periodStart: options.periodStart } : {}),
      ...(options.periodEnd ? { periodEnd: options.periodEnd } : {}),
    };
    const sellerRows = await knex("seller_commissions")
      .distinct("seller_id", "organization_id")
      .whereIn("status", ["pending", "approved"])
      .whereNull("payout_id")
      .whereBetween("created_at", [range.periodStart, `${range.periodEnd} 23:59:59`])
      .orderBy([{ column: "seller_id", order: "asc" }, { column: "organization_id", order: "asc" }]);

    const processed = [];
    const failed = [];

    for (const row of sellerRows) {
      const sellerId = row.seller_id;
      const organizationId = row.organization_id || undefined;
      try {
        const result = await this.processBatchPayouts(sellerId, {
          ...range,
          organizationId,
          source: "scheduled_payout",
          paymentMethod: options.paymentMethod,
          autoProcess: payoutPolicy.autoRazorpayX || options.autoProcess === true,
          paymentReference: payoutPolicy.autoRazorpayX
            ? undefined
            : options.paymentReference || `scheduled_${payoutPolicy.schedule}_${Date.now()}`,
          actor: options.actor || { userId: "system", role: "system" },
        });
        processed.push({
          sellerId,
          organizationId: row.organization_id || null,
          approvalRequired: result.approvalRequired === true,
          payoutId: result.payout?.id || result.id || null,
          status: result.payout?.status || result.status || null,
        });
      } catch (error) {
        failed.push({
          sellerId,
          organizationId: row.organization_id || null,
          error: error.message,
          statusCode: error.statusCode || error.status || null,
        });
      }
    }

    logger.info({
      schedule: payoutPolicy.schedule,
      processed: processed.length,
      failed: failed.length,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
    }, "Scheduled seller payout run completed");

    return {
      skipped: false,
      payoutPolicy,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      processed,
      failed,
    };
  }

  async getSettlements(query = {}) {
    const { limit, offset } = this.normalizePagination(query);
    const buildBase = () => knex("seller_settlements").modify((builder) => {
      if (query.sellerId) builder.where("seller_id", query.sellerId);
      if (query.organizationId) builder.where("organization_id", query.organizationId);
      if (query.status) builder.where("status", query.status);
      if (query.payoutId) builder.where("payout_id", query.payoutId);
    });
    const [rows, countRows] = await Promise.all([
      buildBase().orderBy("created_at", "desc").limit(limit).offset(offset),
      buildBase().count({ total: "*" }),
    ]);
    return {
      items: await this.enrichFinanceRecords(rows),
      total: Number(countRows?.[0]?.total || 0),
      limit,
      offset,
    };
  }

  async getSellerSettlements(sellerId, query = {}) {
    return this.getSettlements({ ...query, sellerId });
  }

  async getPayoutOperationsQueue(query = {}) {
    const { limit, offset } = this.normalizePagination(query);
    const requestedStatus = query.status === "pending_approval" ? "pending" : query.status;
    const shouldLoadStatus = (status) => !requestedStatus || requestedStatus === status;
    const buildPayoutQuery = (status) => {
      const builder = knex("seller_payouts").where("status", status);
      if (query.sellerId) builder.where("seller_id", query.sellerId);
      if (query.organizationId) builder.where("organization_id", query.organizationId);
      if (query.fromDate) builder.where("created_at", ">=", query.fromDate);
      if (query.toDate) builder.where("created_at", "<=", query.toDate);
      if (query.search) {
        const term = `%${String(query.search).trim()}%`;
        builder.where((searchBuilder) => {
          searchBuilder
            .whereRaw("seller_id::text ILIKE ?", [term])
            .orWhereILike("payment_reference", term)
            .orWhereRaw("id::text ILIKE ?", [term]);
        });
      }
      return builder;
    };
    const loadPayouts = (status, orderColumn = "updated_at", orderDirection = "desc") => {
      if (!shouldLoadStatus(status)) return Promise.resolve([]);
      return buildPayoutQuery(status)
        .orderBy(orderColumn, orderDirection)
        .limit(limit)
        .offset(offset);
    };
    const [pendingApprovalRows, processingRows, onHoldRows, failedRows, negativeBalances] = await Promise.all([
      loadPayouts("pending", "created_at", "asc"),
      loadPayouts("processing", "updated_at", "desc"),
      loadPayouts("on_hold", "updated_at", "desc"),
      loadPayouts("failed", "updated_at", "desc"),
      this.listNegativeBalanceRecoveries({ ...query, limit, offset }),
    ]);
    const [pendingApproval, processing, onHold, failed] = await Promise.all([
      this.enrichFinanceRecords(pendingApprovalRows),
      this.enrichFinanceRecords(processingRows),
      this.enrichFinanceRecords(onHoldRows),
      this.enrichFinanceRecords(failedRows),
    ]);

    return {
      pendingApproval,
      processing,
      onHold,
      failed,
      negativeBalances: negativeBalances.items,
      counts: {
        pendingApproval: pendingApproval.length,
        processing: processing.length,
        onHold: onHold.length,
        failed: failed.length,
        negativeBalances: negativeBalances.total,
      },
      limit,
      offset,
    };
  }

  async listNegativeBalanceRecoveries(query = {}) {
    const { limit, offset } = this.normalizePagination(query);
    const buildBase = () => knex("seller_settlements")
      .where("net_amount", "<", 0)
      .modify((builder) => {
        if (query.sellerId) builder.where("seller_id", query.sellerId);
        if (query.organizationId) builder.where("organization_id", query.organizationId);
        if (query.status) builder.where("status", query.status);
        else builder.whereIn("status", ["pending", "processing", "on_hold"]);
        if (query.search) {
          const term = `%${String(query.search).trim()}%`;
          builder.where((searchBuilder) => {
            searchBuilder
              .whereRaw("seller_id::text ILIKE ?", [term])
              .orWhereRaw("payout_id::text ILIKE ?", [term])
              .orWhereILike("notes", term)
              .orWhereRaw("id::text ILIKE ?", [term]);
          });
        }
      });
    const [items, countRows] = await Promise.all([
      buildBase().orderBy("created_at", "asc").limit(limit).offset(offset),
      buildBase().count({ total: "*" }),
    ]);
    return {
      items,
      total: Number(countRows?.[0]?.total || 0),
      limit,
      offset,
    };
  }

  async resolveNegativeBalanceRecovery(settlementId, payload = {}, actor = {}) {
    const action = payload.action || "offset_future_payout";
    const validActions = ["offset_future_payout", "collected_from_seller", "platform_write_off"];
    if (!validActions.includes(action)) {
      throw new AppError("Invalid negative balance recovery action", 400);
    }

    return knex.transaction(async (trx) => {
      const settlement = await trx("seller_settlements").where("id", settlementId).first().forUpdate();
      if (!settlement) throw new AppError("Negative balance settlement not found", 404);
      if (Number(settlement.net_amount || 0) >= 0) {
        throw new AppError("Settlement is not a negative balance recovery item", 400);
      }

      const nextStatus = action === "offset_future_payout" ? "pending" : "completed";
      const [updated] = await trx("seller_settlements")
        .where("id", settlementId)
        .update({
          status: nextStatus,
          notes: payload.note || settlement.notes || this.recoveryActionLabel(action),
          metadata: this.jsonb({
            ...this.parseJson(settlement.metadata, {}),
            recoveryAction: action,
            recoveryAmount: this.round(Math.abs(Number(settlement.net_amount || 0))),
            recoveryReference: payload.referenceId || payload.reference || null,
            recoveryNote: payload.note || null,
            resolvedBy: actor.userId || actor.sub || null,
            resolvedAt: new Date().toISOString(),
          }),
          updated_at: knex.fn.now(),
        })
        .returning("*");
      return updated;
    });
  }

  async getSettlementStatement(settlementId, query = {}, actor = {}) {
    const settlement = await knex("seller_settlements").where("id", settlementId).first();
    if (!settlement) {
      throw new AppError("Settlement not found", 404);
    }
    this.assertSettlementAccess(settlement, actor);

    const [payout, commissions] = await Promise.all([
      settlement.payout_id
        ? knex("seller_payouts").where("id", settlement.payout_id).first()
        : null,
      settlement.payout_id
        ? knex("seller_commissions").where("payout_id", settlement.payout_id).orderBy("created_at", "asc")
        : knex("seller_commissions")
          .where("seller_id", settlement.seller_id)
          .modify((builder) => {
            if (settlement.organization_id) builder.where("organization_id", settlement.organization_id);
            else builder.whereNull("organization_id");
          })
          .whereBetween("created_at", [
            settlement.period_start || "1970-01-01",
            `${settlement.period_end || new Date().toISOString().slice(0, 10)} 23:59:59`,
          ])
          .orderBy("created_at", "asc"),
    ]);

    const document = this.buildSettlementDocument(settlement, payout, commissions);
    return documentRendererService.render(document, {
      format: query.format || "pdf",
      fileBaseName: `settlement-${settlement.id}`,
    });
  }

  assertSettlementAccess(settlement = {}, actor = {}) {
    const adminRoles = ["admin", "sub-admin", "super-admin"];
    if (actor.isSuperAdmin || adminRoles.includes(actor.role)) return;
    const sellerId = actor.ownerSellerId || actor.userId || actor.sub;
    if (sellerId && String(settlement.seller_id || "") === String(sellerId)) return;
    throw new AppError("You are not allowed to download this settlement statement", 403);
  }

  buildSettlementDocument(settlement = {}, payout = null, commissions = []) {
    const currency = settlement.currency || payout?.currency || "INR";
    const commissionMetadata = commissions.map((commission) => this.parseJson(commission.metadata, {}));
    const metadataTotal = (field) => this.round(commissionMetadata.reduce(
      (sum, metadata) => sum + Number(metadata[field] || 0),
      0,
    ));
    const productMetadataTotal = (field) => this.round(commissionMetadata.reduce(
      (sum, metadata) => sum + (metadata.products || []).reduce(
        (productSum, product) => productSum + Number(product[field] || 0),
        0,
      ),
      0,
    ));
    const grossAmount = this.round(Number(settlement.gross_amount || 0));
    const marketplaceDiscount = productMetadataTotal("marketplaceFundedDiscountAmount");
    const paymentPartnerDiscount = productMetadataTotal("paymentPartnerFundedDiscountAmount");
    const sellerFundedDiscount = productMetadataTotal("sellerFundedDiscountAmount");
    const shippingCollected = metadataTotal("sellerDeliveryChargeAmount");
    const shippingReimbursed = metadataTotal("shippingReimbursementAmount");
    const shippingDeducted = metadataTotal("shippingDeductionAmount");
    const commissionAmount = this.round(Number(settlement.commission_amount || 0));
    const commissionTax = this.round(Number(settlement.tax_amount || 0));
    const gstTcsAmount = metadataTotal("gstTcsAmount");
    const incomeTaxTdsAmount = metadataTotal("incomeTaxTdsAmount");
    const refundAmount = this.round(Number(settlement.refund_amount || 0));
    const adjustmentAmount = this.round(Number(settlement.adjustment_amount || 0));
    const netAmount = this.round(Number(settlement.net_amount || 0));

    const sellerCredits = this.round(grossAmount + shippingReimbursed + marketplaceDiscount + paymentPartnerDiscount);
    const platformDeductions = this.round(commissionAmount + commissionTax + shippingDeducted);
    const taxWithholding = this.round(gstTcsAmount + incomeTaxTdsAmount);
    const totalAdjustments = this.round(refundAmount - adjustmentAmount);

    return {
      layout: "settlement",
      title: "Seller Settlement Statement / Payout Advice",
      subtitle: `Settlement ${settlement.id}`,
      fileBaseName: `settlement-${settlement.id}`,
      generatedAt: new Date().toISOString(),
      raw: { settlement, payout, commissions },
      sections: [
        {
          title: "1. Settlement Header",
          rows: [
            { label: "Settlement ID", value: settlement.id },
            { label: "Seller ID", value: settlement.seller_id },
            { label: "Payout ID", value: settlement.payout_id || "-" },
            { label: "Status", value: settlement.status },
            { label: "Period Start", value: settlement.period_start || "-" },
            { label: "Period End", value: settlement.period_end || "-" },
            { label: "Settlement Date", value: settlement.settlement_date || settlement.created_at },
            { label: "Payment Reference", value: payout?.payment_reference || "-" },
            { label: "Payment Method", value: payout?.payment_method || "-" },
          ],
        },
        {
          title: "2. Seller Credits",
          rows: [
            { label: "Product value payable to seller", value: this.renderMoney(grossAmount, currency) },
            { label: "Shipping collected from customer", value: this.renderMoney(shippingCollected, currency) },
            { label: "Shipping paid/reimbursed to seller", value: `+${this.renderMoney(shippingReimbursed, currency)}` },
            { label: "Marketplace-funded discount reimbursement", value: `+${this.renderMoney(marketplaceDiscount, currency)}` },
            { label: "Payment-partner-funded discount reimbursement", value: `+${this.renderMoney(paymentPartnerDiscount, currency)}` },
            { label: "Seller-funded discount", value: `-${this.renderMoney(sellerFundedDiscount, currency)} (already reduced in seller product value)` },
            { label: "Total seller credits", value: this.renderMoney(sellerCredits, currency) },
          ],
        },
        {
          title: "3. Platform Charges",
          rows: [
            { label: "Platform commission charged to seller", value: `-${this.renderMoney(commissionAmount, currency)}` },
            { label: "GST on platform commission", value: `-${this.renderMoney(commissionTax, currency)}` },
            { label: "Shipping deducted from seller", value: `-${this.renderMoney(shippingDeducted, currency)}` },
            { label: "Total platform deductions", value: `-${this.renderMoney(platformDeductions, currency)}` },
          ],
        },
        {
          title: "4. Tax Withholding",
          rows: [
            { label: "GST TCS Withheld", value: `-${this.renderMoney(gstTcsAmount, currency)}` },
            { label: "Income-tax TDS Withheld", value: `-${this.renderMoney(incomeTaxTdsAmount, currency)}` },
            { label: "Total statutory withholding", value: `-${this.renderMoney(taxWithholding, currency)}` },
          ],
        },
        {
          title: "5. Return / Refund / Recovery Adjustments",
          rows: [
            { label: "Refund / return recovery", value: `-${this.renderMoney(refundAmount, currency)}` },
            { label: "Other adjustment", value: `${adjustmentAmount < 0 ? "-" : "+"}${this.renderMoney(Math.abs(adjustmentAmount), currency)}` },
            { label: "Net adjustment impact", value: `${totalAdjustments >= 0 ? "-" : "+"}${this.renderMoney(Math.abs(totalAdjustments), currency)}` },
          ],
        },
        {
          title: "6. Final Seller Payout",
          rows: [
            { label: "Seller credits", value: this.renderMoney(sellerCredits, currency) },
            { label: "Less: platform charges", value: `-${this.renderMoney(platformDeductions, currency)}` },
            { label: "Less: GST TCS / income-tax TDS", value: `-${this.renderMoney(taxWithholding, currency)}` },
            { label: "Less/Add: returns and adjustments", value: `${totalAdjustments >= 0 ? "-" : "+"}${this.renderMoney(Math.abs(totalAdjustments), currency)}` },
            { label: "Final seller payout", value: this.renderMoney(netAmount, currency) },
          ],
        },
        {
          title: "7. Tax / Base Reference",
          rows: [
            { label: "Shipping Taxable Value", value: this.renderMoney(metadataTotal("shippingTaxableAmount"), currency) },
            { label: "Shipping GST", value: this.renderMoney(metadataTotal("shippingTaxAmount"), currency) },
            { label: "GST TCS Taxable Base", value: this.renderMoney(metadataTotal("taxableSupplyAmount"), currency) },
            { label: "Income-tax TDS Base", value: this.renderMoney(metadataTotal("incomeTaxTdsTaxableAmount"), currency) },
          ],
        },
        {
          title: "8. Item-wise Settlement Lines",
          rows: this.buildSettlementCommissionRows(commissions, currency),
        },
        {
          title: "9. Document Notes",
          rows: [
            { label: "Commission tax invoice", value: "Issued separately by platform to seller for platform commission and GST." },
            { label: "Reverse invoice / credit note", value: "Generated separately when a returned/cancelled item reverses seller invoice or platform commission." },
            { label: "Discount funding", value: "Marketplace/payment-partner funded discounts are seller credits/reimbursements, not seller deductions." },
            { label: "Statement notes", value: settlement.notes || "-" },
          ],
        },
      ],
    };
  }

  buildSettlementCommissionRows(commissions = [], currency = "INR") {
    if (!commissions.length) {
      return [{ label: "Commissions", value: "No commission lines available" }];
    }
    return [
      ["Order", "Status", "Product", "Shipping", "Mkt Discount", "Commission", "GST", "TCS", "TDS", "Refund", "Net"],
      ...commissions.map((commission) => {
        const metadata = this.parseJson(commission.metadata, {});
        const marketplaceDiscount = (metadata.products || []).reduce(
          (sum, product) => sum + Number(product.marketplaceFundedDiscountAmount || 0),
          0,
        );
        const shippingNet = Number(metadata.shippingReimbursementAmount || 0) - Number(metadata.shippingDeductionAmount || 0);
        return [
          commission.order_id || "-",
          commission.status || "-",
          this.renderMoney(commission.amount, currency),
          this.renderMoney(shippingNet, currency),
          this.renderMoney(marketplaceDiscount, currency),
          this.renderMoney(commission.commission_amount, currency),
          this.renderMoney(commission.tax_amount, currency),
          this.renderMoney(metadata.gstTcsAmount, currency),
          this.renderMoney(metadata.incomeTaxTdsAmount, currency),
          this.renderMoney(commission.refund_amount, currency),
          this.renderMoney(commission.net_amount, currency),
        ];
      }),
    ];
  }

  renderMoney(value, currency = "INR") {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }

  recoveryActionLabel(action) {
    return {
      offset_future_payout: "Offset against future payout",
      collected_from_seller: "Collected from seller",
      platform_write_off: "Platform write-off",
    }[action] || "Negative balance recovery";
  }

  buildCommissionsExportDocument(commissions = [], summary = {}) {
    return {
      title: "Seller Commission Export",
      subtitle: `${commissions.length} commission row(s)`,
      generatedAt: new Date().toISOString(),
      sections: [
        {
          title: "Summary",
          rows: [
            { label: "Gross Amount", value: this.renderMoney(summary.totalAmount) },
            { label: "Commission Amount", value: this.renderMoney(summary.commissionAmount) },
            { label: "Commission Tax", value: this.renderMoney(summary.taxAmount) },
            { label: "Refund Amount", value: this.renderMoney(summary.refundAmount) },
            { label: "Net Amount", value: this.renderMoney(summary.netAmount) },
          ],
        },
        {
          title: "Commissions",
          rows: [
            ["Commission ID", "Seller ID", "Order ID", "Status", "Payout ID", "Gross", "Shipping Collected", "Shipping Reimbursed", "Shipping Taxable", "Shipping GST", "GST TCS Base", "GST TCS", "Income-tax TDS Base", "Income-tax TDS", "Commission", "Commission Tax", "Refund", "Net", "Created At"],
            ...commissions.map((commission) => {
              const metadata = this.parseJson(commission.metadata, {});
              return [
                commission.id,
                commission.seller_id,
                commission.order_id,
                commission.status,
                commission.payout_id || "-",
                this.renderMoney(commission.amount, commission.currency),
                this.renderMoney(metadata.sellerDeliveryChargeAmount, commission.currency),
                this.renderMoney(metadata.shippingReimbursementAmount, commission.currency),
                this.renderMoney(metadata.shippingTaxableAmount, commission.currency),
                this.renderMoney(metadata.shippingTaxAmount, commission.currency),
                this.renderMoney(metadata.taxableSupplyAmount, commission.currency),
                this.renderMoney(metadata.gstTcsAmount, commission.currency),
                this.renderMoney(metadata.incomeTaxTdsTaxableAmount, commission.currency),
                this.renderMoney(metadata.incomeTaxTdsAmount, commission.currency),
                this.renderMoney(commission.commission_amount, commission.currency),
                this.renderMoney(commission.tax_amount, commission.currency),
                this.renderMoney(commission.refund_amount, commission.currency),
                this.renderMoney(commission.net_amount, commission.currency),
                commission.created_at,
              ];
            }),
          ],
        },
      ],
    };
  }

  buildPayoutsExportDocument(payouts = [], summary = {}) {
    return {
      title: "Seller Payout Export",
      subtitle: `${payouts.length} payout row(s)`,
      generatedAt: new Date().toISOString(),
      sections: [
        {
          title: "Summary",
          rows: [
            { label: "Gross Amount", value: this.renderMoney(summary.totalAmount) },
            { label: "Commission Amount", value: this.renderMoney(summary.commissionAmount) },
            { label: "Commission Tax", value: this.renderMoney(summary.taxAmount) },
            { label: "Refund Amount", value: this.renderMoney(summary.refundAmount) },
            { label: "Net Amount", value: this.renderMoney(summary.netAmount) },
          ],
        },
        {
          title: "Payouts",
          rows: [
            ["Payout ID", "Seller ID", "Status", "Period Start", "Period End", "Gross", "Shipping Collected", "Shipping Reimbursed", "Shipping Taxable", "Shipping GST", "GST TCS Base", "GST TCS", "Income-tax TDS Base", "Income-tax TDS", "Commission", "Commission Tax", "Refund", "Net", "Reference", "Processed At"],
            ...payouts.map((payout) => {
              const breakdown = this.parseJson(payout.metadata, {}).financialBreakdown || {};
              return [
                payout.id,
                payout.seller_id,
                payout.status,
                payout.period_start,
                payout.period_end,
                this.renderMoney(payout.total_amount, payout.currency),
                this.renderMoney(breakdown.sellerDeliveryChargeAmount, payout.currency),
                this.renderMoney(breakdown.shippingReimbursementAmount, payout.currency),
                this.renderMoney(breakdown.shippingTaxableAmount, payout.currency),
                this.renderMoney(breakdown.shippingTaxAmount, payout.currency),
                this.renderMoney(breakdown.gstTcsTaxableAmount, payout.currency),
                this.renderMoney(breakdown.gstTcsAmount, payout.currency),
                this.renderMoney(breakdown.incomeTaxTdsTaxableAmount, payout.currency),
                this.renderMoney(breakdown.incomeTaxTdsAmount, payout.currency),
                this.renderMoney(payout.commission_amount, payout.currency),
                this.renderMoney(payout.tax_amount, payout.currency),
                this.renderMoney(payout.refund_amount, payout.currency),
                this.renderMoney(payout.net_amount, payout.currency),
                payout.payment_reference || "-",
                payout.processed_at || "-",
              ];
            }),
          ],
        },
      ],
    };
  }

  buildSettlementsExportDocument(settlements = []) {
    return {
      title: "Seller Settlement Export",
      subtitle: `${settlements.length} settlement row(s)`,
      generatedAt: new Date().toISOString(),
      sections: [
        {
          title: "Settlements",
          rows: [
            ["Settlement ID", "Seller ID", "Payout ID", "Status", "Period Start", "Period End", "Gross", "Shipping Collected", "Shipping Reimbursed", "Shipping Taxable", "Shipping GST", "GST TCS Base", "GST TCS", "Income-tax TDS Base", "Income-tax TDS", "Commission", "Commission Tax", "Refund", "Adjustment", "Net", "Settlement Date"],
            ...settlements.map((settlement) => {
              const breakdown = this.parseJson(settlement.metadata, {}).financialBreakdown || {};
              return [
                settlement.id,
                settlement.seller_id,
                settlement.payout_id || "-",
                settlement.status,
                settlement.period_start,
                settlement.period_end,
                this.renderMoney(settlement.gross_amount, settlement.currency),
                this.renderMoney(breakdown.sellerDeliveryChargeAmount, settlement.currency),
                this.renderMoney(breakdown.shippingReimbursementAmount, settlement.currency),
                this.renderMoney(breakdown.shippingTaxableAmount, settlement.currency),
                this.renderMoney(breakdown.shippingTaxAmount, settlement.currency),
                this.renderMoney(breakdown.gstTcsTaxableAmount, settlement.currency),
                this.renderMoney(breakdown.gstTcsAmount, settlement.currency),
                this.renderMoney(breakdown.incomeTaxTdsTaxableAmount, settlement.currency),
                this.renderMoney(breakdown.incomeTaxTdsAmount, settlement.currency),
                this.renderMoney(settlement.commission_amount, settlement.currency),
                this.renderMoney(settlement.tax_amount, settlement.currency),
                this.renderMoney(settlement.refund_amount, settlement.currency),
                this.renderMoney(settlement.adjustment_amount, settlement.currency),
                this.renderMoney(settlement.net_amount, settlement.currency),
                settlement.settlement_date || settlement.created_at,
              ];
            }),
          ],
        },
      ],
    };
  }

  async getFinanceSummary(query = {}) {
    const applyFinanceFilters = (builder) => {
      this.applyCommissionFilters(builder, query);
    };
    const applyDates = (builder, column = "created_at") => {
      if (query.fromDate) builder.where(column, ">=", query.fromDate);
      if (query.toDate) builder.where(column, "<=", query.toDate);
      if (query.sellerId) builder.where("seller_id", query.sellerId);
      if (query.organizationId) builder.where("organization_id", query.organizationId);
    };

    const [commissionSummary, payoutSummary, orderSummary, paymentSummary] = await Promise.all([
      knex("seller_commissions")
        .modify((builder) => applyFinanceFilters(builder))
        .sum({ gross_amount: "amount" })
        .sum({ commission_amount: "commission_amount" })
        .sum({ commission_tax_amount: "tax_amount" })
        .sum({ refund_amount: "refund_amount" })
        .sum({ gst_tcs_amount: knex.raw("COALESCE((metadata->>'gstTcsAmount')::numeric, 0)") })
        .sum({ income_tax_tds_amount: knex.raw("COALESCE((metadata->>'incomeTaxTdsAmount')::numeric, 0)") })
        .sum({ shipping_deduction_amount: knex.raw("COALESCE((metadata->>'shippingDeductionAmount')::numeric, 0)") })
        .sum({ payable_amount: "net_amount" })
        .count({ count: "*" })
        .first(),
      knex("seller_payouts")
        .modify((builder) => applyDates(builder))
        .sum({ paid_amount: "net_amount" })
        .sum({ adjustment_amount: "adjustment_amount" })
        .count({ count: "*" })
        .first(),
      knex("order_items")
        .modify((builder) => {
          if (query.sellerId) builder.where("seller_id", query.sellerId);
          if (query.organizationId) builder.where("organization_id", query.organizationId);
        })
        .sum({ item_sales_amount: "line_total" })
        .countDistinct({ order_count: "order_id" })
        .first(),
      knex("payments")
        .modify((builder) => {
          if (query.fromDate) builder.where("created_at", ">=", query.fromDate);
          if (query.toDate) builder.where("created_at", "<=", query.toDate);
        })
        .sum({ captured_amount: "amount" })
        .count({ count: "*" })
        .first(),
    ]);

    return {
      commissions: {
        grossAmount: this.round(commissionSummary?.gross_amount || 0),
        commissionAmount: this.round(commissionSummary?.commission_amount || 0),
        commissionTaxAmount: this.round(commissionSummary?.commission_tax_amount || 0),
        gstTcsAmount: this.round(commissionSummary?.gst_tcs_amount || 0),
        incomeTaxTdsAmount: this.round(commissionSummary?.income_tax_tds_amount || 0),
        shippingDeductionAmount: this.round(commissionSummary?.shipping_deduction_amount || 0),
        refundAmount: this.round(commissionSummary?.refund_amount || 0),
        adjustmentAmount: this.round(payoutSummary?.adjustment_amount || 0),
        payableAmount: this.round(commissionSummary?.payable_amount || 0),
        count: Number(commissionSummary?.count || 0),
      },
      payouts: {
        paidAmount: this.round(payoutSummary?.paid_amount || 0),
        count: Number(payoutSummary?.count || 0),
      },
      orders: {
        itemSalesAmount: this.round(orderSummary?.item_sales_amount || 0),
        count: Number(orderSummary?.order_count || 0),
      },
      payments: {
        capturedAmount: this.round(paymentSummary?.captured_amount || 0),
        count: Number(paymentSummary?.count || 0),
      },
    };
  }

  async recordRefundAdjustment(returnRequest, refundAmount, actor = {}) {
    const orderId = returnRequest?.orderId;
    const returnId = String(returnRequest?._id || returnRequest?.id || "");
    const fullCancellation =
      returnRequest?.scope === "full" ||
      returnRequest?.cancellationScope === "full" ||
      returnRequest?.sellerSupplyCancellation === true;
    if (!orderId || !returnId || Number(refundAmount || 0) <= 0) return null;

    const orderItems = await knex("order_items")
      .where("order_id", orderId)
      .select("id", "seller_id", "organization_id", "organization_snapshot", "product_id", "variant_id", "variant_sku", "quantity", "line_total");
    const itemMap = new Map();
    orderItems.forEach((item) => {
      itemMap.set(String(item.id), item);
      itemMap.set(`${item.product_id}:${item.variant_sku || item.variant_id || ""}`, item);
      itemMap.set(`${item.product_id}:`, item);
    });

    const sellerRefunds = new Map();
    (returnRequest.items || []).forEach((item) => {
      const sellerId = item.sellerId ||
        item.seller_id ||
        itemMap.get(String(item.orderItemId || item.order_item_id || ""))?.seller_id ||
        itemMap.get(`${item.productId}:${item.variantSku || item.variantId || ""}`)?.seller_id ||
        itemMap.get(`${item.productId}:`)?.seller_id;
      if (!sellerId) return;
      const matchedItem =
        itemMap.get(String(item.orderItemId || item.order_item_id || "")) ||
        itemMap.get(`${item.productId}:${item.variantSku || item.variantId || ""}`) ||
        itemMap.get(`${item.productId}:`) ||
        {};
      const organizationId = item.organizationId || item.organization_id || matchedItem.organization_id || null;
      const orderItemId = item.orderItemId || matchedItem.id || null;
      const key = `${String(sellerId)}:${organizationId || "default"}:${orderItemId || item.productId}`;
      const amount = this.round(item.refundAmount || item.lineTotal || 0);
      const orderedQuantity = Math.max(Number(matchedItem.quantity || item.orderedQuantity || item.ordered_quantity || item.quantity || 1), 1);
      const returnedQuantity = Math.min(
        orderedQuantity,
        Math.max(Number(item.approvedQuantity ?? item.approved_quantity ?? item.receivedQuantity ?? item.received_quantity ?? item.requestedQuantity ?? item.requested_quantity ?? item.quantity ?? 1), 0),
      );
      const current = sellerRefunds.get(key) || {
        sellerId: String(sellerId),
        organizationId,
        orderItemId,
        organizationSnapshot: this.parseJson(matchedItem.organization_snapshot, {}),
        amount: 0,
        orderedQuantity,
        returnedQuantity: 0,
      };
      current.amount = this.round(current.amount + amount);
      current.returnedQuantity = this.round(Math.min(current.orderedQuantity, current.returnedQuantity + returnedQuantity));
      sellerRefunds.set(key, current);
    });

    if (!sellerRefunds.size) return null;

    const adjustments = [];
    await knex.transaction(async (trx) => {
      for (const refund of sellerRefunds.values()) {
        const { sellerId, organizationId, organizationSnapshot, orderItemId, amount, orderedQuantity, returnedQuantity } = refund;
        const commissionQuery = trx("seller_commissions")
          .where({ seller_id: sellerId, order_id: orderId });
        if (orderItemId) commissionQuery.where("order_item_id", orderItemId);
        if (organizationId) {
          commissionQuery.where("organization_id", organizationId);
        } else {
          commissionQuery.whereNull("organization_id");
        }
        const commission = await commissionQuery
          .first()
          .forUpdate();

        if (!commission) continue;

        const metadata = this.parseJson(commission.metadata, {});
        const appliedRefunds = metadata.appliedRefunds || {};
        const appliedSellerRefunds = metadata.appliedSellerRefunds || {};
        const originalUnpaidPayable = this.round(
          Math.max(Number(commission.net_amount || 0) + Number(commission.refund_amount || 0), 0),
        );
        const reversalRatio = fullCancellation
          ? 1
          : Math.min(Math.max(Number(returnedQuantity || 0) / Math.max(Number(orderedQuantity || 1), 1), 0), 1);
        const retainedShippingAmount = fullCancellation
          ? 0
          : this.round(this.resolveRetainedShippingOnReturn(returnRequest, metadata) * reversalRatio);
        const sellerRecoveryRequest = this.round(Math.max((originalUnpaidPayable * reversalRatio) - retainedShippingAmount, 0));
        if (appliedRefunds[returnId]) {
          const recordedCustomerRefund = this.round(appliedRefunds[returnId] || amount);
          const recordedSellerRefund = this.round(appliedSellerRefunds[returnId] || sellerRecoveryRequest);
          const correctedLiability = this.round(Math.min(recordedSellerRefund, originalUnpaidPayable));
          const requiresRepair = Number(commission.net_amount || 0) < 0 ||
            Number(commission.refund_amount || 0) > correctedLiability ||
            (correctedLiability >= originalUnpaidPayable && commission.status !== "refunded") ||
            (correctedLiability < originalUnpaidPayable && commission.status === "refunded");
          if (requiresRepair && commission.status !== "paid") {
            await trx("seller_commissions").where("id", commission.id).update({
              refund_amount: correctedLiability,
              net_amount: this.round(Math.max(originalUnpaidPayable - correctedLiability, 0)),
              status: correctedLiability >= originalUnpaidPayable ? "refunded" : commission.status,
              hold_reason: null,
              metadata: this.jsonb({
                ...metadata,
                lastRefundAdjustment: {
                  returnId,
                  customerRefundAmount: recordedCustomerRefund,
                  sellerRefundLiability: correctedLiability,
                  originalSellerPayable: originalUnpaidPayable,
                  orderedQuantity,
                  returnedQuantity,
                  reversalRatio,
                  retainedShippingAmount,
                  reconciledLegacyOverDeduction: true,
                  actorId: actor.userId || actor.sub || null,
                  at: new Date().toISOString(),
                },
              }),
              updated_at: knex.fn.now(),
            });
            if (orderItemId && correctedLiability >= originalUnpaidPayable && reversalRatio >= 1) {
              await trx("order_items").where("id", orderItemId).update({
                payout_status: "refunded",
                payout_hold_reason: null,
              });
            }
            adjustments.push({ sellerId, commissionId: commission.id, repaired: true, sellerRefundLiability: correctedLiability });
          } else {
            adjustments.push({ sellerId, skipped: true, reason: "already_applied" });
          }
          continue;
        }

        // Completed commission/payout rows are accounting records and must be
        // immutable. Recover a later cancellation/return from a future payout.
        if (commission.status === "paid") {
          const existingRecovery = await trx("seller_settlements")
            .where({ seller_id: sellerId, status: "pending" })
            .whereRaw("metadata ->> 'returnId' = ?", [returnId])
            .whereRaw("metadata ->> 'commissionId' = ?", [String(commission.id)])
            .first();
          if (!existingRecovery) {
            await trx("seller_settlements").insert({
              id: uuidv4(),
              seller_id: sellerId,
              organization_id: organizationId || null,
              organization_snapshot: this.jsonb(organizationSnapshot || commission.organization_snapshot || {}),
              payout_id: commission.payout_id || null,
              settlement_date: knex.fn.now(),
              period_start: null,
              period_end: null,
              gross_amount: 0,
              commission_amount: 0,
              tax_amount: 0,
              refund_amount: sellerRecoveryRequest,
              adjustment_amount: -sellerRecoveryRequest,
              net_amount: -sellerRecoveryRequest,
              currency: commission.currency || "INR",
              status: "pending",
              notes: "Refund adjustment after completed payout",
              metadata: this.jsonb({
                adjustmentType: "post_payout_refund_recovery",
                returnId,
                orderId,
                commissionId: commission.id,
                customerRefundAmount: amount,
                sellerRefundLiability: sellerRecoveryRequest,
                originalSellerPayable: originalUnpaidPayable,
                orderedQuantity,
                returnedQuantity,
                reversalRatio,
                retainedShippingAmount,
                fullCancellation,
                actorId: actor.userId || actor.sub || null,
              }),
              created_at: knex.fn.now(),
              updated_at: knex.fn.now(),
            });
          }
          adjustments.push({
            sellerId,
            customerRefundAmount: amount,
            sellerRefundLiability: sellerRecoveryRequest,
            commissionId: commission.id,
            recovery: true,
            skipped: Boolean(existingRecovery),
          });
          continue;
        }

        // Customer refund and seller recovery are different amounts. The
        // seller can never owe more than this unpaid item's current payable.
        // Commission/GST/TCS credit notes reverse the remaining platform/tax
        // components separately.
        const currentNetAmount = Math.max(this.round(commission.net_amount || 0), 0);
        const sellerRefundLiability = this.round(
          Math.min(sellerRecoveryRequest, currentNetAmount),
        );
        const nextRefundAmount = this.round(Number(commission.refund_amount || 0) + sellerRefundLiability);
        const nextNetAmount = this.round(Math.max(currentNetAmount - sellerRefundLiability, 0));

        await trx("seller_commissions")
          .where("id", commission.id)
          .update({
            refund_amount: nextRefundAmount,
            net_amount: nextNetAmount,
            status: nextNetAmount <= 0 ? "refunded" : commission.status,
            hold_reason: null,
            metadata: this.jsonb({
              ...metadata,
              appliedRefunds: {
                ...appliedRefunds,
                [returnId]: amount,
              },
              appliedSellerRefunds: {
                ...appliedSellerRefunds,
                [returnId]: sellerRefundLiability,
              },
              lastRefundAdjustment: {
                returnId,
                customerRefundAmount: amount,
                sellerRefundLiability,
                originalSellerPayable: originalUnpaidPayable,
                orderedQuantity,
                returnedQuantity,
                reversalRatio,
                retainedShippingAmount,
                fullCancellation,
                actorId: actor.userId || actor.sub || null,
                at: new Date().toISOString(),
              },
            }),
            updated_at: knex.fn.now(),
          });

        if (commission.payout_id && commission.status !== "paid") {
          const payoutCommissions = await trx("seller_commissions")
            .where("payout_id", commission.payout_id)
            .select("amount", "commission_amount", "tax_amount", "refund_amount", "net_amount");
          const payoutTotals = payoutCommissions.reduce((totals, row) => ({
            totalAmount: totals.totalAmount + Number(row.amount || 0),
            commissionAmount: totals.commissionAmount + Number(row.commission_amount || 0),
            taxAmount: totals.taxAmount + Number(row.tax_amount || 0),
            refundAmount: totals.refundAmount + Number(row.refund_amount || 0),
            netAmount: totals.netAmount + Number(row.net_amount || 0),
          }), {
            totalAmount: 0,
            commissionAmount: 0,
            taxAmount: 0,
            refundAmount: 0,
            netAmount: 0,
          });
          await trx("seller_payouts")
            .where("id", commission.payout_id)
            .whereNot("status", "completed")
            .update({
              total_amount: this.round(payoutTotals.totalAmount),
              commission_amount: this.round(payoutTotals.commissionAmount),
              tax_amount: this.round(payoutTotals.taxAmount),
              refund_amount: this.round(payoutTotals.refundAmount),
              net_amount: this.round(payoutTotals.netAmount),
              updated_at: knex.fn.now(),
            });
        }

        adjustments.push({ sellerId, customerRefundAmount: amount, sellerRefundLiability, commissionId: commission.id });
      }
    });

    logger.info({ orderId, returnId, adjustments }, "Seller commission refund adjustment recorded");
    return { orderId, returnId, adjustments };
  }

  resolveSellerRecoveryRequest({
    fullCancellation = false,
    customerRefundAmount = 0,
    remainingSellerPayable = 0,
    retainedShippingAmount = 0,
  } = {}) {
    const payable = this.round(Math.max(Number(remainingSellerPayable || 0), 0));
    if (fullCancellation) return payable;
    const retainedShipping = this.round(Math.max(Number(retainedShippingAmount || 0), 0));
    const recoveryAfterRetainedShipping = this.round(Math.max(payable - retainedShipping, 0));
    return this.round(Math.min(recoveryAfterRetainedShipping, payable));
  }

  resolveRetainedShippingOnReturn(returnRequest = {}, commissionMetadata = {}) {
    const refundBreakup = returnRequest.refundBreakup?.toObject?.() ||
      returnRequest.refundBreakup ||
      {};
    const shippingRefunded = Number(refundBreakup.shippingRefund || 0) > 0;
    if (shippingRefunded) return 0;
    return Number(commissionMetadata.shippingReimbursementAmount || 0);
  }

  async auditCommissionCompleteness(orderId, client = knex) {
    const [order, items, commissions] = await Promise.all([
      client("orders").where("id", orderId).select("id", "status").first(),
      client("order_items")
        .where("order_id", orderId)
        .whereNotNull("seller_id")
        .select("id", "seller_id", "organization_id", "quantity", "cancelled_quantity", "delivered_at", "payout_status", "pricing_snapshot"),
      client("seller_commissions")
        .where("order_id", orderId)
        .whereNot("status", "cancelled")
        .select("id", "order_item_id", "seller_id", "organization_id", "amount", "net_amount", "status", "payout_id"),
    ]);
    const orderDelivered = ["delivered", "fulfilled", "completed", "partially_returned", "return_requested", "returned"]
      .includes(String(order?.status || ""));
    const expected = items.filter((item) =>
      Number(item.quantity || 0) > Number(item.cancelled_quantity || 0) &&
      (orderDelivered || item.delivered_at || ["eligible", "held", "paid"].includes(item.payout_status)),
    );
    const byItem = new Map();
    commissions.forEach((commission) => {
      const key = String(commission.order_item_id || "");
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(commission);
    });
    const missing = expected.filter((item) => !(byItem.get(String(item.id)) || []).length);
    const duplicates = [...byItem.entries()]
      .filter(([itemId, rows]) => itemId && rows.length > 1)
      .map(([orderItemId, rows]) => ({ orderItemId, commissionIds: rows.map((row) => row.id) }));
    const orphaned = commissions.filter((commission) =>
      commission.order_item_id && !items.some((item) => String(item.id) === String(commission.order_item_id)),
    );
    return {
      orderId,
      complete: missing.length === 0 && duplicates.length === 0 && orphaned.length === 0,
      expectedItemCount: expected.length,
      commissionCount: commissions.length,
      missing: missing.map((item) => ({ orderItemId: item.id, sellerId: item.seller_id, organizationId: item.organization_id || null })),
      duplicates,
      orphaned: orphaned.map((row) => ({ commissionId: row.id, orderItemId: row.order_item_id, status: row.status })),
      immutablePaidCount: commissions.filter((row) => row.status === "paid").length,
    };
  }

  async repairCommissionCompleteness(orderId, actor = {}) {
    const before = await this.auditCommissionCompleteness(orderId);
    if (before.complete) return { repaired: false, before, after: before };
    await knex.transaction(async (trx) => {
      for (const duplicate of before.duplicates) {
        const rows = await trx("seller_commissions")
          .whereIn("id", duplicate.commissionIds)
          .orderBy("created_at", "asc")
          .forUpdate();
        const mutableRows = rows.filter((row) => row.status !== "paid" && !row.payout_id);
        // Retain one active record. Paid/in-process records are never changed.
        const protectedRows = rows.filter((row) => row.status === "paid" || row.payout_id);
        const keepId = protectedRows[0]?.id || mutableRows[0]?.id;
        for (const row of mutableRows.filter((entry) => entry.id !== keepId)) {
          await trx("seller_commissions").where("id", row.id).update({
            status: "cancelled",
            net_amount: 0,
            metadata: this.jsonb({
              ...this.parseJson(row.metadata, {}),
              supersededByCommissionId: keepId || null,
              repairReason: "duplicate_order_item_commission",
              repairedAt: new Date().toISOString(),
            }),
            updated_at: knex.fn.now(),
          });
        }
      }
      for (const orphan of before.orphaned) {
        const row = await trx("seller_commissions").where("id", orphan.commissionId).first().forUpdate();
        if (!row || row.status === "paid" || row.payout_id) continue;
        await trx("seller_commissions").where("id", row.id).update({
          status: "cancelled",
          net_amount: 0,
          metadata: this.jsonb({
            ...this.parseJson(row.metadata, {}),
            repairReason: "orphaned_order_item_commission",
            repairedAt: new Date().toISOString(),
          }),
          updated_at: knex.fn.now(),
        });
      }
    });
    await this.calculateCommission(orderId, {
      actor: { ...actor, source: "commission_completeness_repair" },
      sourceStatus: "repair",
    });
    const after = await this.auditCommissionCompleteness(orderId);
    return { repaired: true, before, after };
  }

  async getLegacySellerCommissions(sellerId) {
    return knex("seller_commissions")
      .where("seller_id", sellerId)
      .orderBy("created_at", "desc");
  }

  async getLegacySellerPayouts(sellerId) {
    return knex("seller_payouts")
      .where("seller_id", sellerId)
      .orderBy("created_at", "desc");
  }
}

const commissionService = new SellerCommissionService();

module.exports = {
  SellerCommissionService: commissionService,
  CommissionService: commissionService,
};
