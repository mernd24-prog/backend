"use strict";

module.exports = {
  id: "045-tax-document-sequences",

  async up({ queryInterface, Sequelize, transaction }) {
    // Check if table exists using direct SQL
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tax_document_sequences');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "tax_document_sequences",
        {
          prefix: { type: Sequelize.STRING(16), allowNull: false, primaryKey: true },
          period: { type: Sequelize.STRING(6), allowNull: false, primaryKey: true },
          last_number: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("tax_document_sequences", { transaction }).catch(() => {});
  },
};
