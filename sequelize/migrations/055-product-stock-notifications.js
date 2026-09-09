"use strict";

module.exports = {
  id: "055-product-stock-notifications",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    await q("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    await queryInterface.createTable(
      "product_stock_notifications",
      {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false,
          defaultValue: Sequelize.literal("gen_random_uuid()"),
        },
        user_id: { type: Sequelize.STRING(128), allowNull: true },
        name: { type: Sequelize.STRING(180), allowNull: false },
        email: { type: Sequelize.STRING(255), allowNull: false },
        product_id: { type: Sequelize.STRING(128), allowNull: false },
        variant_id: { type: Sequelize.STRING(128), allowNull: true },
        seller_id: { type: Sequelize.STRING(128), allowNull: true },
        organization_id: { type: Sequelize.STRING(128), allowNull: true },
        product_title: { type: Sequelize.STRING(255), allowNull: true },
        product_slug: { type: Sequelize.STRING(255), allowNull: true },
        product_image: { type: Sequelize.TEXT, allowNull: true },
        variant_title: { type: Sequelize.STRING(255), allowNull: true },
        sku: { type: Sequelize.STRING(160), allowNull: true },
        price: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
        status: {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: "pending",
        },
        requested_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("NOW"),
        },
        notified_at: { type: Sequelize.DATE, allowNull: true },
        last_email_error: { type: Sequelize.TEXT, allowNull: true },
        metadata: {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
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

    await q("ALTER TABLE product_stock_notifications ADD CONSTRAINT product_stock_notifications_status_chk CHECK (status IN ('pending', 'queued', 'notified', 'cancelled', 'failed'));");
    await q("CREATE UNIQUE INDEX uniq_product_stock_notifications_email_product_variant ON product_stock_notifications (lower(email), product_id, COALESCE(variant_id, ''));");
    await q("CREATE INDEX idx_product_stock_notifications_product ON product_stock_notifications (product_id, variant_id, status);");
    await q("CREATE INDEX idx_product_stock_notifications_seller ON product_stock_notifications (seller_id, status, requested_at DESC);");
    await q("CREATE INDEX idx_product_stock_notifications_requested ON product_stock_notifications (requested_at DESC);");
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("product_stock_notifications", { transaction }).catch(() => {});
  },
};
