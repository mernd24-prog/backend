"use strict";

module.exports = {
  id: "053-ca-finance-analytics",
  async up({ queryInterface, Sequelize, transaction }) {
    await queryInterface.createTable("payment_provider_transactions", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      provider: { type: Sequelize.STRING(32), allowNull: false },
      external_id: { type: Sequelize.STRING(160), allowNull: false },
      transaction_type: { type: Sequelize.STRING(32), allowNull: false },
      order_reference: { type: Sequelize.STRING(160), allowNull: true },
      payment_reference: { type: Sequelize.STRING(160), allowNull: true },
      settlement_reference: { type: Sequelize.STRING(160), allowNull: true },
      utr: { type: Sequelize.STRING(160), allowNull: true },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      fee_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      fee_tax_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
      status: { type: Sequelize.STRING(32), allowNull: true },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      bank_credit_at: { type: Sequelize.DATE, allowNull: true },
      raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      imported_by: { type: Sequelize.STRING(128), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    }, { transaction });
    await queryInterface.addIndex("payment_provider_transactions", ["provider", "external_id", "transaction_type"], { unique: true, name: "uniq_provider_transaction_fact", transaction });
    await queryInterface.addIndex("payment_provider_transactions", ["provider", "occurred_at"], { name: "idx_provider_transaction_date", transaction });
    await queryInterface.addIndex("payment_provider_transactions", ["settlement_reference"], { name: "idx_provider_transaction_settlement", transaction });
  },
  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("payment_provider_transactions", { transaction });
  },
};
