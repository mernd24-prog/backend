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

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS payment_webhook_events (
        id UUID PRIMARY KEY,
        provider VARCHAR(64) NOT NULL,
        provider_event_id VARCHAR(180) NOT NULL,
        event_type VARCHAR(120) NOT NULL,
        payment_id UUID,
        order_id UUID,
        status VARCHAR(32) NOT NULL DEFAULT 'processed',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_event_id)
      );
      `,
      { transaction },
    );

    await queryInterface.addIndex("payments", ["idempotency_key"], {
      name: "idx_payments_idempotency_key",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("payments", ["provider", "status", "created_at"], {
      name: "idx_payments_provider_status_created",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("payment_webhook_events", ["provider", "event_type"], {
      name: "idx_payment_webhook_events_provider_type",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("payment_webhook_events", { transaction }).catch(() => {});
  },
};
