"use strict";

module.exports = {
  id: "025-delivery-verification",
  async up({ queryInterface, Sequelize, transaction }) {
    const shipmentColumns = await queryInterface.describeTable("shipments", { transaction });

    if (!shipmentColumns.verification_required) {
      await queryInterface.addColumn("shipments", "verification_required", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }, { transaction });
    }

    if (!shipmentColumns.verification_methods) {
      await queryInterface.addColumn("shipments", "verification_methods", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      }, { transaction });
    }

    if (!shipmentColumns.delivery_otp_hash) {
      await queryInterface.addColumn("shipments", "delivery_otp_hash", {
        type: Sequelize.STRING(128),
        allowNull: true,
      }, { transaction });
    }

    if (!shipmentColumns.delivery_otp_expires_at) {
      await queryInterface.addColumn("shipments", "delivery_otp_expires_at", {
        type: Sequelize.DATE,
        allowNull: true,
      }, { transaction });
    }

    if (!shipmentColumns.delivery_otp_attempts) {
      await queryInterface.addColumn("shipments", "delivery_otp_attempts", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      }, { transaction });
    }

    if (!shipmentColumns.delivery_proof_snapshot) {
      await queryInterface.addColumn("shipments", "delivery_proof_snapshot", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      }, { transaction });
    }

    if (!shipmentColumns.delivered_verified_at) {
      await queryInterface.addColumn("shipments", "delivered_verified_at", {
        type: Sequelize.DATE,
        allowNull: true,
      }, { transaction });
    }

    if (!shipmentColumns.verified_by) {
      await queryInterface.addColumn("shipments", "verified_by", {
        type: Sequelize.STRING(64),
        allowNull: true,
      }, { transaction });
    }

    // Check if delivery_verification_events table exists
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_verification_events');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "delivery_verification_events",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          shipment_id: { type: Sequelize.UUID, allowNull: false },
          order_id: { type: Sequelize.UUID, allowNull: false },
          method: { type: Sequelize.STRING(32), allowNull: false },
          status: { type: Sequelize.STRING(32), allowNull: false },
          proof_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          failure_reason: { type: Sequelize.TEXT, allowNull: true },
          attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          expires_at: { type: Sequelize.DATE, allowNull: true },
          verified_at: { type: Sequelize.DATE, allowNull: true },
          source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: "manual" },
          raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          actor_id: { type: Sequelize.STRING(64), allowNull: true },
          actor_role: { type: Sequelize.STRING(64), allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );

      await queryInterface.addIndex("delivery_verification_events", ["shipment_id", "created_at"], {
        name: "idx_delivery_verification_events_shipment_created",
        transaction,
      });
    }

    await queryInterface.addIndex("shipments", ["status", "delivered_verified_at"], {
      name: "idx_shipments_status_delivered_verified_at",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("delivery_verification_events", { transaction }).catch(() => {});
    await queryInterface.removeIndex("shipments", "idx_shipments_status_delivered_verified_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "verified_by", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "delivered_verified_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "delivery_proof_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "delivery_otp_attempts", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "delivery_otp_expires_at", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "delivery_otp_hash", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "verification_methods", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "verification_required", { transaction }).catch(() => {});
  },
};
