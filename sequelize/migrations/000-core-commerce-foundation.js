module.exports = {
  id: "000-core-commerce-foundation",
  async up({ queryInterface, Sequelize, transaction }) {
    const now = Sequelize.fn("NOW");

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY,
        buyer_id VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
        coupon_code VARCHAR(64),
        wallet_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        payable_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_breakup JSONB NOT NULL DEFAULT '{}'::jsonb,
        platform_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        platform_fee_breakup JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id VARCHAR(64) NOT NULL,
        variant_id VARCHAR(64),
        variant_sku VARCHAR(128),
        variant_title VARCHAR(255),
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        seller_id VARCHAR(64) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        buyer_id VARCHAR(64) NOT NULL,
        provider VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        transaction_reference VARCHAR(160) NOT NULL,
        provider_order_id VARCHAR(160),
        provider_payment_id VARCHAR(160),
        verification_method VARCHAR(64),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        verified_at TIMESTAMPTZ,
        failed_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL UNIQUE,
        available_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        locked_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id UUID PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        reference_type VARCHAR(64) NOT NULL,
        reference_id VARCHAR(64),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS user_kyc (
        id UUID PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL UNIQUE,
        pan_number VARCHAR(32),
        aadhaar_number VARCHAR(32),
        legal_name VARCHAR(180),
        verification_status VARCHAR(32) NOT NULL DEFAULT 'draft',
        documents JSONB NOT NULL DEFAULT '{}'::jsonb,
        rejection_reason TEXT,
        submitted_at TIMESTAMPTZ,
        reviewed_by VARCHAR(64),
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS seller_kyc (
        id UUID PRIMARY KEY,
        seller_id VARCHAR(64) NOT NULL UNIQUE,
        pan_number VARCHAR(32),
        gst_number VARCHAR(32),
        aadhaar_number VARCHAR(32),
        aadhaar_verified BOOLEAN NOT NULL DEFAULT FALSE,
        aadhaar_reference_id VARCHAR(128),
        aadhaar_verified_at TIMESTAMPTZ,
        aadhaar_verification_response JSONB,
        legal_name VARCHAR(180),
        business_type VARCHAR(64),
        pan_verified BOOLEAN NOT NULL DEFAULT FALSE,
        pan_verified_at TIMESTAMPTZ,
        pan_verification_response JSONB,
        verification_status VARCHAR(32) NOT NULL DEFAULT 'draft',
        documents JSONB NOT NULL DEFAULT '{}'::jsonb,
        rejection_reason TEXT,
        submitted_at TIMESTAMPTZ,
        reviewed_by VARCHAR(64),
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.sequelize.query(
      `
      CREATE TABLE IF NOT EXISTS outbox_events (
        id UUID PRIMARY KEY,
        event_name VARCHAR(160) NOT NULL,
        aggregate_id VARCHAR(64) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        last_error TEXT,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      `,
      { transaction },
    );

    await queryInterface.addIndex("orders", ["buyer_id", "created_at"], { transaction });
    await queryInterface.addIndex("orders", ["status", "created_at"], { transaction });
    await queryInterface.addIndex("order_items", ["order_id"], { transaction });
    await queryInterface.addIndex("order_items", ["seller_id", "order_id"], { transaction });
    await queryInterface.addIndex("payments", ["order_id", "created_at"], { transaction });
    await queryInterface.addIndex("payments", ["buyer_id", "status", "created_at"], { transaction });
    await queryInterface.addIndex("payments", ["provider_order_id"], { transaction });
    await queryInterface.addIndex("wallet_transactions", ["user_id", "created_at"], { transaction });
    await queryInterface.addIndex("wallet_transactions", ["reference_id", "status"], { transaction });
    await queryInterface.addIndex("outbox_events", ["status", "occurred_at"], { transaction });
  },

  async down({ queryInterface, transaction }) {
    const tables = [
      "outbox_events",
      "seller_kyc",
      "user_kyc",
      "wallet_transactions",
      "wallets",
      "payments",
      "order_items",
      "orders",
    ];

    for (const table of tables) {
      await queryInterface.dropTable(table, { transaction });
    }
  },
};
