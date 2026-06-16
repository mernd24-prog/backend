"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const orders = await queryInterface.describeTable("orders", { transaction });
      if (!orders.shipping_fee_amount) {
        await queryInterface.addColumn(
          "orders",
          "shipping_fee_amount",
          {
            type: Sequelize.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
          },
          { transaction },
        );
      }

      await queryInterface.createTable(
        "seller_charge_settings",
        {
          seller_id: {
            type: Sequelize.STRING(64),
            allowNull: false,
            primaryKey: true,
          },
          settings: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          updated_by: {
            type: Sequelize.STRING(64),
            allowNull: true,
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("NOW"),
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("NOW"),
          },
        },
        { transaction },
      ).catch((error) => {
        if (error?.name !== "SequelizeDatabaseError" && error?.original?.code !== "42P07") {
          throw error;
        }
      });

      await queryInterface.addIndex("seller_charge_settings", ["updated_at"], {
        name: "idx_seller_charge_settings_updated_at",
        transaction,
      }).catch(() => {});

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeIndex("seller_charge_settings", "idx_seller_charge_settings_updated_at", { transaction }).catch(() => {});
      await queryInterface.dropTable("seller_charge_settings", { transaction }).catch(() => {});
      await queryInterface.removeColumn("orders", "shipping_fee_amount", { transaction }).catch(() => {});
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
