const { knex } = require("../../../infrastructure/postgres/postgres-client");

const FAQ_TABLE = "faq_entries";
const CONVERSATION_TABLE = "whatsapp_conversations";
const MESSAGE_TABLE = "whatsapp_messages";

class WhatsappFaqRepository {
  jsonb(value, fallback) {
    return knex.raw("?::jsonb", [JSON.stringify(value === undefined ? fallback : value)]);
  }

  parseJson(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  rowToFaq(row = {}) {
    if (!row?.id) return null;
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      category: row.category,
      tags: this.parseJson(row.tags, []),
      status: row.status,
      metadata: this.parseJson(row.metadata, {}),
      rank: row.rank !== undefined ? Number(row.rank || 0) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  rowToConversation(row = {}) {
    if (!row?.id) return null;
    return {
      id: row.id,
      customerPhoneHash: row.customer_phone_hash,
      customerPhoneMasked: row.customer_phone_masked,
      provider: row.provider,
      lastMessageAt: row.last_message_at,
      metadata: this.parseJson(row.metadata, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async searchFaqs(query, { limit = 5 } = {}) {
    const text = String(query || "").trim();
    if (!text) return [];

    const rows = await knex(FAQ_TABLE)
      .select("*")
      .select(
        knex.raw(
          "ts_rank_cd(to_tsvector('simple', coalesce(question, '') || ' ' || coalesce(answer, '') || ' ' || coalesce(category, '') || ' ' || coalesce(tags::text, '')), plainto_tsquery('simple', ?)) as rank",
          [text],
        ),
      )
      .where("status", "active")
      .whereRaw(
        "to_tsvector('simple', coalesce(question, '') || ' ' || coalesce(answer, '') || ' ' || coalesce(category, '') || ' ' || coalesce(tags::text, '')) @@ plainto_tsquery('simple', ?)",
        [text],
      )
      .orderBy("rank", "desc")
      .orderBy("updated_at", "desc")
      .limit(Math.min(Number(limit || 5), 10));

    return rows.map((row) => this.rowToFaq(row));
  }

  async listFaqs({ status, category, search, limit = 50, offset = 0 } = {}) {
    const base = knex(FAQ_TABLE);
    if (status) base.where("status", status);
    if (category) base.whereILike("category", `%${String(category).trim()}%`);
    if (search) {
      const term = `%${String(search).trim()}%`;
      base.where((q) => q.whereILike("question", term).orWhereILike("answer", term));
    }
    const [{ count }] = await base.clone().count({ count: "*" });
    const rows = await base
      .clone()
      .orderBy("updated_at", "desc")
      .limit(Math.min(Number(limit || 50), 200))
      .offset(Math.max(Number(offset || 0), 0));
    return { items: rows.map((row) => this.rowToFaq(row)), total: Number(count || 0) };
  }

  async createFaq(payload = {}) {
    const [row] = await knex(FAQ_TABLE)
      .insert({
        question: payload.question,
        answer: payload.answer,
        category: payload.category || "general",
        tags: this.jsonb(payload.tags || [], []),
        status: payload.status || "active",
        metadata: this.jsonb(payload.metadata || {}, {}),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return this.rowToFaq(row);
  }

  async upsertConversation({ customerPhoneHash, customerPhoneMasked, provider = "apitxt" }) {
    const [row] = await knex(CONVERSATION_TABLE)
      .insert({
        customer_phone_hash: customerPhoneHash,
        customer_phone_masked: customerPhoneMasked,
        provider,
        last_message_at: knex.fn.now(),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .onConflict("customer_phone_hash")
      .merge({ last_message_at: knex.fn.now(), updated_at: knex.fn.now() })
      .returning("*");
    return this.rowToConversation(row);
  }

  async findMessageByProviderEvent(provider, providerEventId) {
    if (!providerEventId) return null;
    const [row] = await knex(MESSAGE_TABLE).where({ provider, provider_event_id: providerEventId }).limit(1);
    return row || null;
  }

  async createMessage(payload = {}) {
    const [row] = await knex(MESSAGE_TABLE)
      .insert({
        conversation_id: payload.conversationId,
        provider: payload.provider || "apitxt",
        provider_event_id: payload.providerEventId || null,
        direction: payload.direction,
        message_type: payload.messageType || "text",
        text: payload.text || null,
        faq_entry_ids: this.jsonb(payload.faqEntryIds || [], []),
        status: payload.status || "received",
        metadata: this.jsonb(payload.metadata || {}, {}),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning("*");
    return row;
  }

  async getRecentMessages(conversationId, { limit = 6 } = {}) {
    const rows = await knex(MESSAGE_TABLE)
      .where("conversation_id", conversationId)
      .orderBy("created_at", "desc")
      .limit(Math.min(Number(limit || 6), 12));
    return rows.reverse();
  }
}

module.exports = { WhatsappFaqRepository };
