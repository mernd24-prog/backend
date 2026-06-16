"use strict";

module.exports = {
  id: "026-deal-management-foundation",
  async up({ queryInterface, Sequelize, transaction }) {
    const now = Sequelize.fn("NOW");
    const tables = await queryInterface.showAllTables();

    if (!tables.includes("deals")) {
      await queryInterface.createTable("deals", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        deal_number: { type: Sequelize.STRING(80), allowNull: false, unique: true },
        title: { type: Sequelize.STRING(180), allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        seller_id: { type: Sequelize.STRING(64), allowNull: false },
        product_id: { type: Sequelize.STRING(64), allowNull: false },
        variant_id: { type: Sequelize.STRING(64), allowNull: true },
        variant_sku: { type: Sequelize.STRING(128), allowNull: true },
        category: { type: Sequelize.STRING(180), allowNull: true },
        deal_type: { type: Sequelize.STRING(48), allowNull: false },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "draft" },
        original_price: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        deal_price: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
        discount_percent: { type: Sequelize.DECIMAL(8, 4), allowNull: true },
        allocated_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        reserved_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        sold_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        max_quantity_per_order: { type: Sequelize.INTEGER, allowNull: true },
        start_at: { type: Sequelize.DATE, allowNull: false },
        end_at: { type: Sequelize.DATE, allowNull: false },
        approved_at: { type: Sequelize.DATE, allowNull: true },
        approved_by: { type: Sequelize.STRING(64), allowNull: true },
        rejected_at: { type: Sequelize.DATE, allowNull: true },
        rejection_reason: { type: Sequelize.TEXT, allowNull: true },
        paused_at: { type: Sequelize.DATE, allowNull: true },
        cancelled_at: { type: Sequelize.DATE, allowNull: true },
        fulfillment_model: { type: Sequelize.STRING(48), allowNull: false, defaultValue: "seller_fulfilled" },
        delivery_verification_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        delivery_verification_methods: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        inventory_policy: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        finance_policy: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        sponsorship_policy: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        commission_rule_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        terms_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_by: { type: Sequelize.STRING(64), allowNull: true },
        updated_by: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      }, { transaction });
      await queryInterface.addIndex("deals", ["seller_id", "status"], { name: "idx_deals_seller_status", transaction });
      await queryInterface.addIndex("deals", ["product_id", "variant_sku", "status"], { name: "idx_deals_product_variant_status", transaction });
      await queryInterface.addIndex("deals", ["status", "start_at", "end_at"], { name: "idx_deals_status_dates", transaction });
    }

    if (!tables.includes("deal_commission_rules")) {
      await queryInterface.createTable("deal_commission_rules", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        deal_id: { type: Sequelize.UUID, allowNull: false },
        seller_id: { type: Sequelize.STRING(64), allowNull: false },
        rule_type: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "percentage" },
        commission_percent: { type: Sequelize.DECIMAL(8, 4), allowNull: false, defaultValue: 0 },
        fixed_fee: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        cap_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
        tiers: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        applies_on: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "sale" },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_by: { type: Sequelize.STRING(64), allowNull: true },
        updated_by: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      }, { transaction });
      await queryInterface.addIndex("deal_commission_rules", ["deal_id", "status"], { name: "idx_deal_commission_rules_deal_status", transaction });
    }

    if (!tables.includes("deal_timeline")) {
      await queryInterface.createTable("deal_timeline", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        deal_id: { type: Sequelize.UUID, allowNull: false },
        event_type: { type: Sequelize.STRING(80), allowNull: false },
        from_status: { type: Sequelize.STRING(32), allowNull: true },
        to_status: { type: Sequelize.STRING(32), allowNull: true },
        note: { type: Sequelize.TEXT, allowNull: true },
        reason: { type: Sequelize.TEXT, allowNull: true },
        payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        actor_id: { type: Sequelize.STRING(64), allowNull: true },
        actor_role: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      }, { transaction });
      await queryInterface.addIndex("deal_timeline", ["deal_id", "created_at"], { name: "idx_deal_timeline_deal_created", transaction });
    }

    if (!tables.includes("deal_sales")) {
      await queryInterface.createTable("deal_sales", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        deal_id: { type: Sequelize.UUID, allowNull: false },
        order_id: { type: Sequelize.UUID, allowNull: false },
        order_item_id: { type: Sequelize.UUID, allowNull: false },
        seller_id: { type: Sequelize.STRING(64), allowNull: false },
        product_id: { type: Sequelize.STRING(64), allowNull: false },
        variant_id: { type: Sequelize.STRING(64), allowNull: true },
        variant_sku: { type: Sequelize.STRING(128), allowNull: true },
        quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        unit_price: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        line_total: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        commission_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        payout_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        sale_status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "reserved" },
        payout_eligible: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        payout_id: { type: Sequelize.UUID, allowNull: true },
        fulfillment_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        deal_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      }, { transaction });
      await queryInterface.addIndex("deal_sales", ["deal_id", "sale_status"], { name: "idx_deal_sales_deal_status", transaction });
      await queryInterface.addIndex("deal_sales", ["seller_id", "created_at"], { name: "idx_deal_sales_seller_created", transaction });
      await queryInterface.addIndex("deal_sales", ["order_id"], { name: "idx_deal_sales_order", transaction });
      await queryInterface.addIndex("deal_sales", ["deal_id", "order_item_id"], { name: "uq_deal_sales_deal_order_item", unique: true, transaction });
    }

    if (!tables.includes("deal_payouts")) {
      await queryInterface.createTable("deal_payouts", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        payout_number: { type: Sequelize.STRING(80), allowNull: false, unique: true },
        seller_id: { type: Sequelize.STRING(64), allowNull: false },
        deal_id: { type: Sequelize.UUID, allowNull: true },
        period_start: { type: Sequelize.DATEONLY, allowNull: false },
        period_end: { type: Sequelize.DATEONLY, allowNull: false },
        total_sales_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        commission_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        payout_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        currency: { type: Sequelize.STRING(8), allowNull: false, defaultValue: "INR" },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "generated" },
        sale_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        payment_reference: { type: Sequelize.STRING(180), allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_by: { type: Sequelize.STRING(64), allowNull: true },
        processed_by: { type: Sequelize.STRING(64), allowNull: true },
        processed_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      }, { transaction });
      await queryInterface.addIndex("deal_payouts", ["seller_id", "status"], { name: "idx_deal_payouts_seller_status", transaction });
      await queryInterface.addIndex("deal_payouts", ["deal_id"], { name: "idx_deal_payouts_deal", transaction });
    }

    if (!tables.includes("deal_sponsorships")) {
      await queryInterface.createTable("deal_sponsorships", {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        deal_id: { type: Sequelize.UUID, allowNull: false },
        placement: { type: Sequelize.STRING(80), allowNull: false },
        title: { type: Sequelize.STRING(180), allowNull: true },
        cta_text: { type: Sequelize.STRING(80), allowNull: true },
        asset_url: { type: Sequelize.STRING(600), allowNull: true },
        target_url: { type: Sequelize.STRING(600), allowNull: true },
        priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 100 },
        start_at: { type: Sequelize.DATE, allowNull: true },
        end_at: { type: Sequelize.DATE, allowNull: true },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: "active" },
        region_scope: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        audience_scope: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_by: { type: Sequelize.STRING(64), allowNull: true },
        updated_by: { type: Sequelize.STRING(64), allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
      }, { transaction });
      await queryInterface.addIndex("deal_sponsorships", ["placement", "status", "priority"], { name: "idx_deal_sponsorships_placement_status", transaction });
      await queryInterface.addIndex("deal_sponsorships", ["deal_id", "placement"], { name: "uq_deal_sponsorships_deal_placement", unique: true, transaction });
    }

    const orderItemColumns = await queryInterface.describeTable("order_items").catch(() => ({}));
    if (!orderItemColumns.deal_id) {
      await queryInterface.addColumn("order_items", "deal_id", { type: Sequelize.UUID, allowNull: true }, { transaction });
      await queryInterface.addIndex("order_items", ["deal_id"], { name: "idx_order_items_deal_id", transaction });
    }
    if (!orderItemColumns.deal_snapshot) {
      await queryInterface.addColumn("order_items", "deal_snapshot", { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, { transaction });
    }
    if (!orderItemColumns.fulfillment_snapshot) {
      await queryInterface.addColumn("order_items", "fulfillment_snapshot", { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, { transaction });
    }

    const shipmentColumns = await queryInterface.describeTable("shipments").catch(() => ({}));
    if (Object.keys(shipmentColumns).length && !shipmentColumns.deal_id) {
      await queryInterface.addColumn("shipments", "deal_id", { type: Sequelize.UUID, allowNull: true }, { transaction });
      await queryInterface.addIndex("shipments", ["deal_id"], { name: "idx_shipments_deal_id", transaction });
    }
    if (Object.keys(shipmentColumns).length && !shipmentColumns.fulfillment_model) {
      await queryInterface.addColumn("shipments", "fulfillment_model", { type: Sequelize.STRING(48), allowNull: true }, { transaction });
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeColumn("shipments", "fulfillment_model", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "deal_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "fulfillment_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "deal_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "deal_id", { transaction }).catch(() => {});
    await queryInterface.dropTable("deal_sponsorships", { transaction }).catch(() => {});
    await queryInterface.dropTable("deal_payouts", { transaction }).catch(() => {});
    await queryInterface.dropTable("deal_sales", { transaction }).catch(() => {});
    await queryInterface.dropTable("deal_timeline", { transaction }).catch(() => {});
    await queryInterface.dropTable("deal_commission_rules", { transaction }).catch(() => {});
    await queryInterface.dropTable("deals", { transaction }).catch(() => {});
  },
};
