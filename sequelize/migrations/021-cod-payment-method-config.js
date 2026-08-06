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

    // Check if table exists
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_method_configs');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "payment_method_configs",
        {
          method: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
          enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          charge_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          min_order_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
          max_order_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
          currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
          metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );

      // Insert default COD config
      await queryInterface.sequelize.query(
        `INSERT INTO payment_method_configs (method, enabled, charge_amount, currency, metadata)
         VALUES ('cod', true, 0, 'INR', '{}')
         ON CONFLICT (method) DO NOTHING;`,
        { transaction },
      );

      // Add indexes
      await queryInterface.addIndex("orders", ["payment_provider", "created_at"], {
        name: "idx_orders_payment_provider_created",
        transaction,
      });
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("payment_method_configs", { transaction }).catch(() => {});
  },
};
