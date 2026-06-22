"use strict";

module.exports = {
  id: "033-seller-organizations",
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

    await q("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    await q(`
      CREATE TABLE IF NOT EXISTS seller_organizations (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL,
        legal_business_name VARCHAR(180) NOT NULL,
        store_display_name VARCHAR(180) NOT NULL,
        business_type VARCHAR(64),
        gstin VARCHAR(32),
        pan VARCHAR(32),
        kyc_status VARCHAR(32) NOT NULL DEFAULT 'not_submitted',
        bank_verification_status VARCHAR(32) NOT NULL DEFAULT 'not_submitted',
        approval_status VARCHAR(32) NOT NULL DEFAULT 'draft',
        documents JSONB NOT NULL DEFAULT '{}'::jsonb,
        bank_details JSONB NOT NULL DEFAULT '{}'::jsonb,
        billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
        pickup_address JSONB NOT NULL DEFAULT '{}'::jsonb,
        return_address JSONB NOT NULL DEFAULT '{}'::jsonb,
        tax_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        invoice_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        payout_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        suspended_at TIMESTAMPTZ,
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_organizations_gstin
      ON seller_organizations (gstin)
      WHERE gstin IS NOT NULL AND gstin <> '';
    `);
    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_organizations_seller_default
      ON seller_organizations (seller_id)
      WHERE is_default = TRUE;
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_organizations_seller_status
      ON seller_organizations (seller_id, approval_status);
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_organizations_kyc_bank
      ON seller_organizations (kyc_status, bank_verification_status);
    `);

    const sellerKycColumns = await describe("seller_kyc");
    if (sellerKycColumns.seller_id) {
      await addColumnIfMissing("seller_kyc", sellerKycColumns, "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await q(`
        INSERT INTO seller_organizations (
          id,
          seller_id,
          legal_business_name,
          store_display_name,
          business_type,
          gstin,
          pan,
          kyc_status,
          approval_status,
          documents,
          metadata,
          is_default,
          created_by,
          updated_by,
          created_at,
          updated_at
        )
        SELECT
          gen_random_uuid(),
          seller_id,
          COALESCE(NULLIF(legal_name, ''), CONCAT('Seller ', seller_id)),
          COALESCE(NULLIF(legal_name, ''), CONCAT('Seller ', seller_id)),
          business_type,
          NULLIF(gst_number, ''),
          NULLIF(pan_number, ''),
          COALESCE(NULLIF(verification_status, ''), 'submitted'),
          CASE
            WHEN verification_status = 'verified' THEN 'approved'
            WHEN verification_status = 'rejected' THEN 'rejected'
            ELSE 'pending_review'
          END,
          COALESCE(documents, '{}'::jsonb),
          jsonb_build_object('source', 'seller_kyc_backfill'),
          TRUE,
          seller_id,
          seller_id,
          COALESCE(submitted_at, NOW()),
          NOW()
        FROM seller_kyc sk
        WHERE NOT EXISTS (
          SELECT 1
          FROM seller_organizations so
          WHERE so.seller_id = sk.seller_id
            AND so.is_default = TRUE
        );
      `);
      await q(`
        UPDATE seller_kyc sk
        SET organization_id = so.id
        FROM seller_organizations so
        WHERE sk.seller_id = so.seller_id
          AND so.is_default = TRUE
          AND sk.organization_id IS NULL;
      `);
      await queryInterface.addIndex("seller_kyc", ["organization_id"], {
        name: "idx_seller_kyc_organization",
        transaction,
      }).catch(() => {});
    }

    const orderItemColumns = await describe("order_items");
    await addColumnIfMissing("order_items", orderItemColumns, "organization_id", {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItemColumns, "store_id", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItemColumns, "warehouse_id", {
      type: Sequelize.STRING(64),
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
          organization_snapshot = COALESCE(NULLIF(oi.organization_snapshot, '{}'::jsonb), jsonb_build_object(
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
            'source', 'seller_default_backfill'
          ))
      FROM seller_organizations so
      WHERE oi.seller_id = so.seller_id
        AND so.is_default = TRUE
        AND oi.organization_id IS NULL;
    `);
    await queryInterface.addIndex("order_items", ["seller_id", "organization_id", "order_id"], {
      name: "idx_order_items_seller_org_order",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("order_items", ["organization_id"], {
      name: "idx_order_items_organization",
      transaction,
    }).catch(() => {});

    const taxInvoiceColumns = await describe("tax_invoices");
    await addColumnIfMissing("tax_invoices", taxInvoiceColumns, "organization_id", {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await addColumnIfMissing("tax_invoices", taxInvoiceColumns, "organization_snapshot", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await queryInterface.addIndex("tax_invoices", ["organization_id", "issued_at"], {
      name: "idx_tax_invoices_organization_issued",
      transaction,
    }).catch(() => {});
    await q(`
      UPDATE tax_invoices ti
      SET organization_id = grouped.organization_id,
          organization_snapshot = grouped.organization_snapshot
      FROM (
        SELECT
          order_id,
          seller_id,
          organization_id,
          COALESCE((array_agg(organization_snapshot))[1], '{}'::jsonb) AS organization_snapshot
        FROM order_items
        WHERE organization_id IS NOT NULL
        GROUP BY order_id, seller_id, organization_id
      ) grouped
      WHERE ti.order_id = grouped.order_id
        AND ti.seller_id = grouped.seller_id
        AND ti.organization_id IS NULL;
    `).catch(() => {});

    const taxLedgerColumns = await describe("tax_ledger_entries");
    if (Object.keys(taxLedgerColumns).length) {
      await addColumnIfMissing("tax_ledger_entries", taxLedgerColumns, "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await addColumnIfMissing("tax_ledger_entries", taxLedgerColumns, "organization_snapshot", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
      await queryInterface.addIndex("tax_ledger_entries", ["organization_id", "created_at"], {
        name: "idx_tax_ledger_entries_organization_created",
        transaction,
      }).catch(() => {});
      await q(`
        UPDATE tax_ledger_entries tle
        SET organization_id = ti.organization_id,
            organization_snapshot = COALESCE(NULLIF(ti.organization_snapshot, '{}'::jsonb), '{}'::jsonb)
        FROM tax_invoices ti
        WHERE tle.invoice_id = ti.id
          AND ti.organization_id IS NOT NULL
          AND tle.organization_id IS NULL;
      `).catch(() => {});
    }

    const taxCreditNoteColumns = await describe("tax_credit_notes");
    if (Object.keys(taxCreditNoteColumns).length) {
      await addColumnIfMissing("tax_credit_notes", taxCreditNoteColumns, "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await addColumnIfMissing("tax_credit_notes", taxCreditNoteColumns, "organization_snapshot", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
      await queryInterface.addIndex("tax_credit_notes", ["organization_id", "issued_at"], {
        name: "idx_tax_credit_notes_organization_issued",
        transaction,
      }).catch(() => {});
      await q(`
        UPDATE tax_credit_notes tcn
        SET organization_id = ti.organization_id,
            organization_snapshot = COALESCE(NULLIF(ti.organization_snapshot, '{}'::jsonb), '{}'::jsonb)
        FROM tax_invoices ti
        WHERE tcn.invoice_id = ti.id
          AND ti.organization_id IS NOT NULL
          AND tcn.organization_id IS NULL;
      `).catch(() => {});
    }

    for (const table of ["seller_commissions", "seller_payouts", "seller_settlements"]) {
      const columns = await describe(table);
      if (!Object.keys(columns).length) continue;
      await addColumnIfMissing(table, columns, "organization_id", {
        type: Sequelize.UUID,
        allowNull: true,
      });
      await addColumnIfMissing(table, columns, "organization_snapshot", {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
    }

    await q(`
      UPDATE seller_commissions sc
      SET organization_id = grouped.organization_id,
          organization_snapshot = grouped.organization_snapshot
      FROM (
        SELECT
          order_id,
          seller_id,
          organization_id,
          COALESCE((array_agg(organization_snapshot))[1], '{}'::jsonb) AS organization_snapshot
        FROM order_items
        WHERE organization_id IS NOT NULL
        GROUP BY order_id, seller_id, organization_id
      ) grouped
      WHERE sc.order_id = grouped.order_id
        AND sc.seller_id = grouped.seller_id
        AND sc.organization_id IS NULL;
    `).catch(() => {});
    await q(`
      UPDATE seller_payouts sp
      SET organization_id = first_commission.organization_id,
          organization_snapshot = first_commission.organization_snapshot
      FROM (
        SELECT DISTINCT ON (payout_id)
          payout_id,
          organization_id,
          organization_snapshot
        FROM seller_commissions
        WHERE payout_id IS NOT NULL
          AND organization_id IS NOT NULL
        ORDER BY payout_id, created_at ASC
      ) first_commission
      WHERE sp.id = first_commission.payout_id
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

    await q("DROP INDEX IF EXISTS uniq_seller_commissions_seller_order;");
    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_commissions_seller_org_order
      ON seller_commissions (seller_id, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), order_id);
    `).catch(() => {});
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_commissions_org_status_created
      ON seller_commissions (seller_id, organization_id, status, created_at);
    `).catch(() => {});
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_payouts_org_status_created
      ON seller_payouts (seller_id, organization_id, status, created_at);
    `).catch(() => {});
    await q(`
      CREATE INDEX IF NOT EXISTS idx_seller_settlements_org_created
      ON seller_settlements (seller_id, organization_id, created_at);
    `).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q("DROP INDEX IF EXISTS idx_seller_settlements_org_created;").catch(() => {});
    await q("DROP INDEX IF EXISTS idx_seller_payouts_org_status_created;").catch(() => {});
    await q("DROP INDEX IF EXISTS idx_seller_commissions_org_status_created;").catch(() => {});
    await q("DROP INDEX IF EXISTS uniq_seller_commissions_seller_org_order;").catch(() => {});
    await q("CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_commissions_seller_order ON seller_commissions (seller_id, order_id);").catch(() => {});

    for (const table of ["seller_settlements", "seller_payouts", "seller_commissions"]) {
      await queryInterface.removeColumn(table, "organization_snapshot", { transaction }).catch(() => {});
      await queryInterface.removeColumn(table, "organization_id", { transaction }).catch(() => {});
    }
    await queryInterface.removeIndex("tax_credit_notes", "idx_tax_credit_notes_organization_issued", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_credit_notes", "organization_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_credit_notes", "organization_id", { transaction }).catch(() => {});
    await queryInterface.removeIndex("tax_ledger_entries", "idx_tax_ledger_entries_organization_created", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_ledger_entries", "organization_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_ledger_entries", "organization_id", { transaction }).catch(() => {});
    await queryInterface.removeIndex("tax_invoices", "idx_tax_invoices_organization_issued", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "organization_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("tax_invoices", "organization_id", { transaction }).catch(() => {});
    await queryInterface.removeIndex("order_items", "idx_order_items_organization", { transaction }).catch(() => {});
    await queryInterface.removeIndex("order_items", "idx_order_items_seller_org_order", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "organization_snapshot", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "warehouse_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "store_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("order_items", "organization_id", { transaction }).catch(() => {});
    await queryInterface.removeIndex("seller_kyc", "idx_seller_kyc_organization", { transaction }).catch(() => {});
    await queryInterface.removeColumn("seller_kyc", "organization_id", { transaction }).catch(() => {});
    await q("DROP TABLE IF EXISTS seller_organizations;").catch(() => {});
  },
};
