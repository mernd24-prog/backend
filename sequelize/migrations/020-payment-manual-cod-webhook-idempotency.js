"use strict";

module.exports = {
  id: "020-payment-manual-cod-webhook-idempotency",
  async up({ queryInterface, Sequelize, transaction }) {
    const payments = await queryInterface.describeTable("payments", { transaction });

    async function addPaymentColumn(column, definition) {
      if (!payments[column]) {
        await queryInterface.addColumn("payments", column, definition, { transaction });
      }
    }

    await addPaymentColumn("idempotency_key", {
      type: Sequelize.STRING(180),
      allowNull: true,
      unique: true,
    });
    await addPaymentColumn("approved_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addPaymentColumn("approved_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // Check if table exists
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_webhook_events');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "payment_webhook_events",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          provider: { type: Sequelize.STRING(64), allowNull: false },
          provider_event_id: { type: Sequelize.STRING(180), allowNull: false },
          event_type: { type: Sequelize.STRING(120), allowNull: false },
          payment_id: { type: Sequelize.UUID, allowNull: true },
          order_id: { type: Sequelize.UUID, allowNull: true },
          status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "processed" },
          payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction, uniqueKeys: { uniq_provider_event: { fields: ["provider", "provider_event_id"] } } },
      );

      await queryInterface.addIndex("payment_webhook_events", ["provider", "event_type"], {
        name: "idx_payment_webhook_events_provider_type",
        transaction,
      });
    }

    await queryInterface.addIndex("payments", ["idempotency_key"], {
      name: "idx_payments_idempotency_key",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("payments", ["provider", "status", "created_at"], {
      name: "idx_payments_provider_status_created",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("payment_webhook_events", { transaction }).catch(() => {});
  },
};
