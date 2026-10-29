"use strict";

// Normalizes the seller-direct COD workflow without rewriting completed
// financial history. Historical remittances and disputes remain auditable.
module.exports = {
  id: "053-cod-retained-cash-confirmation",

  async up({ queryInterface, transaction }) {
    const tables = (await queryInterface.showAllTables({ transaction })).map(String);
    if (!tables.includes("cod_collections")) return;

    // Old `submitted` rows whose metadata says retained cash are equivalent to
    // the new explicit confirmation state. Remittance/dispute submissions are
    // deliberately left untouched for manual historical reconciliation.
    await queryInterface.sequelize.query(
      `UPDATE cod_collections
       SET status = 'confirmed',
           collected_amount = expected_amount,
           reference_id = NULL,
           proof_url = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb) ||
             jsonb_build_object(
               'sellerSubmissionType', 'retained',
               'liabilityStatus', 'acknowledged',
               'normalizedByMigration', true
             ),
           updated_at = NOW()
       WHERE status = 'submitted'
         AND COALESCE(metadata, '{}'::jsonb) ->> 'sellerSubmissionType' = 'retained'`,
      { transaction },
    );
  },

  async down() {},
};
