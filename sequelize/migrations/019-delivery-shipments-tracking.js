"use strict";

module.exports = {
  id: "019-delivery-shipments-tracking",
  async up({ queryInterface, Sequelize, transaction }) {
    const now = Sequelize.fn("NOW");

    await queryInterface.createTable(
      "shipments",
      {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        order_id: { type: Sequelize.UUID, allowNull: false },
        seller_id: { type: Sequelize.STRING(64), allowNull: false },
        provider: { type: Sequelize.STRING(64), allowNull: false, defaultValue: "manual" },
        courier_name: { type: Sequelize.STRING(160), allowNull: true },
        awb_number: { type: Sequelize.STRING(160), allowNull: true },
        tracking_number: { type: Sequelize.STRING(160), allowNull: true },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "initiated" },
        shipping_mode: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "standard" },
        cod: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        package_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        pickup_address_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        ship_to_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        rate_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        label_data: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        manifest_id: { type: Sequelize.UUID, allowNull: true },
        delivery_exception: { type: Sequelize.STRING(128), allowNull: true },
        expected_delivery_at: { type: Sequelize.DATE, allowNull: true },
        idempotency_key: { type: Sequelize.STRING(180), allowNull: true, unique: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_by: { type: Sequelize.STRING(64), allowNull: true },
        updated_by: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      },
      { transaction },
    );

    await queryInterface.createTable(
      "shipment_tracking_events",
      {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        shipment_id: { type: Sequelize.UUID, allowNull: false },
        order_id: { type: Sequelize.UUID, allowNull: false },
        status: { type: Sequelize.STRING(32), allowNull: false },
        event_time: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        location: { type: Sequelize.STRING(180), allowNull: true },
        note: { type: Sequelize.TEXT, allowNull: true },
        source: { type: Sequelize.STRING(64), allowNull: false, defaultValue: "manual" },
        raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        actor_id: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      },
      { transaction },
    );

    await queryInterface.createTable(
      "shipment_manifests",
      {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        manifest_number: { type: Sequelize.STRING(80), allowNull: false, unique: true },
        courier_name: { type: Sequelize.STRING(160), allowNull: true },
        shipment_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "created" },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_by: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      },
      { transaction },
    );

    await queryInterface.addIndex("shipments", ["order_id", "status"], { transaction });
    await queryInterface.addIndex("shipments", ["seller_id", "status"], { transaction });
    await queryInterface.addIndex("shipments", ["awb_number"], { transaction });
    await queryInterface.addIndex("shipment_tracking_events", ["shipment_id", "event_time"], { transaction });
    await queryInterface.addIndex("shipment_manifests", ["created_at"], { transaction });
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("shipment_tracking_events", { transaction });
    await queryInterface.dropTable("shipment_manifests", { transaction });
    await queryInterface.dropTable("shipments", { transaction });
  },
};
