CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  buyer_id VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  subtotal_amount NUMERIC(12, 2) NOT NULL,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  wallet_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL,
  payable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  coupon_code VARCHAR(64),
  tax_breakup JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_provider VARCHAR(64),
  cod_charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  shipping_address JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders (buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL,
  variant_id VARCHAR(64),
  variant_sku VARCHAR(128),
  variant_title VARCHAR(255),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  seller_id VARCHAR(64) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_seller_id ON order_items (seller_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  buyer_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  transaction_reference VARCHAR(128) NOT NULL,
  provider_order_id VARCHAR(128),
  provider_payment_id VARCHAR(128),
  verification_method VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_buyer_id ON payments (buyer_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);

CREATE TABLE IF NOT EXISTS payment_method_configs (
  method VARCHAR(64) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  min_order_amount NUMERIC(12, 2),
  max_order_amount NUMERIC(12, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO payment_method_configs (method, enabled, charge_amount, currency, metadata)
VALUES ('cod', true, 0, 'INR', '{}'::jsonb)
ON CONFLICT (method) DO NOTHING;

CREATE TABLE IF NOT EXISTS seller_kyc (
  id UUID PRIMARY KEY,
  seller_id VARCHAR(64) NOT NULL UNIQUE,
  pan_number VARCHAR(16) NOT NULL,
  gst_number VARCHAR(32),
  aadhaar_number VARCHAR(16),
  legal_name VARCHAR(120) NOT NULL,
  business_type VARCHAR(64),
  verification_status VARCHAR(64) NOT NULL,
  documents JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by VARCHAR(64),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_kyc_status ON seller_kyc (verification_status);

CREATE TABLE IF NOT EXISTS user_kyc (
  id UUID PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE,
  pan_number VARCHAR(16),
  aadhaar_number VARCHAR(16),
  legal_name VARCHAR(120) NOT NULL,
  verification_status VARCHAR(64) NOT NULL,
  documents JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by VARCHAR(64),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_kyc_status ON user_kyc (verification_status);

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE,
  available_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  locked_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  reference_type VARCHAR(64),
  reference_id VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  event_name VARCHAR(128) NOT NULL,
  aggregate_id VARCHAR(64),
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_status_occurred_at ON outbox_events (status, occurred_at);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(128);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(128);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS verification_method VARCHAR(64);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failed_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_breakup JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(16);
ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS business_type VARCHAR(64);
ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS verification_status VARCHAR(64);
ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(64);
ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE seller_kyc ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
