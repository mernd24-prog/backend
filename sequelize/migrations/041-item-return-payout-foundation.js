"use strict";

module.exports = {
  id: "041-item-return-payout-foundation",

  async up({ queryInterface, Sequelize, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    const itemColumns = await queryInterface.describeTable("order_items", { transaction });
    const shipmentColumns = await queryInterface.describeTable("shipments", { transaction });
    const commissionColumns = await queryInterface.describeTable("seller_commissions", { transaction });

    const add = async (table, columns, column, definition) => {
      if (!columns[column]) await queryInterface.addColumn(table, column, definition, { transaction });
    };

    await add("order_items", itemColumns, "delivered_at", { type: Sequelize.DATE, allowNull: true });
    await add("order_items", itemColumns, "returnable", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await add("order_items", itemColumns, "payout_eligible_at", { type: Sequelize.DATE, allowNull: true });
    await add("order_items", itemColumns, "payout_status", { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" });
    await add("order_items", itemColumns, "payout_hold_reason", { type: Sequelize.TEXT, allowNull: true });
    await add("order_items", itemColumns, "commission_id", { type: Sequelize.UUID, allowNull: true });
    await add("order_items", itemColumns, "payout_id", { type: Sequelize.UUID, allowNull: true });

    await add("shipments", shipmentColumns, "tracking_url", { type: Sequelize.TEXT, allowNull: true });
    await add("shipments", shipmentColumns, "shipped_at", { type: Sequelize.DATE, allowNull: true });
    await add("shipments", shipmentColumns, "delivered_at", { type: Sequelize.DATE, allowNull: true });

    await add("seller_commissions", commissionColumns, "order_item_id", { type: Sequelize.UUID, allowNull: true });
    await add("seller_commissions", commissionColumns, "eligible_at", { type: Sequelize.DATE, allowNull: true });
    await add("seller_commissions", commissionColumns, "hold_reason", { type: Sequelize.TEXT, allowNull: true });

    await q(`
      CREATE TABLE IF NOT EXISTS payout_status_history (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64),
        order_id UUID,
        order_item_id UUID,
        commission_id UUID,
        payout_id UUID,
        from_status VARCHAR(32),
        to_status VARCHAR(32) NOT NULL,
        reason TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        actor_id VARCHAR(64),
        actor_role VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await q(`
      UPDATE order_items oi
      SET
        delivered_at = COALESCE(
          oi.delivered_at,
          (
            SELECT MIN(osh.created_at)
            FROM order_status_history osh
            WHERE osh.order_id = oi.order_id
              AND osh.to_status IN ('delivered', 'fulfilled')
          )
        ),
        returnable = COALESCE(
          NULLIF(oi.product_snapshot #>> '{returnPolicy,returnable}', '')::boolean,
          NULLIF(oi.product_snapshot #>> '{returnPolicy,eligible}', '')::boolean,
          true
        ),
        return_window_days = COALESCE(
          oi.return_window_days,
          NULLIF(oi.product_snapshot #>> '{returnPolicy,returnWindowDays}', '')::integer,
          NULLIF(oi.product_snapshot #>> '{returnPolicy,days}', '')::integer,
          7
        ),
        payout_eligible_at = COALESCE(oi.payout_eligible_at, oi.return_eligible_until)
      WHERE oi.delivered_at IS NULL
         OR oi.payout_eligible_at IS NULL
         OR oi.return_window_days IS NULL;
    `);

    await queryInterface.addIndex("order_items", ["payout_status", "payout_eligible_at"], {
      name: "idx_order_items_payout_eligibility", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("order_items", ["seller_id", "payout_status", "payout_eligible_at"], {
      name: "idx_order_items_seller_payout_eligibility", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("seller_commissions", ["order_item_id"], {
      name: "idx_seller_commissions_order_item", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("payout_status_history", ["payout_id", "created_at"], {
      name: "idx_payout_status_history_payout", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("payout_status_history", ["order_item_id", "created_at"], {
      name: "idx_payout_status_history_order_item", transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("payout_status_history", { transaction }).catch(() => {});
    for (const column of ["hold_reason", "eligible_at", "order_item_id"]) {
      await queryInterface.removeColumn("seller_commissions", column, { transaction }).catch(() => {});
    }
    for (const column of ["delivered_at", "shipped_at", "tracking_url"]) {
      await queryInterface.removeColumn("shipments", column, { transaction }).catch(() => {});
    }
    for (const column of ["payout_id", "commission_id", "payout_hold_reason", "payout_status", "payout_eligible_at", "returnable", "delivered_at"]) {
      await queryInterface.removeColumn("order_items", column, { transaction }).catch(() => {});
    }
  },
};
