-- ============================================================================
-- DressCode ERP — Migration 003: Full Excel Parity (CRM, Partial Payments,
-- Expenses, Cashbox, Partner Capital, Quick Direct Costing, & Monthly P&L)
-- Target: PostgreSQL 15+ / Supabase (100% additive, safe on existing DB)
-- ============================================================================

-- 1. Enhance models with Actual Retail Price, Compare-At Price, Quick Direct Cost fields & Initial Stock
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS actual_retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quick_fabric_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quick_shipping_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quick_overlock_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quick_packaging_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quick_sewing_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quick_accessories_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_stock INTEGER NOT NULL DEFAULT 0;

-- 2. Enhance customers with platform & governorate (matching العملاء sheet)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'واتساب',
  ADD COLUMN IF NOT EXISTS governorate TEXT;

-- 3. Enhance sales_orders with platform, fulfillment_status, remaining_debt & payment_status
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'واتساب',
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'قيد التجهيز';

-- Add remaining_debt & payment_status computed columns safely if not present
DO $$ BEGIN
  ALTER TABLE sales_orders
    ADD COLUMN remaining_debt NUMERIC(14, 2)
    GENERATED ALWAYS AS (GREATEST(total_amount - paid_amount, 0)) STORED;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE sales_orders
    ADD COLUMN payment_status TEXT
    GENERATED ALWAYS AS (
      CASE
        WHEN paid_amount <= 0 THEN 'لم يدفع'
        WHEN paid_amount >= total_amount THEN 'مدفوع بالكامل'
        ELSE 'دفع جزئي'
      END
    ) STORED;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 4. Dated Operating Expenses Log (المصروفات)
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'متغير', -- ثابت | متغير | تسويق | خامات
  is_raw_material_purchase BOOLEAN NOT NULL DEFAULT FALSE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'كاش', -- كاش | تحويل | إنستاباي
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. Partner Capital / Equity Contributions (رأس مال الشركاء: رنا / ريهام / سلمي)
CREATE TABLE IF NOT EXISTS partner_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name TEXT NOT NULL,
  contribution_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14, 2) NOT NULL, -- positive = capital injection, negative = withdrawal
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_partner_contributions_updated_at ON partner_contributions;
CREATE TRIGGER trg_partner_contributions_updated_at
  BEFORE UPDATE ON partner_contributions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. Atomic RPC to record a partial or full customer payment on a Sales Order
CREATE OR REPLACE FUNCTION record_sales_payment(
  p_sale_id UUID,
  p_payment_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'تحويل'
)
RETURNS VOID AS $$
DECLARE
  v_sale sales_orders%ROWTYPE;
BEGIN
  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر';
  END IF;

  SELECT * INTO v_sale FROM sales_orders WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب % غير موجود', p_sale_id;
  END IF;

  UPDATE sales_orders
  SET paid_amount = paid_amount + p_payment_amount
  WHERE id = p_sale_id;

  INSERT INTO financial_transactions (
    tx_type, amount, customer_id, reference_type, reference_id, payment_method, notes
  ) VALUES (
    'sales_receipt', p_payment_amount, v_sale.customer_id,
    'sales_order', p_sale_id, p_payment_method,
    'تحصيل دفعة للطلب ' || v_sale.order_number
  );
END;
$$ LANGUAGE plpgsql;

-- 7. Customers CRM Analytics View (fixes shifted-column & unreachable tier bugs from Excel)
CREATE OR REPLACE VIEW v_customers_crm AS
WITH order_stats AS (
  SELECT
    COALESCE(customer_id::TEXT, LOWER(TRIM(customer_name))) AS match_key,
    customer_id,
    LOWER(TRIM(customer_name)) AS norm_name,
    COUNT(*) AS orders_count,
    COALESCE(SUM(total_amount), 0) AS total_spent,
    COALESCE(SUM(paid_amount), 0) AS total_paid,
    COALESCE(SUM(remaining_debt), 0) AS remaining_debt,
    MAX(order_date) AS last_order_date
  FROM sales_orders
  WHERE status <> 'cancelled'
  GROUP BY COALESCE(customer_id::TEXT, LOWER(TRIM(customer_name))), customer_id, LOWER(TRIM(customer_name))
)
SELECT
  c.id,
  c.name,
  c.phone,
  c.platform,
  c.governorate,
  c.city,
  c.customer_type,
  c.notes,
  COALESCE(SUM(os.orders_count), 0)::INTEGER AS orders_count,
  ROUND(COALESCE(SUM(os.total_spent), 0), 2) AS total_spent,
  ROUND(COALESCE(SUM(os.total_paid), 0), 2) AS total_paid,
  ROUND(COALESCE(SUM(os.remaining_debt), 0), 2) AS remaining_debt,
  MAX(os.last_order_date) AS last_order_date,
  CASE
    WHEN COALESCE(SUM(os.total_spent), 0) = 0 THEN 'جديد'
    WHEN COALESCE(SUM(os.total_spent), 0) >= 6000 THEN 'مميز'
    WHEN COALESCE(SUM(os.total_spent), 0) >= 4000 THEN 'VIP'
    ELSE 'عادي'
  END AS customer_tier
FROM customers c
LEFT JOIN order_stats os
  ON os.customer_id = c.id OR os.norm_name = LOWER(TRIM(c.name))
GROUP BY c.id;

-- 8. Live Cashbox Summary View (المتاح بالخزنة)
CREATE OR REPLACE VIEW v_cashbox_summary AS
SELECT
  ROUND(COALESCE((SELECT SUM(amount) FROM partner_contributions), 0), 2) AS total_partner_capital,
  ROUND(COALESCE((SELECT SUM(paid_amount) FROM sales_orders WHERE status <> 'cancelled'), 0), 2) AS total_collections,
  ROUND(COALESCE((SELECT SUM(amount) FROM expenses), 0), 2) AS total_expenses_outflow,
  ROUND(COALESCE((SELECT SUM(amount) FROM expenses WHERE NOT is_raw_material_purchase), 0), 2) AS operating_expenses_only,
  ROUND(
    COALESCE((SELECT SUM(amount) FROM partner_contributions), 0)
    + COALESCE((SELECT SUM(paid_amount) FROM sales_orders WHERE status <> 'cancelled'), 0)
    - COALESCE((SELECT SUM(amount) FROM expenses), 0),
    2
  ) AS available_cash;

-- 9. Enable RLS on new tables (Supabase-safe)
DO $$
DECLARE
  tbl TEXT;
  has_auth_role BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_auth_role;
  FOREACH tbl IN ARRAY ARRAY['expenses', 'partner_contributions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    IF has_auth_role THEN
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access_%I" ON %I;', tbl, tbl);
      EXECUTE format(
        'CREATE POLICY "authenticated_full_access_%I" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;
