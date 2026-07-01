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

class SellerCommissionService {
  constructor() {
    this.defaultCommissionRates = {
      bronze: 0.15,
      silver: 0.12,
      gold: 0.1,
      platinum: 0.08,
    };
    this.defaultSellerTier = "bronze";
    this.commissionTaxRate = 0.18;
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

  getCommissionRate(sellerTier = this.defaultSellerTier) {
    return this.defaultCommissionRates[sellerTier] ?? this.defaultCommissionRates[this.defaultSellerTier];
  }

  normalizeMoney(value) {
    return Number(Number(value || 0).toFixed(2));
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
    return {
      periodStart: periodStart || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
      periodEnd: periodEnd || now.toISOString().slice(0, 10),
    };
  }

  getPayoutPolicy(settings = {}) {
    const finance = settings.finance || settings || {};
    return {
      releaseMilestone: finance.payoutReleaseMilestone || "delivered_or_fulfilled",
      releaseDaysAfterDelivery: Math.max(Number(finance.payoutReleaseDaysAfterDelivery || 0), 0),
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

    const [orders, releaseRows] = await Promise.all([
      client("orders")
        .select("id", "status", "payment_status", "payment_provider", "created_at", "updated_at")
        .whereIn("id", orderIds),
      client("order_status_history")
        .select("order_id")
        .min({ release_status_at: "created_at" })
        .whereIn("order_id", orderIds)
        .whereIn("to_status", [ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED])
        .groupBy("order_id")
        .catch(() => []),
    ]);

    const releaseData = new Map();
    orders.forEach((order) => {
      releaseData.set(String(order.id), {
        order,
        releaseStatusAt: null,
      });
    });
    releaseRows.forEach((row) => {
      const key = String(row.order_id);
      const current = releaseData.get(key) || { order: { id: row.order_id }, releaseStatusAt: null };
      current.releaseStatusAt = row.release_status_at || null;
      releaseData.set(key, current);
    });

    return releaseData;
  }

  evaluateCommissionRelease(commission = {}, releaseData = new Map(), policy = {}, now = new Date()) {
    const status = String(commission.status || "pending");
    const netAmount = this.round(commission.net_amount || 0);
    const orderData = releaseData.get(String(commission.order_id || "")) || {};
    const order = orderData.order || {};
    const orderStatus = String(order.status || commission.source_status || "");
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
    if (this.isBlockedOrderStatus(orderStatus)) {
      return { ...base, releaseStatus: "blocked", reason: `order_${orderStatus}` };
    }
    if (
      policy.codPayoutRequiresCapture &&
      order.payment_provider === PAYMENT_PROVIDER.COD &&
      order.payment_status !== PAYMENT_STATUS.CAPTURED
    ) {
      return { ...base, releaseStatus: "blocked", reason: "waiting_for_cod_collection_confirmation" };
    }

    if (policy.releaseMilestone === "confirmed") {
      if (this.isConfirmedOrLaterStatus(orderStatus)) {
        return { ...base, releaseStatus: "available", available: true, eligibleAt: new Date().toISOString() };
      }
      return { ...base, reason: "waiting_for_order_confirmation" };
    }

    if (!this.isReleasedOrderStatus(orderStatus)) {
      return { ...base, reason: "waiting_for_delivery_or_fulfillment" };
    }

    if (policy.releaseMilestone === "return_window_closed") {
      const eligibleAt = this.addDays(deliveredAt || commission.updated_at || commission.created_at, policy.releaseDaysAfterDelivery);
      if (!eligibleAt) {
        return { ...base, reason: "missing_delivery_timestamp" };
      }
      if (eligibleAt.getTime() > now.getTime()) {
        return {
          ...base,
          eligibleAt: eligibleAt.toISOString(),
          reason: "waiting_for_return_window",
        };
      }
      return {
        ...base,
        releaseStatus: "available",
        available: true,
        eligibleAt: eligibleAt.toISOString(),
      };
    }

    return {
      ...base,
      releaseStatus: "available",
      available: true,
      eligibleAt: (deliveredAt || new Date()).toISOString(),
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

  async getOrderSellerGroups(orderId, sellerId = null, orderAmount = null, sellerTier = this.defaultSellerTier, organizationId = null) {
    if (!orderId) {
      throw new AppError("Invalid commission input", 400);
    }

    const commerceSettings = await commerceSettingsService.getSettings();
    const commissionTaxRate = commerceSettings.finance.chargePlatformFeeTaxToSeller
      ? Number(commerceSettings.finance.platformFeeTaxRate || 0) / 100
      : 0;

    if (sellerId && Number(orderAmount || 0) > 0) {
      const rate = this.getCommissionRate(sellerTier);
      const amount = this.round(orderAmount);
      const commissionAmount = this.round(amount * rate);
      const taxAmount = this.round(commissionAmount * commissionTaxRate);
      return [{
        sellerId,
        organizationId: organizationId || null,
        organizationSnapshot: {},
        orderId,
        orderItemIds: [],
        amount,
        commissionRate: rate,
        commissionAmount,
        taxAmount,
        refundAmount: 0,
        netAmount: this.round(amount - commissionAmount - taxAmount),
        currency: "INR",
        sourceStatus: "manual",
        metadata: {
          source: "manual_commission_input",
          organizationId: organizationId || null,
          sellerPayoutBase: commerceSettings.finance.sellerPayoutBase,
          platformFeeTaxRate: Number(commerceSettings.finance.platformFeeTaxRate || 0),
          chargePlatformFeeTaxToSeller: Boolean(commerceSettings.finance.chargePlatformFeeTaxToSeller),
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
      const key = `${String(row.seller_id)}:${organizationId || "default"}`;
      const current = grouped.get(key) || {
        sellerId: String(row.seller_id),
        organizationId,
        organizationSnapshot: this.parseJson(row.organization_snapshot, {}),
        orderId,
        orderItemIds: [],
        amount: 0,
        platformFeeAmount: 0,
        platformFeeTaxAmount: 0,
        commissionFeeAmount: 0,
        fixedFeeAmount: 0,
        closingFeeAmount: 0,
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
      const taxBreakup = this.parseJson(row.tax_breakup, {});
      const pricing = this.parseJson(row.pricing_snapshot, {});
      const itemGross = Number(
        (
          pricing.sellerPayoutBaseAmount ??
          (commerceSettings.finance.sellerPayoutBase === "taxable_ex_gst"
            ? taxBreakup.taxableAmount
            : grossAfterDiscount)
        ) || 0,
      );
      current.orderItemIds.push(row.id);
      current.amount += itemGross;
      current.platformFeeAmount += Number(row.platform_fee_amount || 0);
      current.platformFeeTaxAmount += Number(pricing.platformFeeTaxAmount || 0);
      current.commissionFeeAmount += Number(pricing.commissionFee || 0);
      current.fixedFeeAmount += Number(pricing.fixedFee || 0);
      current.closingFeeAmount += Number(pricing.closingFee || 0);
      current.hasPricingSnapshot = current.hasPricingSnapshot || Object.keys(pricing).length > 0;
      current.quantity += Number(row.quantity || 0);
      current.products.push({
        productId: row.product_id,
        variantId: row.variant_id,
        variantSku: row.variant_sku,
        amount: this.round(itemGross),
        grossAfterDiscount: this.round(grossAfterDiscount),
        taxableAmount: this.round(taxBreakup.taxableAmount ?? grossAfterDiscount),
        sellerPayoutBase: pricing.sellerPayoutBase || commerceSettings.finance.sellerPayoutBase,
        platformFeeAmount: this.round(row.platform_fee_amount || 0),
        platformFeeTaxAmount: this.round(pricing.platformFeeTaxAmount || 0),
      });
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).map((group) => {
      const rate = this.getCommissionRate(sellerTier);
      const amount = this.round(group.amount);
      const platformFeeAmount = this.round(group.platformFeeAmount);
      const commissionAmount = group.hasPricingSnapshot
        ? platformFeeAmount
        : this.round(amount * rate);
      const effectiveRate = amount > 0 ? this.round(commissionAmount / amount) : rate;
      const taxAmount = group.hasPricingSnapshot
        ? this.round(group.platformFeeTaxAmount)
        : this.round(commissionAmount * commissionTaxRate);
      const financeSnapshot = group.orderMetadata?.commerceSettings?.finance || commerceSettings.finance;
      const shippingPolicy = financeSnapshot.shippingPolicy || "not_in_seller_payout";
      const sellerDeliveryCharge = (group.orderMetadata?.deliveryCharge?.sellers || []).find((entry) =>
        String(entry.sellerId || entry.seller_id || "") === String(group.sellerId) &&
        String(entry.organizationId || entry.organization_id || "default") === String(group.organizationId || "default"));
      const sellerDeliveryChargeAmount = this.round(sellerDeliveryCharge?.chargeAmount || 0);
      const shippingReimbursementAmount = shippingPolicy === "reimburse_seller" ? sellerDeliveryChargeAmount : 0;
      const shippingDeductionAmount = shippingPolicy === "deduct_from_seller" ? sellerDeliveryChargeAmount : 0;
      const netAmount = this.round(Math.max(
        0,
        amount - commissionAmount - taxAmount + shippingReimbursementAmount - shippingDeductionAmount,
      ));
      return {
        sellerId: group.sellerId,
        organizationId: group.organizationId || null,
        organizationSnapshot: group.organizationSnapshot || {},
        orderId,
        orderItemIds: group.orderItemIds,
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
          sellerPayoutBase: financeSnapshot.sellerPayoutBase,
          platformFeeTaxRate: Number(financeSnapshot.platformFeeTaxRate || 0),
          chargePlatformFeeTaxToSeller: Boolean(financeSnapshot.chargePlatformFeeTaxToSeller),
          shippingPolicy,
          sellerDeliveryChargeAmount,
          shippingReimbursementAmount,
          shippingDeductionAmount,
          pricingSource: group.hasPricingSnapshot ? "checkout_snapshot" : "legacy_fallback",
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
        sellerTier: sellerIdOrOptions.sellerTier || sellerTier || this.defaultSellerTier,
        actor: sellerIdOrOptions.actor || {},
        sourceStatus: sellerIdOrOptions.sourceStatus,
      };
    }
    return {
      sellerId: sellerIdOrOptions,
      organizationId: null,
      orderAmount,
      sellerTier: sellerTier || this.defaultSellerTier,
      actor: {},
      sourceStatus: null,
    };
  }

  async calculateCommission(orderId, sellerIdOrOptions, orderAmount, sellerTier = this.defaultSellerTier) {
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

        if (existing?.status === "paid") {
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
    return await knex.transaction(async (trx) => {
      const commissions = await trx("seller_commissions")
        .where("seller_id", sellerId)
        .modify((builder) => {
          if (organizationId) builder.where("organization_id", organizationId);
          else if (options.organizationId === null) builder.whereNull("organization_id");
        })
        .whereIn("status", ["pending", "approved"])
        .whereNull("payout_id")
        .whereBetween("created_at", [range.periodStart, `${range.periodEnd} 23:59:59`])
        .forUpdate();

      if (!commissions.length) {
        throw new AppError("No commissions to payout", 400);
      }

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
        period_start: range.periodStart,
        period_end: range.periodEnd,
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
          processedBy: options.actor?.userId || options.actor?.sub || null,
        }),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

      const payoutMetadata = this.parseJson(payout.metadata, {});
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

      return { ...payout, status: "completed", payment_reference: paymentReference };
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
      return { ...payout, status: "failed" };
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
    if (status) query.where("status", status);
    if (orderId) query.where("order_id", orderId);
    if (payoutId) query.where("payout_id", payoutId);
    if (fromDate) query.where("created_at", ">=", fromDate);
    if (toDate) query.where("created_at", "<=", toDate);
    if (search) {
      const term = `%${String(search).trim()}%`;
      query.where((builder) => {
        builder
          .whereILike("seller_id", term)
          .orWhereRaw("order_id::text ILIKE ?", [term])
          .orWhereRaw("COALESCE(metadata, '{}'::jsonb)::text ILIKE ?", [term]);
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

    return {
      items: await this.enrichFinanceRecords(items),
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
    if (status) query.where("status", status);
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
      items: await this.enrichFinanceRecords(items),
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
    if (options.organizationId === undefined) {
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
            { label: "Commission Amount", value: this.renderMoney(settlement.commission_amount, currency) },
            { label: "Commission Tax", value: this.renderMoney(settlement.tax_amount, currency) },
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
      ["Order", "Status", "Gross", "Commission", "Tax", "Refund", "Net"],
      ...commissions.map((commission) => [
        commission.order_id || "-",
        commission.status || "-",
        this.renderMoney(commission.amount, currency),
        this.renderMoney(commission.commission_amount, currency),
        this.renderMoney(commission.tax_amount, currency),
        this.renderMoney(commission.refund_amount, currency),
        this.renderMoney(commission.net_amount, currency),
      ]),
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
            ["Commission ID", "Seller ID", "Order ID", "Status", "Payout ID", "Gross", "Commission", "Tax", "Refund", "Net", "Created At"],
            ...commissions.map((commission) => [
              commission.id,
              commission.seller_id,
              commission.order_id,
              commission.status,
              commission.payout_id || "-",
              this.renderMoney(commission.amount, commission.currency),
              this.renderMoney(commission.commission_amount, commission.currency),
              this.renderMoney(commission.tax_amount, commission.currency),
              this.renderMoney(commission.refund_amount, commission.currency),
              this.renderMoney(commission.net_amount, commission.currency),
              commission.created_at,
            ]),
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
            ["Payout ID", "Seller ID", "Status", "Period Start", "Period End", "Gross", "Commission", "Tax", "Refund", "Net", "Reference", "Processed At"],
            ...payouts.map((payout) => [
              payout.id,
              payout.seller_id,
              payout.status,
              payout.period_start,
              payout.period_end,
              this.renderMoney(payout.total_amount, payout.currency),
              this.renderMoney(payout.commission_amount, payout.currency),
              this.renderMoney(payout.tax_amount, payout.currency),
              this.renderMoney(payout.refund_amount, payout.currency),
              this.renderMoney(payout.net_amount, payout.currency),
              payout.payment_reference || "-",
              payout.processed_at || "-",
            ]),
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
            ["Settlement ID", "Seller ID", "Payout ID", "Status", "Period Start", "Period End", "Gross", "Commission", "Tax", "Refund", "Adjustment", "Net", "Settlement Date"],
            ...settlements.map((settlement) => [
              settlement.id,
              settlement.seller_id,
              settlement.payout_id || "-",
              settlement.status,
              settlement.period_start,
              settlement.period_end,
              this.renderMoney(settlement.gross_amount, settlement.currency),
              this.renderMoney(settlement.commission_amount, settlement.currency),
              this.renderMoney(settlement.tax_amount, settlement.currency),
              this.renderMoney(settlement.refund_amount, settlement.currency),
              this.renderMoney(settlement.adjustment_amount, settlement.currency),
              this.renderMoney(settlement.net_amount, settlement.currency),
              settlement.settlement_date || settlement.created_at,
            ]),
          ],
        },
      ],
    };
  }

  async getFinanceSummary(query = {}) {
    const applyDates = (builder, column = "created_at") => {
      if (query.fromDate) builder.where(column, ">=", query.fromDate);
      if (query.toDate) builder.where(column, "<=", query.toDate);
      if (query.sellerId) builder.where("seller_id", query.sellerId);
      if (query.organizationId) builder.where("organization_id", query.organizationId);
    };

    const [commissionSummary, payoutSummary, orderSummary, paymentSummary] = await Promise.all([
      knex("seller_commissions")
        .modify((builder) => applyDates(builder))
        .sum({ gross_amount: "amount" })
        .sum({ commission_amount: "commission_amount" })
        .sum({ commission_tax_amount: "tax_amount" })
        .sum({ refund_amount: "refund_amount" })
        .sum({ payable_amount: "net_amount" })
        .count({ count: "*" })
        .first(),
      knex("seller_payouts")
        .modify((builder) => applyDates(builder))
        .sum({ paid_amount: "net_amount" })
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
        refundAmount: this.round(commissionSummary?.refund_amount || 0),
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
      const key = `${String(sellerId)}:${organizationId || "default"}`;
      const amount = this.round(item.refundAmount || item.lineTotal || 0);
      const current = sellerRefunds.get(key) || {
        sellerId: String(sellerId),
        organizationId,
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
        const { sellerId, organizationId, organizationSnapshot, amount } = refund;
        const commissionQuery = trx("seller_commissions")
          .where({ seller_id: sellerId, order_id: orderId });
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
        if (appliedRefunds[returnId]) {
          adjustments.push({ sellerId, skipped: true, reason: "already_applied" });
          continue;
        }

        const nextRefundAmount = this.round(Number(commission.refund_amount || 0) + amount);
        const nextNetAmount = this.round(
          Number(commission.net_amount || 0) +
          Number(commission.refund_amount || 0) -
          nextRefundAmount,
        );

        await trx("seller_commissions")
          .where("id", commission.id)
          .update({
            refund_amount: nextRefundAmount,
            net_amount: nextNetAmount,
            metadata: this.jsonb({
              ...metadata,
              appliedRefunds: {
                ...appliedRefunds,
                [returnId]: amount,
              },
              lastRefundAdjustment: {
                returnId,
                refundAmount: amount,
                actorId: actor.userId || actor.sub || null,
                at: new Date().toISOString(),
              },
            }),
            updated_at: knex.fn.now(),
          });

        if (commission.payout_id && commission.status !== "paid") {
          const payoutCommissions = await trx("seller_commissions")
            .where("payout_id", commission.payout_id)
            .select("amount", "commission_amount", "tax_amount", "refund_amount", "adjustment_amount", "net_amount");
          const payoutTotals = payoutCommissions.reduce((totals, row) => ({
            totalAmount: totals.totalAmount + Number(row.amount || 0),
            commissionAmount: totals.commissionAmount + Number(row.commission_amount || 0),
            taxAmount: totals.taxAmount + Number(row.tax_amount || 0),
            refundAmount: totals.refundAmount + Number(row.refund_amount || 0),
            adjustmentAmount: totals.adjustmentAmount + Number(row.adjustment_amount || 0),
            netAmount: totals.netAmount + Number(row.net_amount || 0),
          }), {
            totalAmount: 0,
            commissionAmount: 0,
            taxAmount: 0,
            refundAmount: 0,
            adjustmentAmount: 0,
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
              adjustment_amount: this.round(payoutTotals.adjustmentAmount),
              net_amount: this.round(payoutTotals.netAmount),
              updated_at: knex.fn.now(),
            });
        }

        if (commission.status === "paid") {
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
            refund_amount: amount,
            adjustment_amount: -amount,
            net_amount: -amount,
            currency: commission.currency || "INR",
            status: "pending",
            notes: "Refund adjustment after completed payout",
            metadata: this.jsonb({
              returnId,
              orderId,
              commissionId: commission.id,
              actorId: actor.userId || actor.sub || null,
            }),
            created_at: knex.fn.now(),
            updated_at: knex.fn.now(),
          });
        }

        adjustments.push({ sellerId, refundAmount: amount, commissionId: commission.id });
      }
    });

    logger.info({ orderId, returnId, adjustments }, "Seller commission refund adjustment recorded");
    return { orderId, returnId, adjustments };
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
