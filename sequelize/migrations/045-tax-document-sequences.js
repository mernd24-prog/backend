"use strict";

module.exports = {
  id: "045-tax-document-sequences",

  async up({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS tax_document_sequences (
        prefix VARCHAR(16) NOT NULL,
        period VARCHAR(6) NOT NULL,
        last_number INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (prefix, period)
      );
    `, { transaction });
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("tax_document_sequences", { transaction }).catch(() => {});
  },
};
