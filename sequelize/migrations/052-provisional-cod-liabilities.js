"use strict";

const { v4: uuidv4 } = require("uuid");

// Backfill financial exposure for seller-held COD cash. The collection row is
// created at delivery, so finance must not depend on a later seller response.
module.exports = {
  id: "052-provisional-cod-liabilities",

  async up({ queryInterface, transaction }) {
    const tables = (await queryInterface.showAllTables({ transaction })).map(String);
    if (
      !tables.includes("cod_collections") ||
      !tables.includes("seller_settlement_adjustments") ||
      !tables.includes("seller_settlements")
    ) return;

    const [collections] = await queryInterface.sequelize.query(
      `SELECT c.*
       FROM cod_collections c
       WHERE c.collected_by = 'seller'
         AND c.status <> 'remitted'`,
      { transaction },
    );

    for (const collection of collections) {
      const amount = Math.abs(Number(
        ["verified"].includes(collection.status) && Number(collection.collected_amount) > 0
          ? collection.collected_amount
          : collection.expected_amount,
      ));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const adjustmentAmount = -amount;
      const provisional = !["verified"].includes(collection.status);
      const metadata = JSON.stringify({
        source: "seller_direct_cod",
        expectedAmount: Number(collection.expected_amount || 0),
        collectedAmount: Number(collection.collected_amount || 0),
        liabilityStatus: provisional ? "provisional" : "recoverable",
        provisional,
        backfilledByMigration: true,
      });

      await queryInterface.sequelize.query(
        `INSERT INTO seller_settlement_adjustments
          (id, seller_id, organization_id, order_id, cod_collection_id, type,
           amount, currency, status, reference_id, notes, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'cod_recovery', ?, ?, 'pending', ?, ?, ?::jsonb, NOW(), NOW())
         ON CONFLICT (cod_collection_id, type) DO UPDATE SET
           amount = EXCLUDED.amount,
           status = 'pending',
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        {
          replacements: [
            uuidv4(), collection.seller_id, collection.organization_id,
            collection.order_id, collection.id, adjustmentAmount,
            collection.currency || "INR", collection.reference_id,
            collection.notes, metadata,
          ],
          transaction,
        },
      );

      const [existingRows] = await queryInterface.sequelize.query(
        `SELECT id FROM seller_settlements
         WHERE COALESCE(metadata, '{}'::jsonb) ->> 'codCollectionId' = ?
         LIMIT 1`,
        { replacements: [collection.id], transaction },
      );
      const recoveryMetadata = JSON.stringify({
        source: "seller_direct_cod_recovery",
        codCollectionId: collection.id,
        orderId: collection.order_id,
        expectedAmount: Number(collection.expected_amount || 0),
        collectedAmount: Number(collection.collected_amount || 0),
        liabilityStatus: provisional ? "provisional" : "recoverable",
        provisional,
        adjustmentType: "cod_recovery",
        originalLiabilityAmount: amount,
        recoveredAmount: 0,
        remainingAmount: amount,
        backfilledByMigration: true,
      });

      if (existingRows[0]) {
        await queryInterface.sequelize.query(
          `UPDATE seller_settlements
           SET adjustment_amount = ?, net_amount = ?, status = 'pending',
               metadata = ?::jsonb, updated_at = NOW()
           WHERE id = ?`,
          {
            replacements: [adjustmentAmount, adjustmentAmount, recoveryMetadata, existingRows[0].id],
            transaction,
          },
        );
      } else {
        await queryInterface.sequelize.query(
          `INSERT INTO seller_settlements
            (id, seller_id, organization_id, settlement_date, gross_amount,
             commission_amount, tax_amount, refund_amount, adjustment_amount,
             net_amount, currency, status, notes, metadata, created_at, updated_at)
           VALUES (?, ?, ?, CURRENT_DATE, 0, 0, 0, 0, ?, ?, ?, 'pending',
             'Seller-direct COD collection recovery', ?::jsonb, NOW(), NOW())`,
          {
            replacements: [
              uuidv4(), collection.seller_id, collection.organization_id,
              adjustmentAmount, adjustmentAmount, collection.currency || "INR",
              recoveryMetadata,
            ],
            transaction,
          },
        );
      }
    }
  },

  async down() {},
};
