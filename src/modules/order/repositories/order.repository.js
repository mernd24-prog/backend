const { knex, postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { OutboxRepository } = require("../../../infrastructure/postgres/outbox.repository");
const { PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { UserModel } = require("../../user/models/user.model");

class OrderRepository {
  constructor({ outboxRepository = new OutboxRepository() } = {}) {
    this.outboxRepository = outboxRepository;
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

  async createOrder(payload, event) {
    const orderId = payload.id || uuidv4();
    const trx = await knex.transaction();

    try {
      const orderNumber = payload.orderNumber || this.generateOrderNumber();
      await trx("orders").insert({
        id: orderId,
        order_number: orderNumber,
        buyer_id: payload.buyerId,
        status: payload.status,
        payment_status: payload.paymentStatus || PAYMENT_STATUS.INITIATED,
        delivery_status: payload.deliveryStatus || null,
        currency: payload.currency,
        subtotal_amount: payload.subtotalAmount,
        discount_amount: payload.discountAmount,
        tax_amount: payload.taxAmount,
        total_amount: payload.totalAmount,
        shipping_address: this.jsonb(payload.shippingAddress),
        coupon_code: payload.couponCode || null,
        wallet_discount_amount: payload.walletDiscountAmount || 0,
        payable_amount: payload.payableAmount || payload.totalAmount,
        tax_breakup: this.jsonb(payload.taxBreakup),
        platform_fee_amount: payload.platformFeeAmount || 0,
        platform_fee_breakup: this.jsonb(payload.platformFeeBreakup, []),
        payment_provider: payload.paymentProvider || null,
        cod_charge_amount: payload.codChargeAmount || 0,
        metadata: this.jsonb(payload.metadata),
        created_by: payload.createdBy || payload.buyerId,
        updated_by: payload.updatedBy || payload.buyerId,
      });
      const items = payload.items.map((item) => ({
        id: uuidv4(),
        order_id: orderId,
        product_id: item.productId,
        product_title: item.title || item.productTitle || null,
        product_slug: item.slug || item.productSlug || null,
        product_sku: item.sku || item.productSku || null,
        product_image: item.image || item.productImage || null,
        brand: item.brand || null,
        category: item.category || null,
        hsn_code: item.hsnCode || null,
        gst_rate: item.gstRate ?? null,
        variant_id: item.variantId || null,
        variant_sku: item.variantSku || null,
        variant_title: item.variantTitle || null,
        attributes: this.jsonb(item.attributes),
        seller_id: item.sellerId,
        seller_snapshot: this.jsonb(item.sellerSnapshot || { sellerId: item.sellerId }),
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_amount: item.discountAmount || 0,
        tax_amount: item.taxAmount || 0,
        tax_breakup: this.jsonb(item.taxBreakup),
        platform_fee_amount: item.platformFeeAmount || 0,
        pricing_snapshot: this.jsonb(item.pricingSnapshot),
        product_snapshot: this.jsonb(item.productSnapshot),
        line_total: item.lineTotal,
      }));

      await trx("order_items").insert(items);
      await this.insertStatusHistory(trx, {
        orderId,
        fromStatus: null,
        toStatus: payload.status,
        actorId: payload.createdBy || payload.buyerId,
        actorRole: payload.actorRole || "buyer",
        reason: "order_created",
        metadata: {
          orderNumber,
          paymentStatus: payload.paymentStatus || PAYMENT_STATUS.INITIATED,
        },
      });

      if (event) {
        await this.outboxRepository.enqueue(trx, {
          ...event,
          aggregateId: orderId,
        });
      }

      await trx.commit();
      return { id: orderId, orderNumber, ...payload };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async findByBuyerIdempotencyKey(buyerId, idempotencyKey) {
    if (!buyerId || !idempotencyKey) return null;
    const [order] = await knex("orders")
      .where("buyer_id", buyerId)
      .whereRaw("metadata->>'idempotencyKey' = ?", [idempotencyKey])
      .orderBy("created_at", "desc")
      .limit(1);
    if (!order) return null;
    return this.findByIdWithItems(order.id);
  }

  generateOrderNumber(date = new Date()) {
    const datePart = date.toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = uuidv4().replace(/-/g, "").slice(0, 10).toUpperCase();
    return `ORD-${datePart}-${randomPart}`;
  }

  async listOrdersByBuyer(buyerId, filters = {}) {
    const orders = await this.listOrders({ ...filters, buyerId });
    return this.attachOrderRelations(orders);
  }

  async listOrdersBySeller(sellerId, productIds = null, filters = {}) {
    const values = [sellerId];
    const clauses = ["oi.seller_id = $1"];
    let index = 2;
    const productFilter = Array.isArray(productIds)
      ? `oi.product_id = ANY($${index++}::text[])`
      : "";
    if (Array.isArray(productIds)) values.push(productIds);
    if (productFilter) clauses.push(productFilter);
    this.applyOrderFilters(clauses, values, filters, () => index++);
    values.push(Number(filters.limit || 50), Number(filters.offset || 0));

    const { rows } = await postgresPool.query(
      `SELECT DISTINCT o.*
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY o.created_at DESC
       LIMIT $${index++}
       OFFSET $${index}`,
      values,
    );
    return this.attachOrderRelations(rows);
  }

  async updateStatus(orderId, status, metadata = {}) {
    const trx = await knex.transaction();

    try {
      const [current] = await trx("orders").where("id", orderId).limit(1).forUpdate();
      if (!current) {
        await trx.commit();
        return null;
      }

      const [order] = await trx("orders")
      .where("id", orderId)
        .update({
          status,
          payment_status: metadata.paymentStatus || current.payment_status,
          delivery_status: metadata.deliveryStatus || current.delivery_status,
          metadata: metadata.orderMetadata
            ? knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify(metadata.orderMetadata)])
            : current.metadata,
          updated_by: metadata.actorId || current.updated_by,
          updated_at: knex.fn.now(),
        })
      .returning("*");

      await this.insertStatusHistory(trx, {
        orderId,
        fromStatus: current.status,
        toStatus: status,
        actorId: metadata.actorId || null,
        actorRole: metadata.actorRole || null,
        reason: metadata.reason || null,
        note: metadata.note || null,
        metadata: metadata.metadata || {},
      });

      await trx.commit();
      return order || null;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async findById(orderId) {
    const [order] = await knex("orders").where("id", orderId).limit(1);
    return order || null;
  }

  async findByIdWithItems(orderId) {
    const order = await this.findById(orderId);
    if (!order) {
      return null;
    }

    const [hydrated] = await this.attachOrderRelations([order], {
      includeTimeline: true,
      includeNotes: true,
    });
    return hydrated || null;
  }

  async findItemsByOrderId(orderId) {
    const { rows } = await postgresPool.query(
      "SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC",
      [orderId],
    );
    return rows;
  }

  async findByIdAndBuyer(orderId, buyerId) {
    const [order] = await knex("orders")
      .where({ id: orderId, buyer_id: buyerId })
      .limit(1);
    return order || null;
  }

  async deleteById(orderId) {
    return knex("orders").where("id", orderId).del();
  }

  async isSellerInOrder(orderId, sellerId) {
    const { rows } = await postgresPool.query(
      `SELECT 1
       FROM order_items
       WHERE order_id = $1 AND seller_id = $2
       LIMIT 1`,
      [orderId, sellerId],
    );
    return rows.length > 0;
  }

  async hasNonCancellableShipment(orderId) {
    const rows = await this.optionalTableRows("shipments", (query) => query
      .where("order_id", orderId)
      .whereNotIn("status", ["initiated", "cancelled", "failed"])
      .limit(1));
    return rows.length > 0;
  }

  async findLatestPaymentByOrderId(orderId) {
    const [payment] = await knex("payments")
      .where("order_id", orderId)
      .orderBy("created_at", "desc")
      .limit(1);
    return payment || null;
  }

  async updatePaymentsForOrderCancellation(orderId, payload = {}) {
    const trx = await knex.transaction();

    try {
      const payments = await trx("payments")
        .where("order_id", orderId)
        .whereNotIn("status", [PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.CANCELLED])
        .forUpdate();

      if (!payments.length) {
        await trx.commit();
        return [];
      }

      const updated = [];
      for (const payment of payments) {
        const metadata = {
          ...(typeof payment.metadata === "object" && payment.metadata ? payment.metadata : {}),
          cancellation: payload.metadata || {},
        };
        const [row] = await trx("payments")
          .where("id", payment.id)
          .update({
            status: payload.status || payment.status,
            metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify(metadata)]),
            failed_reason: payload.failedReason || payment.failed_reason,
            updated_at: knex.fn.now(),
          })
          .returning("*");
        if (row) updated.push(row);
      }

      await trx.commit();
      return updated;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  applyOrderFilters(clauses, values, filters = {}, nextIndex) {
    const {
      status = null,
      paymentStatus = null,
      deliveryStatus = null,
      buyerId = null,
      fromDate = null,
      toDate = null,
      search = null,
    } = filters;

    if (status) {
      clauses.push(`o.status = $${nextIndex()}`);
      values.push(status);
    }
    if (paymentStatus) {
      clauses.push(`o.payment_status = $${nextIndex()}`);
      values.push(paymentStatus);
    }
    if (deliveryStatus) {
      clauses.push(`o.delivery_status = $${nextIndex()}`);
      values.push(deliveryStatus);
    }
    if (buyerId) {
      clauses.push(`o.buyer_id = $${nextIndex()}`);
      values.push(buyerId);
    }
    if (fromDate) {
      clauses.push(`o.created_at >= $${nextIndex()}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`o.created_at <= $${nextIndex()}`);
      values.push(toDate);
    }
    if (search) {
      const placeholder = nextIndex();
      clauses.push(`(o.order_number ILIKE $${placeholder} OR o.id::text ILIKE $${placeholder})`);
      values.push(`%${search}%`);
    }
  }

  async listOrders(filters = {}) {
    const values = [];
    const clauses = [];
    let index = 1;

    if (filters.sellerId) {
      clauses.push(`EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.seller_id = $${index++}
      )`);
      values.push(filters.sellerId);
    }
    this.applyOrderFilters(clauses, values, filters, () => index++);

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(Number(filters.limit || 50), Number(filters.offset || 0));

    const { rows } = await postgresPool.query(
      `SELECT o.*
       FROM orders o
       ${whereSql}
       ORDER BY o.created_at DESC
       LIMIT $${index++}
       OFFSET $${index}`,
      values,
    );
    return rows;
  }

  async listOrdersForAdmin(filters = {}) {
    const orders = await this.listOrders(filters);
    return this.attachOrderRelations(orders);
  }

  async attachOrderRelations(orders, options = {}) {
    const {
      includeItems = true,
      includeTimeline = false,
      includeNotes = false,
      includePayments = true,
      includeTax = true,
      includeDelivery = true,
      includeWallet = true,
      includeUsers = true,
    } = options;

    if (!Array.isArray(orders) || !orders.length) {
      return orders;
    }

    const orderIds = orders.map((order) => order.id).filter(Boolean);
    if (!orderIds.length) {
      return orders;
    }

    const [
      items,
      timeline,
      notes,
      payments,
      invoices,
      shipments,
      eWayBills,
      walletTransactions,
    ] = await Promise.all([
      includeItems
        ? knex("order_items").whereIn("order_id", orderIds).orderBy("id", "asc")
        : Promise.resolve([]),
      includeTimeline
        ? knex("order_status_history").whereIn("order_id", orderIds).orderBy("created_at", "asc")
        : Promise.resolve([]),
      includeNotes
        ? knex("order_notes").whereIn("order_id", orderIds).orderBy("created_at", "desc")
        : Promise.resolve([]),
      includePayments
        ? knex("payments").whereIn("order_id", orderIds).orderBy("created_at", "desc")
        : Promise.resolve([]),
      includeTax
        ? this.optionalTableRows("tax_invoices", (query) => query.whereIn("order_id", orderIds).orderBy("created_at", "desc"))
        : Promise.resolve([]),
      includeDelivery
        ? this.optionalTableRows("shipments", (query) => query.whereIn("order_id", orderIds).orderBy("created_at", "desc"))
        : Promise.resolve([]),
      includeDelivery
        ? this.optionalTableRows("e_way_bill_details", (query) => query.whereIn("order_id", orderIds).orderBy("created_at", "desc"))
        : Promise.resolve([]),
      includeWallet
        ? this.optionalTableRows("wallet_transactions", (query) => query.where("reference_type", "order").whereIn("reference_id", orderIds).orderBy("created_at", "desc"))
        : Promise.resolve([]),
    ]);

    const trackingEvents = includeDelivery && shipments.length
      ? await this.optionalTableRows("shipment_tracking_events", (query) => query
        .whereIn("shipment_id", shipments.map((shipment) => shipment.id))
        .orderBy("event_time", "asc"))
      : [];

    const usersById = includeUsers
      ? await this.findOrderUsers(orders, items)
      : new Map();

    const grouped = {
      items: this.groupBy(items, "order_id"),
      timeline: this.groupBy(timeline, "order_id"),
      notes: this.groupBy(notes, "order_id"),
      payments: this.groupBy(payments, "order_id"),
      invoices: this.groupBy(invoices, "order_id"),
      shipments: this.groupBy(shipments, "order_id"),
      eWayBills: this.groupBy(eWayBills, "order_id"),
      walletTransactions: this.groupBy(walletTransactions, "reference_id"),
      trackingEvents: this.groupBy(trackingEvents, "shipment_id"),
    };

    return orders.map((order) => {
      const orderItems = grouped.items.get(order.id) || [];
      const orderShipments = (grouped.shipments.get(order.id) || []).map((shipment) => ({
        ...shipment,
        trackingEvents: grouped.trackingEvents.get(shipment.id) || [],
      }));
      const sellerIds = [...new Set(orderItems.map((item) => item.seller_id).filter(Boolean))];
      const sellers = sellerIds.map((sellerId) => usersById.get(String(sellerId)) || { id: sellerId }).filter(Boolean);
      const sellerSettlements = this.buildSellerSettlements(orderItems, sellers);
      const summary = this.buildOrderSummary(order, orderItems, sellerSettlements);

      return {
        ...order,
        summary,
        ...(includeItems ? { items: orderItems } : {}),
        ...(includeTimeline ? { timeline: grouped.timeline.get(order.id) || [] } : {}),
        ...(includeNotes ? { notes: grouped.notes.get(order.id) || [] } : {}),
        relations: {
          buyer: usersById.get(String(order.buyer_id)) || { id: order.buyer_id },
          sellers,
          sellerSettlements,
          payments: grouped.payments.get(order.id) || [],
          invoice: (grouped.invoices.get(order.id) || [])[0] || null,
          invoices: grouped.invoices.get(order.id) || [],
          shipments: orderShipments,
          eWayBill: (grouped.eWayBills.get(order.id) || [])[0] || null,
          walletTransactions: grouped.walletTransactions.get(order.id) || [],
        },
      };
    });
  }

  money(value) {
    return Number(value || 0);
  }

  parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value;
  }

  buildOrderSummary(order = {}, items = [], sellerSettlements = []) {
    const taxBreakup = this.parseJson(order.tax_breakup, {});
    const itemAmount = items.reduce((sum, item) => sum + this.money(item.line_total), 0);
    const platformFeeAmount = this.money(order.platform_fee_amount);
    const sellerPayoutAmount = sellerSettlements.reduce((sum, seller) => sum + this.money(seller.sellerPayoutAmount), 0);

    return {
      itemAmount: Number(itemAmount.toFixed(2)),
      subtotalAmount: this.money(order.subtotal_amount),
      discountAmount: this.money(order.discount_amount),
      walletDiscountAmount: this.money(order.wallet_discount_amount),
      taxAmount: this.money(order.tax_amount),
      taxIncludedAmount: this.money(taxBreakup.taxIncludedAmount),
      taxPayableAmount: this.money(taxBreakup.taxPayableAmount),
      platformFeeAmount,
      codChargeAmount: this.money(order.cod_charge_amount),
      customerTotalAmount: this.money(order.total_amount),
      customerPayableAmount: this.money(order.payable_amount),
      sellerPayoutAmount: Number(sellerPayoutAmount.toFixed(2)),
      platformFeeChargedToCustomer: false,
    };
  }

  buildSellerSettlements(items = [], sellers = []) {
    const sellerNames = new Map(
      sellers.map((seller) => [
        String(seller.id),
        seller.sellerProfile?.displayName ||
          seller.sellerProfile?.businessName ||
          seller.profile?.name ||
          seller.email ||
          seller.id,
      ]),
    );

    const grouped = new Map();
    for (const item of items) {
      const sellerId = String(item.seller_id || "platform");
      const taxBreakup = this.parseJson(item.tax_breakup, {});
      const pricing = this.parseJson(item.pricing_snapshot, {});
      const current = grouped.get(sellerId) || {
        sellerId,
        sellerName: sellerNames.get(sellerId) || sellerId,
        grossSalesAmount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        platformFeeAmount: 0,
        sellerPayoutAmount: 0,
      };

      const lineTotal = this.money(item.line_total);
      const taxableAmount = this.money(taxBreakup.taxableAmount ?? item.line_total);
      const platformFeeAmount = this.money(item.platform_fee_amount || pricing.platformFeeAmount);
      const taxAmount = item.tax_amount !== undefined && item.tax_amount !== null
        ? this.money(item.tax_amount)
        : this.money(taxBreakup.taxAmount) + this.money(taxBreakup.cessAmount);

      current.grossSalesAmount += lineTotal;
      current.taxableAmount += taxableAmount;
      current.taxAmount += taxAmount;
      current.platformFeeAmount += platformFeeAmount;
      current.sellerPayoutAmount += Math.max(0, taxableAmount - platformFeeAmount);
      grouped.set(sellerId, current);
    }

    return [...grouped.values()].map((seller) => ({
      ...seller,
      grossSalesAmount: Number(seller.grossSalesAmount.toFixed(2)),
      taxableAmount: Number(seller.taxableAmount.toFixed(2)),
      taxAmount: Number(seller.taxAmount.toFixed(2)),
      platformFeeAmount: Number(seller.platformFeeAmount.toFixed(2)),
      sellerPayoutAmount: Number(seller.sellerPayoutAmount.toFixed(2)),
    }));
  }

  async optionalTableRows(tableName, buildQuery) {
    try {
      return await buildQuery(knex(tableName));
    } catch (error) {
      if (error?.code === "42P01") {
        return [];
      }
      throw error;
    }
  }

  async findOrderUsers(orders, items) {
    const ids = new Set();
    orders.forEach((order) => {
      if (order.buyer_id) ids.add(String(order.buyer_id));
    });
    items.forEach((item) => {
      if (item.seller_id) ids.add(String(item.seller_id));
    });

    const objectIds = [...ids].filter((id) => UserModel.db.base.Types.ObjectId.isValid(id));
    if (!objectIds.length) {
      return new Map();
    }

    const users = await UserModel.find({ _id: { $in: objectIds } })
      .select("email phone role profile sellerProfile accountStatus ownerSellerId parentSellerId")
      .lean();

    return new Map(users.map((user) => [String(user._id), this.toUserSummary(user)]));
  }

  toUserSummary(user) {
    const sellerProfile = user.sellerProfile || {};
    return {
      id: String(user._id),
      email: user.email || null,
      phone: user.phone || null,
      role: user.role || null,
      profile: user.profile || {},
      accountStatus: user.accountStatus || null,
      ownerSellerId: user.ownerSellerId || null,
      parentSellerId: user.parentSellerId || null,
      sellerProfile: {
        displayName: sellerProfile.displayName || null,
        businessName: sellerProfile.businessName || null,
        legalBusinessName: sellerProfile.legalBusinessName || null,
        supportEmail: sellerProfile.supportEmail || null,
        supportPhone: sellerProfile.supportPhone || null,
        kycStatus: sellerProfile.kycStatus || null,
        bankVerificationStatus: sellerProfile.bankVerificationStatus || null,
        goLiveStatus: sellerProfile.goLiveStatus || null,
      },
    };
  }

  groupBy(rows, key) {
    const grouped = new Map();
    rows.forEach((row) => {
      const groupKey = row[key];
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey).push(row);
    });
    return grouped;
  }

  async addNote(orderId, payload) {
    const [note] = await knex("order_notes")
      .insert({
        id: uuidv4(),
        order_id: orderId,
        actor_id: payload.actorId || null,
        actor_role: payload.actorRole || null,
        visibility: payload.visibility || "internal",
        note: payload.note,
      })
      .returning("*");
    return note || null;
  }

  async insertStatusHistory(client, payload) {
    await client("order_status_history").insert({
      id: uuidv4(),
      order_id: payload.orderId,
      from_status: payload.fromStatus || null,
      to_status: payload.toStatus,
      actor_id: payload.actorId || null,
      actor_role: payload.actorRole || null,
      reason: payload.reason || null,
      note: payload.note || null,
      metadata: this.jsonb(payload.metadata),
    });
  }
}

module.exports = { OrderRepository };
