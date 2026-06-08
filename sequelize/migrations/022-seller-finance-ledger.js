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

    await q(`
      CREATE TABLE IF NOT EXISTS seller_payouts (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        refund_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        adjustment_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        payment_method VARCHAR(64),
        payment_reference VARCHAR(160),
        scheduled_at TIMESTAMPTZ,
        processed_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS seller_commissions (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL,
        order_id UUID NOT NULL,
        order_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        commission_rate DECIMAL(8,4) NOT NULL DEFAULT 0,
        commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        refund_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        payout_id UUID,
        source_status VARCHAR(64),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS seller_settlements (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL,
        payout_id UUID,
        settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
        period_start DATE,
        period_end DATE,
        gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        refund_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        adjustment_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        notes TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const payoutColumns = await describe("seller_payouts");
    const commissionColumns = await describe("seller_commissions");
    const settlementColumns = await describe("seller_settlements");

    if (payoutColumns.seller_id) {
      await q("ALTER TABLE seller_payouts ALTER COLUMN seller_id TYPE VARCHAR(64) USING seller_id::text;");
    }
    if (commissionColumns.seller_id) {
      await q("ALTER TABLE seller_commissions ALTER COLUMN seller_id TYPE VARCHAR(64) USING seller_id::text;");
    }
    if (settlementColumns.seller_id) {
      await q("ALTER TABLE seller_settlements ALTER COLUMN seller_id TYPE VARCHAR(64) USING seller_id::text;");
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
