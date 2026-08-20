"use strict";

module.exports = {
  id: "049-remove-blocked-pincode-serviceability",

  async up({ queryInterface, transaction }) {
    const hasTable = async (tableName) => {
      const tables = await queryInterface.showAllTables({ transaction });
      return tables.map(String).includes(tableName);
    };

    for (const tableName of ["shipping_profiles", "shipping_profile_templates"]) {
      if (!(await hasTable(tableName))) continue;
      await queryInterface.sequelize.query(
        `UPDATE ${tableName}
         SET serviceability_mode = CASE
           WHEN serviceability_mode = 'block_pincodes' THEN 'all_india'
           WHEN serviceability_mode IN ('selected_states', 'selected_cities') THEN 'selected_pincodes'
           ELSE serviceability_mode
         END`,
        { transaction },
      );
      const columns = await queryInterface.describeTable(tableName, { transaction });
      for (const columnName of ["allowed_states", "allowed_cities", "blocked_pincodes"]) {
        if (columns[columnName]) {
          await queryInterface.removeColumn(tableName, columnName, { transaction });
        }
      }
    }

    if (await hasTable("delivery_exclusions")) {
      await queryInterface.dropTable("delivery_exclusions", { transaction });
    }
  },

  async down({ queryInterface, Sequelize, transaction }) {
    const tables = (await queryInterface.showAllTables({ transaction })).map(String);
    for (const tableName of ["shipping_profiles", "shipping_profile_templates"]) {
      if (!tables.includes(tableName)) continue;
      const columns = await queryInterface.describeTable(tableName, { transaction });
      for (const columnName of ["allowed_states", "allowed_cities", "blocked_pincodes"]) {
        if (!columns[columnName]) {
          await queryInterface.addColumn(
            tableName,
            columnName,
            { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
            { transaction },
          );
        }
      }
    }

    if (!tables.includes("delivery_exclusions")) {
      await queryInterface.createTable(
        "delivery_exclusions",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          pincode: { type: Sequelize.STRING(12), allowNull: false },
          reason_code: { type: Sequelize.STRING(64), allowNull: false },
          reason_note: { type: Sequelize.TEXT, allowNull: true },
          source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: "manual" },
          active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );
      await queryInterface.addIndex("delivery_exclusions", ["pincode", "active"], { transaction });
    }
  },
};
