"use strict";

module.exports = {
  id: "044-remove-deal-delivery-verification",
  async up({ queryInterface, transaction }) {
    const columns = await queryInterface.describeTable("deals", { transaction });
    await queryInterface.sequelize.query(
      "UPDATE deal_sales SET sale_status = 'delivered' WHERE sale_status = 'delivered_verified'",
      { transaction },
    );
    for (const column of ["delivery_verification_methods", "delivery_verification_required"]) {
      if (columns[column]) await queryInterface.removeColumn("deals", column, { transaction });
    }
  },
  async down({ queryInterface, Sequelize, transaction }) {
    const columns = await queryInterface.describeTable("deals", { transaction });
    if (!columns.delivery_verification_required) await queryInterface.addColumn("deals", "delivery_verification_required", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, { transaction });
    if (!columns.delivery_verification_methods) await queryInterface.addColumn("deals", "delivery_verification_methods", { type: Sequelize.JSONB, allowNull: false, defaultValue: [] }, { transaction });
  },
};
