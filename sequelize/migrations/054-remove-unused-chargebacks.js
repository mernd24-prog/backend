"use strict";

module.exports = {
  id: "054-remove-unused-chargebacks",
  async up({ queryInterface, transaction }) {
    await queryInterface.dropTable("chargebacks", { transaction }).catch(() => {});
  },

  async down({ queryInterface, Sequelize, transaction }) {
    await queryInterface.createTable("chargebacks", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      payment_id: { type: Sequelize.UUID, allowNull: false },
      order_id: { type: Sequelize.UUID, allowNull: false },
      gateway_reference: { type: Sequelize.STRING(128), allowNull: false },
      reason_code: { type: Sequelize.STRING(64), allowNull: true },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
      representment_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
      opened_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    }, { transaction });
  },
};
