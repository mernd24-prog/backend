"use strict";

module.exports = {
  id: "037-complete-organization-ownership",
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

    const orderItemColumns = await describe("order_items");
    if (Object.keys(orderItemColumns).length) {
      await addColumnIfMissing("order_items", orderItemColumns, "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await addColumnIfMissing("order_items", orderItemColumns, "organization_snapshot", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
      await q(`
        UPDATE order_items oi
        SET organization_id = so.id,
            organization_snapshot = CASE
              WHEN COALESCE(oi.organization_snapshot, '{}'::jsonb) = '{}'::jsonb
              THEN jsonb_build_object(
                'organizationId', so.id,
                'sellerId', so.seller_id,
                'legalBusinessName', so.legal_business_name,
                'storeDisplayName', so.store_display_name,
                'gstin', so.gstin,
                'pan', so.pan,
                'billingAddress', so.billing_address,
                'pickupAddress', so.pickup_address,
                'taxSettings', so.tax_settings,
                'invoiceSettings', so.invoice_settings,
                'payoutSettings', so.payout_settings,
                'source', 'organization_ownership_backfill'
              )
              ELSE oi.organization_snapshot
            END
        FROM seller_organizations so
        WHERE oi.seller_id = so.seller_id
          AND so.is_default = TRUE
          AND oi.organization_id IS NULL;
      `);
    }

    const shipmentColumns = await describe("shipments");
    if (Object.keys(shipmentColumns).length) {
      await addColumnIfMissing("shipments", shipmentColumns, "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await addColumnIfMissing("shipments", shipmentColumns, "organization_snapshot", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
      await q(`
        UPDATE shipments s
        SET organization_id = grouped.organization_id,
            organization_snapshot = grouped.organization_snapshot
        FROM (
          SELECT DISTINCT ON (order_id, seller_id)
            order_id,
            seller_id,
            organization_id,
            organization_snapshot
          FROM order_items
          WHERE organization_id IS NOT NULL
          ORDER BY order_id, seller_id, id
        ) grouped
        WHERE s.order_id = grouped.order_id
          AND s.seller_id = grouped.seller_id
          AND s.organization_id IS NULL;
      `);
      await q(`
        UPDATE shipments s
        SET organization_id = so.id,
            organization_snapshot = jsonb_build_object(
              'organizationId', so.id,
              'sellerId', so.seller_id,
              'legalBusinessName', so.legal_business_name,
              'storeDisplayName', so.store_display_name,
              'gstin', so.gstin,
              'pickupAddress', so.pickup_address,
              'source', 'seller_default_backfill'
            )
        FROM seller_organizations so
        WHERE s.seller_id = so.seller_id
          AND so.is_default = TRUE
          AND s.organization_id IS NULL;
      `);
      await q(`
        CREATE INDEX IF NOT EXISTS idx_shipments_seller_org_status
        ON shipments (seller_id, organization_id, status, created_at);
      `);
    }

    const deliveryAgentColumns = await describe("delivery_agents");
    if (Object.keys(deliveryAgentColumns).length) {
      await addColumnIfMissing("delivery_agents", deliveryAgentColumns, "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await q(`
        UPDATE delivery_agents da
        SET organization_id = so.id
        FROM seller_organizations so
        WHERE da.seller_id = so.seller_id
          AND so.is_default = TRUE
          AND da.organization_id IS NULL;
      `);
      await q(`
        CREATE INDEX IF NOT EXISTS idx_delivery_agents_seller_org_active
        ON delivery_agents (seller_id, organization_id, active);
      `);
    }

    await q(`
      UPDATE tax_invoices ti
      SET organization_id = grouped.organization_id,
          organization_snapshot = grouped.organization_snapshot
      FROM (
        SELECT DISTINCT ON (order_id, seller_id)
          order_id,
          seller_id,
          organization_id,
          organization_snapshot
        FROM order_items
        WHERE organization_id IS NOT NULL
        ORDER BY order_id, seller_id, id
      ) grouped
      WHERE ti.order_id = grouped.order_id
        AND ti.seller_id = grouped.seller_id
        AND ti.organization_id IS NULL;
    `).catch(() => {});

    await q(`
      UPDATE seller_commissions sc
      SET organization_id = grouped.organization_id,
          organization_snapshot = grouped.organization_snapshot
      FROM (
        SELECT DISTINCT ON (order_id, seller_id)
          order_id,
          seller_id,
          organization_id,
          organization_snapshot
        FROM order_items
        WHERE organization_id IS NOT NULL
        ORDER BY order_id, seller_id, id
      ) grouped
      WHERE sc.order_id = grouped.order_id
        AND sc.seller_id = grouped.seller_id
        AND sc.organization_id IS NULL;
    `).catch(() => {});

    await q(`
      UPDATE seller_payouts sp
      SET organization_id = grouped.organization_id,
          organization_snapshot = grouped.organization_snapshot
      FROM (
        SELECT DISTINCT ON (payout_id)
          payout_id,
          organization_id,
          organization_snapshot
        FROM seller_commissions
        WHERE payout_id IS NOT NULL AND organization_id IS NOT NULL
        ORDER BY payout_id, created_at
      ) grouped
      WHERE sp.id = grouped.payout_id
        AND sp.organization_id IS NULL;
    `).catch(() => {});

    await q(`
      UPDATE seller_settlements ss
      SET organization_id = sp.organization_id,
          organization_snapshot = sp.organization_snapshot
      FROM seller_payouts sp
      WHERE ss.payout_id = sp.id
        AND sp.organization_id IS NOT NULL
        AND ss.organization_id IS NULL;
    `).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("DROP INDEX IF EXISTS idx_delivery_agents_seller_org_active;").catch(() => {});
    await q("DROP INDEX IF EXISTS idx_shipments_seller_org_status;").catch(() => {});
    await queryInterface.removeColumn("delivery_agents", "organization_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "organization_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("shipments", "organization_id", { transaction }).catch(() => {});
  },
};
