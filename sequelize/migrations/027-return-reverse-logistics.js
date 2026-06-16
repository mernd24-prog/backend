"use strict";

module.exports = {
  id: "027-return-reverse-logistics",
  async up({ queryInterface, Sequelize, transaction }) {
    const columns = await queryInterface.describeTable("shipments", { transaction });

    if (!columns.shipment_type) {
      await queryInterface.addColumn("shipments", "shipment_type", {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "forward",
      }, { transaction });
    }
    if (!columns.direction) {
      await queryInterface.addColumn("shipments", "direction", {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: "forward",
      }, { transaction });
    }
    if (!columns.return_id) {
      await queryInterface.addColumn("shipments", "return_id", {
        type: Sequelize.STRING(64),
        allowNull: true,
      }, { transaction });
    }

    await queryInterface.addIndex("shipments", ["return_id", "status"], {
      name: "idx_shipments_return_id_status",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("shipments", ["shipment_type", "direction"], {
      name: "idx_shipments_type_direction",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeIndex("shipments", "idx_shipments_type_direction", { transaction }).catch(() => {});
    await queryInterface.removeIndex("shipments", "idx_shipments_return_id_status", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "return_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "direction", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "shipment_type", { transaction }).catch(() => {});
  },
};
