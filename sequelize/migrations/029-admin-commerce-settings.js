"use strict";

module.exports = {
  id: "029-admin-commerce-settings",
  async up({ queryInterface, Sequelize, transaction }) {
    // Check if table exists
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_settings');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "admin_settings",
        {
          setting_key: { type: Sequelize.STRING(96), primaryKey: true, allowNull: false },
          setting_value: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          updated_by: { type: Sequelize.STRING(64), allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("admin_settings", { transaction }).catch(() => {});
  },
};
