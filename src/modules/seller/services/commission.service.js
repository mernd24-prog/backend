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
const {
  calculateInclusiveShippingTax,
  resolveShippingPolicy,
} = require("../../../shared/domain/seller-payout-rules");

class SellerCommissionService {
  constructor() { }

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
    return {
      releaseMilestone: finance.payoutReleaseMilestone || "return_window_closed",
      schedule: finance.payoutSchedule || "manual",
      manualApprovalRequired: finance.payoutManualApprovalRequired !== false,
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

  evaluateCommissionRelease(commission = {}, releaseData = new Map(), policy = {}, now = new Date()) {
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

  async evaluateCommissionsRelease(commissions = [], settings = {}, client = knex) {
    const policy = this.getPayoutPolicy(settings);
    const releaseData = await this.getCommissionOrderReleaseData(commissions, client);
    const now = new Date();
    return commissions.map((commission) => ({
      commission,
      release: this.evaluateCommissionRelease(commission, releaseData, policy, now),
    }));
  }

  async filterPayoutEligibleCommissions(commissions = [], options = {}) {
    const evaluations = await this.evaluateCommissionsRelease(
      commissions,
      options.settings || {},
      options.trx || knex,
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
      throw new AppError("Unable to get order commission data", 400);
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
    const options = this.normalizeCalculateArgs(sellerIdOrOptions, orderAmount, sellerTier);
    const groups = await this.getOrderSellerGroups(
      orderId,
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
          .where({ seller_id: group.sellerId, order_id: orderId });
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
          order_id: orderId,
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
        orderId,
        created,
        updated,
        skipped,
        items,
        summary: this.summarizeCommissions(items),
      };
    });

    logger.info(
      {
        orderId,
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
    const pendingOrders = await knex("seller_commissions")
      .where("seller_id", sellerId)
      .whereIn("status", ["pending", "approved"])
      .whereNull("payout_id")
      .modify((builder) => {
        if (organizationId) builder.where("organization_id", organizationId);
        else if (options.organizationId === null) builder.whereNull("organization_id");
      })
      .modify((builder) => {
        if (options.commissionIds?.length) builder.whereIn("id", options.commissionIds);
        else builder.whereBetween("created_at", [range.periodStart, `${range.periodEnd} 23:59:59`]);
      })
      .distinct("order_id");
    for (const row of pendingOrders) {
      await this.calculateCommission(row.order_id, {
        sellerId,
        organizationId,
        actor: options.actor || {},
        sourceStatus: "pre_payout_refresh",
      });
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
      });

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
      const payoutStatus = payoutPolicy.manualApprovalRequired ? "pending" : "processing";
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

      await trx("seller_payouts").insert({
        id: payoutId,
        seller_id: sellerId,
        organization_id: organizationId,
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
    return await knex.transaction(async (trx) => {
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
      return result;
    });
  }

  async failPayout(payoutId, reason, actor = {}) {
    return knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts").where("id", payoutId).first().forUpdate();
      if (!payout) throw new AppError("Payout not found", 404);
      if (payout.status === "completed") throw new AppError("Completed payouts cannot be failed", 409);

      await trx("seller_payouts").where("id", payoutId).update({
        status: "failed",
        metadata: this.jsonb({
          ...this.parseJson(payout.metadata, {}),
          failedReason: reason || "payout_failed",
          failedBy: actor.userId || actor.sub || null,
          failedAt: new Date().toISOString(),
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
    return knex.transaction(async (trx) => {
      const payout = await trx("seller_payouts").where("id", payoutId).first().forUpdate();
      if (!payout) throw new AppError("Payout not found", 404);
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
    return knex.transaction(async (trx) => {
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
  }

  async retryFailedPayout(payoutId, options = {}) {
    const payout = await knex("seller_payouts").where("id", payoutId).first();
    if (!payout) throw new AppError("Payout not found", 404);
    if (payout.status !== "failed") {
      throw new AppError(`Only failed payouts can be retried`, 409);
    }
    return this.processBatchPayouts(payout.seller_id, {
      periodStart: payout.period_start,
      periodEnd: payout.period_end,
      organizationId: payout.organization_id || undefined,
      source: "failed_payout_retry",
      previousPayoutId: payoutId,
      paymentReference: options.paymentReference,
      paymentMethod: options.paymentMethod || payout.payment_method || null,
      autoProcess: options.autoProcess === true,
      actor: options.actor,
    });
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

    const [commerceSettings, commissions, paidPayoutRow, inProcessPayoutRow, adjustmentRow] = await Promise.all([
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
    ]);

    const payoutPolicy = this.getPayoutPolicy(commerceSettings);
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
        totalOpenBalance: this.round(
          balances.pendingBalance +
          balances.availableBalance +
          balances.inProcessBalance +
          balances.blockedBalance,
        ),
      },
      counts,
      payoutPolicy,
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
    const payoutId = await this.initiatePayout(sellerId, range.periodStart, range.periodEnd, options);
    const commerceSettings = await commerceSettingsService.getSettings();
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
    return this.processPayout(payoutId, options.paymentReference || `batch_${Date.now()}`, options);
  }

  async processScheduledPayouts(options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const commerceSettings = await commerceSettingsService.getSettings();
    const payoutPolicy = this.getPayoutPolicy(commerceSettings);

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
          autoProcess: options.autoProcess === true,
          paymentReference: options.paymentReference || `scheduled_${payoutPolicy.schedule}_${Date.now()}`,
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
    return {
      title: "Seller Settlement Statement",
      subtitle: `Settlement ${settlement.id}`,
      fileBaseName: `settlement-${settlement.id}`,
      generatedAt: new Date().toISOString(),
      raw: { settlement, payout, commissions },
      sections: [
        {
          title: "Settlement Summary",
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
          title: "Amounts",
          rows: [
            { label: "Gross Amount", value: this.renderMoney(settlement.gross_amount, currency) },
            { label: "Customer Discount", value: this.renderMoney(productMetadataTotal("discountAmount"), currency) },
            { label: "Marketplace-funded Discount", value: this.renderMoney(productMetadataTotal("marketplaceFundedDiscountAmount"), currency) },
            { label: "Payment-partner-funded Discount", value: this.renderMoney(productMetadataTotal("paymentPartnerFundedDiscountAmount"), currency) },
            { label: "Seller-funded Discount", value: this.renderMoney(productMetadataTotal("sellerFundedDiscountAmount"), currency) },
            { label: "Shipping Collected For Seller", value: this.renderMoney(metadataTotal("sellerDeliveryChargeAmount"), currency) },
            { label: "Shipping Reimbursed To Seller", value: this.renderMoney(metadataTotal("shippingReimbursementAmount"), currency) },
            { label: "Shipping Deducted From Seller", value: this.renderMoney(metadataTotal("shippingDeductionAmount"), currency) },
            { label: "Shipping Taxable Value", value: this.renderMoney(metadataTotal("shippingTaxableAmount"), currency) },
            { label: "Shipping GST", value: this.renderMoney(metadataTotal("shippingTaxAmount"), currency) },
            { label: "Commission Amount", value: this.renderMoney(settlement.commission_amount, currency) },
            { label: "Commission Tax", value: this.renderMoney(settlement.tax_amount, currency) },
            { label: "GST TCS Taxable Base", value: this.renderMoney(metadataTotal("taxableSupplyAmount"), currency) },
            { label: "GST TCS Withheld", value: this.renderMoney(metadataTotal("gstTcsAmount"), currency) },
            { label: "Income-tax TDS Gross Base", value: this.renderMoney(metadataTotal("incomeTaxTdsTaxableAmount"), currency) },
            { label: "Income-tax TDS Withheld", value: this.renderMoney(metadataTotal("incomeTaxTdsAmount"), currency) },
            { label: "Refund Amount", value: this.renderMoney(settlement.refund_amount, currency) },
            { label: "Adjustment Amount", value: this.renderMoney(settlement.adjustment_amount, currency) },
            { label: "Net Payout Amount", value: this.renderMoney(settlement.net_amount, currency) },
          ],
        },
        {
          title: "Commission Lines",
          rows: this.buildSettlementCommissionRows(commissions, currency),
        },
        {
          title: "Notes",
          rows: [
            { label: "Statement Notes", value: settlement.notes || "-" },
            { label: "Generated From", value: "seller_commissions, seller_payouts, seller_settlements" },
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
      ["Order", "Status", "Gross", "Commission", "Tax", "TCS Base", "TCS", "TDS", "Refund", "Net"],
      ...commissions.map((commission) => {
        const metadata = this.parseJson(commission.metadata, {});
        return [
          commission.order_id || "-",
          commission.status || "-",
          this.renderMoney(commission.amount, currency),
          this.renderMoney(commission.commission_amount, currency),
          this.renderMoney(commission.tax_amount, currency),
          this.renderMoney(metadata.taxableSupplyAmount, currency),
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
      .select("id", "seller_id", "organization_id", "organization_snapshot", "product_id", "variant_id", "variant_sku", "line_total");
    const itemMap = new Map();
    orderItems.forEach((item) => {
      itemMap.set(`${item.product_id}:${item.variant_sku || item.variant_id || ""}`, item);
      itemMap.set(`${item.product_id}:`, item);
    });

    const sellerRefunds = new Map();
    (returnRequest.items || []).forEach((item) => {
      const sellerId = item.sellerId ||
        item.seller_id ||
        itemMap.get(`${item.productId}:${item.variantSku || item.variantId || ""}`)?.seller_id ||
        itemMap.get(`${item.productId}:`)?.seller_id;
      if (!sellerId) return;
      const matchedItem =
        itemMap.get(`${item.productId}:${item.variantSku || item.variantId || ""}`) ||
        itemMap.get(`${item.productId}:`) ||
        {};
      const organizationId = item.organizationId || item.organization_id || matchedItem.organization_id || null;
      const orderItemId = item.orderItemId || matchedItem.id || null;
      const key = `${String(sellerId)}:${organizationId || "default"}:${orderItemId || item.productId}`;
      const amount = this.round(item.refundAmount || item.lineTotal || 0);
      const current = sellerRefunds.get(key) || {
        sellerId: String(sellerId),
        organizationId,
        orderItemId,
        organizationSnapshot: this.parseJson(matchedItem.organization_snapshot, {}),
        amount: 0,
      };
      current.amount = this.round(current.amount + amount);
      sellerRefunds.set(key, current);
    });

    if (!sellerRefunds.size) return null;

    const adjustments = [];
    await knex.transaction(async (trx) => {
      for (const refund of sellerRefunds.values()) {
        const { sellerId, organizationId, organizationSnapshot, orderItemId, amount } = refund;
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
        const remainingSellerPayable = this.round(Math.max(Number(commission.net_amount || 0), 0));
        const retainedShippingAmount = fullCancellation
          ? 0
          : this.resolveRetainedShippingOnReturn(returnRequest, metadata);
        const sellerRecoveryRequest = this.resolveSellerRecoveryRequest({
          fullCancellation,
          customerRefundAmount: amount,
          remainingSellerPayable,
          retainedShippingAmount,
        });
        if (appliedRefunds[returnId]) {
          const recordedCustomerRefund = this.round(appliedRefunds[returnId] || amount);
          const originalUnpaidPayable = this.round(
            Math.max(Number(commission.net_amount || 0) + Number(commission.refund_amount || 0), 0),
          );
          const correctedLiability = this.round(Math.min(recordedCustomerRefund, originalUnpaidPayable));
          const requiresRepair = Number(commission.net_amount || 0) < 0 ||
            Number(commission.refund_amount || 0) > originalUnpaidPayable ||
            (correctedLiability >= originalUnpaidPayable && commission.status !== "refunded");
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
                  reconciledLegacyOverDeduction: true,
                  actorId: actor.userId || actor.sub || null,
                  at: new Date().toISOString(),
                },
              }),
              updated_at: knex.fn.now(),
            });
            if (orderItemId && correctedLiability >= originalUnpaidPayable) {
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
              lastRefundAdjustment: {
                returnId,
                customerRefundAmount: amount,
                sellerRefundLiability,
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
