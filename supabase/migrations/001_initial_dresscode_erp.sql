-- ============================================================================
-- DressCode ERP — Full-Cycle Apparel Manufacturing & Costing Database
-- Target: PostgreSQL 15+ / Supabase
-- Cycle: Purchases -> Raw Inventory -> BOM & Costing -> Production (WIP)
--        -> Finished Goods (Color/Size) -> Sales & P&L
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE currency_code AS ENUM ('EGP', 'SAR', 'AED', 'USD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fabric_unit AS ENUM ('meter', 'kg');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trim_purchase_unit AS ENUM ('piece', 'dozen', 'roll', 'pack', 'box', 'cone');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE labor_billing_type AS ENUM ('per_piece', 'per_batch');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE model_status AS ENUM ('active', 'sampling', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE overhead_category AS ENUM ('rent', 'utilities', 'maintenance', 'marketing', 'shipping', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE purchase_order_status AS ENUM ('draft', 'ordered', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE production_order_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sales_channel AS ENUM ('online_store', 'retail', 'wholesale', 'social_media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sales_order_status AS ENUM ('draft', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_item_type AS ENUM ('fabric', 'trim', 'finished_good');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_movement_type AS ENUM (
    'purchase_in',
    'production_issue',
    'production_waste',
    'finished_goods_in',
    'sale_out',
    'sale_return',
    'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE finance_tx_type AS ENUM (
    'supplier_payment',
    'workshop_payout',
    'sales_receipt',
    'overhead_expense',
    'refund'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. UPDATED_AT TRIGGER HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. CORE SETTINGS & MASTER DIRECTORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  brand_name TEXT NOT NULL DEFAULT 'DressCode',
  website TEXT NOT NULL DEFAULT 'dresscode-clothing.com',
  currency currency_code NOT NULL DEFAULT 'EGP',
  estimated_monthly_volume INTEGER NOT NULL DEFAULT 600 CHECK (estimated_monthly_volume > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  address TEXT,
  specialty TEXT, -- أقمشة، كلف وتغليف، خيوط
  balance_payable NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workshops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  address TEXT,
  specialty TEXT, -- قص، خياطة، تطريز، بليسيه، كي وتشطيب
  balance_payable NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  city TEXT,
  address TEXT,
  customer_type TEXT NOT NULL DEFAULT 'retail', -- retail | wholesale
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. RAW MATERIALS MASTER & INVENTORY (الأقمشة والكلف)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fabrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL DEFAULT 'مورد عام',
  unit fabric_unit NOT NULL DEFAULT 'meter',
  price_per_unit NUMERIC(12, 2) NOT NULL CHECK (price_per_unit >= 0),
  width_cm INTEGER NOT NULL DEFAULT 150 CHECK (width_cm > 0),
  default_waste_pct NUMERIC(5, 2) NOT NULL DEFAULT 6 CHECK (default_waste_pct >= 0 AND default_waste_pct <= 100),
  stock_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(14, 3) NOT NULL DEFAULT 20,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'إكسسوارات',
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL DEFAULT 'مورد عام',
  purchase_unit trim_purchase_unit NOT NULL DEFAULT 'pack',
  pack_price NUMERIC(12, 2) NOT NULL CHECK (pack_price >= 0),
  units_per_pack NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (units_per_pack > 0),
  unit_cost NUMERIC(12, 4) GENERATED ALWAYS AS (pack_price / units_per_pack) STORED,
  unit_label TEXT NOT NULL DEFAULT 'قطعة',
  stock_qty NUMERIC(14, 3) NOT NULL DEFAULT 0, -- tracked in single consumption units
  reorder_level NUMERIC(14, 3) NOT NULL DEFAULT 50,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. OUTSOURCED OPERATIONS CATALOG (التشغيل الخارجي)
-- ============================================================================

CREATE TABLE IF NOT EXISTS outsourced_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  workshop_name TEXT NOT NULL DEFAULT 'ورشة خارجية',
  billing_type labor_billing_type NOT NULL DEFAULT 'per_piece',
  cost NUMERIC(12, 2) NOT NULL CHECK (cost >= 0),
  batch_size INTEGER NOT NULL DEFAULT 1 CHECK (batch_size > 0),
  unit_cost NUMERIC(12, 4) GENERATED ALWAYS AS (
    CASE WHEN billing_type = 'per_batch' THEN cost / batch_size ELSE cost END
  ) STORED,
  lead_time_days INTEGER NOT NULL DEFAULT 1 CHECK (lead_time_days >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. MODELS, VARIANTS (COLOR/SIZE), AND BOM (الموديلات والباترون)
-- ============================================================================

CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'عباية',
  season TEXT NOT NULL DEFAULT '2026',
  status model_status NOT NULL DEFAULT 'active',
  target_margin_pct NUMERIC(6, 2) NOT NULL DEFAULT 65 CHECK (target_margin_pct >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  variant_sku TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  size TEXT NOT NULL, -- S, M, L, XL, Free Size
  finished_goods_qty INTEGER NOT NULL DEFAULT 0,
  avg_unit_cogs NUMERIC(12, 2) NOT NULL DEFAULT 0,
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model_id, color, size)
);

CREATE TABLE IF NOT EXISTS model_fabrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  fabric_id UUID NOT NULL REFERENCES fabrics(id) ON DELETE RESTRICT,
  consumption NUMERIC(10, 4) NOT NULL CHECK (consumption > 0),
  waste_pct NUMERIC(5, 2) NOT NULL DEFAULT 6 CHECK (waste_pct >= 0 AND waste_pct <= 100)
);

CREATE TABLE IF NOT EXISTS model_trims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  trim_id UUID NOT NULL REFERENCES trims(id) ON DELETE RESTRICT,
  quantity NUMERIC(10, 3) NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS model_labor_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  operation_id UUID REFERENCES outsourced_operations(id) ON DELETE SET NULL,
  workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  workshop_name TEXT NOT NULL,
  billing_type labor_billing_type NOT NULL DEFAULT 'per_piece',
  cost NUMERIC(12, 2) NOT NULL CHECK (cost >= 0),
  batch_size INTEGER NOT NULL DEFAULT 1 CHECK (batch_size > 0),
  sequence_order INTEGER NOT NULL DEFAULT 1
);

-- ============================================================================
-- 7. MONTHLY INDIRECT OVERHEAD (المصاريف غير المباشرة)
-- ============================================================================

CREATE TABLE IF NOT EXISTS overhead_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category overhead_category NOT NULL DEFAULT 'other',
  monthly_amount NUMERIC(14, 2) NOT NULL CHECK (monthly_amount >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 8. PURCHASES MODULE (المشتريات وفواتير الموردين)
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  received_at TIMESTAMPTZ,
  status purchase_order_status NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_type inventory_item_type NOT NULL CHECK (item_type IN ('fabric', 'trim')),
  fabric_id UUID REFERENCES fabrics(id) ON DELETE RESTRICT,
  trim_id UUID REFERENCES trims(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  -- For fabrics: qty in meters/kg & unit_price per meter/kg
  -- For trims: qty in packs (dozens/rolls/boxes) & unit_price per pack; converted to single units on receipt
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  units_per_pack NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (units_per_pack > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(14, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  CHECK (
    (item_type = 'fabric' AND fabric_id IS NOT NULL AND trim_id IS NULL) OR
    (item_type = 'trim' AND trim_id IS NOT NULL AND fabric_id IS NULL)
  )
);

-- ============================================================================
-- 9. PRODUCTION ORDERS / WIP MANUFACTURING (أوامر التشغيل والتصنيع)
-- ============================================================================

CREATE TABLE IF NOT EXISTS production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT NOT NULL UNIQUE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
  status production_order_status NOT NULL DEFAULT 'planned',
  planned_qty INTEGER NOT NULL CHECK (planned_qty > 0),
  completed_qty INTEGER NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  actual_material_cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  actual_labor_cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  allocated_overhead_cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  actual_unit_cogs NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_order_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES model_variants(id) ON DELETE RESTRICT,
  planned_qty INTEGER NOT NULL CHECK (planned_qty > 0),
  completed_qty INTEGER NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
  UNIQUE (production_order_id, variant_id)
);

CREATE TABLE IF NOT EXISTS production_workshop_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  workshop_name TEXT NOT NULL,
  step_name TEXT NOT NULL,
  billing_type labor_billing_type NOT NULL DEFAULT 'per_piece',
  agreed_cost NUMERIC(12, 2) NOT NULL CHECK (agreed_cost >= 0),
  batch_size INTEGER NOT NULL DEFAULT 1 CHECK (batch_size > 0),
  total_step_cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- 10. SALES ORDERS & RETURNS (المبيعات والمتجر الإلكتروني)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  channel sales_channel NOT NULL DEFAULT 'online_store',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status sales_order_status NOT NULL DEFAULT 'draft',
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  shipping_fee NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_cogs NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gross_profit NUMERIC(14, 2) GENERATED ALWAYS AS ((subtotal - discount_amount) - total_cogs) STORED,
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES model_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  unit_cogs_snapshot NUMERIC(12, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  line_cogs NUMERIC(14, 2) GENERATED ALWAYS AS (quantity * unit_cogs_snapshot) STORED
);

-- ============================================================================
-- 11. IMMUTABLE INVENTORY & FINANCIAL LEDGERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type inventory_item_type NOT NULL,
  fabric_id UUID REFERENCES fabrics(id) ON DELETE SET NULL,
  trim_id UUID REFERENCES trims(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES model_variants(id) ON DELETE SET NULL,
  movement_type inventory_movement_type NOT NULL,
  qty_delta NUMERIC(14, 3) NOT NULL, -- positive for IN, negative for OUT
  unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0,
  reference_type TEXT, -- purchase_order | production_order | sales_order | manual
  reference_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_date DATE NOT NULL DEFAULT CURRENT_DATE,
  tx_type finance_tx_type NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  reference_type TEXT,
  reference_id UUID,
  payment_method TEXT DEFAULT 'cash', -- cash | bank_transfer | instapay | cod
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 12. INDEXES & UPDATED_AT TRIGGERS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_fabrics_supplier ON fabrics(supplier_id);
CREATE INDEX IF NOT EXISTS idx_trims_supplier ON trims(supplier_id);
CREATE INDEX IF NOT EXISTS idx_model_variants_model ON model_variants(model_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_prod_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_status_date ON sales_orders(status, order_date);
CREATE INDEX IF NOT EXISTS idx_inv_movements_created ON inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_ref ON inventory_movements(reference_type, reference_id);

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'app_settings', 'suppliers', 'workshops', 'customers', 'fabrics', 'trims',
    'outsourced_operations', 'models', 'model_variants', 'overhead_items',
    'purchase_orders', 'production_orders', 'sales_orders'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;', tbl, tbl);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();', tbl, tbl);
  END LOOP;
END $$;

-- ============================================================================
-- 13. ATOMIC FULL-CYCLE STORED PROCEDURES (RPC FUNCTIONS)
-- ============================================================================

-- A) Receive a Purchase Order: updates raw stock, recalculates Weighted Average Cost (WAC),
--    logs inventory_movements, and increases supplier payable balance.
CREATE OR REPLACE FUNCTION receive_purchase_order(p_po_id UUID)
RETURNS VOID AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_total NUMERIC(14, 2) := 0;
  v_old_qty NUMERIC(14, 3);
  v_old_cost NUMERIC(12, 4);
  v_new_qty NUMERIC(14, 3);
  v_added_units NUMERIC(14, 3);
  v_unit_cost NUMERIC(12, 4);
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;
  IF v_po.status = 'received' THEN
    RAISE EXCEPTION 'Purchase order % is already received', v_po.po_number;
  END IF;

  FOR v_item IN
    SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
  LOOP
    v_total := v_total + v_item.line_total;

    IF v_item.item_type = 'fabric' THEN
      SELECT stock_qty, price_per_unit INTO v_old_qty, v_old_cost
      FROM fabrics WHERE id = v_item.fabric_id FOR UPDATE;

      v_new_qty := GREATEST(v_old_qty, 0) + v_item.quantity;
      UPDATE fabrics
      SET
        stock_qty = stock_qty + v_item.quantity,
        price_per_unit = ROUND(
          ((GREATEST(v_old_qty, 0) * v_old_cost) + (v_item.quantity * v_item.unit_price)) / NULLIF(v_new_qty, 0),
          2
        )
      WHERE id = v_item.fabric_id;

      INSERT INTO inventory_movements (
        item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'fabric', v_item.fabric_id, 'purchase_in', v_item.quantity, v_item.unit_price,
        'purchase_order', p_po_id, 'استلام أمر شراء ' || v_po.po_number
      );

    ELSIF v_item.item_type = 'trim' THEN
      SELECT stock_qty, unit_cost INTO v_old_qty, v_old_cost
      FROM trims WHERE id = v_item.trim_id FOR UPDATE;

      v_added_units := v_item.quantity * v_item.units_per_pack;
      v_unit_cost := v_item.unit_price / v_item.units_per_pack;
      v_new_qty := GREATEST(v_old_qty, 0) + v_added_units;

      UPDATE trims
      SET
        stock_qty = stock_qty + v_added_units,
        pack_price = ROUND(
          (((GREATEST(v_old_qty, 0) * v_old_cost) + (v_added_units * v_unit_cost)) / NULLIF(v_new_qty, 0)) * units_per_pack,
          2
        )
      WHERE id = v_item.trim_id;

      INSERT INTO inventory_movements (
        item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'trim', v_item.trim_id, 'purchase_in', v_added_units, v_unit_cost,
        'purchase_order', p_po_id, 'استلام أمر شراء ' || v_po.po_number
      );
    END IF;
  END LOOP;

  UPDATE purchase_orders
  SET status = 'received', total_amount = v_total, received_at = NOW()
  WHERE id = p_po_id;

  IF v_po.supplier_id IS NOT NULL THEN
    UPDATE suppliers
    SET balance_payable = balance_payable + v_total
    WHERE id = v_po.supplier_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- B) Issue Materials to Start a Production Order (BOM -> Raw Stock Deduction -> WIP)
CREATE OR REPLACE FUNCTION issue_production_order(p_prod_id UUID)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_fab RECORD;
  v_trim RECORD;
  v_step RECORD;
  v_req_qty NUMERIC(14, 3);
  v_mat_cost NUMERIC(14, 2) := 0;
  v_step_total NUMERIC(14, 2);
BEGIN
  SELECT * INTO v_prod FROM production_orders WHERE id = p_prod_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production order % not found', p_prod_id;
  END IF;
  IF v_prod.status <> 'planned' THEN
    RAISE EXCEPTION 'Production order % must be in planned status', v_prod.batch_number;
  END IF;

  -- Deduct fabrics (consumption * (1 + waste%) * planned_qty)
  FOR v_fab IN
    SELECT mf.fabric_id, mf.consumption, mf.waste_pct, f.name, f.stock_qty, f.price_per_unit
    FROM model_fabrics mf
    JOIN fabrics f ON f.id = mf.fabric_id
    WHERE mf.model_id = v_prod.model_id
  LOOP
    v_req_qty := ROUND(v_fab.consumption * (1 + v_fab.waste_pct / 100.0) * v_prod.planned_qty, 3);
    IF v_fab.stock_qty < v_req_qty THEN
      RAISE EXCEPTION 'رصيد القماش (%) غير كافٍ: المطلوب % والمتاح %', v_fab.name, v_req_qty, v_fab.stock_qty;
    END IF;

    UPDATE fabrics SET stock_qty = stock_qty - v_req_qty WHERE id = v_fab.fabric_id;
    v_mat_cost := v_mat_cost + (v_req_qty * v_fab.price_per_unit);

    INSERT INTO inventory_movements (
      item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'fabric', v_fab.fabric_id, 'production_issue', -v_req_qty, v_fab.price_per_unit,
      'production_order', p_prod_id, 'صرف للتصنيع ' || v_prod.batch_number
    );
  END LOOP;

  -- Deduct trims (quantity * planned_qty)
  FOR v_trim IN
    SELECT mt.trim_id, mt.quantity, t.name, t.stock_qty, t.unit_cost
    FROM model_trims mt
    JOIN trims t ON t.id = mt.trim_id
    WHERE mt.model_id = v_prod.model_id
  LOOP
    v_req_qty := ROUND(v_trim.quantity * v_prod.planned_qty, 3);
    IF v_trim.stock_qty < v_req_qty THEN
      RAISE EXCEPTION 'رصيد الكلفة (%) غير كافٍ: المطلوب % والمتاح %', v_trim.name, v_req_qty, v_trim.stock_qty;
    END IF;

    UPDATE trims SET stock_qty = stock_qty - v_req_qty WHERE id = v_trim.trim_id;
    v_mat_cost := v_mat_cost + (v_req_qty * v_trim.unit_cost);

    INSERT INTO inventory_movements (
      item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'trim', v_trim.trim_id, 'production_issue', -v_req_qty, v_trim.unit_cost,
      'production_order', p_prod_id, 'صرف للتصنيع ' || v_prod.batch_number
    );
  END LOOP;

  -- Copy BOM outsourced labor steps into workshop logs if none exist yet
  IF NOT EXISTS (SELECT 1 FROM production_workshop_logs WHERE production_order_id = p_prod_id) THEN
    FOR v_step IN
      SELECT * FROM model_labor_steps WHERE model_id = v_prod.model_id ORDER BY sequence_order
    LOOP
      v_step_total := CASE
        WHEN v_step.billing_type = 'per_batch' THEN (v_step.cost / v_step.batch_size) * v_prod.planned_qty
        ELSE v_step.cost * v_prod.planned_qty
      END;

      INSERT INTO production_workshop_logs (
        production_order_id, workshop_id, workshop_name, step_name,
        billing_type, agreed_cost, batch_size, total_step_cost
      ) VALUES (
        p_prod_id, v_step.workshop_id, v_step.workshop_name, v_step.name,
        v_step.billing_type, v_step.cost, v_step.batch_size, ROUND(v_step_total, 2)
      );
    END LOOP;
  END IF;

  UPDATE production_orders
  SET status = 'in_progress', started_at = NOW(), actual_material_cost = ROUND(v_mat_cost, 2)
  WHERE id = p_prod_id;
END;
$$ LANGUAGE plpgsql;

-- C) Complete a Production Order: converts WIP -> Finished Goods by Color/Size with Actual Unit COGS,
--    and accrues workshop payables.
CREATE OR REPLACE FUNCTION complete_production_order(p_prod_id UUID)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_var RECORD;
  v_wlog RECORD;
  v_total_completed INTEGER := 0;
  v_labor_cost NUMERIC(14, 2) := 0;
  v_overhead_per_piece NUMERIC(12, 4) := 0;
  v_allocated_overhead NUMERIC(14, 2) := 0;
  v_unit_cogs NUMERIC(12, 2) := 0;
  v_old_qty INTEGER;
  v_old_cogs NUMERIC(12, 2);
  v_new_qty INTEGER;
BEGIN
  SELECT * INTO v_prod FROM production_orders WHERE id = p_prod_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production order % not found', p_prod_id;
  END IF;
  IF v_prod.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Production order % must be in_progress to complete', v_prod.batch_number;
  END IF;

  -- Mark workshop steps completed & accrue payables
  FOR v_wlog IN
    SELECT * FROM production_workshop_logs WHERE production_order_id = p_prod_id FOR UPDATE
  LOOP
    v_labor_cost := v_labor_cost + v_wlog.total_step_cost;
    IF NOT v_wlog.is_completed THEN
      UPDATE production_workshop_logs
      SET is_completed = TRUE, completed_at = NOW()
      WHERE id = v_wlog.id;

      IF v_wlog.workshop_id IS NOT NULL THEN
        UPDATE workshops
        SET balance_payable = balance_payable + v_wlog.total_step_cost
        WHERE id = v_wlog.workshop_id;
      END IF;
    END IF;
  END LOOP;

  -- Calculate total completed qty across variants (default to planned_qty if not entered)
  UPDATE production_order_variants
  SET completed_qty = planned_qty
  WHERE production_order_id = p_prod_id AND completed_qty = 0;

  SELECT COALESCE(SUM(completed_qty), 0) INTO v_total_completed
  FROM production_order_variants WHERE production_order_id = p_prod_id;

  IF v_total_completed <= 0 THEN
    RAISE EXCEPTION 'Production order % has no variant quantities to receive', v_prod.batch_number;
  END IF;

  -- Allocate monthly overhead per piece
  SELECT COALESCE(SUM(o.monthly_amount), 0) / GREATEST(s.estimated_monthly_volume, 1)
  INTO v_overhead_per_piece
  FROM app_settings s
  LEFT JOIN overhead_items o ON TRUE
  WHERE s.id = 1
  GROUP BY s.estimated_monthly_volume;

  v_allocated_overhead := ROUND(COALESCE(v_overhead_per_piece, 0) * v_total_completed, 2);
  v_unit_cogs := ROUND((v_prod.actual_material_cost + v_labor_cost + v_allocated_overhead) / v_total_completed, 2);

  -- Receive into Finished Goods Inventory (updating WAC COGS per variant)
  FOR v_var IN
    SELECT variant_id, completed_qty
    FROM production_order_variants
    WHERE production_order_id = p_prod_id AND completed_qty > 0
  LOOP
    SELECT finished_goods_qty, avg_unit_cogs INTO v_old_qty, v_old_cogs
    FROM model_variants WHERE id = v_var.variant_id FOR UPDATE;

    v_new_qty := GREATEST(v_old_qty, 0) + v_var.completed_qty;

    UPDATE model_variants
    SET
      finished_goods_qty = finished_goods_qty + v_var.completed_qty,
      avg_unit_cogs = ROUND(
        ((GREATEST(v_old_qty, 0) * v_old_cogs) + (v_var.completed_qty * v_unit_cogs)) / NULLIF(v_new_qty, 0),
        2
      )
    WHERE id = v_var.variant_id;

    INSERT INTO inventory_movements (
      item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'finished_good', v_var.variant_id, 'finished_goods_in', v_var.completed_qty, v_unit_cogs,
      'production_order', p_prod_id, 'استلام منتج تام ' || v_prod.batch_number
    );
  END LOOP;

  UPDATE production_orders
  SET
    status = 'completed',
    completed_qty = v_total_completed,
    completed_at = NOW(),
    actual_labor_cost = ROUND(v_labor_cost, 2),
    allocated_overhead_cost = v_allocated_overhead,
    actual_unit_cogs = v_unit_cogs
  WHERE id = p_prod_id;
END;
$$ LANGUAGE plpgsql;

-- D) Confirm a Sales Order: deducts Finished Goods stock, snapshots Unit COGS, calculates revenue & profit.
CREATE OR REPLACE FUNCTION confirm_sales_order(p_sale_id UUID)
RETURNS VOID AS $$
DECLARE
  v_sale sales_orders%ROWTYPE;
  v_item RECORD;
  v_subtotal NUMERIC(14, 2) := 0;
  v_total_cogs NUMERIC(14, 2) := 0;
BEGIN
  SELECT * INTO v_sale FROM sales_orders WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order % not found', p_sale_id;
  END IF;
  IF v_sale.status <> 'draft' THEN
    RAISE EXCEPTION 'Sales order % is already processed (status: %)', v_sale.order_number, v_sale.status;
  END IF;

  FOR v_item IN
    SELECT soi.id, soi.variant_id, soi.quantity, soi.unit_price, mv.variant_sku, mv.finished_goods_qty, mv.avg_unit_cogs
    FROM sales_order_items soi
    JOIN model_variants mv ON mv.id = soi.variant_id
    WHERE soi.sales_order_id = p_sale_id
    FOR UPDATE OF mv
  LOOP
    IF v_item.finished_goods_qty < v_item.quantity THEN
      RAISE EXCEPTION 'المخزون غير كافٍ للصنف %: المطلوب % والمتاح %', v_item.variant_sku, v_item.quantity, v_item.finished_goods_qty;
    END IF;

    UPDATE model_variants
    SET finished_goods_qty = finished_goods_qty - v_item.quantity
    WHERE id = v_item.variant_id;

    UPDATE sales_order_items
    SET unit_cogs_snapshot = v_item.avg_unit_cogs
    WHERE id = v_item.id;

    v_subtotal := v_subtotal + (v_item.quantity * v_item.unit_price);
    v_total_cogs := v_total_cogs + (v_item.quantity * v_item.avg_unit_cogs);

    INSERT INTO inventory_movements (
      item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'finished_good', v_item.variant_id, 'sale_out', -v_item.quantity, v_item.avg_unit_cogs,
      'sales_order', p_sale_id, 'صرف مبيعات ' || v_sale.order_number
    );
  END LOOP;

  UPDATE sales_orders
  SET
    status = 'confirmed',
    subtotal = ROUND(v_subtotal, 2),
    total_amount = ROUND(v_subtotal - discount_amount + shipping_fee, 2),
    total_cogs = ROUND(v_total_cogs, 2)
  WHERE id = p_sale_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 14. REPORTING VIEWS (التقارير الفورية)
-- ============================================================================

CREATE OR REPLACE VIEW v_model_cost_summary AS
WITH overhead_unit AS (
  SELECT
    COALESCE(SUM(o.monthly_amount), 0) / GREATEST(s.estimated_monthly_volume, 1) AS overhead_per_piece
  FROM app_settings s
  LEFT JOIN overhead_items o ON TRUE
  WHERE s.id = 1
  GROUP BY s.estimated_monthly_volume
),
fab_costs AS (
  SELECT
    mf.model_id,
    SUM(mf.consumption * (1 + mf.waste_pct / 100.0) * f.price_per_unit) AS fabric_cost
  FROM model_fabrics mf
  JOIN fabrics f ON f.id = mf.fabric_id
  GROUP BY mf.model_id
),
trim_costs AS (
  SELECT
    mt.model_id,
    SUM(mt.quantity * t.unit_cost) AS trim_cost
  FROM model_trims mt
  JOIN trims t ON t.id = mt.trim_id
  GROUP BY mt.model_id
),
labor_costs AS (
  SELECT
    ml.model_id,
    SUM(CASE WHEN ml.billing_type = 'per_batch' THEN ml.cost / ml.batch_size ELSE ml.cost END) AS labor_cost
  FROM model_labor_steps ml
  GROUP BY ml.model_id
)
SELECT
  m.id AS model_id,
  m.sku,
  m.name,
  m.category,
  m.season,
  m.status,
  ROUND(COALESCE(fc.fabric_cost, 0), 2) AS fabric_cost,
  ROUND(COALESCE(tc.trim_cost, 0), 2) AS trim_cost,
  ROUND(COALESCE(fc.fabric_cost, 0) + COALESCE(tc.trim_cost, 0), 2) AS direct_material_cost,
  ROUND(COALESCE(lc.labor_cost, 0), 2) AS direct_labor_cost,
  ROUND(COALESCE(ou.overhead_per_piece, 0), 2) AS indirect_overhead_cost,
  ROUND(
    COALESCE(fc.fabric_cost, 0) + COALESCE(tc.trim_cost, 0) + COALESCE(lc.labor_cost, 0) + COALESCE(ou.overhead_per_piece, 0),
    2
  ) AS total_unit_cost,
  m.target_margin_pct,
  ROUND(
    (COALESCE(fc.fabric_cost, 0) + COALESCE(tc.trim_cost, 0) + COALESCE(lc.labor_cost, 0) + COALESCE(ou.overhead_per_piece, 0))
    * (1 + m.target_margin_pct / 100.0),
    2
  ) AS suggested_retail_price
FROM models m
CROSS JOIN overhead_unit ou
LEFT JOIN fab_costs fc ON fc.model_id = m.id
LEFT JOIN trim_costs tc ON tc.model_id = m.id
LEFT JOIN labor_costs lc ON lc.model_id = m.id;

CREATE OR REPLACE VIEW v_monthly_pnl AS
SELECT
  DATE_TRUNC('month', order_date)::DATE AS month,
  COUNT(*) AS orders_count,
  ROUND(SUM(subtotal - discount_amount), 2) AS net_sales_revenue,
  ROUND(SUM(total_cogs), 2) AS total_cogs,
  ROUND(SUM(gross_profit), 2) AS gross_profit,
  ROUND(
    CASE WHEN SUM(subtotal - discount_amount) > 0
      THEN (SUM(gross_profit) / SUM(subtotal - discount_amount)) * 100
      ELSE 0
    END,
    2
  ) AS gross_margin_pct
FROM sales_orders
WHERE status IN ('confirmed', 'shipped', 'delivered')
GROUP BY DATE_TRUNC('month', order_date)
ORDER BY month DESC;

CREATE OR REPLACE VIEW v_low_stock_alerts AS
SELECT 'fabric'::TEXT AS item_type, code AS sku, name, stock_qty::NUMERIC, reorder_level::NUMERIC
FROM fabrics WHERE stock_qty <= reorder_level
UNION ALL
SELECT 'trim'::TEXT, code, name, stock_qty::NUMERIC, reorder_level::NUMERIC
FROM trims WHERE stock_qty <= reorder_level
UNION ALL
SELECT 'finished_good'::TEXT, mv.variant_sku, m.name || ' (' || mv.color || ' - ' || mv.size || ')', mv.finished_goods_qty::NUMERIC, mv.reorder_level::NUMERIC
FROM model_variants mv
JOIN models m ON m.id = mv.model_id
WHERE mv.finished_goods_qty <= mv.reorder_level;
