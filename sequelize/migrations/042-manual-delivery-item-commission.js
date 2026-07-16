"use strict";

module.exports = {
  id: "042-manual-delivery-item-commission",

  async up({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    const shipmentColumns = await queryInterface.describeTable("shipments", { transaction });

    await q("DROP INDEX IF EXISTS uniq_seller_commissions_seller_order;");
    await q("DROP INDEX IF EXISTS uniq_seller_commissions_seller_org_order;");
    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_commissions_item
      ON seller_commissions (
        seller_id,
        COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        order_id,
        order_item_id
      ) WHERE order_item_id IS NOT NULL;
    `);
    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_commissions_legacy_order
      ON seller_commissions (
        seller_id,
        COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        order_id
      ) WHERE order_item_id IS NULL;
    `);

    await queryInterface.dropTable("delivery_verification_events", { transaction }).catch(() => {});
    await queryInterface.dropTable("delivery_agents", { transaction }).catch(() => {});
    for (const column of [
      "delivery_otp_hash", "delivery_otp_expires_at", "delivery_otp_attempts",
      "verification_required", "verification_methods", "delivered_verified_at",
      "verified_by", "delivery_agent_id", "delivery_agent_snapshot",
    ]) {
      if (shipmentColumns[column]) {
        await queryInterface.removeColumn("shipments", column, { transaction }).catch(() => {});
      }
    }

    await q(`
      UPDATE shipments
      SET status = 'delivered'
      WHERE status = 'delivered_verified';
    `);
  },

  async down({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("DROP INDEX IF EXISTS uniq_seller_commissions_item;");
    await q("DROP INDEX IF EXISTS uniq_seller_commissions_legacy_order;");
    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_commissions_seller_org_order
      ON seller_commissions (seller_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), order_id);
    `);
    const columns = await queryInterface.describeTable("shipments", { transaction });
    if (!columns.verification_required) await queryInterface.addColumn("shipments", "verification_required", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, { transaction });
    if (!columns.verification_methods) await queryInterface.addColumn("shipments", "verification_methods", { type: Sequelize.JSONB, allowNull: false, defaultValue: [] }, { transaction });
  },
};
