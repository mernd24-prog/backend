"use strict";

module.exports = {
  id: "043-shipment-organization-scope",

  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    const columns = await queryInterface.describeTable("shipments", { transaction });

    if (!columns.organization_id) {
      await queryInterface.addColumn("shipments", "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      }, { transaction });
    }

    await q(`
      UPDATE shipments
      SET organization_id = NULLIF(metadata->>'organizationId', '')::uuid
      WHERE organization_id IS NULL
        AND metadata ? 'organizationId'
        AND metadata->>'organizationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    `);

    await queryInterface.addIndex("shipments", ["seller_id", "organization_id", "status"], {
      name: "idx_shipments_seller_org_status",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("shipments", ["order_id", "seller_id", "organization_id"], {
      name: "idx_shipments_order_seller_org",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeIndex("shipments", "idx_shipments_order_seller_org", { transaction }).catch(() => {});
    await queryInterface.removeIndex("shipments", "idx_shipments_seller_org_status", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "organization_id", { transaction }).catch(() => {});
  },
};
