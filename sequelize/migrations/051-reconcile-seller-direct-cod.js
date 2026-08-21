"use strict";

module.exports = {
  id: "051-reconcile-seller-direct-cod",

  async up({ queryInterface, transaction }) {
    const tables = (await queryInterface.showAllTables({ transaction })).map(String);
    if (!tables.includes("cod_collections")) return;

    // Earlier Admin UI defaulted the remittance checkbox to true. A remitted
    // collection with a still-pending recovery proves that cash was only
    // verified as seller-held, so restore the accurate state.
    if (tables.includes("seller_settlement_adjustments")) {
      await queryInterface.sequelize.query(
        `UPDATE cod_collections c
         SET status = 'verified', remitted_at = NULL, updated_at = NOW()
         WHERE c.status = 'remitted'
           AND c.collection_mode = 'seller_direct'
           AND EXISTS (
             SELECT 1 FROM seller_settlement_adjustments a
             WHERE a.cod_collection_id = c.id
               AND a.type = 'cod_recovery'
               AND a.status = 'pending'
           )`,
        { transaction },
      );
    }

    if (tables.includes("payments")) {
      await queryInterface.sequelize.query(
        `UPDATE payments p
         SET status = 'captured',
             verification_method = 'seller_cod_collection_verified',
             verified_at = COALESCE(p.verified_at, NOW()),
             updated_at = NOW(),
             metadata = COALESCE(p.metadata, '{}'::jsonb) ||
               jsonb_build_object('codCollectionVerified', true, 'reconciledByMigration', true)
         WHERE p.provider = 'cod'
           AND p.status <> 'captured'
           AND EXISTS (SELECT 1 FROM cod_collections c WHERE c.order_id = p.order_id)
           AND NOT EXISTS (
             SELECT 1 FROM cod_collections c
             WHERE c.order_id = p.order_id
               AND c.status NOT IN ('verified', 'remitted')
           )
           AND (
             SELECT COALESCE(SUM(c.collected_amount), 0)
             FROM cod_collections c
             WHERE c.order_id = p.order_id
           ) >= p.amount`,
        { transaction },
      );
    }

    if (tables.includes("orders") && tables.includes("payments")) {
      await queryInterface.sequelize.query(
        `UPDATE orders o
         SET payment_status = 'captured', updated_at = NOW()
         WHERE o.payment_provider = 'cod'
           AND o.payment_status <> 'captured'
           AND EXISTS (
             SELECT 1 FROM payments p
             WHERE p.order_id = o.id
               AND p.provider = 'cod'
               AND p.status = 'captured'
           )`,
        { transaction },
      );
    }
  },

  async down() {},
};
