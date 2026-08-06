"use strict";

module.exports = {
  id: "022-seller-finance-ledger",
  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    async function describe(table) {
      try {
        return await queryInterface.describeTable(table, { transaction });
      } catch {
        return {};
      }
    }

    async function addColumnIfMissing(table, existing, column, definition) {
      if (!existing[column]) {
        await queryInterface.addColumn(table, column, definition, { transaction });
      }
    }

    // Create seller_payouts table if it doesn't exist
    const hasPayoutsTable = await queryInterface.sequelize
      .query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_payouts');", {
        transaction,
      })
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasPayoutsTable) {
      await queryInterface.createTable(
        "seller_payouts",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          seller_id: { type: Sequelize.STRING(64), allowNull: false },
          period_start: { type: Sequelize.DATEONLY, allowNull: false },
          period_end: { type: Sequelize.DATEONLY, allowNull: false },
          total_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          commission_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          tax_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          refund_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          adjustment_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          net_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
          status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
          payment_method: { type: Sequelize.STRING(64), allowNull: true },
          payment_reference: { type: Sequelize.STRING(160), allowNull: true },
          scheduled_at: { type: Sequelize.DATE, allowNull: true },
          processed_at: { type: Sequelize.DATE, allowNull: true },
          metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );
    }

    // Create seller_commissions table if it doesn't exist
    const hasCommissionsTable = await queryInterface.sequelize
      .query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_commissions');", {
        transaction,
      })
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasCommissionsTable) {
      await queryInterface.createTable(
        "seller_commissions",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          seller_id: { type: Sequelize.STRING(64), allowNull: false },
          order_id: { type: Sequelize.UUID, allowNull: false },
          order_item_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
          amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          commission_rate: { type: Sequelize.DECIMAL(8, 4), allowNull: false, defaultValue: 0 },
          commission_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          tax_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          refund_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          net_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
          status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
          payout_id: { type: Sequelize.UUID, allowNull: true },
          source_status: { type: Sequelize.STRING(64), allowNull: true },
          metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );
    }

    // Create seller_settlements table if it doesn't exist
    const hasSettlementsTable = await queryInterface.sequelize
      .query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_settlements');", {
        transaction,
      })
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasSettlementsTable) {
      await queryInterface.createTable(
        "seller_settlements",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          seller_id: { type: Sequelize.STRING(64), allowNull: false },
          payout_id: { type: Sequelize.UUID, allowNull: true },
          settlement_date: { type: Sequelize.DATEONLY, allowNull: false, defaultValue: Sequelize.fn("CURRENT_DATE") },
          period_start: { type: Sequelize.DATEONLY, allowNull: true },
          period_end: { type: Sequelize.DATEONLY, allowNull: true },
          gross_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          commission_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          tax_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          refund_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          adjustment_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          net_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
          currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
          status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
          notes: { type: Sequelize.TEXT, allowNull: true },
          metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );
    }

    const payoutColumns = await describe("seller_payouts");
    const commissionColumns = await describe("seller_commissions");
    const settlementColumns = await describe("seller_settlements");

    if (payoutColumns.seller_id) {
      await q("ALTER TABLE seller_payouts ALTER COLUMN seller_id TYPE VARCHAR(64) USING seller_id::text;").catch(
        () => {},
      );
    }
    if (commissionColumns.seller_id) {
      await q("ALTER TABLE seller_commissions ALTER COLUMN seller_id TYPE VARCHAR(64) USING seller_id::text;").catch(
        () => {},
      );
    }
    if (settlementColumns.seller_id) {
      await q("ALTER TABLE seller_settlements ALTER COLUMN seller_id TYPE VARCHAR(64) USING seller_id::text;").catch(
        () => {},
      );
    }

    await addColumnIfMissing("seller_payouts", payoutColumns, "refund_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_payouts", payoutColumns, "adjustment_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_payouts", payoutColumns, "payment_method", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_payouts", payoutColumns, "scheduled_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_payouts", payoutColumns, "processed_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await addColumnIfMissing("seller_payouts", payoutColumns, "metadata", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("seller_payouts", payoutColumns, "updated_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });

    await addColumnIfMissing("seller_commissions", commissionColumns, "order_item_ids", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
    await addColumnIfMissing("seller_commissions", commissionColumns, "refund_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_commissions", commissionColumns, "currency", {
      type: Sequelize.STRING(8),
      allowNull: false,
      defaultValue: "INR",
    });
    await addColumnIfMissing("seller_commissions", commissionColumns, "source_status", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("seller_commissions", commissionColumns, "metadata", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("seller_commissions", commissionColumns, "updated_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });

    await addColumnIfMissing("seller_settlements", settlementColumns, "payout_id", {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "period_start", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "period_end", {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "gross_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "commission_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "tax_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "refund_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "adjustment_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "net_amount", {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "metadata", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("seller_settlements", settlementColumns, "updated_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });
    if (settlementColumns.amount) {
      await q("ALTER TABLE seller_settlements ALTER COLUMN amount DROP NOT NULL;");
      await q("ALTER TABLE seller_settlements ALTER COLUMN amount SET DEFAULT 0;");
    }

    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_commissions_seller_order
      ON seller_commissions (seller_id, order_id);
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_commissions_seller_status_created
      ON seller_commissions (seller_id, status, created_at);
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_commissions_payout
      ON seller_commissions (payout_id);
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_payouts_seller_status_created
      ON seller_payouts (seller_id, status, created_at);
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_settlements_seller_created
      ON seller_settlements (seller_id, created_at);
    `);
  },

  async down({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

    await q("DROP TABLE IF EXISTS seller_settlements;");
    await q("DROP TABLE IF EXISTS seller_commissions;");
    await q("DROP TABLE IF EXISTS seller_payouts;");
  },
};
