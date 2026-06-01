"use strict";

module.exports = {
  id: "018-tax-credit-notes-and-invoice-filters",
  async up({ queryInterface, Sequelize, transaction }) {
    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS tax_credit_notes (
        id UUID PRIMARY KEY,
        credit_note_number VARCHAR(64) NOT NULL UNIQUE,
        invoice_id UUID NOT NULL,
        order_id UUID NOT NULL,
        buyer_id VARCHAR(64) NOT NULL,
        reference_type VARCHAR(32) NOT NULL,
        reference_id VARCHAR(128) NOT NULL,
        taxable_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        cgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        sgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        igst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        reason TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.addIndex("tax_credit_notes", ["reference_type", "reference_id"], {
      name: "idx_tax_credit_notes_reference",
      unique: true,
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("tax_credit_notes", ["order_id", "issued_at"], {
      name: "idx_tax_credit_notes_order_issued",
      transaction,
    }).catch(() => {});
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
