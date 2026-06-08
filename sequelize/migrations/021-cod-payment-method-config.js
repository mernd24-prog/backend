"use strict";

module.exports = {
  id: "021-cod-payment-method-config",
  async up({ queryInterface, Sequelize, transaction }) {
    const orders = await queryInterface.describeTable("orders", { transaction });

    async function addOrderColumn(column, definition) {
      if (!orders[column]) {
        await queryInterface.addColumn("orders", column, definition, { transaction });
      }
    }

    await addOrderColumn("payment_provider", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addOrderColumn("cod_charge_amount", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS payment_method_configs (
        method VARCHAR(64) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT true,
        charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        min_order_amount NUMERIC(12, 2),
        max_order_amount NUMERIC(12, 2),
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO payment_method_configs (method, enabled, charge_amount, currency, metadata)
      VALUES ('cod', true, 0, 'INR', '{}'::jsonb)
      ON CONFLICT (method) DO NOTHING;
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_orders_payment_provider_created
       ON orders (payment_provider, created_at);`,
      { transaction },
    );
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      "DROP TABLE IF EXISTS payment_method_configs;",
      { transaction },
    );
  },
};
