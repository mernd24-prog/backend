"use strict";

module.exports = {
  id: "037-shipping-profiles",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    await q("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    async function hasTable(name) {
      const [rows] = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = '${name}' AND table_schema = 'public'`,
        { transaction }
      );
      return rows.length > 0;
    }

    if (!(await hasTable("shipping_profiles"))) {
      await queryInterface.createTable(
        "shipping_profiles",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal("gen_random_uuid()"),
          },
          seller_id: {
            type: Sequelize.STRING(64),
            allowNull: false,
          },
          organization_id: {
            type: Sequelize.UUID,
            allowNull: true,
          },
          name: {
            type: Sequelize.STRING(128),
            allowNull: false,
          },
          description: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          // standard | express | same_day | hyperlocal
          shipping_method: {
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: "standard",
          },
          // all_india | selected_states | selected_cities | selected_pincodes | block_pincodes
          serviceability_mode: {
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: "all_india",
          },
          // JSONB arrays of strings
          allowed_states: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
          },
          allowed_cities: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
          },
          allowed_pincodes: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
          },
          blocked_pincodes: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
          },
          cod_available: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          shipping_charge: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
          },
          // NULL = no free shipping threshold
          free_shipping_threshold: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          eta_min: {
            type: Sequelize.INTEGER,
            allowNull: true,
          },
          eta_max: {
            type: Sequelize.INTEGER,
            allowNull: true,
          },
          is_default: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          active: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          created_by: {
            type: Sequelize.STRING(64),
            allowNull: true,
          },
          updated_by: {
            type: Sequelize.STRING(64),
            allowNull: true,
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("NOW"),
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("NOW"),
          },
        },
        { transaction }
      );

      await q(`
        CREATE INDEX idx_shipping_profiles_seller_id
          ON shipping_profiles (seller_id);
      `);
      await q(`
        CREATE INDEX idx_shipping_profiles_organization_id
          ON shipping_profiles (organization_id)
          WHERE organization_id IS NOT NULL;
      `);
      await q(`
        CREATE UNIQUE INDEX idx_shipping_profiles_seller_default
          ON shipping_profiles (seller_id, organization_id)
          WHERE is_default = true AND organization_id IS NOT NULL;
      `);
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("shipping_profiles", { transaction });
  },
};
