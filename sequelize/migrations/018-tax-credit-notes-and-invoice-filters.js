"use strict";

module.exports = {
  id: "018-tax-credit-notes-and-invoice-filters",
  async up({ queryInterface, Sequelize, transaction }) {
    // Check if table exists
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tax_credit_notes');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "tax_credit_notes",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          credit_note_number: { type: Sequelize.STRING(64), allowNull: false, unique: true },
          invoice_id: { type: Sequelize.UUID, allowNull: false },
          order_id: { type: Sequelize.UUID, allowNull: false },
          buyer_id: { type: Sequelize.STRING(64), allowNull: false },
          reference_type: { type: Sequelize.STRING(32), allowNull: false },
          reference_id: { type: Sequelize.STRING(128), allowNull: false },
          taxable_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          tax_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          cgst_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          sgst_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          igst_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          total_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
          reason: { type: Sequelize.TEXT, allowNull: true },
          metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          issued_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );

      await queryInterface.addIndex("tax_credit_notes", ["reference_type", "reference_id"], {
        name: "idx_tax_credit_notes_reference",
        unique: true,
        transaction,
      });
      await queryInterface.addIndex("tax_credit_notes", ["order_id", "issued_at"], {
        name: "idx_tax_credit_notes_order_issued",
        transaction,
      });
    }

    // Add indexes to existing tax_invoices table
    await queryInterface.addIndex("tax_invoices", ["issued_at"], {
      name: "idx_tax_invoices_issued_at",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("tax_invoices", ["place_of_supply"], {
      name: "idx_tax_invoices_place_of_supply",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("tax_credit_notes", { transaction }).catch(() => {});
  },
};
