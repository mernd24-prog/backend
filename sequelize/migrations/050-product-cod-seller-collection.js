"use strict";

module.exports = {
  id: "050-product-cod-seller-collection",

  async up({ queryInterface, transaction }) {
    const tables = (await queryInterface.showAllTables({ transaction })).map(String);

    if (tables.includes("seller_charge_settings")) {
      await queryInterface.sequelize.query(
        `UPDATE seller_charge_settings
         SET settings = settings - 'cod', updated_at = NOW()
         WHERE settings ? 'cod'`,
        { transaction },
      );
    }

    if (tables.includes("cod_collections")) {
      await queryInterface.sequelize.query(
        `UPDATE cod_collections
         SET collection_mode = 'seller_direct',
             collected_by = 'seller',
             updated_at = NOW()
         WHERE status IN ('pending', 'submitted')
           AND collection_mode <> 'seller_direct'`,
        { transaction },
      );
    }
  },

  // Removed seller-level COD rules cannot be reconstructed after deployment.
  async down() {},
};
