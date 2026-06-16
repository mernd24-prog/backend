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

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS delivery_verification_events (
        id UUID PRIMARY KEY,
        shipment_id UUID NOT NULL,
        order_id UUID NOT NULL,
        method VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL,
        proof_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        failure_reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ,
        verified_at TIMESTAMPTZ,
        source VARCHAR(64) NOT NULL DEFAULT 'manual',
        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        actor_id VARCHAR(64),
        actor_role VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.addIndex("shipments", ["status", "delivered_verified_at"], {
      name: "idx_shipments_status_delivered_verified_at",
      transaction,
    }).catch(() => {});

    await queryInterface.addIndex("delivery_verification_events", ["shipment_id", "created_at"], {
      name: "idx_delivery_verification_events_shipment_created",
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
