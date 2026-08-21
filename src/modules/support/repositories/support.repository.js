const { knex } = require("../../../infrastructure/postgres/postgres-client");

const TABLE_NAME = "support_queries";

class SupportRepository {
  parseJson(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  rowToQuery(row = {}) {
    if (!row || !row.id) return null;
    const message = row.message || "";
    const metadata = this.parseJson(row.metadata, {});
    return {
      id: row.id,
      queryId: row.query_id,
      userId: row.user_id,
      requesterId: row.requester_id || null,
      userType: row.user_type,
      userName: row.user_name || null,
      userEmail: row.user_email || null,
      userPhone: row.user_phone || null,
      sellerOrganizationId: row.seller_organization_id || null,
      sellerOrganizationName: row.seller_organization_name || null,
      category: row.category,
      subject: row.subject,
      message,
      messagePreview: message.length > 140 ? `${message.slice(0, 137)}...` : message,
      status: row.status,
      priority: row.priority || "normal",
      attachmentUrls: this.parseJson(row.attachment_urls, []),
      metadata,
      messages: Array.isArray(metadata.messages) ? metadata.messages : [],
      statusHistory: Array.isArray(metadata.statusHistory) ? metadata.statusHistory : [],
      lastStatusChangedBy: row.last_status_changed_by || null,
      lastStatusChangedAt: row.last_status_changed_at || null,
      adminNotes: row.admin_notes || null,
      resolvedAt: row.resolved_at || null,
      closedAt: row.closed_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  jsonb(value, fallback) {
    const normalized = value === undefined ? fallback : value;
    return knex.raw("?::jsonb", [JSON.stringify(normalized ?? fallback)]);
  }

  async create(payload = {}) {
    const [row] = await knex(TABLE_NAME)
      .insert({
        query_id: payload.queryId,
        user_id: payload.userId,
        requester_id: payload.requesterId || null,
        user_type: payload.userType,
        user_name: payload.userName || null,
        user_email: payload.userEmail || null,
        user_phone: payload.userPhone || null,
        seller_organization_id: payload.sellerOrganizationId || null,
        seller_organization_name: payload.sellerOrganizationName || null,
        category: payload.category,
        subject: payload.subject,
        message: payload.message,
        status: payload.status || "pending",
        priority: payload.priority || "normal",
        attachment_urls: this.jsonb(payload.attachmentUrls, []),
        metadata: this.jsonb(payload.metadata, {}),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return this.rowToQuery(row);
  }

  applyFilters(builder, filters = {}) {
    if (filters.userType) builder.where("user_type", filters.userType);
    if (filters.userId) builder.where("user_id", String(filters.userId));
    if (filters.status) builder.where("status", filters.status);
    if (filters.category) builder.where("category", filters.category);
    if (filters.search) {
      const term = `%${String(filters.search).trim()}%`;
      builder.where((q) => {
        q.whereILike("query_id", term)
          .orWhereILike("user_name", term)
          .orWhereILike("user_email", term)
          .orWhereILike("subject", term)
          .orWhereILike("message", term);
      });
    }
  }

  async list(filters = {}) {
    const limit = Math.min(Number(filters.limit || 50), 200);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const base = knex(TABLE_NAME);
    this.applyFilters(base, filters);

    const [{ count }] = await base.clone().count({ count: "*" });
    const rows = await base
      .clone()
      .orderBy("updated_at", "desc")
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((row) => this.rowToQuery(row)),
      total: Number(count || 0),
      limit,
      offset,
    };
  }

  async findByQueryId(queryId) {
    const [row] = await knex(TABLE_NAME)
      .where("query_id", String(queryId || "").trim())
      .limit(1);
    return this.rowToQuery(row);
  }

  async addReply(queryId, payload = {}) {
    const existing = await this.findByQueryId(queryId);
    if (!existing) return null;

    const metadata = existing.metadata || {};
    const messages = Array.isArray(metadata.messages) ? metadata.messages : [];
    const createdAt = new Date().toISOString();
    const nextMessages = [
      ...messages,
      {
        message: payload.message,
        senderType: payload.senderType,
        senderId: payload.senderId || null,
        senderName: payload.senderName || null,
        createdAt,
      },
    ];

    const [row] = await knex(TABLE_NAME)
      .where("query_id", String(queryId || "").trim())
      .update({
        metadata: this.jsonb({
          ...metadata,
          messages: nextMessages,
        }, {}),
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return this.rowToQuery(row);
  }

  async findByQueryIdForUser(queryId, userType, userId) {
    const [row] = await knex(TABLE_NAME)
      .where("query_id", String(queryId || "").trim())
      .where("user_type", userType)
      .where("user_id", String(userId))
      .limit(1);
    return this.rowToQuery(row);
  }

  async updateStatus(queryId, payload = {}) {
    const existing = await this.findByQueryId(queryId);
    if (!existing) return null;
    const metadata = existing.metadata || {};
    const statusHistory = Array.isArray(metadata.statusHistory)
      ? metadata.statusHistory
      : [];
    const changedAt = new Date().toISOString();
    const nextHistory = [
      ...statusHistory,
      {
        status: payload.status,
        note: payload.adminNotes || "",
        actorId: payload.actorId || null,
        changedAt,
      },
    ];
    const update = {
      status: payload.status,
      last_status_changed_by: payload.actorId || null,
      last_status_changed_at: knex.fn.now(),
      metadata: this.jsonb({
        ...metadata,
        statusHistory: nextHistory,
      }, {}),
      updated_at: knex.fn.now(),
    };
    if (payload.adminNotes !== undefined) {
      update.admin_notes = payload.adminNotes || null;
    }
    if (payload.status === "resolved") {
      update.resolved_at = knex.fn.now();
    }
    if (payload.status === "closed") {
      update.closed_at = knex.fn.now();
    }

    const [row] = await knex(TABLE_NAME)
      .where("query_id", String(queryId || "").trim())
      .update(update)
      .returning("*");
    return this.rowToQuery(row);
  }

  async deleteByQueryId(queryId) {
    const [row] = await knex(TABLE_NAME)
      .where("query_id", String(queryId || "").trim())
      .del()
      .returning("*");
    return this.rowToQuery(row);
  }

  async deleteManyByQueryIds(queryIds = []) {
    const normalizedQueryIds = Array.from(new Set(
      (Array.isArray(queryIds) ? queryIds : [])
        .map((queryId) => String(queryId || "").trim())
        .filter(Boolean),
    ));

    if (!normalizedQueryIds.length) {
      return { deletedCount: 0, deletedQueryIds: [] };
    }

    const rows = await knex(TABLE_NAME)
      .whereIn("query_id", normalizedQueryIds)
      .del()
      .returning(["query_id"]);

    return {
      deletedCount: rows.length,
      deletedQueryIds: rows.map((row) => row.query_id).filter(Boolean),
    };
  }
}

module.exports = { SupportRepository };
