"use strict";

module.exports = {
  id: "029-admin-commerce-settings",
  async up({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS admin_settings (
        setting_key VARCHAR(96) PRIMARY KEY,
        setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      "DROP TABLE IF EXISTS admin_settings;",
      { transaction },
    );
  },
};
