"use strict";

module.exports = {
  id: "053-whatsapp-ai-faq-support",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    await q("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    await queryInterface.createTable(
      "faq_entries",
      {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal("gen_random_uuid()"),
        },
        question: { type: Sequelize.TEXT, allowNull: false },
        answer: { type: Sequelize.TEXT, allowNull: false },
        category: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "general" },
        tags: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      },
      { transaction },
    );

    await q("ALTER TABLE faq_entries ADD CONSTRAINT faq_entries_status_chk CHECK (status IN ('active', 'inactive', 'draft'));");
    await q("CREATE INDEX idx_faq_entries_status ON faq_entries (status);");
    await q("CREATE INDEX idx_faq_entries_category ON faq_entries (category);");
    await q(`
      CREATE INDEX idx_faq_entries_search ON faq_entries USING GIN (
        to_tsvector('simple', coalesce(question, '') || ' ' || coalesce(answer, '') || ' ' || coalesce(category, '') || ' ' || coalesce(tags::text, ''))
      );
    `);

    await queryInterface.createTable(
      "whatsapp_conversations",
      {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal("gen_random_uuid()"),
        },
        customer_phone_hash: { type: Sequelize.STRING(128), allowNull: false, unique: true },
        customer_phone_masked: { type: Sequelize.STRING(40), allowNull: false },
        provider: { type: Sequelize.STRING(40), allowNull: false, defaultValue: "apitxt" },
        last_message_at: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      },
      { transaction },
    );

    await q("CREATE INDEX idx_whatsapp_conversations_last_message ON whatsapp_conversations (last_message_at DESC);");

    await queryInterface.createTable(
      "whatsapp_messages",
      {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal("gen_random_uuid()"),
        },
        conversation_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: "whatsapp_conversations", key: "id" },
          onDelete: "CASCADE",
        },
        provider: { type: Sequelize.STRING(40), allowNull: false, defaultValue: "apitxt" },
        provider_event_id: { type: Sequelize.STRING(160), allowNull: true },
        direction: { type: Sequelize.STRING(16), allowNull: false },
        message_type: { type: Sequelize.STRING(40), allowNull: false, defaultValue: "text" },
        text: { type: Sequelize.TEXT, allowNull: true },
        faq_entry_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: "received" },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      },
      { transaction },
    );

    await q("ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_direction_chk CHECK (direction IN ('inbound', 'outbound'));");
    await q("CREATE UNIQUE INDEX idx_whatsapp_messages_provider_event ON whatsapp_messages (provider, provider_event_id) WHERE provider_event_id IS NOT NULL;");
    await q("CREATE INDEX idx_whatsapp_messages_conversation_created ON whatsapp_messages (conversation_id, created_at DESC);");
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("whatsapp_messages", { transaction }).catch(() => {});
    await queryInterface.dropTable("whatsapp_conversations", { transaction }).catch(() => {});
    await queryInterface.dropTable("faq_entries", { transaction }).catch(() => {});
  },
};
