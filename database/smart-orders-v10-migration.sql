-- Smart Orders V10
-- Warehouses + warehouse stock + stock movements + transfers
-- Safe to run after the existing database/schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity INTEGER NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product
  ON warehouse_stock(product_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_low
  ON warehouse_stock(warehouse_id, quantity, min_quantity);

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  movement_type VARCHAR(30) NOT NULL CHECK (
    movement_type IN (
      'opening',
      'purchase',
      'sale',
      'return',
      'adjustment_in',
      'adjustment_out',
      'transfer_in',
      'transfer_out'
    )
  ),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reference_type VARCHAR(40),
  reference_id BIGINT,
  notes TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse
  ON stock_movements(warehouse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
  ON stock_movements(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON stock_movements(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id BIGSERIAL PRIMARY KEY,
  transfer_number VARCHAR(50) UNIQUE NOT NULL,
  from_warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','shipped','received','cancelled')),
  notes TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  received_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status
  ON stock_transfers(status);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id BIGSERIAL PRIMARY KEY,
  transfer_id BIGINT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (transfer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product
  ON stock_transfer_items(product_id);

-- Create a default warehouse for existing installations.
INSERT INTO warehouses(code, name)
VALUES ('MAIN', 'المستودع الرئيسي')
ON CONFLICT (code) DO NOTHING;

-- Move the current legacy product stock into the default warehouse.
-- This keeps the existing stock_quantity values available while V10
-- introduces per-warehouse quantities.
INSERT INTO warehouse_stock(warehouse_id, product_id, quantity, min_quantity)
SELECT w.id, p.id, p.stock_quantity, 0
FROM warehouses w
CROSS JOIN products p
WHERE w.code = 'MAIN'
ON CONFLICT (warehouse_id, product_id) DO NOTHING;

-- Record the imported quantities as opening balances, once.
INSERT INTO stock_movements
  (warehouse_id, product_id, movement_type, quantity, notes)
SELECT ws.warehouse_id, ws.product_id, 'opening', ws.quantity,
       'رصيد افتتاحي عند تفعيل V10'
FROM warehouse_stock ws
WHERE ws.quantity > 0
  AND NOT EXISTS (
    SELECT 1
    FROM stock_movements sm
    WHERE sm.warehouse_id = ws.warehouse_id
      AND sm.product_id = ws.product_id
      AND sm.movement_type = 'opening'
  );

COMMIT;
