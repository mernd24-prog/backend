"use strict";

module.exports = {
  id: "038-shipping-profile-templates-and-guards",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    await q("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    async function hasTable(name) {
      const [rows] = await queryInterface.sequelize.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        { bind: [name], transaction },
      );
      return rows.length > 0;
    }

    async function hasColumn(table, column) {
      const columns = await queryInterface.describeTable(table, { transaction }).catch(() => ({}));
      return Boolean(columns[column]);
    }

    if (!(await hasTable("shipping_profile_templates"))) {
      await queryInterface.createTable(
        "shipping_profile_templates",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal("gen_random_uuid()"),
          },
          name: {
            type: Sequelize.STRING(128),
            allowNull: false,
          },
          description: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          shipping_method: {
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: "standard",
          },
          serviceability_mode: {
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: "all_india",
          },
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
          allowed_overrides: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [
              "name",
              "description",
              "shippingMethod",
              "serviceabilityMode",
              "allowedStates",
              "allowedCities",
              "allowedPincodes",
              "blockedPincodes",
              "codAvailable",
              "shippingCharge",
              "freeShippingThreshold",
              "etaMin",
              "etaMax",
              "isDefault",
              "active",
            ],
          },
          version: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 1,
          },
          status: {
            type: Sequelize.STRING(32),
            allowNull: false,
            defaultValue: "published",
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
        { transaction },
      );

      await q("CREATE INDEX idx_shipping_profile_templates_status ON shipping_profile_templates (status, active);");
      await q("CREATE INDEX idx_shipping_profile_templates_created_at ON shipping_profile_templates (created_at DESC);");
    }

    if (await hasTable("shipping_profiles")) {
      if (!(await hasColumn("shipping_profiles", "source_template_id"))) {
        await queryInterface.addColumn("shipping_profiles", "source_template_id", {
          type: Sequelize.UUID,
          allowNull: true,
        }, { transaction });
      }
      if (!(await hasColumn("shipping_profiles", "source_template_version"))) {
        await queryInterface.addColumn("shipping_profiles", "source_template_version", {
          type: Sequelize.INTEGER,
          allowNull: true,
        }, { transaction });
      }
      if (!(await hasColumn("shipping_profiles", "template_snapshot"))) {
        await queryInterface.addColumn("shipping_profiles", "template_snapshot", {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
        }, { transaction });
      }
      if (!(await hasColumn("shipping_profiles", "editable_fields"))) {
        await queryInterface.addColumn("shipping_profiles", "editable_fields", {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: [],
        }, { transaction });
      }
      if (!(await hasColumn("shipping_profiles", "copied_from_template_at"))) {
        await queryInterface.addColumn("shipping_profiles", "copied_from_template_at", {
          type: Sequelize.DATE,
          allowNull: true,
        }, { transaction });
      }
      if (!(await hasColumn("shipping_profiles", "archived_at"))) {
        await queryInterface.addColumn("shipping_profiles", "archived_at", {
          type: Sequelize.DATE,
          allowNull: true,
        }, { transaction });
      }

      await q(`
        CREATE INDEX IF NOT EXISTS idx_shipping_profiles_source_template
          ON shipping_profiles (source_template_id)
          WHERE source_template_id IS NOT NULL;
      `);
      await q(`
        CREATE INDEX IF NOT EXISTS idx_shipping_profiles_archived_at
          ON shipping_profiles (archived_at);
      `);
      await q(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_profiles_seller_default_no_org
          ON shipping_profiles (seller_id)
          WHERE is_default = true AND organization_id IS NULL AND archived_at IS NULL;
      `);
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeIndex("shipping_profiles", "idx_shipping_profiles_seller_default_no_org", { transaction }).catch(() => {});
    await queryInterface.removeIndex("shipping_profiles", "idx_shipping_profiles_archived_at", { transaction }).catch(() => {});
    await queryInterface.removeIndex("shipping_profiles", "idx_shipping_profiles_source_template", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipping_profiles", "archived_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipping_profiles", "copied_from_template_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipping_profiles", "editable_fields", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipping_profiles", "template_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipping_profiles", "source_template_version", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipping_profiles", "source_template_id", { transaction }).catch(() => {});
    await queryInterface.dropTable("shipping_profile_templates", { transaction }).catch(() => {});
  },
};
