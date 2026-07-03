"use strict";

module.exports = {
  id: "039-support-queries",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    await q("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    const [tables] = await queryInterface.sequelize.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_queries'",
      { transaction },
    );

    if (tables.length) return;

    await queryInterface.createTable(
      "support_queries",
      {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal("gen_random_uuid()"),
        },
        query_id: {
          type: Sequelize.STRING(40),
          allowNull: false,
          unique: true,
        },
        user_id: {
          type: Sequelize.STRING(128),
          allowNull: false,
        },
        requester_id: {
          type: Sequelize.STRING(128),
          allowNull: true,
        },
        user_type: {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        user_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        user_email: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        user_phone: {
          type: Sequelize.STRING(40),
          allowNull: true,
        },
        seller_organization_id: {
          type: Sequelize.UUID,
          allowNull: true,
        },
        seller_organization_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        category: {
          type: Sequelize.STRING(80),
          allowNull: false,
        },
        subject: {
          type: Sequelize.STRING(220),
          allowNull: false,
        },
        message: {
          type: Sequelize.TEXT,
          allowNull: false,
        },
        status: {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: "pending",
        },
        priority: {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: "normal",
        },
        attachment_urls: {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: [],
        },
        metadata: {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
        },
        last_status_changed_by: {
          type: Sequelize.STRING(128),
          allowNull: true,
        },
        last_status_changed_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        admin_notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        resolved_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        closed_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("NOW"),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("NOW"),
        },
      },
      { transaction },
    );

    await q("ALTER TABLE support_queries ADD CONSTRAINT support_queries_user_type_chk CHECK (user_type IN ('customer', 'seller'));");
    await q("ALTER TABLE support_queries ADD CONSTRAINT support_queries_status_chk CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed'));");
    await q("CREATE INDEX idx_support_queries_user_scope ON support_queries (user_type, user_id, created_at DESC);");
    await q("CREATE INDEX idx_support_queries_status ON support_queries (status, created_at DESC);");
    await q("CREATE INDEX idx_support_queries_category ON support_queries (category);");
    await q("CREATE INDEX idx_support_queries_created_at ON support_queries (created_at DESC);");
    await q("CREATE INDEX idx_support_queries_seller_org ON support_queries (seller_organization_id) WHERE seller_organization_id IS NOT NULL;");
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("support_queries", { transaction }).catch(() => {});
  },
};
