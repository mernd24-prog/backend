"use strict";

module.exports = {
  id: "036-organization-scoped-seller-charge-settings",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    async function describe(table) {
      try {
        return await queryInterface.describeTable(table, { transaction });
      } catch {
        return {};
      }
    }

    await q("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    const columns = await describe("seller_charge_settings");
    if (!Object.keys(columns).length) {
      await queryInterface.createTable(
        "seller_charge_settings",
        {
          seller_id: {
            type: Sequelize.STRING(64),
            allowNull: false,
          },
          organization_id: {
            type: Sequelize.UUID,
            allowNull: true,
          },
          settings: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
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
    } else if (!columns.organization_id) {
      await queryInterface.addColumn(
        "seller_charge_settings",
        "organization_id",
        {
          type: Sequelize.UUID,
          allowNull: true,
        },
        { transaction },
      );
    }

    await q("ALTER TABLE seller_charge_settings DROP CONSTRAINT IF EXISTS seller_charge_settings_pkey;");
    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_charge_settings_scope
      ON seller_charge_settings (
        seller_id,
        COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
      );
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_charge_settings_org
      ON seller_charge_settings (organization_id);
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_charge_settings_seller_org
      ON seller_charge_settings (seller_id, organization_id);
    `);
  },

  async down({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("DROP INDEX IF EXISTS idx_seller_charge_settings_seller_org;");
    await q("DROP INDEX IF EXISTS idx_seller_charge_settings_org;");
    await q("DROP INDEX IF EXISTS uniq_seller_charge_settings_scope;");
    await queryInterface.removeColumn("seller_charge_settings", "organization_id", { transaction }).catch(() => {});
    await q("ALTER TABLE seller_charge_settings ADD PRIMARY KEY (seller_id);").catch(() => {});
  },
};
