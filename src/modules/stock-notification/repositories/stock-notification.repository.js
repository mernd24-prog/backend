const { knex } = require("../../../infrastructure/postgres/postgres-client");

const TABLE_NAME = "product_stock_notifications";

class StockNotificationRepository {
  parseJson(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  jsonb(value, fallback) {
    const normalized = value === undefined ? fallback : value;
    return knex.raw("?::jsonb", [JSON.stringify(normalized ?? fallback)]);
  }

  rowToNotification(row = {}) {
    if (!row || !row.id) return null;
    return {
      id: row.id,
      userId: row.user_id || null,
      name: row.name,
      email: row.email,
      productId: row.product_id,
      variantId: row.variant_id || null,
      sellerId: row.seller_id || null,
      organizationId: row.organization_id || null,
      productTitle: row.product_title || null,
      productSlug: row.product_slug || null,
      productImage: row.product_image || null,
      variantTitle: row.variant_title || null,
      sku: row.sku || "",
      price: row.price === null || row.price === undefined ? null : Number(row.price),
      status: row.status || "pending",
      requestedAt: row.requested_at,
      notifiedAt: row.notified_at || null,
      lastEmailError: row.last_email_error || null,
      metadata: this.parseJson(row.metadata, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsert(payload = {}) {
    const [row] = await knex(TABLE_NAME)
      .insert({
        user_id: payload.userId || null,
        name: payload.name,
        email: payload.email,
        product_id: payload.productId,
        variant_id: payload.variantId || null,
        seller_id: payload.sellerId || null,
        organization_id: payload.organizationId || null,
        product_title: payload.productTitle || null,
        product_slug: payload.productSlug || null,
        product_image: payload.productImage || null,
        variant_title: payload.variantTitle || null,
        sku: payload.sku || null,
        price: payload.price ?? null,
        status: "pending",
        requested_at: knex.fn.now(),
        notified_at: null,
        last_email_error: null,
        metadata: this.jsonb(payload.metadata, {}),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .onConflict(knex.raw("(lower(email), product_id, COALESCE(variant_id, ''))"))
      .merge({
        user_id: payload.userId || null,
        name: payload.name,
        seller_id: payload.sellerId || null,
        organization_id: payload.organizationId || null,
        product_title: payload.productTitle || null,
        product_slug: payload.productSlug || null,
        product_image: payload.productImage || null,
        variant_title: payload.variantTitle || null,
        sku: payload.sku || null,
        price: payload.price ?? null,
        status: "pending",
        requested_at: knex.fn.now(),
        notified_at: null,
        last_email_error: null,
        metadata: this.jsonb(payload.metadata, {}),
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return this.rowToNotification(row);
  }

  applyFilters(builder, filters = {}) {
    if (filters.status) {
      builder.where("status", filters.status);
    } else {
      builder.whereNotIn("status", ["notified", "cancelled"]);
    }
    if (filters.productId) builder.where("product_id", String(filters.productId));
    if (filters.variantId) builder.where("variant_id", String(filters.variantId));
    if (filters.sellerId) builder.where("seller_id", String(filters.sellerId));
    if (filters.email) builder.whereILike("email", String(filters.email).trim());
    if (filters.search) {
      const term = `%${String(filters.search).trim()}%`;
      builder.where((q) => {
        q.whereILike("name", term)
          .orWhereILike("email", term)
          .orWhereILike("product_title", term)
          .orWhereILike("product_id", term)
          .orWhereILike("sku", term);
      });
    }
  }

  async list(filters = {}) {
    const limit = Math.min(Number(filters.limit || 20), 200);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const base = knex(TABLE_NAME);
    this.applyFilters(base, filters);

    const [{ count }] = await base.clone().count({ count: "*" });
    const rows = await base
      .clone()
      .orderBy("requested_at", "desc")
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((row) => this.rowToNotification(row)),
      total: Number(count || 0),
      limit,
      offset,
    };
  }

  async findPendingForProduct(productId, variantId = null, sellerId = null) {
    const query = knex(TABLE_NAME)
      .where("product_id", String(productId))
      .whereIn("status", ["pending", "failed"]);
    if (variantId) query.where("variant_id", String(variantId));
    if (sellerId) query.where("seller_id", String(sellerId));
    const rows = await query.orderBy("requested_at", "asc");
    return rows.map((row) => this.rowToNotification(row));
  }

  async markQueued(id) {
    const [row] = await knex(TABLE_NAME)
      .where("id", id)
      .update({
        status: "queued",
        last_email_error: null,
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return this.rowToNotification(row);
  }

  async markNotified(id) {
    const [row] = await knex(TABLE_NAME)
      .where("id", id)
      .update({
        status: "notified",
        notified_at: knex.fn.now(),
        last_email_error: null,
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return this.rowToNotification(row);
  }

  async markFailed(id, error) {
    const [row] = await knex(TABLE_NAME)
      .where("id", id)
      .update({
        status: "failed",
        last_email_error: String(error || "").slice(0, 2000),
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return this.rowToNotification(row);
  }
}

module.exports = { StockNotificationRepository };
