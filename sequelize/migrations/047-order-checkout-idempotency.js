"use strict";

module.exports = {
  id: "047-order-checkout-idempotency",
  async up({ queryInterface, Sequelize, transaction }) {
    const columns = await queryInterface.describeTable("orders", { transaction });
    if (!columns.checkout_idempotency_key) {
      await queryInterface.addColumn("orders", "checkout_idempotency_key", {
        type: Sequelize.STRING(128), allowNull: true,
      }, { transaction });
    }
    await queryInterface.sequelize.query(`
      UPDATE orders
      SET checkout_idempotency_key = NULLIF(metadata->>'idempotencyKey', '')
      WHERE checkout_idempotency_key IS NULL
    `, { transaction });
    await queryInterface.sequelize.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY buyer_id, checkout_idempotency_key
          ORDER BY created_at ASC, id ASC
        ) AS row_number
        FROM orders
        WHERE checkout_idempotency_key IS NOT NULL
      )
      UPDATE orders SET checkout_idempotency_key = NULL
      FROM ranked WHERE orders.id = ranked.id AND ranked.row_number > 1
    `, { transaction });
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_buyer_checkout_idempotency
      ON orders (buyer_id, checkout_idempotency_key)
      WHERE checkout_idempotency_key IS NOT NULL
    `, { transaction });
  },
  async down({ queryInterface, transaction }) {
    await queryInterface.removeIndex("orders", "ux_orders_buyer_checkout_idempotency", { transaction }).catch(() => {});
    await queryInterface.removeColumn("orders", "checkout_idempotency_key", { transaction }).catch(() => {});
  },
};
