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

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS delivery_webhook_events (
        id UUID PRIMARY KEY,
        provider VARCHAR(64) NOT NULL,
        provider_event_id VARCHAR(180) NOT NULL,
        shipment_id UUID,
        status VARCHAR(32) NOT NULL DEFAULT 'processing',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_event_id)
      );
      `,
      { transaction },
    );

    await queryInterface.addIndex("delivery_webhook_events", ["shipment_id", "created_at"], {
      name: "idx_delivery_webhook_shipment_created",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("delivery_webhook_events", { transaction }).catch(() => {});
    await queryInterface.removeColumn("e_way_bill_details", "updated_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("e_way_bill_details", "created_by", { transaction }).catch(() => {});
  },
};
