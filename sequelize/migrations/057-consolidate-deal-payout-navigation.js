"use strict";

module.exports = {
  id: "057-consolidate-deal-payout-navigation",
  async up({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      `UPDATE modules SET is_visible_in_sidebar = false
       WHERE module_key IN ('deal-payouts', 'sidebar-deal-payouts')
          OR slug IN ('deal-payouts', 'sidebar-deal-payouts')`,
      { transaction },
    );
  },
  async down({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      `UPDATE modules SET is_visible_in_sidebar = true
       WHERE module_key = 'sidebar-deal-payouts' OR slug = 'sidebar-deal-payouts'`,
      { transaction },
    );
  },
};
