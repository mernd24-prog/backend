"use strict";

module.exports = {
  id: "017-order-flow-foundation",
  async up({ queryInterface, Sequelize, transaction }) {
    const orders = await queryInterface.describeTable("orders", { transaction });
    const orderItems = await queryInterface.describeTable("order_items", { transaction });

    async function addColumnIfMissing(table, existing, column, definition) {
      if (!existing[column]) {
        await queryInterface.addColumn(table, column, definition, { transaction });
      }
    }

    await addColumnIfMissing("orders", orders, "order_number", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("orders", orders, "payment_status", {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "initiated",
    });
    await addColumnIfMissing("orders", orders, "delivery_status", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("orders", orders, "metadata", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("orders", orders, "created_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing("orders", orders, "updated_by", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });

    await queryInterface.sequelize.query(
      `
      UPDATE orders
      SET order_number = CONCAT('ORD-', TO_CHAR(created_at, 'YYYYMMDD'), '-', UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 10)))
      WHERE order_number IS NULL;
      `,
      { transaction },
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE orders ALTER COLUMN order_number SET NOT NULL;",
      { transaction },
    );

    await addColumnIfMissing("order_items", orderItems, "product_title", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "product_slug", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "product_sku", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "product_image", {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "brand", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "category", {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "hsn_code", {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "gst_rate", {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });
    await addColumnIfMissing("order_items", orderItems, "seller_snapshot", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("order_items", orderItems, "discount_amount", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("order_items", orderItems, "tax_amount", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("order_items", orderItems, "tax_breakup", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("order_items", orderItems, "platform_fee_amount", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addColumnIfMissing("order_items", orderItems, "pricing_snapshot", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await addColumnIfMissing("order_items", orderItems, "product_snapshot", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS order_status_history (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        from_status VARCHAR(32),
        to_status VARCHAR(32) NOT NULL,
        actor_id VARCHAR(64),
        actor_role VARCHAR(64),
        reason TEXT,
        note TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS order_notes (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        actor_id VARCHAR(64),
        actor_role VARCHAR(64),
        visibility VARCHAR(32) NOT NULL DEFAULT 'internal',
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.addIndex("orders", ["order_number"], {
      name: "idx_orders_order_number",
      unique: true,
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("orders", ["payment_status", "created_at"], {
      name: "idx_orders_payment_status_created_at",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("orders", ["delivery_status", "created_at"], {
      name: "idx_orders_delivery_status_created_at",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("order_items", ["hsn_code"], {
      name: "idx_order_items_hsn_code",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("order_status_history", ["order_id", "created_at"], {
      name: "idx_order_status_history_order_created",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("order_notes", ["order_id", "created_at"], {
      name: "idx_order_notes_order_created",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("order_notes", { transaction }).catch(() => {});
    await queryInterface.dropTable("order_status_history", { transaction }).catch(() => {});
  },
};
