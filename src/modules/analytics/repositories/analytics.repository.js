const { AnalyticsModel } = require("../models/analytics.model");
const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { ReturnModel } = require("../../returns/models/return.model");
const { UserModel } = require("../../user/models/user.model");

const DELIVERED_ORDER_STATUSES = ["delivered", "fulfilled", "completed"];
const CANCELLED_ORDER_STATUSES = ["cancelled", "payment_failed"];
const SUCCESS_SHIPMENT_STATUSES = ["delivered", "delivered_verified"];
const FAILED_SHIPMENT_STATUSES = ["failed", "cancelled", "rto", "lost", "damaged"];
const RETURN_REFUNDED_STATUSES = ["refunded", "partially_refunded"];

class AnalyticsRepository {
  async create(payload) {
    return AnalyticsModel.create(payload);
  }

  async list(limit = 20) {
    return AnalyticsModel.find({}).sort({ createdAt: -1 }).limit(limit);
  }

  async getSellerDashboard({ sellerId, fromDate = null, toDate = null, recentLimit = 10 } = {}) {
    const [
      orderSummary,
      financeSummary,
      payoutSummary,
      deliverySummary,
      returnSummary,
      recentOrders,
    ] = await Promise.all([
      this.getSellerOrderSummary(sellerId, { fromDate, toDate }),
      this.getSellerFinanceSummary(sellerId, { fromDate, toDate }),
      this.getSellerPayoutSummary(sellerId, { fromDate, toDate }),
      this.getSellerDeliverySummary(sellerId, { fromDate, toDate }),
      this.getReturnSummary({ sellerId, fromDate, toDate }),
      this.getSellerRecentOrders(sellerId, { fromDate, toDate, limit: recentLimit }),
    ]);

    const returnRate = this.rate(returnSummary.returnCount, orderSummary.orderCount);
    const deliverySuccessRate = this.rate(deliverySummary.deliveredShipments, deliverySummary.totalShipments);

    return {
      sellerId,
      currency: orderSummary.currency || financeSummary.currency || "INR",
      window: this.buildWindow(fromDate, toDate),
      orders: orderSummary,
      finance: financeSummary,
      payouts: payoutSummary,
      returns: {
        ...returnSummary,
        returnRate,
      },
      delivery: {
        ...deliverySummary,
        successRate: deliverySuccessRate,
      },
      recentOrders,
    };
  }

  async getAdminDashboard({ fromDate = null, toDate = null, topSellerLimit = 10 } = {}) {
    const [
      orderSummary,
      statusBreakdown,
      paymentSummary,
      financeSummary,
      payoutSummary,
      deliverySummary,
      returnSummary,
      sellerPerformance,
    ] = await Promise.all([
      this.getAdminOrderSummary({ fromDate, toDate }),
      this.getOrderStatusBreakdown({ fromDate, toDate }),
      this.getPaymentSummary({ fromDate, toDate }),
      this.getAdminFinanceSummary({ fromDate, toDate }),
      this.getAdminPayoutSummary({ fromDate, toDate }),
      this.getAdminDeliverySummary({ fromDate, toDate }),
      this.getReturnSummary({ fromDate, toDate }),
      this.getSellerPerformance({ fromDate, toDate, limit: topSellerLimit }),
    ]);

    return {
      currency: orderSummary.currency || financeSummary.currency || "INR",
      window: this.buildWindow(fromDate, toDate),
      orders: {
        ...orderSummary,
        statusBreakdown,
      },
      payments: paymentSummary,
      finance: financeSummary,
      payouts: payoutSummary,
      returns: {
        ...returnSummary,
        returnRate: this.rate(returnSummary.returnCount, orderSummary.orderCount),
      },
      delivery: {
        ...deliverySummary,
        successRate: this.rate(deliverySummary.deliveredShipments, deliverySummary.totalShipments),
      },
      sellerPerformance,
    };
  }

  async getSellerOrderSummary(sellerId, range = {}) {
    const row = await knex("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .where("oi.seller_id", sellerId)
      .modify((builder) => this.applyDateRange(builder, range, "o.created_at"))
      .select(knex.raw(`
        COUNT(DISTINCT o.id)::INT AS order_count,
        COUNT(DISTINCT o.id) FILTER (WHERE o.status IN (${this.bindings(DELIVERED_ORDER_STATUSES)}))::INT AS delivered_orders,
        COUNT(DISTINCT o.id) FILTER (WHERE o.status IN (${this.bindings(CANCELLED_ORDER_STATUSES)}))::INT AS cancelled_orders,
        COALESCE(SUM(oi.line_total), 0)::NUMERIC AS total_sales_amount,
        COALESCE(SUM(oi.discount_amount), 0)::NUMERIC AS discount_amount,
        COALESCE(SUM(oi.tax_amount), 0)::NUMERIC AS gst_amount,
        COALESCE(SUM(oi.platform_fee_amount), 0)::NUMERIC AS commission_amount,
        COALESCE(SUM(${this.jsonNumberSql("oi.pricing_snapshot", "platformFeeTaxAmount")}), 0)::NUMERIC AS commission_tax_amount,
        COALESCE(SUM(${this.jsonNumberSql("oi.pricing_snapshot", "sellerPayoutBaseAmount")}), 0)::NUMERIC AS seller_payout_base_amount,
        MAX(o.currency) AS currency
      `, [...DELIVERED_ORDER_STATUSES, ...CANCELLED_ORDER_STATUSES]))
      .first();

    return {
      orderCount: Number(row?.order_count || 0),
      deliveredOrders: Number(row?.delivered_orders || 0),
      cancelledOrders: Number(row?.cancelled_orders || 0),
      totalSalesAmount: this.money(row?.total_sales_amount),
      discountAmount: this.money(row?.discount_amount),
      gstAmount: this.money(row?.gst_amount),
      commissionAmount: this.money(row?.commission_amount),
      commissionTaxAmount: this.money(row?.commission_tax_amount),
      sellerPayoutBaseAmount: this.money(row?.seller_payout_base_amount),
      averageOrderValue: this.average(row?.total_sales_amount, row?.order_count),
      currency: row?.currency || "INR",
    };
  }

  async getSellerFinanceSummary(sellerId, range = {}) {
    const row = await knex("seller_commissions")
      .where("seller_id", sellerId)
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select(knex.raw(`
        COUNT(*)::INT AS commission_count,
        COALESCE(SUM(amount), 0)::NUMERIC AS gross_amount,
        COALESCE(SUM(commission_amount), 0)::NUMERIC AS commission_amount,
        COALESCE(SUM(tax_amount), 0)::NUMERIC AS commission_tax_amount,
        COALESCE(SUM(refund_amount), 0)::NUMERIC AS refund_adjustment_amount,
        COALESCE(SUM(net_amount), 0)::NUMERIC AS net_seller_revenue,
        COUNT(*) FILTER (WHERE status = 'pending')::INT AS pending_count,
        COUNT(*) FILTER (WHERE status = 'paid')::INT AS paid_count,
        MAX(currency) AS currency
      `))
      .first();

    return {
      commissionCount: Number(row?.commission_count || 0),
      grossAmount: this.money(row?.gross_amount),
      commissionAmount: this.money(row?.commission_amount),
      commissionTaxAmount: this.money(row?.commission_tax_amount),
      refundAdjustmentAmount: this.money(row?.refund_adjustment_amount),
      netSellerRevenue: this.money(row?.net_seller_revenue),
      pendingCommissionCount: Number(row?.pending_count || 0),
      paidCommissionCount: Number(row?.paid_count || 0),
      currency: row?.currency || "INR",
    };
  }

  async getSellerPayoutSummary(sellerId, range = {}) {
    const rows = await knex("seller_payouts")
      .where("seller_id", sellerId)
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select("status")
      .count({ count: "*" })
      .sum({ net_amount: "net_amount" })
      .sum({ gross_amount: "total_amount" })
      .groupBy("status");

    return this.normalizeStatusRows(rows, ["pending", "processing", "completed", "failed"]);
  }

  async getSellerDeliverySummary(sellerId, range = {}) {
    const row = await knex("shipments")
      .where("seller_id", sellerId)
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select(knex.raw(`
        COUNT(*)::INT AS total_shipments,
        COUNT(*) FILTER (WHERE status IN (${this.bindings(SUCCESS_SHIPMENT_STATUSES)}))::INT AS delivered_shipments,
        COUNT(*) FILTER (WHERE status IN (${this.bindings(FAILED_SHIPMENT_STATUSES)}))::INT AS failed_shipments,
        COUNT(*) FILTER (WHERE status NOT IN (${this.bindings([...SUCCESS_SHIPMENT_STATUSES, ...FAILED_SHIPMENT_STATUSES])}))::INT AS in_progress_shipments
      `, [...SUCCESS_SHIPMENT_STATUSES, ...FAILED_SHIPMENT_STATUSES, ...SUCCESS_SHIPMENT_STATUSES, ...FAILED_SHIPMENT_STATUSES]))
      .first();

    return {
      totalShipments: Number(row?.total_shipments || 0),
      deliveredShipments: Number(row?.delivered_shipments || 0),
      failedShipments: Number(row?.failed_shipments || 0),
      inProgressShipments: Number(row?.in_progress_shipments || 0),
    };
  }

  async getSellerRecentOrders(sellerId, { fromDate = null, toDate = null, limit = 10 } = {}) {
    const rows = await knex("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .where("oi.seller_id", sellerId)
      .modify((builder) => this.applyDateRange(builder, { fromDate, toDate }, "o.created_at"))
      .select(
        "o.id",
        "o.order_number",
        "o.status",
        "o.payment_status",
        "o.delivery_status",
        "o.currency",
        "o.created_at",
      )
      .sum({ seller_amount: "oi.line_total" })
      .sum({ tax_amount: "oi.tax_amount" })
      .groupBy("o.id")
      .orderBy("o.created_at", "desc")
      .limit(Number(limit || 10));

    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      paymentStatus: row.payment_status,
      deliveryStatus: row.delivery_status,
      sellerAmount: this.money(row.seller_amount),
      taxAmount: this.money(row.tax_amount),
      currency: row.currency || "INR",
      createdAt: row.created_at,
    }));
  }

  async getAdminOrderSummary(range = {}) {
    const row = await knex("orders")
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select(knex.raw(`
        COUNT(*)::INT AS order_count,
        COUNT(*) FILTER (WHERE status IN (${this.bindings(DELIVERED_ORDER_STATUSES)}))::INT AS delivered_orders,
        COUNT(*) FILTER (WHERE status IN (${this.bindings(CANCELLED_ORDER_STATUSES)}))::INT AS cancelled_orders,
        COALESCE(SUM(total_amount), 0)::NUMERIC AS gmv_amount,
        COALESCE(SUM(payable_amount), 0)::NUMERIC AS payable_amount,
        COALESCE(SUM(subtotal_amount), 0)::NUMERIC AS item_subtotal_amount,
        COALESCE(SUM(discount_amount), 0)::NUMERIC AS discount_amount,
        COALESCE(SUM(tax_amount), 0)::NUMERIC AS gst_amount,
        COALESCE(SUM(shipping_fee_amount), 0)::NUMERIC AS shipping_fee_amount,
        MAX(currency) AS currency
      `, [...DELIVERED_ORDER_STATUSES, ...CANCELLED_ORDER_STATUSES]))
      .first();

    return {
      orderCount: Number(row?.order_count || 0),
      deliveredOrders: Number(row?.delivered_orders || 0),
      cancelledOrders: Number(row?.cancelled_orders || 0),
      gmvAmount: this.money(row?.gmv_amount),
      payableAmount: this.money(row?.payable_amount),
      itemSubtotalAmount: this.money(row?.item_subtotal_amount),
      discountAmount: this.money(row?.discount_amount),
      gstAmount: this.money(row?.gst_amount),
      shippingFeeAmount: this.money(row?.shipping_fee_amount),
      averageOrderValue: this.average(row?.gmv_amount, row?.order_count),
      currency: row?.currency || "INR",
    };
  }

  async getOrderStatusBreakdown(range = {}) {
    const rows = await knex("orders")
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select("status")
      .count({ count: "*" })
      .sum({ amount: "total_amount" })
      .groupBy("status")
      .orderBy("count", "desc");

    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count || 0),
      amount: this.money(row.amount),
    }));
  }

  async getPaymentSummary(range = {}) {
    const rows = await knex("payments")
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select("status")
      .count({ count: "*" })
      .sum({ amount: "amount" })
      .groupBy("status");

    const byStatus = this.normalizeStatusRows(rows, ["initiated", "authorized", "captured", "failed", "partially_refunded", "refunded", "cancelled"]);
    return {
      ...byStatus,
      capturedAmount: byStatus.byStatus.captured?.netAmount || 0,
      capturedCount: byStatus.byStatus.captured?.count || 0,
    };
  }

  async getAdminFinanceSummary(range = {}) {
    const row = await knex("seller_commissions")
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select(knex.raw(`
        COUNT(*)::INT AS commission_count,
        COALESCE(SUM(amount), 0)::NUMERIC AS seller_gross_amount,
        COALESCE(SUM(commission_amount), 0)::NUMERIC AS platform_revenue_amount,
        COALESCE(SUM(tax_amount), 0)::NUMERIC AS platform_revenue_tax_amount,
        COALESCE(SUM(refund_amount), 0)::NUMERIC AS refund_adjustment_amount,
        COALESCE(SUM(net_amount), 0)::NUMERIC AS seller_payable_amount,
        MAX(currency) AS currency
      `))
      .first();

    return {
      commissionCount: Number(row?.commission_count || 0),
      sellerGrossAmount: this.money(row?.seller_gross_amount),
      platformRevenueAmount: this.money(row?.platform_revenue_amount),
      platformRevenueTaxAmount: this.money(row?.platform_revenue_tax_amount),
      refundAdjustmentAmount: this.money(row?.refund_adjustment_amount),
      sellerPayableAmount: this.money(row?.seller_payable_amount),
      platformRevenueTotalAmount: this.money(Number(row?.platform_revenue_amount || 0) + Number(row?.platform_revenue_tax_amount || 0)),
      currency: row?.currency || "INR",
    };
  }

  async getAdminPayoutSummary(range = {}) {
    const rows = await knex("seller_payouts")
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select("status")
      .count({ count: "*" })
      .sum({ net_amount: "net_amount" })
      .sum({ gross_amount: "total_amount" })
      .groupBy("status");

    return this.normalizeStatusRows(rows, ["pending", "processing", "completed", "failed"]);
  }

  async getAdminDeliverySummary(range = {}) {
    const row = await knex("shipments")
      .modify((builder) => this.applyDateRange(builder, range, "created_at"))
      .select(knex.raw(`
        COUNT(*)::INT AS total_shipments,
        COUNT(*) FILTER (WHERE status IN (${this.bindings(SUCCESS_SHIPMENT_STATUSES)}))::INT AS delivered_shipments,
        COUNT(*) FILTER (WHERE status IN (${this.bindings(FAILED_SHIPMENT_STATUSES)}))::INT AS failed_shipments,
        COUNT(*) FILTER (WHERE status NOT IN (${this.bindings([...SUCCESS_SHIPMENT_STATUSES, ...FAILED_SHIPMENT_STATUSES])}))::INT AS in_progress_shipments
      `, [...SUCCESS_SHIPMENT_STATUSES, ...FAILED_SHIPMENT_STATUSES, ...SUCCESS_SHIPMENT_STATUSES, ...FAILED_SHIPMENT_STATUSES]))
      .first();

    return {
      totalShipments: Number(row?.total_shipments || 0),
      deliveredShipments: Number(row?.delivered_shipments || 0),
      failedShipments: Number(row?.failed_shipments || 0),
      inProgressShipments: Number(row?.in_progress_shipments || 0),
    };
  }

  async getSellerPerformance({ fromDate = null, toDate = null, limit = 10 } = {}) {
    const rows = await knex("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .modify((builder) => this.applyDateRange(builder, { fromDate, toDate }, "o.created_at"))
      .select("oi.seller_id")
      .countDistinct({ order_count: "o.id" })
      .sum({ gmv_amount: "oi.line_total" })
      .sum({ gst_amount: "oi.tax_amount" })
      .sum({ commission_amount: "oi.platform_fee_amount" })
      .select(knex.raw(`
        COUNT(DISTINCT o.id) FILTER (WHERE o.status IN (${this.bindings(DELIVERED_ORDER_STATUSES)}))::INT AS delivered_orders,
        COALESCE(SUM(${this.jsonNumberSql("oi.pricing_snapshot", "platformFeeTaxAmount")}), 0)::NUMERIC AS commission_tax_amount
      `, DELIVERED_ORDER_STATUSES))
      .groupBy("oi.seller_id")
      .orderBy("gmv_amount", "desc")
      .limit(Number(limit || 10));

    const sellerNames = await this.getSellerNameMap(rows.map((row) => row.seller_id));

    return rows.map((row) => ({
      sellerId: row.seller_id,
      sellerName: sellerNames.get(String(row.seller_id)) || row.seller_id,
      orderCount: Number(row.order_count || 0),
      deliveredOrders: Number(row.delivered_orders || 0),
      gmvAmount: this.money(row.gmv_amount),
      gstAmount: this.money(row.gst_amount),
      commissionAmount: this.money(row.commission_amount),
      commissionTaxAmount: this.money(row.commission_tax_amount),
      deliveryRate: this.rate(row.delivered_orders, row.order_count),
    }));
  }

  async getReturnSummary({ sellerId = null, fromDate = null, toDate = null } = {}) {
    const filter = {};
    if (sellerId) {
      filter.$or = [
        { sellerId: String(sellerId) },
        { "items.sellerId": String(sellerId) },
      ];
    }

    const createdAt = {};
    if (fromDate) createdAt.$gte = new Date(fromDate);
    if (toDate) createdAt.$lte = new Date(toDate);
    if (Object.keys(createdAt).length) {
      filter.createdAt = createdAt;
    }

    const rows = await ReturnModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          returnCount: { $sum: 1 },
          refundedCount: {
            $sum: {
              $cond: [{ $in: ["$status", RETURN_REFUNDED_STATUSES] }, 1, 0],
            },
          },
          refundAmount: {
            $sum: {
              $ifNull: ["$refund.refundedAmount", { $ifNull: ["$refundAmount", 0] }],
            },
          },
        },
      },
    ]);

    const row = rows[0] || {};
    return {
      returnCount: Number(row.returnCount || 0),
      refundedCount: Number(row.refundedCount || 0),
      refundAmount: this.money(row.refundAmount),
    };
  }

  async getSellerNameMap(sellerIds = []) {
    const uniqueIds = Array.from(new Set((sellerIds || []).map((id) => String(id || "")).filter(Boolean)));
    const objectIds = uniqueIds.filter((id) => UserModel.db.base.Types.ObjectId.isValid(id));
    if (!objectIds.length) {
      return new Map();
    }

    const users = await UserModel.find({ _id: { $in: objectIds } })
      .select("email profile sellerProfile")
      .lean();

    return new Map(users.map((user) => {
      const sellerProfile = user.sellerProfile || {};
      const profile = user.profile || {};
      const name =
        sellerProfile.displayName ||
        sellerProfile.businessName ||
        sellerProfile.legalBusinessName ||
        [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
        user.email ||
        String(user._id);
      return [String(user._id), name];
    }));
  }

  applyDateRange(builder, { fromDate = null, toDate = null } = {}, column = "created_at") {
    if (fromDate) {
      builder.where(column, ">=", fromDate);
    }
    if (toDate) {
      builder.where(column, "<=", toDate);
    }
  }

  jsonNumberSql(jsonColumn, key) {
    const rawValue = `(COALESCE(${jsonColumn}, '{}'::jsonb)->>'${key}')`;
    return `CASE WHEN ${rawValue} ~ '^-{0,1}[0-9]+(\\.[0-9]+){0,1}$' THEN ${rawValue}::NUMERIC ELSE 0 END`;
  }

  bindings(values = []) {
    return values.map(() => "?").join(",");
  }

  normalizeStatusRows(rows = [], expectedStatuses = []) {
    const byStatus = {};
    let totalCount = 0;
    let totalNetAmount = 0;
    let totalGrossAmount = 0;

    expectedStatuses.forEach((status) => {
      byStatus[status] = { count: 0, netAmount: 0, grossAmount: 0 };
    });

    rows.forEach((row) => {
      const status = row.status || "unknown";
      const item = {
        count: Number(row.count || 0),
        netAmount: this.money(row.net_amount ?? row.amount),
        grossAmount: this.money(row.gross_amount ?? row.amount),
      };
      byStatus[status] = item;
      totalCount += item.count;
      totalNetAmount += item.netAmount;
      totalGrossAmount += item.grossAmount;
    });

    return {
      totalCount,
      totalNetAmount: this.money(totalNetAmount),
      totalGrossAmount: this.money(totalGrossAmount),
      byStatus,
    };
  }

  buildWindow(fromDate, toDate) {
    return {
      fromDate: fromDate || null,
      toDate: toDate || null,
    };
  }

  average(amount, count) {
    const denominator = Number(count || 0);
    if (!denominator) return 0;
    return this.money(Number(amount || 0) / denominator);
  }

  rate(numerator, denominator) {
    const base = Number(denominator || 0);
    if (!base) return 0;
    return Number(((Number(numerator || 0) / base) * 100).toFixed(2));
  }

  money(value) {
    return Number(Number(value || 0).toFixed(2));
  }
}

module.exports = { AnalyticsRepository };
