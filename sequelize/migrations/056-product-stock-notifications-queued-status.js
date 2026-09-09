"use strict";

module.exports = {
  id: "056-product-stock-notifications-queued-status",
  async up({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("ALTER TABLE product_stock_notifications DROP CONSTRAINT IF EXISTS product_stock_notifications_status_chk;");
    await q("ALTER TABLE product_stock_notifications ADD CONSTRAINT product_stock_notifications_status_chk CHECK (status IN ('pending', 'queued', 'notified', 'cancelled', 'failed'));");
  },

  async down({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("UPDATE product_stock_notifications SET status = 'pending' WHERE status = 'queued';");
    await q("ALTER TABLE product_stock_notifications DROP CONSTRAINT IF EXISTS product_stock_notifications_status_chk;");
    await q("ALTER TABLE product_stock_notifications ADD CONSTRAINT product_stock_notifications_status_chk CHECK (status IN ('pending', 'notified', 'cancelled', 'failed'));");
  },
};
