"use strict";

module.exports = {
  id: "031-delivery-agents",
  async up({ queryInterface, Sequelize, transaction }) {
    const now = Sequelize.fn("NOW");

    await queryInterface.createTable(
      "delivery_agents",
      {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        seller_id: { type: Sequelize.STRING(64), allowNull: false },
        name: { type: Sequelize.STRING(160), allowNull: false },
        phone: { type: Sequelize.STRING(32), allowNull: false },
        email: { type: Sequelize.STRING(180), allowNull: true },
        vehicle_type: { type: Sequelize.STRING(64), allowNull: true },
        vehicle_number: { type: Sequelize.STRING(64), allowNull: true },
        license_number: { type: Sequelize.STRING(80), allowNull: true },
        documents: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        verification_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
        active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_by: { type: Sequelize.STRING(64), allowNull: true },
        updated_by: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      },
      { transaction },
    ).catch((error) => {
      if (error?.original?.code !== "42P07") throw error;
    });

    const shipmentColumns = await queryInterface.describeTable("shipments", { transaction });
    if (!shipmentColumns.delivery_agent_id) {
      await queryInterface.addColumn("shipments", "delivery_agent_id", {
        type: Sequelize.UUID,
        allowNull: true,
      }, { transaction });
    }
    if (!shipmentColumns.delivery_agent_snapshot) {
      await queryInterface.addColumn("shipments", "delivery_agent_snapshot", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      }, { transaction });
    }

    await queryInterface.addIndex("delivery_agents", ["seller_id", "active"], {
      name: "idx_delivery_agents_seller_active",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("delivery_agents", ["seller_id", "phone"], {
      name: "idx_delivery_agents_seller_phone",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("shipments", ["delivery_agent_id"], {
      name: "idx_shipments_delivery_agent",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeIndex("shipments", "idx_shipments_delivery_agent", { transaction }).catch(() => {});
    await queryInterface.removeIndex("delivery_agents", "idx_delivery_agents_seller_phone", { transaction }).catch(() => {});
    await queryInterface.removeIndex("delivery_agents", "idx_delivery_agents_seller_active", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "delivery_agent_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "delivery_agent_id", { transaction }).catch(() => {});
    await queryInterface.dropTable("delivery_agents", { transaction }).catch(() => {});
  },
};
