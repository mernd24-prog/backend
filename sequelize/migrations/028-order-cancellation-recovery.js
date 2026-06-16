"use strict";

module.exports = {
  id: "028-order-cancellation-recovery",
  async up({ queryInterface, Sequelize, transaction }) {
    const now = Sequelize.fn("NOW");
    const orderColumns = await queryInterface.describeTable("orders", { transaction });
    const itemColumns = await queryInterface.describeTable("order_items", { transaction });
    const trackingColumns = await queryInterface.describeTable("shipment_tracking_events", { transaction });
    const dealSaleColumns = await queryInterface.describeTable("deal_sales", { transaction }).catch(() => ({}));

    if (!orderColumns.cancellation_status) {
      await queryInterface.addColumn("orders", "cancellation_status", {
        type: Sequelize.STRING(32), allowNull: true,
      }, { transaction });
    }
    if (!orderColumns.cancelled_amount) {
      await queryInterface.addColumn("orders", "cancelled_amount", {
        type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0,
      }, { transaction });
    }
    if (!itemColumns.cancelled_quantity) {
      await queryInterface.addColumn("order_items", "cancelled_quantity", {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 0,
      }, { transaction });
    }
    if (!itemColumns.cancellation_status) {
      await queryInterface.addColumn("order_items", "cancellation_status", {
        type: Sequelize.STRING(32), allowNull: true,
      }, { transaction });
    }
    if (!itemColumns.cancellation_snapshot) {
      await queryInterface.addColumn("order_items", "cancellation_snapshot", {
        type: Sequelize.JSONB, allowNull: false, defaultValue: {},
      }, { transaction });
    }
    if (!trackingColumns.idempotency_key) {
      await queryInterface.addColumn("shipment_tracking_events", "idempotency_key", {
        type: Sequelize.STRING(180), allowNull: true,
      }, { transaction });
      await queryInterface.addIndex("shipment_tracking_events", ["idempotency_key"], {
        name: "uq_shipment_tracking_events_idempotency",
        unique: true,
        transaction,
      }).catch(() => {});
    }
    if (Object.keys(dealSaleColumns).length && !dealSaleColumns.cancelled_quantity) {
      await queryInterface.addColumn("deal_sales", "cancelled_quantity", {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 0,
      }, { transaction });
    }
    if (Object.keys(dealSaleColumns).length && !dealSaleColumns.cancellation_history) {
      await queryInterface.addColumn("deal_sales", "cancellation_history", {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      }, { transaction });
    }

    await queryInterface.createTable("order_cancellations", {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      cancellation_number: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      order_id: { type: Sequelize.UUID, allowNull: false },
      buyer_id: { type: Sequelize.STRING(64), allowNull: false },
      scope: { type: Sequelize.STRING(16), allowNull: false, defaultValue: "full" },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "processing" },
      reason_code: { type: Sequelize.STRING(64), allowNull: true },
      reason: { type: Sequelize.TEXT, allowNull: false },
      source_order_status: { type: Sequelize.STRING(32), allowNull: false },
      items: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      refund_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      wallet_refund_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      provider_refund_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      refund_method: { type: Sequelize.STRING(32), allowNull: true },
      refund_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "not_required" },
      payment_id: { type: Sequelize.UUID, allowNull: true },
      payment_provider: { type: Sequelize.STRING(64), allowNull: true },
      provider_refund_id: { type: Sequelize.STRING(180), allowNull: true },
      inventory_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
      shipment_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
      finance_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "pending" },
      credit_note_id: { type: Sequelize.UUID, allowNull: true },
      attempts: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      idempotency_key: { type: Sequelize.STRING(180), allowNull: false, unique: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      requested_by: { type: Sequelize.STRING(64), allowNull: true },
      requested_by_role: { type: Sequelize.STRING(64), allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
    }, { transaction }).catch((error) => {
      if (error?.original?.code !== "42P07") throw error;
    });

    await queryInterface.addIndex("order_cancellations", ["order_id", "created_at"], {
      name: "idx_order_cancellations_order_created", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("order_cancellations", ["status", "refund_status"], {
      name: "idx_order_cancellations_status_refund", transaction,
    }).catch(() => {});
    await queryInterface.addIndex("orders", ["cancellation_status", "created_at"], {
      name: "idx_orders_cancellation_status_created", transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("order_cancellations", { transaction }).catch(() => {});
    await queryInterface.removeIndex("orders", "idx_orders_cancellation_status_created", { transaction }).catch(() => {});
    await queryInterface.removeIndex("shipment_tracking_events", "uq_shipment_tracking_events_idempotency", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipment_tracking_events", "idempotency_key", { transaction }).catch(() => {});
    await queryInterface.removeColumn("deal_sales", "cancellation_history", { transaction }).catch(() => {});
    await queryInterface.removeColumn("deal_sales", "cancelled_quantity", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "cancellation_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "cancellation_status", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "cancelled_quantity", { transaction }).catch(() => {});
    await queryInterface.removeColumn("orders", "cancelled_amount", { transaction }).catch(() => {});
    await queryInterface.removeColumn("orders", "cancellation_status", { transaction }).catch(() => {});
  },
};
