"use strict";

module.exports = {
  id: "047-seller-payout-profiles",

  async up({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q(`
      CREATE TABLE IF NOT EXISTS seller_payout_profiles (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL,
        organization_id UUID,
        payout_destination VARCHAR(32) NOT NULL DEFAULT 'razorpayx',
        bank_details JSONB NOT NULL DEFAULT '{}'::jsonb,
        bank_verification_status VARCHAR(32) NOT NULL DEFAULT 'submitted',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_payout_profiles_org
      ON seller_payout_profiles(seller_id, organization_id)
      WHERE organization_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_payout_profiles_default
      ON seller_payout_profiles(seller_id)
      WHERE organization_id IS NULL;

      CREATE INDEX IF NOT EXISTS idx_seller_payout_profiles_seller
      ON seller_payout_profiles(seller_id);
    `);
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("seller_payout_profiles", { transaction }).catch(() => {});
  },
};
