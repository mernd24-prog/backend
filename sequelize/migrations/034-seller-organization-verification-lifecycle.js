"use strict";

module.exports = {
  id: "034-seller-organization-verification-lifecycle",
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

    await addColumnIfMissing("seller_organizations", columns, "approved_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "approved_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "rejected_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "rejected_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "rejection_reason", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "resubmitted_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "resubmitted_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "blocked_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "blocked_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_organizations", columns, "required_changes", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
    await addColumnIfMissing("seller_organizations", columns, "verification_history", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });

    await q(`
      UPDATE seller_organizations
      SET
        approved_at = COALESCE(approved_at, CASE WHEN approval_status IN ('approved', 'active') THEN updated_at END),
        rejected_at = COALESCE(rejected_at, CASE WHEN approval_status = 'rejected' THEN updated_at END),
        verification_history = CASE
          WHEN jsonb_typeof(COALESCE(verification_history, '[]'::jsonb)) = 'array'
            AND jsonb_array_length(COALESCE(verification_history, '[]'::jsonb)) > 0
          THEN verification_history
          ELSE jsonb_build_array(jsonb_build_object(
            'status', approval_status,
            'kycStatus', kyc_status,
            'bankVerificationStatus', bank_verification_status,
            'action', 'migration_backfill',
            'at', COALESCE(updated_at, created_at, NOW())
          ))
        END
      WHERE TRUE;
    `);

    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_organizations_lifecycle
      ON seller_organizations (approval_status, approved_at, rejected_at, resubmitted_at);
    `);
  },

  async down({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("DROP INDEX IF EXISTS idx_seller_organizations_lifecycle;");
    await queryInterface.removeColumn("seller_organizations", "verification_history", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "required_changes", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "blocked_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "blocked_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "resubmitted_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "resubmitted_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "rejection_reason", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "rejected_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "rejected_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "approved_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_organizations", "approved_at", { transaction }).catch(() => {});
  },
};
