"use strict";

module.exports = {
  id: "058-return-window-minute-precision",
  async up({ queryInterface, Sequelize, transaction }) {
    // Existing whole-day values are preserved. Double precision retains durations
    // expressed as minutes / 1440 without rounding a one-minute window down.
    for (const table of ["orders", "order_items"]) {
      await queryInterface.changeColumn(table, "return_window_days", {
        type: Sequelize.DOUBLE,
        allowNull: true,
      }, { transaction });
    }
  },
  async down({ queryInterface, transaction }) {
    // Round up during rollback so a purchased window cannot be shortened.
    for (const table of ["orders", "order_items"]) {
      await queryInterface.sequelize.query(
        `ALTER TABLE "${table}" ALTER COLUMN "return_window_days" TYPE INTEGER USING CEIL("return_window_days")::integer`,
        { transaction },
      );
    }
  },
};
