"use strict";

module.exports = {
  id: "032-tax-marketplace-invoices",
  async up({ queryInterface, Sequelize, transaction }) {
    const columns = await queryInterface.describeTable("tax_invoices", { transaction });

    async function addColumnIfMissing(column, definition) {
      if (!columns[column]) {
        await queryInterface.addColumn("tax_invoices", column, definition, { transaction });
      }
    }

    await addColumnIfMissing("invoice_type", {
      type: Sequelize.STRING(48),
      allowNull: false,
      defaultValue: "order_customer",
    });
    await addColumnIfMissing("seller_id", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("issuer_type", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await addColumnIfMissing("recipient_type", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await addColumnIfMissing("reference_type", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("reference_id", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await addColumnIfMissing("parent_invoice_id", {
      type: Sequelize.UUID,
      allowNull: true,
    });

    await queryInterface.sequelize.query(
      `
      UPDATE tax_invoices
      SET invoice_type = 'order_customer'
      WHERE invoice_type IS NULL OR invoice_type = '';
      `,
      { transaction },
    );

    await queryInterface.addIndex("tax_invoices", ["invoice_type", "seller_id", "issued_at"], {
      name: "idx_tax_invoices_type_seller_issued",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("tax_invoices", ["reference_type", "reference_id"], {
      name: "idx_tax_invoices_reference",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("tax_invoices", ["order_id", "invoice_type"], {
      name: "idx_tax_invoices_order_type",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeIndex("tax_invoices", "idx_tax_invoices_order_type", { transaction }).catch(() => {});
    await queryInterface.removeIndex("tax_invoices", "idx_tax_invoices_reference", { transaction }).catch(() => {});
    await queryInterface.removeIndex("tax_invoices", "idx_tax_invoices_type_seller_issued", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "parent_invoice_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "reference_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "reference_type", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "recipient_type", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "issuer_type", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "seller_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "invoice_type", { transaction }).catch(() => {});
  },
};
