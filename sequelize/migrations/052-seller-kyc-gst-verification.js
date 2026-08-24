"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("seller_kyc", "gst_verified", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    }).catch(() => {});

    await queryInterface.addColumn("seller_kyc", "gst_verified_at", {
      type: Sequelize.DATE,
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn("seller_kyc", "gst_verification_response", {
      type: Sequelize.JSONB,
      allowNull: true,
    }).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("seller_kyc", "gst_verification_response").catch(() => {});
    await queryInterface.removeColumn("seller_kyc", "gst_verified_at").catch(() => {});
    await queryInterface.removeColumn("seller_kyc", "gst_verified").catch(() => {});
  },
};
