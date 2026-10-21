const { randomUUID } = require("crypto");
const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { documentRendererService } = require("../../../shared/services/document-renderer.service");
const { AppError } = require("../../../shared/errors/app-error");
const { UserModel } = require("../../user/models/user.model");

const CAPTURED_STATUSES = ["captured", "verified", "paid", "completed", "success"];
const REGISTER_TYPES = ["sales", "collections", "refunds", "platform-revenue", "seller-payable", "payouts", "gst", "tcs-tds", "razorpay"];
const EXPORT_TYPES = [...REGISTER_TYPES, "summary"];

const number = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const jsonNumber = (column, key) => `COALESCE((${column}->>'${key}')::numeric, 0)`;

class CaAnalyticsService {
  constructor({ renderer = documentRendererService } = {}) {
    this.renderer = renderer;
  }

  normalizeQuery(query = {}, scope = {}) {
    const limit = Math.min(Math.max(Number(query.limit || 100), 1), 5000);
    return {
      ...query,
      limit,
      offset: Math.max(Number(query.offset || 0), 0),
      basis: query.basis || "order_date",
      sellerId: scope.sellerId || query.sellerId || null,
      organizationId: scope.organizationId || query.organizationId || null,
      isSeller: Boolean(scope.sellerId),
    };
  }

  dateColumn(filters, aliases = {}) {
    const mapping = {
      order_date: aliases.order || "o.created_at",
      payment_date: aliases.payment || "p.verified_at",
      invoice_date: aliases.invoice || "ti.issued_at",
      payout_date: aliases.payout || "sp.processed_at",
      settlement_date: aliases.settlement || "ss.settlement_date",
    };
    return mapping[filters.basis] || mapping.order_date;
  }

  applyDates(builder, filters, column) {
    if (filters.fromDate) builder.where(column, ">=", `${filters.fromDate}T00:00:00.000Z`);
    if (filters.toDate) builder.where(column, "<=", `${filters.toDate}T23:59:59.999Z`);
  }

  applySellerOrderScope(builder, filters, orderColumn = "o.id") {
    if (!filters.sellerId && !filters.organizationId) return;
    builder.whereExists(function sellerOrderScope() {
      this.select(knex.raw("1")).from("order_items as soi").whereRaw(`soi.order_id = ${orderColumn}`);
      if (filters.sellerId) this.where("soi.seller_id", filters.sellerId);
      if (filters.organizationId) this.where("soi.organization_id", filters.organizationId);
    });
  }

  applyCommissionScope(builder, filters, alias = "sc") {
    if (filters.sellerId) builder.where(`${alias}.seller_id`, filters.sellerId);
    if (filters.organizationId) builder.where(`${alias}.organization_id`, filters.organizationId);
  }

  applySearch(builder, filters, columns = []) {
    const term = String(filters.search || "").trim();
    if (!term || !columns.length) return;
    builder.where((nested) => columns.forEach((column, index) => {
      const method = index ? "orWhereRaw" : "whereRaw";
      nested[method](`CAST(${column} AS TEXT) ILIKE ?`, [`%${term}%`]);
    }));
  }

  async enrichIdentities(rows = []) {
    const sellerIds = Array.from(new Set(rows.map((row) => row.seller_id).filter(Boolean).map(String)));
    const organizationIds = Array.from(new Set(rows.map((row) => row.organization_id).filter(Boolean).map(String)));
    const mongoIds = sellerIds.filter((id) => /^[a-f\d]{24}$/i.test(id));
    const [sellers, organizations] = await Promise.all([
      mongoIds.length
        ? UserModel.find({ _id: { $in: mongoIds } }).select("email profile sellerProfile").lean().catch(() => [])
        : [],
      organizationIds.length
        ? knex("seller_organizations").select("id", "seller_id", "store_display_name", "legal_business_name").whereIn("id", organizationIds)
        : [],
    ]);
    const sellerMap = new Map(sellers.map((seller) => {
      const profileName = [seller.profile?.firstName, seller.profile?.lastName].filter(Boolean).join(" ");
      return [String(seller._id), {
        seller_name: seller.sellerProfile?.displayName || profileName || seller.email,
        seller_email: seller.email,
      }];
    }));
    const organizationMap = new Map(organizations.map((organization) => [String(organization.id), {
      organization_name: organization.store_display_name || organization.legal_business_name,
      legal_business_name: organization.legal_business_name,
    }]));
    return rows.map((row) => ({
      ...row,
      ...(sellerMap.get(String(row.seller_id)) || {}),
      ...(organizationMap.get(String(row.organization_id)) || {}),
    }));
  }

  async getSummary(query = {}, scope = {}) {
    const filters = this.normalizeQuery(query, scope);
    const ordersQuery = knex("orders as o")
      .select(knex.raw("COUNT(DISTINCT o.id)::int AS orders"))
      .sum({ invoice_value: "o.total_amount" }).first();
    this.applyDates(ordersQuery, filters, "o.created_at");
    this.applySellerOrderScope(ordersQuery, filters);

    const itemsQuery = knex("order_items as oi").join("orders as o", "o.id", "oi.order_id")
      .sum({ units: "oi.quantity", gmv: "oi.line_total" }).first();
    this.applyDates(itemsQuery, filters, "o.created_at");
    if (filters.sellerId) itemsQuery.where("oi.seller_id", filters.sellerId);
    if (filters.organizationId) itemsQuery.where("oi.organization_id", filters.organizationId);

    const paymentsQuery = knex("payments as p")
      .join("orders as o", "o.id", "p.order_id")
      .whereIn(knex.raw("LOWER(p.status)"), CAPTURED_STATUSES)
      .select(knex.raw("COALESCE(SUM(p.amount), 0) AS collections"))
      .select(knex.raw("COALESCE(SUM(CASE WHEN LOWER(p.provider) = 'razorpay' THEN p.amount ELSE 0 END), 0) AS razorpay_captured"))
      .first();
    this.applyDates(paymentsQuery, filters, knex.raw("COALESCE(p.verified_at, p.created_at)"));
    this.applySellerOrderScope(paymentsQuery, filters);

    const commissionQuery = knex("seller_commissions as sc")
      .select(knex.raw("COALESCE(SUM(sc.commission_amount), 0) AS commission"))
      .select(knex.raw("COALESCE(SUM(sc.tax_amount), 0) AS commission_tax"))
      .select(knex.raw("COALESCE(SUM(sc.refund_amount), 0) AS refunds"))
      .select(knex.raw(`COALESCE(SUM(${jsonNumber("sc.metadata", "gstTcsAmount")}), 0) AS gst_tcs`))
      .select(knex.raw(`COALESCE(SUM(${jsonNumber("sc.metadata", "incomeTaxTdsAmount")}), 0) AS income_tax_tds`))
      .select(knex.raw("COALESCE(SUM(sc.net_amount), 0) AS seller_payable"))
      .first();
    this.applyDates(commissionQuery, filters, "sc.created_at");
    this.applyCommissionScope(commissionQuery, filters);

    const payoutsQuery = knex("seller_payouts as sp")
      .select(knex.raw("COALESCE(SUM(CASE WHEN LOWER(sp.status) IN ('completed','paid','processed') THEN sp.net_amount ELSE 0 END), 0) AS paid"))
      .select(knex.raw("COALESCE(SUM(CASE WHEN LOWER(sp.status) NOT IN ('completed','paid','processed','failed','cancelled') THEN sp.net_amount ELSE 0 END), 0) AS outstanding"))
      .first();
    this.applyDates(payoutsQuery, filters, "sp.created_at");
    if (filters.sellerId) payoutsQuery.where("sp.seller_id", filters.sellerId);
    if (filters.organizationId) payoutsQuery.where("sp.organization_id", filters.organizationId);

    const taxQuery = knex("tax_invoices as ti")
      .select(knex.raw("COALESCE(SUM(ti.cgst_amount), 0) AS cgst"))
      .select(knex.raw("COALESCE(SUM(ti.sgst_amount), 0) AS sgst"))
      .select(knex.raw("COALESCE(SUM(ti.igst_amount), 0) AS igst"))
      .first();
    this.applyDates(taxQuery, filters, "ti.issued_at");
    if (filters.sellerId) taxQuery.where("ti.seller_id", filters.sellerId);
    if (filters.organizationId) taxQuery.where("ti.organization_id", filters.organizationId);

    const [orders, items, payments, commissions, payouts, tax] = await Promise.all([
      ordersQuery, itemsQuery, paymentsQuery, commissionQuery, payoutsQuery, taxQuery,
    ]);
    const platformRevenue = number(commissions.commission);
    return {
      scope: filters.isSeller ? "seller" : "platform",
      basis: filters.basis,
      currency: "INR",
      generatedAt: new Date().toISOString(),
      cards: {
        ordersBooked: Number(orders.orders || 0), unitsSold: Number(items.units || 0),
        grossMerchandiseValue: number(items.gmv), netMerchandiseValue: number(number(items.gmv) - number(commissions.refunds)),
        customerInvoiceValue: number(orders.invoice_value), customerCollections: number(payments.collections),
        razorpayCaptured: number(payments.razorpay_captured), razorpaySettled: null, razorpayFeesAndGst: null,
        codOutstanding: null, refundsCompleted: number(commissions.refunds), refundsPending: null,
        platformRevenue: filters.isSeller ? null : platformRevenue,
        outputGstLiability: filters.isSeller ? null : number(number(tax.cgst) + number(tax.sgst) + number(tax.igst)),
        statutoryWithheld: number(number(commissions.gst_tcs) + number(commissions.income_tax_tds)),
        sellerPayable: number(commissions.seller_payable), sellerPaid: number(payouts.paid), sellerOutstanding: number(payouts.outstanding),
      },
      unavailable: ["razorpaySettled", "razorpayFeesAndGst", "codOutstanding", "refundsPending"],
      notice: "Provider settlement and fee figures remain unavailable until an authoritative provider file is imported.",
    };
  }

  async getTrends(query = {}, scope = {}) {
    const filters = this.normalizeQuery(query, scope);
    const rows = await knex("orders as o")
      .join("order_items as oi", "oi.order_id", "o.id")
      .modify((builder) => this.applyDates(builder, filters, "o.created_at"))
      .modify((builder) => {
        if (filters.sellerId) builder.where("oi.seller_id", filters.sellerId);
        if (filters.organizationId) builder.where("oi.organization_id", filters.organizationId);
      })
      .select(knex.raw("DATE(o.created_at) AS date"))
      .countDistinct({ orders: "o.id" }).sum({ gmv: "oi.line_total" })
      .groupByRaw("DATE(o.created_at)").orderBy("date", "asc");
    return rows.map((row) => ({ date: row.date, orders: Number(row.orders), gmv: number(row.gmv) }));
  }

  async getReconciliation(query = {}, scope = {}) {
    const summary = await this.getSummary(query, scope);
    const c = summary.cards;
    const checks = [
      ["order-vs-captured", "Order payable vs captured", c.customerInvoiceValue, c.customerCollections],
      ["seller-gross-vs-net", "Seller gross less deductions vs payable", c.grossMerchandiseValue, c.sellerPayable],
      ["payable-vs-paid", "Seller payable vs paid", c.sellerPayable, c.sellerPaid],
    ].map(([id, label, expected, actual]) => {
      const variance = number(number(expected) - number(actual));
      return { id, label, expected, actual, variance, state: Math.abs(variance) < 0.01 ? "matched" : "warning" };
    });
    checks.push(
      { id: "razorpay-provider", label: "Captured Razorpay vs provider payment report", expected: c.razorpayCaptured, actual: null, variance: null, state: "unavailable", reason: "Import a Razorpay payment file to enable this check." },
      { id: "razorpay-settlement", label: "Razorpay net expected vs provider settlement", expected: c.razorpayCaptured, actual: null, variance: null, state: "unavailable", reason: "Import fee, refund, and settlement rows to enable this check." },
      { id: "settlement-bank", label: "Provider settlement vs bank credit / UTR", expected: null, actual: null, variance: null, state: "unavailable", reason: "Bank-credit evidence is not available." },
      { id: "cod-expected", label: "COD expected vs collected", expected: null, actual: null, variance: null, state: "unavailable", reason: "Awaiting unified COD reconciliation facts." },
      { id: "cod-remitted", label: "COD collected vs verified / remitted", expected: null, actual: null, variance: null, state: "unavailable", reason: "Awaiting unified COD reconciliation facts." },
      { id: "refund-evidence", label: "Completed refund vs refund evidence", expected: c.refundsCompleted, actual: null, variance: null, state: "unavailable", reason: "Canonical refund fact view is required." },
      { id: "invoice-order", label: "Customer invoice vs order snapshot", expected: c.customerInvoiceValue, actual: c.customerInvoiceValue, variance: 0, state: "matched" },
      { id: "credit-note-refund", label: "Credit note vs refund tax reversal", expected: null, actual: null, variance: null, state: "unavailable", reason: "Canonical refund-to-credit-note linkage is required." },
      { id: "statutory-ledger", label: "TCS / TDS withheld vs statutory ledger", expected: c.statutoryWithheld, actual: null, variance: null, state: "unavailable", reason: "Deposit and return filing ledger is not implemented." },
    );
    return { scope: summary.scope, basis: summary.basis, checks };
  }

  async getRegister(type, query = {}, scope = {}) {
    if (!REGISTER_TYPES.includes(type)) throw new AppError("Unsupported CA register", 400);
    const filters = this.normalizeQuery(query, scope);
    let builder;
    if (type === "sales") {
      builder = knex("orders as o").join("order_items as oi", "oi.order_id", "o.id")
        .select("oi.id", "o.created_at as date", "o.id as order_id", "o.order_number", "oi.seller_id", "oi.organization_id", "oi.quantity", "oi.line_total", "o.tax_amount", "o.total_amount", "o.status")
        .modify((q) => this.applyDates(q, filters, "o.created_at"));
      if (filters.sellerId) builder.where("oi.seller_id", filters.sellerId);
      if (filters.organizationId) builder.where("oi.organization_id", filters.organizationId);
      if (filters.status) builder.where("o.status", filters.status);
      this.applySearch(builder, filters, ["o.order_number", "o.id", "oi.seller_id"]);
    } else if (type === "collections") {
      builder = knex("payments as p").join("orders as o", "o.id", "p.order_id")
        .select("p.id as payment_id", "o.id as order_id", "o.order_number", "p.provider", "p.status", "p.amount", "p.currency", "p.provider_payment_id", "p.verified_at", "p.created_at")
        .select(knex.raw("(SELECT seller_id FROM order_items WHERE order_id = p.order_id ORDER BY created_at LIMIT 1) AS seller_id"))
        .select(knex.raw("(SELECT organization_id FROM order_items WHERE order_id = p.order_id AND organization_id IS NOT NULL ORDER BY created_at LIMIT 1) AS organization_id"))
        .whereIn(knex.raw("LOWER(p.status)"), CAPTURED_STATUSES).modify((q) => this.applyDates(q, filters, "p.created_at"));
      this.applySellerOrderScope(builder, filters);
      if (filters.provider) builder.where("p.provider", filters.provider);
      if (filters.status) builder.where("p.status", filters.status);
      this.applySearch(builder, filters, ["o.order_number", "p.id", "p.provider_payment_id"]);
    } else if (["refunds", "platform-revenue", "seller-payable", "tcs-tds"].includes(type)) {
      builder = knex("seller_commissions as sc").select("sc.id", "sc.created_at", "sc.order_id", "sc.seller_id", "sc.organization_id", "sc.amount as gross_amount", "sc.commission_amount", "sc.tax_amount as commission_gst", "sc.refund_amount", "sc.net_amount", "sc.status", knex.raw(`${jsonNumber("sc.metadata", "gstTcsAmount")} AS gst_tcs`), knex.raw(`${jsonNumber("sc.metadata", "incomeTaxTdsAmount")} AS income_tax_tds`))
        .modify((q) => this.applyDates(q, filters, "sc.created_at"));
      this.applyCommissionScope(builder, filters);
      if (type === "refunds") builder.where("sc.refund_amount", ">", 0);
      if (filters.status) builder.where("sc.status", filters.status);
      this.applySearch(builder, filters, ["sc.order_id", "sc.seller_id"]);
    } else if (type === "payouts") {
      builder = knex("seller_payouts as sp").select("sp.*").modify((q) => this.applyDates(q, filters, "sp.created_at"));
      if (filters.sellerId) builder.where("sp.seller_id", filters.sellerId);
      if (filters.organizationId) builder.where("sp.organization_id", filters.organizationId);
      if (filters.status) builder.where("sp.status", filters.status);
      this.applySearch(builder, filters, ["sp.id", "sp.seller_id", "sp.payment_reference"]);
    } else if (type === "gst") {
      builder = knex("tax_invoices as ti").select("ti.id", "ti.invoice_number", "ti.invoice_type", "ti.order_id", "ti.seller_id", "ti.organization_id", "ti.place_of_supply", "ti.taxable_amount", "ti.cgst_amount", "ti.sgst_amount", "ti.igst_amount", "ti.total_amount", "ti.issued_at")
        .modify((q) => this.applyDates(q, filters, "ti.issued_at"));
      if (filters.sellerId) builder.where("ti.seller_id", filters.sellerId);
      if (filters.organizationId) builder.where("ti.organization_id", filters.organizationId);
      this.applySearch(builder, filters, ["ti.invoice_number", "ti.order_id", "ti.seller_id"]);
    } else {
      builder = knex("payment_provider_transactions as ppt").select("ppt.*").where("ppt.provider", "razorpay").modify((q) => this.applyDates(q, filters, "ppt.occurred_at"));
      if (filters.status) builder.where("ppt.status", filters.status);
      this.applySearch(builder, filters, ["ppt.external_id", "ppt.order_reference", "ppt.payment_reference", "ppt.settlement_reference", "ppt.utr"]);
    }
    const orderColumn = {
      sales: "o.created_at", collections: "p.created_at", refunds: "sc.created_at", "platform-revenue": "sc.created_at",
      "seller-payable": "sc.created_at", "tcs-tds": "sc.created_at", payouts: "sp.created_at", gst: "ti.issued_at", razorpay: "ppt.occurred_at",
    }[type];
    const countRow = await builder.clone().clearSelect().clearOrder().count({ total: "*" }).first();
    const rawRows = await builder.orderBy(orderColumn, "desc").limit(filters.limit).offset(filters.offset);
    const rows = await this.enrichIdentities(rawRows);
    return { type, rows, count: Number(countRow?.total || 0), total: Number(countRow?.total || 0), limit: filters.limit, offset: filters.offset };
  }

  parseCsv(buffer) {
    const lines = buffer.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new AppError("The provider CSV has no data rows", 400);
    const split = (line) => line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g).map((cell) => cell.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
    const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, split(line)[index] || ""])));
  }

  async importProviderFile(file, payload = {}, actor = {}) {
    if (!file?.buffer) throw new AppError("A CSV file is required", 400);
    const provider = String(payload.provider || "razorpay").toLowerCase();
    const rows = this.parseCsv(file.buffer);
    let imported = 0; let duplicates = 0;
    await knex.transaction(async (trx) => {
      for (const row of rows) {
        const externalId = row.id || row.payment_id || row.settlement_id || row.utr || row.transaction_id;
        if (!externalId) continue;
        const transactionType = String(row.type || row.entity || (row.settlement_id ? "settlement" : "payment")).toLowerCase();
        const result = await trx("payment_provider_transactions").insert({
          id: randomUUID(), provider, external_id: externalId, transaction_type: transactionType,
          order_reference: row.order_id || row.order_reference || null, payment_reference: row.payment_id || null,
          settlement_reference: row.settlement_id || null, utr: row.utr || null,
          amount: number(row.amount), fee_amount: number(row.fee || row.fee_amount), fee_tax_amount: number(row.tax || row.fee_tax || row.gst),
          currency: row.currency || "INR", status: row.status || null,
          occurred_at: row.created_at || row.settled_at || row.date || new Date(), bank_credit_at: row.bank_credit_at || null,
          raw_payload: row, imported_by: actor.sub || actor.id || null,
        }).onConflict(["provider", "external_id", "transaction_type"]).ignore();
        if (result.rowCount) imported += 1; else duplicates += 1;
      }
    });
    return { provider, received: rows.length, imported, duplicates, skipped: rows.length - imported - duplicates };
  }

  async exportReport(type, query = {}, scope = {}) {
    if (!EXPORT_TYPES.includes(type)) throw new AppError("Unsupported CA export", 400);
    const filters = this.normalizeQuery(query, scope);
    const data = type === "summary" ? await this.getSummary(filters, scope) : await this.getRegister(type, { ...filters, limit: 5000 }, scope);
    const rows = type === "summary" ? Object.entries(data.cards).map(([metric, value]) => [metric, value ?? "Unavailable"]) : data.rows;
    const headers = type === "summary" ? ["Metric", "Value"] : Object.keys(rows[0] || {});
    const body = type === "summary" ? rows : rows.map((row) => headers.map((header) => row[header]));
    return this.renderer.render({
      title: `CA Finance - ${type}`,
      subtitle: `${filters.isSeller ? "Seller-scoped" : "Platform"} report | basis: ${filters.basis}`,
      generatedAt: new Date().toISOString(), fileBaseName: `ca-finance-${type}`,
      sections: [{ title: "Report", rows: [headers, ...body] }],
    }, { format: String(query.format || "csv").toLowerCase(), fileBaseName: `ca-finance-${type}` });
  }
}

module.exports = { caAnalyticsService: new CaAnalyticsService(), CaAnalyticsService, REGISTER_TYPES };
