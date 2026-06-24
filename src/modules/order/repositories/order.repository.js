const { knex, postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { OutboxRepository } = require("../../../infrastructure/postgres/outbox.repository");
const { PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { DELIVERY_STATUS } = require("../../delivery/models/delivery.model");
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
        shipping_fee_amount: payload.shippingFeeAmount || payload.deliveryChargeAmount || 0,
        shipping_address: this.jsonb(payload.shippingAddress),
        coupon_code: payload.couponCode || null,
        wallet_discount_amount: payload.walletDiscountAmount || 0,
        payable_amount: payload.payableAmount ?? payload.totalAmount,
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
        organization_id: item.organizationId || null,
        store_id: item.storeId || null,
        warehouse_id: item.warehouseId || null,
        seller_snapshot: this.jsonb(item.sellerSnapshot || { sellerId: item.sellerId }),
        organization_snapshot: this.jsonb(item.organizationSnapshot || {
          organizationId: item.organizationId || null,
          sellerId: item.sellerId || null,
        }),
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_amount: item.discountAmount || 0,
        tax_amount: item.taxAmount || 0,
        tax_breakup: this.jsonb(item.taxBreakup),
        platform_fee_amount: item.platformFeeAmount || 0,
        pricing_snapshot: this.jsonb(item.pricingSnapshot),
        product_snapshot: this.jsonb(item.productSnapshot),
        deal_id: item.dealId || null,
        deal_snapshot: this.jsonb(item.dealSnapshot),
        fulfillment_snapshot: this.jsonb(item.fulfillmentSnapshot),
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
    if (filters.organizationId) {
      clauses.push(`oi.organization_id = $${index++}::uuid`);
      values.push(filters.organizationId);
    }
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

  async hasBuyerPurchasedProduct(buyerId, productId, orderId) {
    const { rows } = await postgresPool.query(
      `SELECT 1
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.buyer_id = $1
         AND oi.product_id = $2
         AND o.id = $3
         AND o.status IN ('delivered', 'completed')
       LIMIT 1`,
      [buyerId, productId, orderId],
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

  advanceShipmentStatus(currentStatus, requestedStatus) {
    if (!requestedStatus) return currentStatus || "initiated";
    if (!currentStatus) return requestedStatus;
    if (currentStatus === "delivered_verified") return currentStatus;
    const rank = new Map([
      ["initiated", 1],
      ["manifested", 2],
      ["picked_up", 3],
      ["in_transit", 4],
      ["out_for_delivery", 5],
      ["delivered", 6],
      ["delivered_verified", 7],
    ]);
    return (rank.get(requestedStatus) || 0) >= (rank.get(currentStatus) || 0)
      ? requestedStatus
      : currentStatus;
  }

  async createShipment(payload = {}) {
    if (!payload.orderId || !payload.sellerId) return null;

    const trx = await knex.transaction();
    try {
      const [existing] = await trx("shipments")
        .where("order_id", payload.orderId)
        .where("seller_id", String(payload.sellerId))
        .modify((builder) => {
          if (payload.organizationId) builder.where("organization_id", payload.organizationId);
          else builder.whereNull("organization_id");
        })
        .where((builder) => {
          builder.where("direction", "forward").orWhereNull("direction");
        })
        .orderBy("created_at", "desc")
        .limit(1)
        .forUpdate();

      const requestedStatus = payload.status || "initiated";
      const trackingNumber = payload.trackingNumber || payload.awbNumber || null;
      const courierName = payload.carrierName || payload.courierName || payload.provider || null;
      const now = new Date();

      if (existing) {
        const nextStatus = this.advanceShipmentStatus(existing.status, requestedStatus);
        const shouldWriteEvent = nextStatus !== existing.status;
        const [updated] = await trx("shipments")
          .where("id", existing.id)
          .update({
            status: nextStatus,
            provider: payload.provider || existing.provider || "manual",
            courier_name: courierName || existing.courier_name,
            awb_number: trackingNumber || existing.awb_number,
            tracking_number: trackingNumber || existing.tracking_number,
            organization_snapshot:
              payload.organizationSnapshot || existing.organization_snapshot || {},
            ship_to_snapshot: payload.shipToSnapshot || existing.ship_to_snapshot || {},
            verification_required:
              payload.verificationRequired === undefined
                ? existing.verification_required
                : Boolean(payload.verificationRequired),
            verification_methods:
              payload.verificationMethods === undefined
                ? existing.verification_methods
                : payload.verificationMethods || [],
            metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [
              JSON.stringify({
                ...(payload.metadata || {}),
                ...(payload.carrierUrl ? { carrierUrl: payload.carrierUrl } : {}),
              }),
            ]),
            updated_by: payload.updatedBy || payload.createdBy || existing.updated_by,
            updated_at: knex.fn.now(),
          })
          .returning("*");

        if (shouldWriteEvent) {
          await trx("shipment_tracking_events").insert({
            id: uuidv4(),
            shipment_id: existing.id,
            order_id: payload.orderId,
            status: nextStatus,
            event_time: payload.eventTime || now,
            location: payload.location || null,
            note: payload.note || `Order moved to ${payload.orderStatus || nextStatus}`,
            source: payload.source || "order_status_sync",
            raw_payload: payload.rawPayload || {},
            actor_id: payload.createdBy || payload.updatedBy || null,
            idempotency_key: payload.idempotencyKey
              ? `${payload.idempotencyKey}:${nextStatus}`
              : null,
          }).catch((error) => {
            if (!String(error?.message || "").includes("duplicate")) throw error;
          });
        }

        await trx.commit();
        return updated || null;
      }

      const id = uuidv4();
      const [row] = await trx("shipments")
        .insert({
          id,
          order_id: payload.orderId,
          seller_id: String(payload.sellerId),
          organization_id: payload.organizationId || null,
          organization_snapshot: payload.organizationSnapshot || {},
          provider: payload.provider || "manual",
          courier_name: courierName,
          awb_number: trackingNumber,
          tracking_number: trackingNumber,
          status: requestedStatus,
          shipping_mode: payload.shippingMode || "standard",
          cod: Boolean(payload.cod),
          package_snapshot: payload.packageSnapshot || {},
          pickup_address_snapshot: payload.pickupAddressSnapshot || {},
          ship_to_snapshot: payload.shipToSnapshot || {},
          rate_snapshot: payload.rateSnapshot || {},
          label_data: payload.labelData || {},
          shipment_type: payload.shipmentType || "forward",
          direction: payload.direction || "forward",
          return_id: payload.returnId || null,
          deal_id: payload.dealId || null,
          fulfillment_model: payload.fulfillmentModel || null,
          verification_required: Boolean(payload.verificationRequired),
          verification_methods: payload.verificationMethods || [],
          delivery_proof_snapshot: payload.deliveryProofSnapshot || {},
          manifest_id: payload.manifestId || null,
          expected_delivery_at: payload.expectedDeliveryAt || null,
          idempotency_key: payload.idempotencyKey || null,
          metadata: {
            ...(payload.metadata || {}),
            ...(payload.carrierUrl ? { carrierUrl: payload.carrierUrl } : {}),
          },
          created_by: payload.createdBy || null,
          updated_by: payload.updatedBy || payload.createdBy || null,
          created_at: now,
          updated_at: now,
        })
        .returning("*");

      await trx("shipment_tracking_events").insert({
        id: uuidv4(),
        shipment_id: id,
        order_id: payload.orderId,
        status: requestedStatus,
        event_time: payload.eventTime || now,
        location: payload.location || null,
        note: payload.note || `Shipment created from order ${payload.orderStatus || requestedStatus}`,
        source: payload.source || "order_status_sync",
        raw_payload: payload.rawPayload || {},
        actor_id: payload.createdBy || null,
        idempotency_key: payload.idempotencyKey ? `${payload.idempotencyKey}:${requestedStatus}` : null,
      }).catch((error) => {
        if (!String(error?.message || "").includes("duplicate")) throw error;
      });

      await trx.commit();
      return row || null;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async findLatestPaymentByOrderId(orderId) {
    const [payment] = await knex("payments")
      .where("order_id", orderId)
      .orderBy("created_at", "desc")
      .limit(1);
    return payment || null;
  }

  async findRefundablePaymentByOrderId(orderId) {
    const [payment] = await knex("payments")
      .where("order_id", orderId)
      .whereIn("status", ["captured", "paid", "approved", "authorized", "completed"])
      .orderByRaw("CASE WHEN provider = 'razorpay' AND provider_payment_id IS NOT NULL THEN 0 ELSE 1 END")
      .orderBy("created_at", "desc")
      .limit(1);
    return payment || this.findLatestPaymentByOrderId(orderId);
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

  async updatePaymentsForOrderReturnRefund(orderId, payload = {}) {
    const trx = await knex.transaction();

    try {
      const payments = await trx("payments")
        .where("order_id", orderId)
        .whereNotIn("status", [PAYMENT_STATUS.CANCELLED, PAYMENT_STATUS.FAILED])
        .forUpdate();

      if (!payments.length) {
        await trx.commit();
        return [];
      }

      const updated = [];
      for (const payment of payments) {
        const existingMetadata = typeof payment.metadata === "object" && payment.metadata
          ? payment.metadata
          : {};
        const refundMetadata = payload.metadata || {};
        const [row] = await trx("payments")
          .where("id", payment.id)
          .update({
            status: payload.status || payment.status,
            metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [
              JSON.stringify({
                ...existingMetadata,
                returnRefund: {
                  ...(existingMetadata.returnRefund || {}),
                  ...refundMetadata,
                },
              }),
            ]),
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
      organizationId = null,
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
    if (organizationId && !filters.sellerId) {
      clauses.push(`EXISTS (
        SELECT 1
        FROM order_items oi_org
        WHERE oi_org.order_id = o.id
          AND oi_org.organization_id = $${nextIndex()}::uuid
      )`);
      values.push(organizationId);
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
          ${filters.organizationId ? `AND oi.organization_id = $${index++}::uuid` : ""}
      )`);
      values.push(filters.sellerId);
      if (filters.organizationId) values.push(filters.organizationId);
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
    const values = [];
    const clauses = [];
    let index = 1;

    if (filters.sellerId) {
      clauses.push(`EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.seller_id = $${index++}
          ${filters.organizationId ? `AND oi.organization_id = $${index++}::uuid` : ""}
      )`);
      values.push(filters.sellerId);
      if (filters.organizationId) values.push(filters.organizationId);
    }
    this.applyOrderFilters(clauses, values, filters, () => index++);

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sortMap = {
      createdAt: "o.created_at",
      created_at: "o.created_at",
      order_number: "o.order_number",
      orderNumber: "o.order_number",
      total_amount: "o.total_amount",
      totalAmount: "o.total_amount",
      status: "o.status",
      payment_status: "o.payment_status",
      paymentStatus: "o.payment_status",
      delivery_status: "o.delivery_status",
      deliveryStatus: "o.delivery_status",
    };
    const sortColumn = sortMap[filters.sortBy] || "o.created_at";
    const sortDirection = filters.sortDir === "asc" || filters.sortOrder === "asc" ? "ASC" : "DESC";
    const limit = Number(filters.limit || 50);
    const offset = Number(filters.offset || 0);

    const [countResult, rowsResult] = await Promise.all([
      postgresPool.query(
        `SELECT COUNT(*)::int AS total
         FROM orders o
         ${whereSql}`,
        values,
      ),
      postgresPool.query(
        `SELECT o.*
         FROM orders o
         ${whereSql}
         ORDER BY ${sortColumn} ${sortDirection}
         LIMIT $${index++}
         OFFSET $${index}`,
        [...values, limit, offset],
      ),
    ]);

    const orders = await this.attachOrderRelations(rowsResult.rows);
    return {
      items: orders,
      total: Number(countResult.rows?.[0]?.total || 0),
      limit,
      offset,
    };
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
      cancellations,
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
      this.optionalTableRows("order_cancellations", (query) => query.whereIn("order_id", orderIds).orderBy("created_at", "desc")),
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
      cancellations: this.groupBy(cancellations, "order_id"),
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
      const sellerSettlements = this.buildSellerSettlements(orderItems, sellers, order);
      const summary = this.buildOrderSummary(order, orderItems, sellerSettlements);
      const sellerFulfillmentGroups = this.buildSellerFulfillmentGroups(
        order,
        orderItems,
        sellers,
        sellerSettlements,
        orderShipments,
      );

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
          sellerFulfillmentGroups,
          eWayBill: (grouped.eWayBills.get(order.id) || [])[0] || null,
          walletTransactions: grouped.walletTransactions.get(order.id) || [],
          cancellations: grouped.cancellations.get(order.id) || [],
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
    const metadata = this.parseJson(order.metadata, {});
    const itemAmount = items.reduce((sum, item) => sum + this.money(item.line_total), 0);
    const platformFeeAmount = this.money(order.platform_fee_amount);
    const shippingFeeAmount = this.money(
      order.shipping_fee_amount ??
      metadata.pricingSummary?.shippingFeeAmount ??
      metadata.pricingSummary?.deliveryChargeAmount,
    );
    const sellerPayoutAmount = sellerSettlements.reduce((sum, seller) => sum + this.money(seller.sellerPayoutAmount), 0);
    const sellerPlatformFeeAmount = this.money(metadata.pricingSummary?.sellerPlatformFeeAmount ?? platformFeeAmount);
    const customerPlatformFeeAmount = this.money(metadata.pricingSummary?.customerPlatformFeeAmount);
    const customerPlatformFeeTaxAmount = this.money(metadata.pricingSummary?.customerPlatformFeeTaxAmount);

    return {
      itemAmount: Number(itemAmount.toFixed(2)),
      subtotalAmount: this.money(order.subtotal_amount),
      discountAmount: this.money(order.discount_amount),
      walletDiscountAmount: this.money(order.wallet_discount_amount),
      taxAmount: this.money(order.tax_amount),
      taxIncludedAmount: this.money(taxBreakup.taxIncludedAmount),
      taxPayableAmount: this.money(taxBreakup.taxPayableAmount),
      platformFeeAmount,
      sellerPlatformFeeAmount,
      customerPlatformFeeAmount,
      customerPlatformFeeTaxAmount,
      codChargeAmount: this.money(order.cod_charge_amount),
      deliveryChargeAmount: shippingFeeAmount,
      shippingFeeAmount,
      customerTotalAmount: this.money(order.total_amount),
      customerPayableAmount: this.money(order.payable_amount),
      sellerPayoutAmount: Number(sellerPayoutAmount.toFixed(2)),
      platformFeeChargedToCustomer: customerPlatformFeeAmount > 0,
    };
  }

  buildSellerSettlements(items = [], sellers = [], order = {}) {
    const orderMetadata = this.parseJson(order.metadata, {});
    const shippingPolicy = orderMetadata.commerceSettings?.finance?.shippingPolicy || "not_in_seller_payout";
    const deliveryChargeSellers = Array.isArray(orderMetadata.deliveryCharge?.sellers)
      ? orderMetadata.deliveryCharge.sellers
      : [];
    const deliveryBySeller = new Map(
      deliveryChargeSellers.map((seller) => [
        String(seller.sellerId),
        this.money(seller.chargeAmount),
      ]),
    );
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
      const organizationId = item.organization_id ? String(item.organization_id) : null;
      const organizationSnapshot = this.parseJson(item.organization_snapshot, {});
      const key = `${sellerId}:${organizationId || "default"}`;
      const taxBreakup = this.parseJson(item.tax_breakup, {});
      const pricing = this.parseJson(item.pricing_snapshot, {});
      const current = grouped.get(key) || {
        sellerId,
        organizationId,
        sellerName: sellerNames.get(sellerId) || sellerId,
        organizationSnapshot,
        grossSalesAmount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        platformFeeAmount: 0,
        sellerPayoutAmount: 0,
      };

      const lineTotal = this.money(item.line_total);
      const taxableAmount = this.money(taxBreakup.taxableAmount ?? item.line_total);
      const platformFeeAmount = this.money(item.platform_fee_amount || pricing.platformFeeAmount);
      const platformFeeTaxAmount = this.money(pricing.platformFeeTaxAmount);
      const sellerPayoutBaseAmount = this.money(pricing.sellerPayoutBaseAmount || lineTotal - this.money(item.discount_amount));
      const taxAmount = item.tax_amount !== undefined && item.tax_amount !== null
        ? this.money(item.tax_amount)
        : this.money(taxBreakup.taxAmount) + this.money(taxBreakup.cessAmount);

      current.grossSalesAmount += lineTotal;
      current.taxableAmount += taxableAmount;
      current.taxAmount += taxAmount;
      current.platformFeeAmount += platformFeeAmount;
      current.platformFeeTaxAmount = this.money(current.platformFeeTaxAmount) + platformFeeTaxAmount;
      current.sellerPayoutBaseAmount = this.money(current.sellerPayoutBaseAmount) + sellerPayoutBaseAmount;
      current.productTaxLiabilityAmount = this.money(current.productTaxLiabilityAmount) + taxAmount;
      current.sellerPayoutAmount += Math.max(0, sellerPayoutBaseAmount - platformFeeAmount - platformFeeTaxAmount);
      grouped.set(key, current);
    }

    return [...grouped.values()].map((seller) => {
      const sellerDeliveryChargeAmount = this.money(deliveryBySeller.get(String(seller.sellerId)));
      const shippingReimbursementAmount = shippingPolicy === "reimburse_seller" ? sellerDeliveryChargeAmount : 0;
      const shippingDeductionAmount = shippingPolicy === "deduct_from_seller" ? sellerDeliveryChargeAmount : 0;
      const sellerPayoutAmount = Math.max(
        0,
        seller.sellerPayoutAmount + shippingReimbursementAmount - shippingDeductionAmount,
      );

      return {
        ...seller,
        grossSalesAmount: Number(seller.grossSalesAmount.toFixed(2)),
        sellerPayoutBaseAmount: Number(this.money(seller.sellerPayoutBaseAmount).toFixed(2)),
        taxableAmount: Number(seller.taxableAmount.toFixed(2)),
        taxAmount: Number(seller.taxAmount.toFixed(2)),
        platformFeeAmount: Number(seller.platformFeeAmount.toFixed(2)),
        platformFeeTaxAmount: Number(this.money(seller.platformFeeTaxAmount).toFixed(2)),
        productTaxLiabilityAmount: Number(this.money(seller.productTaxLiabilityAmount).toFixed(2)),
        sellerDeliveryChargeAmount: Number(sellerDeliveryChargeAmount.toFixed(2)),
        shippingReimbursementAmount: Number(shippingReimbursementAmount.toFixed(2)),
        shippingDeductionAmount: Number(shippingDeductionAmount.toFixed(2)),
        shippingPolicy,
        sellerPayoutAmount: Number(sellerPayoutAmount.toFixed(2)),
      };
    });
  }

  buildSellerFulfillmentGroups(order = {}, items = [], sellers = [], sellerSettlements = [], shipments = []) {
    const metadata = this.parseJson(order.metadata, {});
    const returnLifecycle = metadata.returnLifecycle || {};
    const sellerNames = new Map(
      sellers.map((seller) => [
        String(seller.id || seller._id || ""),
        seller.sellerProfile?.displayName ||
          seller.sellerProfile?.businessName ||
          seller.profile?.name ||
          seller.email ||
          seller.id,
      ]),
    );
    const groupKey = (sellerId, organizationId = null) => `${String(sellerId)}:${organizationId || "default"}`;
    const settlementsByGroup = new Map(
      sellerSettlements.map((settlement) => [
        groupKey(settlement.sellerId, settlement.organizationId),
        settlement,
      ]),
    );
    const itemsByGroup = new Map();
    const shipmentsByGroup = new Map();

    for (const item of items) {
      const sellerId = String(item.seller_id || item.sellerId || "platform");
      const organizationId = item.organization_id || item.organizationId || null;
      const key = groupKey(sellerId, organizationId);
      if (!itemsByGroup.has(key)) {
        itemsByGroup.set(key, { sellerId, organizationId, items: [] });
      }
      itemsByGroup.get(key).items.push(item);
    }

    for (const shipment of shipments) {
      const sellerId = String(shipment.seller_id || shipment.sellerId || "platform");
      const organizationId = shipment.organization_id || shipment.organizationId || null;
      const key = groupKey(sellerId, organizationId);
      if (!shipmentsByGroup.has(key)) {
        shipmentsByGroup.set(key, { sellerId, organizationId, shipments: [] });
      }
      shipmentsByGroup.get(key).shipments.push(shipment);
    }

    const groupKeys = new Set([
      ...itemsByGroup.keys(),
      ...shipmentsByGroup.keys(),
      ...settlementsByGroup.keys(),
    ]);

    return [...groupKeys].map((key) => {
      const itemGroup = itemsByGroup.get(key) || {};
      const shipmentGroup = shipmentsByGroup.get(key) || {};
      const settlement = settlementsByGroup.get(key) || null;
      const [sellerId, organizationKey] = key.split(":");
      const organizationId = itemGroup.organizationId || shipmentGroup.organizationId || settlement?.organizationId || (organizationKey === "default" ? null : organizationKey);
      const sellerItems = itemGroup.items || [];
      const sellerShipments = shipmentGroup.shipments || [];
      const forwardShipments = sellerShipments.filter((shipment) => this.isForwardShipment(shipment));
      const reverseShipments = sellerShipments.filter((shipment) => !this.isForwardShipment(shipment));
      const deliveryStatus = this.resolveSellerDeliveryStatus(forwardShipments, order);
      const deliveredShipmentCount = forwardShipments.filter((shipment) =>
        this.isDeliveredShipmentStatus(shipment.status),
      ).length;
      const requiresVerification = forwardShipments.some((shipment) => Boolean(shipment.verification_required));
      const verificationComplete = requiresVerification
        ? forwardShipments.every((shipment) =>
            !shipment.verification_required || shipment.status === DELIVERY_STATUS.DELIVERED_VERIFIED,
          )
        : null;
      const latestTrackingEvent = this.latestTrackingEvent(forwardShipments);
      const sellerReturnLifecycle = this.resolveSellerReturnLifecycle(returnLifecycle, sellerId, order);

      return {
        sellerId,
        organizationId,
        organizationSnapshot: this.parseJson(sellerItems[0]?.organization_snapshot, settlement?.organizationSnapshot || {}),
        sellerName: sellerNames.get(sellerId) || sellerId,
        orderItemIds: sellerItems.map((item) => item.id).filter(Boolean),
        itemCount: sellerItems.length,
        quantity: sellerItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        deliveryStatus,
        shipmentStatus: deliveryStatus,
        shipmentIds: sellerShipments.map((shipment) => shipment.id).filter(Boolean),
        forwardShipmentIds: forwardShipments.map((shipment) => shipment.id).filter(Boolean),
        reverseShipmentIds: reverseShipments.map((shipment) => shipment.id).filter(Boolean),
        forwardShipmentCount: forwardShipments.length,
        reverseShipmentCount: reverseShipments.length,
        deliveredShipmentCount,
        pendingShipmentCount: Math.max(forwardShipments.length - deliveredShipmentCount, 0),
        isFullyDelivered: forwardShipments.length > 0 && deliveredShipmentCount === forwardShipments.length,
        isPartiallyDelivered: deliveredShipmentCount > 0 && deliveredShipmentCount < forwardShipments.length,
        requiresVerification,
        verificationComplete,
        expectedDeliveryAt: this.resolveExpectedDeliveryAt(forwardShipments),
        latestTrackingEvent,
        latestTrackingStatus: latestTrackingEvent?.status || deliveryStatus,
        settlement,
        returnLifecycle: sellerReturnLifecycle,
      };
    });
  }

  isForwardShipment(shipment = {}) {
    const direction = String(shipment.direction || "forward");
    const shipmentType = String(shipment.shipment_type || shipment.shipmentType || "forward");
    return direction !== "reverse" && shipmentType !== "return";
  }

  isDeliveredShipmentStatus(status) {
    return [DELIVERY_STATUS.DELIVERED, DELIVERY_STATUS.DELIVERED_VERIFIED].includes(status);
  }

  resolveSellerDeliveryStatus(shipments = [], order = {}) {
    if (!shipments.length) return order.delivery_status || null;
    const statuses = shipments.map((shipment) => shipment.status).filter(Boolean);
    if (!statuses.length) return order.delivery_status || null;

    const deliveredCount = statuses.filter((status) => this.isDeliveredShipmentStatus(status)).length;
    if (deliveredCount === shipments.length) {
      return statuses.every((status) => status === DELIVERY_STATUS.DELIVERED_VERIFIED)
        ? DELIVERY_STATUS.DELIVERED_VERIFIED
        : DELIVERY_STATUS.DELIVERED;
    }
    if (deliveredCount > 0) return "partially_delivered";

    const priority = [
      DELIVERY_STATUS.FAILED,
      DELIVERY_STATUS.RTO,
      DELIVERY_STATUS.LOST,
      DELIVERY_STATUS.DAMAGED,
      DELIVERY_STATUS.OUT_FOR_DELIVERY,
      DELIVERY_STATUS.IN_TRANSIT,
      DELIVERY_STATUS.PICKED_UP,
      DELIVERY_STATUS.MANIFESTED,
      DELIVERY_STATUS.INITIATED,
      DELIVERY_STATUS.CANCELLED,
    ];
    return priority.find((status) => statuses.includes(status)) || statuses[0] || order.delivery_status || null;
  }

  latestTrackingEvent(shipments = []) {
    return shipments
      .flatMap((shipment) => shipment.trackingEvents || [])
      .sort((left, right) => {
        const rightTime = new Date(right.event_time || right.eventTime || right.created_at || 0).getTime();
        const leftTime = new Date(left.event_time || left.eventTime || left.created_at || 0).getTime();
        return rightTime - leftTime;
      })[0] || null;
  }

  resolveExpectedDeliveryAt(shipments = []) {
    const timestamps = shipments
      .map((shipment) => shipment.expected_delivery_at || shipment.expectedDeliveryAt)
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));
    if (!timestamps.length) return null;
    return new Date(Math.min(...timestamps)).toISOString();
  }

  resolveSellerReturnLifecycle(returnLifecycle = {}, sellerId, order = {}) {
    const sellerEntries = Array.isArray(returnLifecycle.sellers)
      ? returnLifecycle.sellers
      : Array.isArray(returnLifecycle.sellerBreakup)
        ? returnLifecycle.sellerBreakup
        : [];
    const sellerLifecycle = sellerEntries.find((entry) => String(entry.sellerId || entry.seller_id || "") === String(sellerId));
    if (sellerLifecycle) return sellerLifecycle;

    return {
      status: returnLifecycle.status || null,
      paymentStatus: returnLifecycle.paymentStatus || order.payment_status || null,
      refundedAmount: Number(returnLifecycle.refundedAmount || 0),
      returnedQuantity: Number(returnLifecycle.returnedQuantity || 0),
      openReturnCount: Number(returnLifecycle.openReturnCount || 0),
      completedReturnCount: Number(returnLifecycle.completedReturnCount || 0),
      returnIds: Array.isArray(returnLifecycle.returnIds) ? returnLifecycle.returnIds : [],
      updatedAt: returnLifecycle.updatedAt || null,
    };
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
