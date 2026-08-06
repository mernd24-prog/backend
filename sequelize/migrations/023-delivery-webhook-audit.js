"use strict";

module.exports = {
  id: "023-delivery-webhook-audit",
  async up({ queryInterface, Sequelize, transaction }) {
    const ewayColumns = await queryInterface.describeTable("e_way_bill_details", { transaction });
    if (!ewayColumns.created_by) {
      await queryInterface.addColumn("e_way_bill_details", "created_by", {
        type: Sequelize.STRING(64),
        allowNull: true,
      }, { transaction });
    }
    if (!ewayColumns.updated_by) {
      await queryInterface.addColumn("e_way_bill_details", "updated_by", {
        type: Sequelize.STRING(64),
        allowNull: true,
      }, { transaction });
    }

    // Check if table exists
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_webhook_events');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "delivery_webhook_events",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          provider: { type: Sequelize.STRING(64), allowNull: false },
          provider_event_id: { type: Sequelize.STRING(180), allowNull: false },
          shipment_id: { type: Sequelize.UUID, allowNull: true },
          status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "processing" },
          payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction, uniqueKeys: { uniq_provider_event: { fields: ["provider", "provider_event_id"] } } },
      );

      await queryInterface.addIndex("delivery_webhook_events", ["shipment_id", "created_at"], {
        name: "idx_delivery_webhook_shipment_created",
        transaction,
      });
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("delivery_webhook_events", { transaction }).catch(() => {});
    await queryInterface.removeColumn("e_way_bill_details", "updated_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("e_way_bill_details", "created_by", { transaction }).catch(() => {});
  },
};
