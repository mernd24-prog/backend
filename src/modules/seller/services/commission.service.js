const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../../shared/logger/logger");
const { AppError } = require("../../../shared/errors/app-error");
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");

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

  buildDateRange(periodStart, periodEnd) {
    const now = new Date();
    return {
      periodStart: periodStart || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
      periodEnd: periodEnd || now.toISOString().slice(0, 10),
    };
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

  async getOrderSellerGroups(orderId, sellerId = null, orderAmount = null, sellerTier = this.defaultSellerTier) {
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
      )
      .where("oi.order_id", orderId)
      .modify((query) => {
        if (sellerId) query.andWhere("oi.seller_id", sellerId);
      });

    if (!rows.length) {
      throw new AppError("Unable to get order commission data", 400);
    }

    const grouped = new Map();
    rows.forEach((row) => {
      if (!row.seller_id) return;
      const key = String(row.seller_id);
      const current = grouped.get(key) || {
        sellerId: key,
        orderId,
        orderItemIds: [],
        amount: 0,
        platformFeeAmount: 0,
        quantity: 0,
        currency: row.currency || "INR",
        sourceStatus: row.order_status || "order",
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
      const commissionAmount = platformFeeAmount > 0 ? platformFeeAmount : this.round(amount * rate);
      const effectiveRate = amount > 0 ? this.round(commissionAmount / amount) : rate;
      const taxAmount = this.round(commissionAmount * commissionTaxRate);
      return {
        sellerId: group.sellerId,
        orderId,
        orderItemIds: group.orderItemIds,
        amount,
        commissionRate: effectiveRate,
        commissionAmount,
        taxAmount,
        refundAmount: 0,
        netAmount: this.round(amount - commissionAmount - taxAmount),
        currency: group.currency,
        sourceStatus: group.sourceStatus,
        metadata: {
          source: "order_items",
          itemCount: group.orderItemIds.length,
          quantity: group.quantity,
          platformFeeAmount,
          sellerPayoutBase: commerceSettings.finance.sellerPayoutBase,
          platformFeeTaxRate: Number(commerceSettings.finance.platformFeeTaxRate || 0),
          chargePlatformFeeTaxToSeller: Boolean(commerceSettings.finance.chargePlatformFeeTaxToSeller),
          products: group.products,
        },
      };
    });
  }

  normalizeCalculateArgs(sellerIdOrOptions, orderAmount, sellerTier) {
    if (sellerIdOrOptions && typeof sellerIdOrOptions === "object" && !Array.isArray(sellerIdOrOptions)) {
      return {
        sellerId: sellerIdOrOptions.sellerId,
        orderAmount: sellerIdOrOptions.orderAmount,
        sellerTier: sellerIdOrOptions.sellerTier || sellerTier || this.defaultSellerTier,
        actor: sellerIdOrOptions.actor || {},
        sourceStatus: sellerIdOrOptions.sourceStatus,
      };
    }
    return {
      sellerId: sellerIdOrOptions,
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
    );

    const result = await knex.transaction(async (trx) => {
      const items = [];
      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const group of groups) {
        const existing = await trx("seller_commissions")
          .where({ seller_id: group.sellerId, order_id: orderId })
          .first()
          .forUpdate();

        const metadata = {
          ...this.parseJson(existing?.metadata, {}),
          ...group.metadata,
          calculatedBy: options.actor?.userId || options.actor?.sub || null,
          calculatedAt: new Date().toISOString(),
        };
        const refundAmount = this.round(existing?.refund_amount || group.refundAmount || 0);
        const netAmount = this.round(group.amount - group.commissionAmount - group.taxAmount - refundAmount);

        if (existing?.status === "paid") {
          skipped += 1;
          items.push(existing);
          continue;
        }

        const payload = {
          seller_id: group.sellerId,
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
    return await knex.transaction(async (trx) => {
      const commissions = await trx("seller_commissions")
        .where("seller_id", sellerId)
        .whereIn("status", ["pending", "approved"])
        .whereNull("payout_id")
        .whereBetween("created_at", [range.periodStart, `${range.periodEnd} 23:59:59`])
        .forUpdate();

      if (!commissions.length) {
        throw new AppError("No commissions to payout", 400);
      }

      const totals = commissions.reduce(
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

      if (totals.netAmount <= 0) {
        throw new AppError("Invalid payout amount", 400);
      }

      const payoutId = uuidv4();

      await trx("seller_payouts").insert({
        id: payoutId,
        seller_id: sellerId,
        period_start: range.periodStart,
        period_end: range.periodEnd,
        total_amount: this.round(totals.totalAmount),
        commission_amount: this.round(totals.commissionAmount),
        tax_amount: this.round(totals.taxAmount),
        refund_amount: this.round(totals.refundAmount || 0),
        adjustment_amount: this.round(totals.adjustmentAmount || 0),
        net_amount: this.round(totals.netAmount),
        currency: options.currency || commissions[0]?.currency || "INR",
        status: "processing",
        payment_method: options.paymentMethod || null,
        metadata: this.jsonb({
          source: options.source || "batch_payout",
          commissionIds: commissions.map((commission) => commission.id),
          createdBy: options.actor?.userId || options.actor?.sub || null,
        }),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

      await trx("seller_commissions")
        .whereIn(
          "id",
          commissions.map((c) => c.id)
        )
        .update({
          status: "approved",
          payout_id: payoutId,
          updated_at: knex.fn.now(),
        });

      logger.info(
        { sellerId, payoutId, amount: totals.netAmount },
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

      if (!["processing", "pending", "failed"].includes(payout.status)) {
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
      return { ...payout, status: "failed" };
    });
  }

  async getSellerCommissions(sellerId, query = {}) {
    return this.listSellerCommissions({ ...query, sellerId });
  }

  async getSellerPayouts(sellerId, query = {}) {
    return this.listSellerPayouts({ ...query, sellerId });
  }

  applyCommissionFilters(query, filters = {}) {
    const { sellerId, status, orderId, payoutId, fromDate, toDate, search } = filters;
    if (sellerId) query.where("seller_id", sellerId);
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
      items,
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
    const { sellerId, status, payoutId, fromDate, toDate, search } = filters;
    if (sellerId) query.where("seller_id", sellerId);
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
      items,
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
    const payoutId = await this.initiatePayout(sellerId, range.periodStart, range.periodEnd, options);
    return this.processPayout(payoutId, options.paymentReference || `batch_${Date.now()}`, options);
  }

  async getSettlements(query = {}) {
    const { limit, offset } = this.normalizePagination(query);
    const rows = await knex("seller_settlements")
      .modify((builder) => {
        if (query.sellerId) builder.where("seller_id", query.sellerId);
        if (query.status) builder.where("status", query.status);
        if (query.payoutId) builder.where("payout_id", query.payoutId);
      })
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset);
    return { items: rows, total: rows.length, limit, offset };
  }

  async getFinanceSummary(query = {}) {
    const applyDates = (builder, column = "created_at") => {
      if (query.fromDate) builder.where(column, ">=", query.fromDate);
      if (query.toDate) builder.where(column, "<=", query.toDate);
      if (query.sellerId) builder.where("seller_id", query.sellerId);
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
      .select("id", "seller_id", "product_id", "variant_id", "variant_sku", "line_total");
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
      const amount = this.round(item.refundAmount || item.lineTotal || 0);
      sellerRefunds.set(String(sellerId), this.round((sellerRefunds.get(String(sellerId)) || 0) + amount));
    });

    if (!sellerRefunds.size) return null;

    const adjustments = [];
    await knex.transaction(async (trx) => {
      for (const [sellerId, amount] of sellerRefunds.entries()) {
        const commission = await trx("seller_commissions")
          .where({ seller_id: sellerId, order_id: orderId })
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
          Number(commission.amount || 0) -
          Number(commission.commission_amount || 0) -
          Number(commission.tax_amount || 0) -
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

        if (commission.status === "paid") {
          await trx("seller_settlements").insert({
            id: uuidv4(),
            seller_id: sellerId,
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
