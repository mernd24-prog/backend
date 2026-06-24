const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { ProductModel } = require("../../product/models/product.model");
const { InventoryTransactionModel } = require("../../inventory/models/inventory-transaction.model");
const { ReturnModel } = require("../../returns/models/return.model");
const { UserModel } = require("../../user/models/user.model");
const { documentRendererService } = require("../../../shared/services/document-renderer.service");
const { AppError } = require("../../../shared/errors/app-error");

const REPORT_TYPES = [
  "orders",
  "products",
  "inventory",
  "shipments",
  "delivery-agents",
  "returns",
  "cancellations",
  "refunds",
  "seller-scorecards",
];

const EXPORT_LIMIT_MAX = 5000;

class OperationsReportService {
  constructor({ renderer = documentRendererService } = {}) {
    this.renderer = renderer;
    this.tableCache = new Map();
  }

  async exportReport(reportType, query = {}) {
    if (!REPORT_TYPES.includes(reportType)) {
      throw new AppError("Unsupported operations report type", 400);
    }

    const filters = this.normalizeFilters(query);
    const result = await ({
      orders: () => this.buildOrdersReport(filters),
      products: () => this.buildProductsReport(filters),
      inventory: () => this.buildInventoryReport(filters),
      shipments: () => this.buildShipmentsReport(filters),
      "delivery-agents": () => this.buildDeliveryAgentsReport(filters),
      returns: () => this.buildReturnsReport(filters),
      cancellations: () => this.buildCancellationsReport(filters),
      refunds: () => this.buildRefundsReport(filters),
      "seller-scorecards": () => this.buildSellerScorecardsReport(filters),
    })[reportType]();

    return this.renderer.render(result.document, {
      format: filters.format,
      fileBaseName: result.document.fileBaseName,
    });
  }

  normalizeFilters(query = {}) {
    return {
      ...query,
      format: String(query.format || "csv").toLowerCase(),
      limit: Math.min(Math.max(Number(query.limit || 1000), 1), EXPORT_LIMIT_MAX),
      offset: Math.max(Number(query.offset || 0), 0),
      fromDate: query.fromDate || query.dateFrom || query.createdFrom || null,
      toDate: query.toDate || query.dateTo || query.createdTo || null,
    };
  }

  async hasTable(tableName) {
    if (this.tableCache.has(tableName)) return this.tableCache.get(tableName);
    const exists = await knex.schema.hasTable(tableName);
    this.tableCache.set(tableName, exists);
    return exists;
  }

  applyDateRange(query, filters = {}, column = "created_at") {
    if (filters.fromDate) query.where(column, ">=", filters.fromDate);
    if (filters.toDate) query.where(column, "<=", filters.toDate);
  }

  mongoDateFilter(filters = {}) {
    const createdAt = {};
    if (filters.fromDate) createdAt.$gte = new Date(filters.fromDate);
    if (filters.toDate) createdAt.$lte = new Date(filters.toDate);
    return Object.keys(createdAt).length ? { createdAt } : {};
  }

  async buildOrdersReport(filters) {
    const query = knex("orders as o")
      .leftJoin("order_items as oi", "oi.order_id", "o.id")
      .select(
        "o.id",
        "o.order_number",
        "o.buyer_id",
        "o.status",
        "o.payment_status",
        "o.delivery_status",
        "o.currency",
        "o.subtotal_amount",
        "o.discount_amount",
        "o.tax_amount",
        "o.shipping_fee_amount",
        "o.cod_charge_amount",
        "o.total_amount",
        "o.payable_amount",
        "o.created_at",
      )
      .count({ item_count: "oi.id" })
      .countDistinct({ seller_count: "oi.seller_id" })
      .select(knex.raw("STRING_AGG(DISTINCT oi.seller_id, ', ' ORDER BY oi.seller_id) AS seller_ids"))
      .groupBy("o.id");

    if (filters.status) query.where("o.status", filters.status);
    if (filters.paymentStatus) query.where("o.payment_status", filters.paymentStatus);
    if (filters.deliveryStatus) query.where("o.delivery_status", filters.deliveryStatus);
    if (filters.buyerId) query.where("o.buyer_id", filters.buyerId);
    if (filters.sellerId) query.where("oi.seller_id", filters.sellerId);
    if (filters.organizationId) query.where("oi.organization_id", filters.organizationId);
    if (filters.search) {
      query.where((builder) => builder
        .whereILike("o.order_number", `%${filters.search}%`)
        .orWhereRaw("o.id::text ILIKE ?", [`%${filters.search}%`]));
    }
    this.applyDateRange(query, filters, "o.created_at");

    const rows = await query
      .orderBy("o.created_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset);

    return {
      rows,
      document: this.buildDocument({
        title: "Orders Export",
        subtitle: `${rows.length} order row(s)`,
        fileBaseName: "orders-export",
        filters,
        summary: [
          ["Orders", rows.length],
          ["GMV", this.money(rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0))],
          ["Tax", this.money(rows.reduce((sum, row) => sum + Number(row.tax_amount || 0), 0))],
          ["Payable", this.money(rows.reduce((sum, row) => sum + Number(row.payable_amount || 0), 0))],
        ],
        headers: [
          "Order ID", "Order Number", "Buyer ID", "Seller IDs", "Seller Count", "Item Count",
          "Status", "Payment Status", "Delivery Status", "Subtotal", "Discount", "Tax",
          "Shipping", "COD Charge", "Total", "Payable", "Currency", "Created At",
        ],
        rows: rows.map((row) => [
          row.id,
          row.order_number,
          row.buyer_id,
          row.seller_ids || "-",
          row.seller_count,
          row.item_count,
          row.status,
          row.payment_status,
          row.delivery_status || "-",
          this.money(row.subtotal_amount, row.currency),
          this.money(row.discount_amount, row.currency),
          this.money(row.tax_amount, row.currency),
          this.money(row.shipping_fee_amount, row.currency),
          this.money(row.cod_charge_amount, row.currency),
          this.money(row.total_amount, row.currency),
          this.money(row.payable_amount, row.currency),
          row.currency || "INR",
          row.created_at,
        ]),
        raw: rows,
      }),
    };
  }

  async buildProductsReport(filters) {
    const filter = this.buildProductFilter(filters);
    const rows = await ProductModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(filters.offset)
      .limit(filters.limit)
      .lean({ virtuals: true });

    return {
      rows,
      document: this.buildDocument({
        title: "Products Export",
        subtitle: `${rows.length} product row(s)`,
        fileBaseName: "products-export",
        filters,
        summary: [
          ["Products", rows.length],
          ["Active", rows.filter((row) => row.status === "active").length],
          ["Rejected", rows.filter((row) => row.status === "rejected").length],
          ["Out Of Stock", rows.filter((row) => this.availableStock(row) <= 0).length],
        ],
        headers: [
          "Product ID", "Seller ID", "Title", "SKU", "Category", "Brand", "Status",
          "Visibility", "Stock", "Reserved", "Available", "Low Stock Threshold", "MRP",
          "Price", "Sale Price", "GST Rate", "Views", "Purchases", "Rating", "Created At",
        ],
        rows: rows.map((row) => [
          row._id,
          row.sellerId,
          row.title,
          row.sku || "-",
          row.category || "-",
          row.brand || "-",
          row.status,
          row.visibility,
          row.stock,
          row.reservedStock,
          this.availableStock(row),
          row.inventorySettings?.lowStockThreshold ?? 5,
          this.money(row.mrp, row.currency),
          this.money(row.price, row.currency),
          this.money(row.salePrice, row.currency),
          row.gstRate,
          row.analytics?.views || 0,
          row.analytics?.purchases || 0,
          row.rating || 0,
          row.createdAt,
        ]),
        raw: rows,
      }),
    };
  }

  async buildInventoryReport(filters) {
    if (String(filters.view || "snapshot") === "transactions") {
      return this.buildInventoryTransactionsReport(filters);
    }
    const filter = this.buildProductFilter({ ...filters, includeAllStatuses: true });
    const rows = await ProductModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip(filters.offset)
      .limit(filters.limit)
      .lean({ virtuals: true });

    const lowStockRows = rows.filter((row) => this.isLowStock(row));
    return {
      rows,
      document: this.buildDocument({
        title: "Inventory Snapshot Export",
        subtitle: `${rows.length} inventory row(s)`,
        fileBaseName: "inventory-snapshot-export",
        filters,
        summary: [
          ["Products", rows.length],
          ["Low Stock", lowStockRows.length],
          ["Out Of Stock", rows.filter((row) => this.availableStock(row) <= 0).length],
          ["Reserved Units", rows.reduce((sum, row) => sum + Number(row.reservedStock || 0), 0)],
        ],
        headers: [
          "Product ID", "Seller ID", "Title", "SKU", "Status", "Stock", "Reserved",
          "Available", "Low Stock Threshold", "Stock Status", "Allow Backorder", "Updated At",
        ],
        rows: rows.map((row) => [
          row._id,
          row.sellerId,
          row.title,
          row.sku || "-",
          row.status,
          row.stock,
          row.reservedStock,
          this.availableStock(row),
          row.inventorySettings?.lowStockThreshold ?? 5,
          this.inventoryStatus(row),
          Boolean(row.inventorySettings?.allowBackorder),
          row.updatedAt,
        ]),
        raw: rows,
      }),
    };
  }

  async buildInventoryTransactionsReport(filters) {
    const filter = {
      ...this.mongoDateFilter(filters),
    };
    if (filters.sellerId) filter.sellerId = String(filters.sellerId);
    if (filters.organizationId) filter.organizationId = String(filters.organizationId);
    if (filters.productId) filter.productId = String(filters.productId);
    if (filters.variantSku) filter.variantSku = String(filters.variantSku);
    if (filters.orderId) filter.orderId = String(filters.orderId);
    if (filters.returnId) filter.returnId = String(filters.returnId);
    if (filters.status) filter.status = String(filters.status);
    if (filters.type) filter.type = String(filters.type);
    if (filters.search) {
      filter.$or = [
        { productId: { $regex: filters.search, $options: "i" } },
        { orderId: { $regex: filters.search, $options: "i" } },
        { referenceId: { $regex: filters.search, $options: "i" } },
        { variantSku: { $regex: filters.search, $options: "i" } },
      ];
    }

    const rows = await InventoryTransactionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(filters.offset)
      .limit(filters.limit)
      .lean();

    return {
      rows,
      document: this.buildDocument({
        title: "Inventory Transactions Export",
        subtitle: `${rows.length} inventory transaction row(s)`,
        fileBaseName: "inventory-transactions-export",
        filters,
        summary: [
          ["Transactions", rows.length],
          ["Quantity Delta", rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)],
        ],
        headers: [
          "Transaction ID", "Type", "Status", "Product ID", "Variant SKU", "Seller ID",
          "Quantity", "Order ID", "Return ID", "Reference Type", "Reference ID", "Created At",
        ],
        rows: rows.map((row) => [
          row._id,
          row.type,
          row.status,
          row.productId,
          row.variantSku || "-",
          row.sellerId || "-",
          row.quantity,
          row.orderId || "-",
          row.returnId || "-",
          row.referenceType,
          row.referenceId,
          row.createdAt,
        ]),
        raw: rows,
      }),
    };
  }

  async buildShipmentsReport(filters) {
    const rows = await this.queryShipments(filters);
    return {
      rows,
      document: this.buildDocument({
        title: "Shipments Export",
        subtitle: `${rows.length} shipment row(s)`,
        fileBaseName: "shipments-export",
        filters,
        summary: [
          ["Shipments", rows.length],
          ["Delivered", rows.filter((row) => ["delivered", "delivered_verified"].includes(row.status)).length],
          ["Failed/RTO", rows.filter((row) => ["failed", "rto", "lost", "damaged"].includes(row.status)).length],
          ["COD", rows.filter((row) => row.cod).length],
        ],
        headers: [
          "Shipment ID", "Order ID", "Seller ID", "Agent ID", "Provider", "Courier",
          "AWB", "Tracking Number", "Status", "Mode", "COD", "Expected Delivery", "Created At",
        ],
        rows: rows.map((row) => [
          row.id,
          row.order_id,
          row.seller_id,
          row.delivery_agent_id || "-",
          row.provider,
          row.courier_name || "-",
          row.awb_number || "-",
          row.tracking_number || "-",
          row.status,
          row.shipping_mode,
          Boolean(row.cod),
          row.expected_delivery_at || "-",
          row.created_at,
        ]),
        raw: rows,
      }),
    };
  }

  async buildDeliveryAgentsReport(filters) {
    if (!(await this.hasTable("delivery_agents"))) {
      return this.emptyReport("Delivery Agents Export", "delivery-agents-export", filters);
    }

    const query = knex("delivery_agents as da")
      .leftJoin("shipments as s", "s.delivery_agent_id", "da.id")
      .select(
        "da.id",
        "da.seller_id",
        "da.name",
        "da.phone",
        "da.email",
        "da.vehicle_type",
        "da.vehicle_number",
        "da.license_number",
        "da.verification_status",
        "da.active",
        "da.created_at",
      )
      .select(knex.raw("COUNT(s.id)::INT AS assigned_shipments"))
      .select(knex.raw("COUNT(s.id) FILTER (WHERE s.status IN ('delivered', 'delivered_verified'))::INT AS delivered_shipments"))
      .groupBy("da.id");

    if (filters.sellerId) query.where("da.seller_id", filters.sellerId);
    if (filters.organizationId) query.where("da.organization_id", filters.organizationId);
    if (filters.status) query.where("da.verification_status", filters.status);
    if (filters.active !== undefined) query.where("da.active", filters.active === true || filters.active === "true");
    if (filters.search) {
      query.where((builder) => builder
        .whereILike("da.name", `%${filters.search}%`)
        .orWhereILike("da.phone", `%${filters.search}%`)
        .orWhereILike("da.email", `%${filters.search}%`)
        .orWhereILike("da.vehicle_number", `%${filters.search}%`)
        .orWhereILike("da.license_number", `%${filters.search}%`));
    }
    this.applyDateRange(query, filters, "da.created_at");

    const rows = await query.orderBy("da.created_at", "desc").limit(filters.limit).offset(filters.offset);
    return {
      rows,
      document: this.buildDocument({
        title: "Delivery Agents Export",
        subtitle: `${rows.length} delivery agent row(s)`,
        fileBaseName: "delivery-agents-export",
        filters,
        summary: [
          ["Agents", rows.length],
          ["Active", rows.filter((row) => row.active).length],
          ["Verified", rows.filter((row) => row.verification_status === "verified").length],
          ["Assigned Shipments", rows.reduce((sum, row) => sum + Number(row.assigned_shipments || 0), 0)],
        ],
        headers: [
          "Agent ID", "Seller ID", "Name", "Phone", "Email", "Vehicle Type", "Vehicle Number",
          "License Number", "Verification", "Active", "Assigned Shipments", "Delivered Shipments", "Created At",
        ],
        rows: rows.map((row) => [
          row.id,
          row.seller_id,
          row.name,
          row.phone,
          row.email || "-",
          row.vehicle_type || "-",
          row.vehicle_number || "-",
          row.license_number || "-",
          row.verification_status,
          Boolean(row.active),
          row.assigned_shipments || 0,
          row.delivered_shipments || 0,
          row.created_at,
        ]),
        raw: rows,
      }),
    };
  }

  async buildReturnsReport(filters) {
    const rows = await this.queryReturns(filters);
    return {
      rows,
      document: this.buildDocument({
        title: "Returns Export",
        subtitle: `${rows.length} return row(s)`,
        fileBaseName: "returns-export",
        filters,
        summary: [
          ["Returns", rows.length],
          ["Refunded", rows.filter((row) => ["refunded", "partially_refunded"].includes(row.status)).length],
          ["Refund Amount", this.money(rows.reduce((sum, row) => sum + this.returnRefundAmount(row), 0))],
          ["QC Failed", rows.filter((row) => ["qc_failed", "qc_completed"].includes(row.status)).length],
        ],
        headers: [
          "Return ID", "Return Number", "Order ID", "Buyer ID", "Seller ID", "Reason",
          "Resolution", "Status", "Refund Status", "Refund Amount", "Provider Refund ID",
          "Tracking Number", "Requested At", "Created At",
        ],
        rows: rows.map((row) => [
          row._id,
          row.returnNumber || "-",
          row.orderId,
          row.buyerId,
          row.sellerId || this.sellerIdsFromItems(row.items).join(", "),
          row.reason,
          row.resolution,
          row.status,
          row.refund?.status || "-",
          this.money(this.returnRefundAmount(row)),
          row.providerRefundId || row.refund?.providerRefundId || "-",
          row.trackingNumber || row.reverseShipment?.trackingNumber || "-",
          row.requestedAt || "-",
          row.createdAt,
        ]),
        raw: rows,
      }),
    };
  }

  async buildCancellationsReport(filters) {
    const rows = await this.queryCancellations(filters);
    return {
      rows,
      document: this.buildDocument({
        title: "Cancellations Export",
        subtitle: `${rows.length} cancellation row(s)`,
        fileBaseName: "cancellations-export",
        filters,
        summary: [
          ["Cancellations", rows.length],
          ["Refund Amount", this.money(rows.reduce((sum, row) => sum + Number(row.refund_amount || 0), 0))],
          ["Completed", rows.filter((row) => row.status === "completed").length],
          ["Failed", rows.filter((row) => row.status === "failed").length],
        ],
        headers: [
          "Cancellation ID", "Cancellation Number", "Order ID", "Buyer ID", "Seller IDs", "Scope",
          "Status", "Reason Code", "Refund Status", "Refund Amount", "Wallet Refund",
          "Provider Refund", "Provider Refund ID", "Created At",
        ],
        rows: rows.map((row) => [
          row.id,
          row.cancellation_number,
          row.order_id,
          row.buyer_id,
          this.sellerIdsFromItems(row.items).join(", "),
          row.scope,
          row.status,
          row.reason_code || "-",
          row.refund_status,
          this.money(row.refund_amount),
          this.money(row.wallet_refund_amount),
          this.money(row.provider_refund_amount),
          row.provider_refund_id || "-",
          row.created_at,
        ]),
        raw: rows,
      }),
    };
  }

  async buildRefundsReport(filters) {
    const [returns, cancellations] = await Promise.all([
      this.queryReturns({ ...filters, limit: Math.ceil(filters.limit / 2), offset: 0 }),
      this.queryCancellations({ ...filters, limit: Math.ceil(filters.limit / 2), offset: 0 }),
    ]);

    const rows = [
      ...returns.map((row) => ({
        source: "return",
        id: String(row._id),
        referenceNumber: row.returnNumber || "-",
        orderId: row.orderId,
        buyerId: row.buyerId,
        sellerIds: row.sellerId || this.sellerIdsFromItems(row.items).join(", "),
        status: row.refund?.status || row.status,
        amount: this.returnRefundAmount(row),
        walletAmount: row.refund?.walletAmount || 0,
        providerAmount: row.refund?.providerAmount || 0,
        providerRefundId: row.providerRefundId || row.refund?.providerRefundId || "-",
        method: row.refundMethod || row.refund?.method || "-",
        reason: row.reason || "-",
        createdAt: row.createdAt,
      })),
      ...cancellations.map((row) => ({
        source: "cancellation",
        id: row.id,
        referenceNumber: row.cancellation_number || "-",
        orderId: row.order_id,
        buyerId: row.buyer_id,
        sellerIds: this.sellerIdsFromItems(row.items).join(", "),
        status: row.refund_status || row.status,
        amount: Number(row.refund_amount || 0),
        walletAmount: Number(row.wallet_refund_amount || 0),
        providerAmount: Number(row.provider_refund_amount || 0),
        providerRefundId: row.provider_refund_id || "-",
        method: row.refund_method || "-",
        reason: row.reason || row.reason_code || "-",
        createdAt: row.created_at,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(filters.offset, filters.offset + filters.limit);

    return {
      rows,
      document: this.buildDocument({
        title: "Refunds Export",
        subtitle: `${rows.length} refund row(s) from returns and cancellations`,
        fileBaseName: "refunds-export",
        filters,
        summary: [
          ["Refund Rows", rows.length],
          ["Refund Amount", this.money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))],
          ["Wallet Amount", this.money(rows.reduce((sum, row) => sum + Number(row.walletAmount || 0), 0))],
          ["Provider Amount", this.money(rows.reduce((sum, row) => sum + Number(row.providerAmount || 0), 0))],
        ],
        headers: [
          "Source", "Reference ID", "Reference Number", "Order ID", "Buyer ID", "Seller IDs",
          "Status", "Refund Amount", "Wallet Amount", "Provider Amount", "Provider Refund ID",
          "Method", "Reason", "Created At",
        ],
        rows: rows.map((row) => [
          row.source,
          row.id,
          row.referenceNumber,
          row.orderId,
          row.buyerId,
          row.sellerIds || "-",
          row.status,
          this.money(row.amount),
          this.money(row.walletAmount),
          this.money(row.providerAmount),
          row.providerRefundId,
          row.method,
          row.reason,
          row.createdAt,
        ]),
        raw: rows,
      }),
    };
  }

  async buildSellerScorecardsReport(filters) {
    const [
      orderRows,
      shipmentRows,
      payoutRows,
      negativeRows,
      returnRows,
      productRows,
    ] = await Promise.all([
      this.querySellerOrderScorecards(filters),
      this.querySellerShipmentScorecards(filters),
      this.querySellerPayoutScorecards(filters),
      this.querySellerNegativeBalanceScorecards(filters),
      this.querySellerReturnScorecards(filters),
      this.querySellerProductScorecards(filters),
    ]);

    const sellerIds = Array.from(new Set([
      ...orderRows.map((row) => row.seller_id),
      ...shipmentRows.map((row) => row.seller_id),
      ...payoutRows.map((row) => row.seller_id),
      ...negativeRows.map((row) => row.seller_id),
      ...returnRows.map((row) => row.sellerId),
      ...productRows.map((row) => row.sellerId),
    ].filter(Boolean)));
    const sellerNames = await this.getSellerNameMap(sellerIds);
    const shipmentMap = this.mapBy(shipmentRows, "seller_id");
    const payoutMap = this.mapBy(payoutRows, "seller_id");
    const negativeMap = this.mapBy(negativeRows, "seller_id");
    const returnMap = this.mapBy(returnRows, "sellerId");
    const productMap = this.mapBy(productRows, "sellerId");

    const rows = sellerIds
      .map((sellerId) => {
        const order = orderRows.find((row) => row.seller_id === sellerId) || {};
        const shipment = shipmentMap.get(sellerId) || {};
        const payout = payoutMap.get(sellerId) || {};
        const negative = negativeMap.get(sellerId) || {};
        const returns = returnMap.get(sellerId) || {};
        const products = productMap.get(sellerId) || {};
        const orderCount = Number(order.order_count || 0);
        const deliveredOrders = Number(order.delivered_orders || 0);
        const cancelledOrders = Number(order.cancelled_orders || 0);
        const totalShipments = Number(shipment.total_shipments || 0);
        const deliveredShipments = Number(shipment.delivered_shipments || 0);
        const failedShipments = Number(shipment.failed_shipments || 0);
        const returnCount = Number(returns.returnCount || 0);
        return {
          sellerId,
          sellerName: sellerNames.get(String(sellerId)) || sellerId,
          orderCount,
          deliveredOrders,
          cancelledOrders,
          gmvAmount: Number(order.gmv_amount || 0),
          taxAmount: Number(order.tax_amount || 0),
          commissionAmount: Number(order.commission_amount || 0),
          cancellationRate: this.rate(cancelledOrders, orderCount),
          returnCount,
          returnRate: this.rate(returnCount, orderCount),
          totalShipments,
          deliveredShipments,
          failedShipments,
          deliverySuccessRate: this.rate(deliveredShipments, totalShipments),
          deliveryFailureRate: this.rate(failedShipments, totalShipments),
          pendingPayoutAmount: Number(payout.pending_amount || 0),
          failedPayoutCount: Number(payout.failed_count || 0),
          negativeBalanceAmount: Math.abs(Number(negative.negative_balance_amount || 0)),
          productCount: Number(products.productCount || 0),
          activeProductCount: Number(products.activeProductCount || 0),
          rejectedProductCount: Number(products.rejectedProductCount || 0),
          lowStockProductCount: Number(products.lowStockProductCount || 0),
        };
      })
      .sort((a, b) => b.gmvAmount - a.gmvAmount)
      .slice(filters.offset, filters.offset + filters.limit);

    return {
      rows,
      document: this.buildDocument({
        title: "Seller Scorecards Export",
        subtitle: `${rows.length} seller scorecard row(s)`,
        fileBaseName: "seller-scorecards-export",
        filters,
        summary: [
          ["Sellers", rows.length],
          ["GMV", this.money(rows.reduce((sum, row) => sum + row.gmvAmount, 0))],
          ["Returns", rows.reduce((sum, row) => sum + row.returnCount, 0)],
          ["Negative Balance", this.money(rows.reduce((sum, row) => sum + row.negativeBalanceAmount, 0))],
        ],
        headers: [
          "Seller ID", "Seller Name", "Orders", "Delivered Orders", "Cancelled Orders",
          "Cancellation Rate %", "Returns", "Return Rate %", "GMV", "Tax", "Commission",
          "Shipments", "Delivered Shipments", "Failed Shipments", "Delivery Success %",
          "Delivery Failure %", "Pending Payout", "Failed Payouts", "Negative Balance",
          "Products", "Active Products", "Rejected Products", "Low Stock Products",
        ],
        rows: rows.map((row) => [
          row.sellerId,
          row.sellerName,
          row.orderCount,
          row.deliveredOrders,
          row.cancelledOrders,
          row.cancellationRate,
          row.returnCount,
          row.returnRate,
          this.money(row.gmvAmount),
          this.money(row.taxAmount),
          this.money(row.commissionAmount),
          row.totalShipments,
          row.deliveredShipments,
          row.failedShipments,
          row.deliverySuccessRate,
          row.deliveryFailureRate,
          this.money(row.pendingPayoutAmount),
          row.failedPayoutCount,
          this.money(row.negativeBalanceAmount),
          row.productCount,
          row.activeProductCount,
          row.rejectedProductCount,
          row.lowStockProductCount,
        ]),
        raw: rows,
      }),
    };
  }

  buildProductFilter(filters = {}) {
    const filter = {
      ...this.mongoDateFilter(filters),
    };
    if (filters.sellerId) filter.sellerId = String(filters.sellerId);
    if (filters.organizationId) filter.organizationId = String(filters.organizationId);
    if (filters.status) filter.status = String(filters.status);
    if (filters.category) filter.category = String(filters.category);
    if (filters.brand) filter.brand = String(filters.brand);
    if (filters.search) {
      filter.$or = [
        { title: { $regex: filters.search, $options: "i" } },
        { sku: { $regex: filters.search, $options: "i" } },
        { category: { $regex: filters.search, $options: "i" } },
        { brand: { $regex: filters.search, $options: "i" } },
      ];
    }
    if (filters.stockStatus === "out_of_stock") {
      filter.$expr = { $lte: [{ $subtract: ["$stock", "$reservedStock"] }, 0] };
    }
    if (filters.stockStatus === "low_stock") {
      filter.$expr = {
        $and: [
          { $gt: [{ $subtract: ["$stock", "$reservedStock"] }, 0] },
          {
            $lte: [
              { $subtract: ["$stock", "$reservedStock"] },
              { $ifNull: ["$inventorySettings.lowStockThreshold", 5] },
            ],
          },
        ],
      };
    }
    return filter;
  }

  async queryShipments(filters = {}) {
    if (!(await this.hasTable("shipments"))) return [];
    const query = knex("shipments");
    if (filters.orderId) query.where("order_id", filters.orderId);
    if (filters.returnId) query.where("return_id", filters.returnId);
    if (filters.sellerId) query.where("seller_id", filters.sellerId);
    if (filters.organizationId) query.where("organization_id", filters.organizationId);
    if (filters.deliveryAgentId) query.where("delivery_agent_id", filters.deliveryAgentId);
    if (filters.status) query.where("status", filters.status);
    if (filters.shipmentType) query.where("shipment_type", filters.shipmentType);
    if (filters.direction) query.where("direction", filters.direction);
    if (filters.search) {
      query.where((builder) => builder
        .whereILike("awb_number", `%${filters.search}%`)
        .orWhereILike("tracking_number", `%${filters.search}%`)
        .orWhereILike("courier_name", `%${filters.search}%`)
        .orWhereRaw("order_id::text ILIKE ?", [`%${filters.search}%`])
        .orWhereRaw("id::text ILIKE ?", [`%${filters.search}%`]));
    }
    this.applyDateRange(query, filters, "created_at");
    return query.orderBy("created_at", "desc").limit(filters.limit).offset(filters.offset);
  }

  async queryReturns(filters = {}) {
    const filter = {
      ...this.mongoDateFilter(filters),
    };
    if (filters.sellerId) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
        { sellerId: String(filters.sellerId) },
        { "items.sellerId": String(filters.sellerId) },
        ],
      });
    }
    if (filters.organizationId) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { organizationId: String(filters.organizationId) },
          { "items.organizationId": String(filters.organizationId) },
        ],
      });
    }
    if (filters.buyerId) filter.buyerId = String(filters.buyerId);
    if (filters.orderId) filter.orderId = String(filters.orderId);
    if (filters.status) filter.status = String(filters.status);
    if (filters.reason) filter.reason = String(filters.reason);
    if (filters.refundStatus) filter["refund.status"] = String(filters.refundStatus);
    if (filters.search) {
      const searchFilters = [
        { returnNumber: { $regex: filters.search, $options: "i" } },
        { orderId: { $regex: filters.search, $options: "i" } },
        { "items.productTitle": { $regex: filters.search, $options: "i" } },
      ];
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: searchFilters });
    }
    return ReturnModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(filters.offset)
      .limit(filters.limit)
      .lean();
  }

  async queryCancellations(filters = {}) {
    if (!(await this.hasTable("order_cancellations"))) return [];
    const query = knex("order_cancellations");
    if (filters.orderId) query.where("order_id", filters.orderId);
    if (filters.buyerId) query.where("buyer_id", filters.buyerId);
    if (filters.status) query.where("status", filters.status);
    if (filters.refundStatus) query.where("refund_status", filters.refundStatus);
    if (filters.scope) query.where("scope", filters.scope);
    if (filters.sellerId) {
      query.whereRaw("items @> ?::jsonb", [JSON.stringify([{ sellerId: String(filters.sellerId) }])]);
    }
    if (filters.organizationId) {
      query.whereRaw("items @> ?::jsonb", [
        JSON.stringify([{ organizationId: String(filters.organizationId) }]),
      ]);
    }
    if (filters.search) {
      query.where((builder) => builder
        .whereILike("cancellation_number", `%${filters.search}%`)
        .orWhereRaw("order_id::text ILIKE ?", [`%${filters.search}%`])
        .orWhereILike("reason", `%${filters.search}%`));
    }
    this.applyDateRange(query, filters, "created_at");
    return query.orderBy("created_at", "desc").limit(filters.limit).offset(filters.offset);
  }

  async querySellerOrderScorecards(filters = {}) {
    const query = knex("order_items as oi")
      .join("orders as o", "o.id", "oi.order_id")
      .select("oi.seller_id")
      .countDistinct({ order_count: "o.id" })
      .sum({ gmv_amount: "oi.line_total" })
      .sum({ tax_amount: "oi.tax_amount" })
      .sum({ commission_amount: "oi.platform_fee_amount" })
      .select(knex.raw(`
        COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('delivered', 'fulfilled', 'completed'))::INT AS delivered_orders,
        COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('cancelled', 'payment_failed'))::INT AS cancelled_orders
      `))
      .groupBy("oi.seller_id");
    if (filters.sellerId) query.where("oi.seller_id", filters.sellerId);
    this.applyDateRange(query, filters, "o.created_at");
    return query;
  }

  async querySellerShipmentScorecards(filters = {}) {
    if (!(await this.hasTable("shipments"))) return [];
    const query = knex("shipments")
      .select("seller_id")
      .count({ total_shipments: "*" })
      .select(knex.raw(`
        COUNT(*) FILTER (WHERE status IN ('delivered', 'delivered_verified'))::INT AS delivered_shipments,
        COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled', 'rto', 'lost', 'damaged'))::INT AS failed_shipments
      `))
      .groupBy("seller_id");
    if (filters.sellerId) query.where("seller_id", filters.sellerId);
    this.applyDateRange(query, filters, "created_at");
    return query;
  }

  async querySellerPayoutScorecards(filters = {}) {
    if (!(await this.hasTable("seller_payouts"))) return [];
    const query = knex("seller_payouts")
      .select("seller_id")
      .select(knex.raw("COALESCE(SUM(net_amount) FILTER (WHERE status IN ('pending', 'processing', 'on_hold')), 0)::NUMERIC AS pending_amount"))
      .select(knex.raw("COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed_count"))
      .groupBy("seller_id");
    if (filters.sellerId) query.where("seller_id", filters.sellerId);
    this.applyDateRange(query, filters, "created_at");
    return query;
  }

  async querySellerNegativeBalanceScorecards(filters = {}) {
    if (!(await this.hasTable("seller_settlements"))) return [];
    const query = knex("seller_settlements")
      .select("seller_id")
      .sum({ negative_balance_amount: "net_amount" })
      .where("net_amount", "<", 0)
      .whereNot("status", "completed")
      .groupBy("seller_id");
    if (filters.sellerId) query.where("seller_id", filters.sellerId);
    this.applyDateRange(query, filters, "created_at");
    return query;
  }

  async querySellerReturnScorecards(filters = {}) {
    const match = this.mongoDateFilter(filters);
    if (filters.sellerId) {
      match.$or = [
        { sellerId: String(filters.sellerId) },
        { "items.sellerId": String(filters.sellerId) },
      ];
    }
    const rows = await ReturnModel.find(match).select("sellerId items status refundAmount refund createdAt").lean();
    const bySeller = new Map();
    rows.forEach((row) => {
      const sellerIds = row.sellerId ? [String(row.sellerId)] : this.sellerIdsFromItems(row.items);
      sellerIds.forEach((sellerId) => {
        const current = bySeller.get(sellerId) || { sellerId, returnCount: 0, refundAmount: 0 };
        current.returnCount += 1;
        current.refundAmount += this.returnRefundAmount(row);
        bySeller.set(sellerId, current);
      });
    });
    return Array.from(bySeller.values());
  }

  async querySellerProductScorecards(filters = {}) {
    const match = {
      ...this.mongoDateFilter(filters),
    };
    if (filters.sellerId) match.sellerId = String(filters.sellerId);
    const rows = await ProductModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$sellerId",
          productCount: { $sum: 1 },
          activeProductCount: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          rejectedProductCount: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          lowStockProductCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $subtract: ["$stock", "$reservedStock"] }, 0] },
                    {
                      $lte: [
                        { $subtract: ["$stock", "$reservedStock"] },
                        { $ifNull: ["$inventorySettings.lowStockThreshold", 5] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    return rows.map((row) => ({
      sellerId: row._id,
      productCount: row.productCount,
      activeProductCount: row.activeProductCount,
      rejectedProductCount: row.rejectedProductCount,
      lowStockProductCount: row.lowStockProductCount,
    }));
  }

  async getSellerNameMap(sellerIds = []) {
    const ids = Array.from(new Set((sellerIds || []).map((id) => String(id || "")).filter(Boolean)));
    const objectIds = ids.filter((id) => UserModel.db.base.Types.ObjectId.isValid(id));
    if (!objectIds.length) return new Map();
    const users = await UserModel.find({ _id: { $in: objectIds } })
      .select("email profile sellerProfile")
      .lean();
    return new Map(users.map((user) => {
      const name = user.sellerProfile?.displayName ||
        user.sellerProfile?.businessName ||
        user.sellerProfile?.legalBusinessName ||
        [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ") ||
        user.email ||
        String(user._id);
      return [String(user._id), name];
    }));
  }

  buildDocument({ title, subtitle, fileBaseName, filters, summary = [], headers = [], rows = [], raw = [] }) {
    return {
      title,
      subtitle,
      fileBaseName,
      generatedAt: new Date().toISOString(),
      raw: {
        filters,
        rows: raw,
        count: raw.length,
      },
      sections: [
        {
          title: "Filters",
          rows: this.filterRows(filters),
        },
        {
          title: "Summary",
          rows: summary.map(([label, value]) => ({ label, value })),
        },
        {
          title: "Rows",
          rows: headers.length ? [headers, ...rows] : rows,
        },
      ],
    };
  }

  emptyReport(title, fileBaseName, filters) {
    return {
      rows: [],
      document: this.buildDocument({
        title,
        subtitle: "0 row(s)",
        fileBaseName,
        filters,
        summary: [["Rows", 0]],
        headers: [],
        rows: [],
        raw: [],
      }),
    };
  }

  filterRows(filters = {}) {
    return Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([label, value]) => ({ label, value }));
  }

  sellerIdsFromItems(items = []) {
    const normalized = Array.isArray(items) ? items : [];
    return Array.from(new Set(normalized.map((item) => String(item.sellerId || item.seller_id || "")).filter(Boolean)));
  }

  returnRefundAmount(row = {}) {
    return Number(row.refund?.refundedAmount ?? row.refund?.approvedAmount ?? row.refundAmount ?? 0);
  }

  availableStock(product = {}) {
    return Math.max(0, Number(product.stock || 0) - Number(product.reservedStock || 0));
  }

  isLowStock(product = {}) {
    const available = this.availableStock(product);
    const threshold = Number(product.inventorySettings?.lowStockThreshold ?? 5);
    return available > 0 && available <= threshold;
  }

  inventoryStatus(product = {}) {
    const available = this.availableStock(product);
    if (available <= 0) return "out_of_stock";
    if (this.isLowStock(product)) return "low_stock";
    return "available";
  }

  money(value, currency = "INR") {
    return this.renderer.money(Number(value || 0), currency || "INR");
  }

  rate(numerator, denominator) {
    const base = Number(denominator || 0);
    if (!base) return 0;
    return Number(((Number(numerator || 0) / base) * 100).toFixed(2));
  }

  mapBy(rows = [], key) {
    return new Map(rows.map((row) => [String(row[key]), row]));
  }
}

const operationsReportService = new OperationsReportService();

module.exports = {
  REPORT_TYPES,
  OperationsReportService,
  operationsReportService,
};
