"use strict";

module.exports = {
  id: "035-seller-organization-onboarding-compliance",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    async function describe(table) {
      try {
        return await queryInterface.describeTable(table, { transaction });
      } catch {
        return {};
      }
    }

    async function addColumnIfMissing(table, columns, column, definition) {
      if (!columns[column]) {
        await queryInterface.addColumn(table, column, definition, { transaction });
      }
    }

    const columns = await describe("seller_organizations");
    if (!Object.keys(columns).length) return;

    await addColumnIfMissing("seller_organizations", columns, "description", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "support_email", {
      type: Sequelize.STRING(254),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "support_phone", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "registration_number", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "aadhaar_number", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "date_of_birth", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "business_website", {
      type: Sequelize.STRING(512),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "primary_contact_name", {
      type: Sequelize.STRING(180),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "compliance_settings", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("seller_organizations", columns, "go_live_status", {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "pending",
    });
    await addColumnIfMissing("seller_organizations", columns, "kyc_reviewed_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "kyc_reviewed_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "bank_reviewed_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "bank_reviewed_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "go_live_approved_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "go_live_approved_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });

    await q(`
      UPDATE seller_organizations
      SET go_live_status = CASE
        WHEN approval_status IN ('approved', 'active')
          AND kyc_status = 'verified'
          AND bank_verification_status = 'verified'
        THEN 'live'
        WHEN approval_status IN ('blocked', 'suspended') THEN 'blocked'
        ELSE COALESCE(NULLIF(go_live_status, ''), 'pending')
      END;
    `);

    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_organizations_go_live
      ON seller_organizations (seller_id, go_live_status, approval_status);
    `);
  },

  async down({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("DROP INDEX IF EXISTS idx_seller_organizations_go_live;");
    const columns = [
      "go_live_approved_by",
      "go_live_approved_at",
      "bank_reviewed_by",
      "bank_reviewed_at",
      "kyc_reviewed_by",
      "kyc_reviewed_at",
      "go_live_status",
      "compliance_settings",
      "primary_contact_name",
      "business_website",
      "date_of_birth",
      "aadhaar_number",
      "registration_number",
      "support_phone",
      "support_email",
      "description",
    ];
    for (const column of columns) {
      await queryInterface.removeColumn("seller_organizations", column, { transaction }).catch(() => {});
    }
  },
};
