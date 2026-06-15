"use strict";

module.exports = {
  id: "024-tax-document-actor-metadata",
  async up({ queryInterface, Sequelize, transaction }) {
    async function addColumnIfMissing(table, column) {
      const columns = await queryInterface.describeTable(table, { transaction });
      if (!columns[column]) {
        await queryInterface.addColumn(table, column, {
          type: Sequelize.STRING(64),
          allowNull: true,
        }, { transaction });
      }
    }

    await addColumnIfMissing("tax_invoices", "created_by");
    await addColumnIfMissing("tax_invoices", "updated_by");
    await addColumnIfMissing("tax_credit_notes", "created_by");
    await addColumnIfMissing("tax_credit_notes", "updated_by");
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeColumn("tax_credit_notes", "updated_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_credit_notes", "created_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "updated_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "created_by", { transaction }).catch(() => {});
  },
};
