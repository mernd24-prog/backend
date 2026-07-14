"use strict";

// Settlement lifecycle: immutable per-order return deadline plus COD collection evidence.
// The migration is intentionally additive so existing payment, shipment and payout data remain valid.
module.exports = {
  id: "040-cod-collections-return-settlement-lifecycle",

  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    const orderColumns = await queryInterface.describeTable("orders", { transaction });
    const itemColumns = await queryInterface.describeTable("order_items", { transaction });

    const add = async (table, columns, column, definition) => {
      if (!columns[column]) await queryInterface.addColumn(table, column, definition, { transaction });
    };

    await add("orders", orderColumns, "return_window_days", {
      type: Sequelize.INTEGER, allowNull: true,
    });
    await add("orders", orderColumns, "return_eligible_until", {
      type: Sequelize.DATE, allowNull: true,
    });
    await add("orders", orderColumns, "return_policy_snapshot", {
      type: Sequelize.JSONB, allowNull: false, defaultValue: {},
    });
    await add("orders", orderColumns, "fulfillment_eligible_at", {
      type: Sequelize.DATE, allowNull: true,
    });
    await add("order_items", itemColumns, "return_window_days", {
      type: Sequelize.INTEGER, allowNull: true,
    });
    await add("order_items", itemColumns, "return_eligible_until", {
      type: Sequelize.DATE, allowNull: true,
    });
    await add("order_items", itemColumns, "return_policy_snapshot", {
      type: Sequelize.JSONB, allowNull: false, defaultValue: {},
    });

    await q(`
      CREATE TABLE IF NOT EXISTS cod_collections (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL,
        shipment_id UUID,
        seller_id VARCHAR(64) NOT NULL,
        organization_id UUID,
        payment_id UUID,
        collection_mode VARCHAR(32) NOT NULL DEFAULT 'platform_or_courier',
        collected_by VARCHAR(32) NOT NULL DEFAULT 'platform_or_courier',
        expected_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        collected_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        collection_date TIMESTAMPTZ,
        reference_id VARCHAR(180),
        proof_url TEXT,
        notes TEXT,
        submitted_by VARCHAR(64),
        submitted_at TIMESTAMPTZ,
        verified_by VARCHAR(64),
        verified_at TIMESTAMPTZ,
        remitted_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(order_id, shipment_id, seller_id)
      );
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS seller_settlement_adjustments (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL,
        organization_id UUID,
        order_id UUID,
        cod_collection_id UUID,
        type VARCHAR(48) NOT NULL,
        amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        reference_id VARCHAR(180),
        notes TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by VARCHAR(64),
        resolved_by VARCHAR(64),
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(cod_collection_id, type)
      );
    `);

    await queryInterface.addIndex("orders", ["status", "fulfillment_eligible_at"], {
      name: "idx_orders_fulfillment_eligible", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("cod_collections", ["status", "collection_mode"], {
      name: "idx_cod_collections_status_mode", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("cod_collections", ["seller_id", "status", "created_at"], {
      name: "idx_cod_collections_seller_status", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("seller_settlement_adjustments", ["seller_id", "status", "created_at"], {
      name: "idx_seller_settlement_adjustments_seller_status", transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("seller_settlement_adjustments", { transaction }).catch(() => {});
    await queryInterface.dropTable("cod_collections", { transaction }).catch(() => {});
    for (const column of ["fulfillment_eligible_at", "return_policy_snapshot", "return_eligible_until", "return_window_days"]) {
      await queryInterface.removeColumn("orders", column, { transaction }).catch(() => {});
    }
    for (const column of ["return_policy_snapshot", "return_eligible_until", "return_window_days"]) {
      await queryInterface.removeColumn("order_items", column, { transaction }).catch(() => {});
    }
  },
};
