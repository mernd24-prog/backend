const { knex, postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { OutboxRepository } = require("../../../infrastructure/postgres/outbox.repository");

class OrderRepository {
  constructor({ outboxRepository = new OutboxRepository() } = {}) {
    this.outboxRepository = outboxRepository;
  }

  async createOrder(payload, event) {
    const orderId = payload.id || uuidv4();
    const trx = await knex.transaction();

    try {
      await trx("orders").insert({
        id: orderId,
        buyer_id: payload.buyerId,
        status: payload.status,
        currency: payload.currency,
        subtotal_amount: payload.subtotalAmount,
        discount_amount: payload.discountAmount,
        tax_amount: payload.taxAmount,
        total_amount: payload.totalAmount,
        shipping_address: payload.shippingAddress,
        coupon_code: payload.couponCode || null,
        wallet_discount_amount: payload.walletDiscountAmount || 0,
        payable_amount: payload.payableAmount || payload.totalAmount,
        tax_breakup: payload.taxBreakup || {},
        platform_fee_amount: payload.platformFeeAmount || 0,
        platform_fee_breakup: payload.platformFeeBreakup || [],
      });
      const items = payload.items.map((item) => ({
        id: uuidv4(),
        order_id: orderId,
        product_id: item.productId,
        seller_id: item.sellerId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        line_total: item.lineTotal,
      }));

      await trx("order_items").insert(items);

      if (event) {
        await this.outboxRepository.enqueue(trx, {
          ...event,
          aggregateId: orderId,
        });
      }

      await trx.commit();
      return { id: orderId, ...payload };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async listOrdersByBuyer(buyerId) {
    return knex("orders").where("buyer_id", buyerId).orderBy("created_at", "desc");
  }

  async listOrdersBySeller(sellerId, productIds = null) {
    const values = [sellerId];
    const productFilter = Array.isArray(productIds)
      ? `AND oi.product_id = ANY($2::text[])`
      : "";
    if (Array.isArray(productIds)) values.push(productIds);

    const { rows } = await postgresPool.query(
      `SELECT DISTINCT o.*
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.seller_id = $1
         ${productFilter}
       ORDER BY o.created_at DESC`,
      values,
    );
    return rows;
  }

  async updateStatus(orderId, status) {
    const [order] = await knex("orders")
      .where("id", orderId)
      .update({ status })
      .returning("*");
    return order || null;
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

    const items = await knex("order_items").where("order_id", orderId).orderBy("id", "asc");
    return { ...order, items };
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

  async listOrdersForAdmin({
    status = null,
    sellerId = null,
    buyerId = null,
    fromDate = null,
    toDate = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const values = [];
    const clauses = [];
    let index = 1;

    if (status) {
      clauses.push(`o.status = $${index++}`);
      values.push(status);
    }
    if (buyerId) {
      clauses.push(`o.buyer_id = $${index++}`);
      values.push(buyerId);
    }
    if (sellerId) {
      clauses.push(`EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.seller_id = $${index++}
      )`);
      values.push(sellerId);
    }
    if (fromDate) {
      clauses.push(`o.created_at >= $${index++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`o.created_at <= $${index++}`);
      values.push(toDate);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);

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
}

module.exports = { OrderRepository };
