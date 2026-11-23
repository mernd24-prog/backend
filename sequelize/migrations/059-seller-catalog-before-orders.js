"use strict";

module.exports = {
  id: "059-seller-catalog-before-orders",
  async up({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      `UPDATE modules SET "order" = CASE
         WHEN module_key = 'sidebar-seller-catalog-management' THEN 2
         ELSE 30 END
       WHERE module_key IN ('sidebar-seller-catalog-management', 'sidebar-seller-orders-management')`,
      { transaction },
    );
  },
  async down({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      `UPDATE modules SET "order" = CASE
         WHEN module_key = 'sidebar-seller-catalog-management' THEN 30
         ELSE 2 END
       WHERE module_key IN ('sidebar-seller-catalog-management', 'sidebar-seller-orders-management')`,
      { transaction },
    );
  },
};
