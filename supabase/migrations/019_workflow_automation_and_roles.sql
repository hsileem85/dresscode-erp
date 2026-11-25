-- ============================================================================
-- DressCode ERP — Migration 019: Workflow Automation & Role-Based Access
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) `record_supplier_payment(p_po_id, p_amount, p_payment_method, p_notes)`:
--    Atomically records a supplier payment against a Purchase Order:
--    - Validates amount > 0 and amount <= remaining balance on PO
--    - Increments `purchase_orders.paid_amount`
--    - Decrements `suppliers.balance_payable`
--    - Logs cashbox outflow in `expenses` (is_raw_material_purchase = true)
--      and `financial_transactions`
-- 2) `process_sales_exchange_return(...)`:
--    Atomically processes a customer size exchange or partial return:
--    - Restores returned variant qty to `model_variants.finished_goods_qty`
--    - Deducts replacement variant qty (if exchange), validating stock
--    - Logs `sale_return` / `sale_out` inventory movements
--    - Adjusts `sales_orders` totals & notes cleanly
-- 3) `user_roles` table + `get_my_user_role()` RPC:
--    - Optional Admin / Staff role-based permissions
--    - Defaults safely to 'admin' for any user not explicitly marked as 'staff'
-- ============================================================================

-- 1) Atomic Supplier Payment RPC (links PO + Supplier Balance + Cashbox)
CREATE OR REPLACE FUNCTION record_supplier_payment(
  p_po_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'كاش',
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_remaining NUMERIC(14, 2);
  v_safe_amt NUMERIC(14, 2);
  v_method TEXT := COALESCE(NULLIF(TRIM(p_payment_method), ''), 'كاش');
  v_title TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'يجب أن يكون مبلغ الدفعة للمورد أكبر من صفر';
  END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود';
  END IF;

  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة لأمر شراء ملغي (%)', v_po.po_number;
  END IF;

  v_remaining := GREATEST(0, COALESCE(v_po.total_amount, 0) - COALESCE(v_po.paid_amount, 0));
  v_safe_amt := ROUND(p_amount, 2);

  IF v_safe_amt > v_remaining + 0.01 THEN
    RAISE EXCEPTION 'مبلغ الدفعة (%) أكبر من المتبقي المستحق على أمر الشراء (%)', v_safe_amt, v_remaining;
  END IF;

  UPDATE purchase_orders
  SET paid_amount = ROUND(COALESCE(paid_amount, 0) + v_safe_amt, 2)
  WHERE id = p_po_id;

  IF v_po.supplier_id IS NOT NULL THEN
    UPDATE suppliers
    SET balance_payable = GREATEST(0, ROUND(COALESCE(balance_payable, 0) - v_safe_amt, 2))
    WHERE id = v_po.supplier_id;
  END IF;

  v_title := 'دفعة لمورد (' || COALESCE(v_po.supplier_name, 'مورد') || ') — أمر شراء ' || v_po.po_number;

  -- Record cashbox outflow in expenses (if table exists)
  IF to_regclass('public.expenses') IS NOT NULL THEN
    INSERT INTO expenses (
      expense_date,
      title,
      category,
      is_raw_material_purchase,
      amount,
      payment_method,
      notes
    ) VALUES (
      CURRENT_DATE,
      v_title,
      'خامات',
      TRUE,
      v_safe_amt,
      v_method,
      COALESCE(NULLIF(TRIM(p_notes), ''), 'سداد تلقائي من شاشة المشتريات — ' || v_po.po_number)
    );
  END IF;

  -- Record in financial_transactions ledger
  INSERT INTO financial_transactions (
    tx_type,
    category,
    amount,
    reference_type,
    reference_id,
    description
  ) VALUES (
    'expense',
    'supplier_payment',
    v_safe_amt,
    'purchase_order',
    p_po_id,
    v_title || CASE WHEN NULLIF(TRIM(p_notes), '') IS NOT NULL THEN ' • ' || TRIM(p_notes) ELSE '' END
  );
END;
$$;

-- 2) Atomic Customer Size Exchange / Partial Return RPC
CREATE OR REPLACE FUNCTION process_sales_exchange_return(
  p_sale_id UUID,
  p_return_variant_id UUID,
  p_return_qty INTEGER,
  p_replacement_variant_id UUID DEFAULT NULL,
  p_replacement_qty INTEGER DEFAULT 0,
  p_price_diff NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales_orders%ROWTYPE;
  v_line sales_order_items%ROWTYPE;
  v_ret_var model_variants%ROWTYPE;
  v_rep_var model_variants%ROWTYPE;
  v_new_qty INTEGER;
  v_new_subtotal NUMERIC(14, 2);
  v_new_total NUMERIC(14, 2);
  v_new_cogs NUMERIC(14, 2);
  v_new_paid NUMERIC(14, 2);
  v_new_remaining NUMERIC(14, 2);
  v_new_pay_status TEXT;
  v_note_entry TEXT;
BEGIN
  IF p_return_qty IS NULL OR p_return_qty <= 0 THEN
    RAISE EXCEPTION 'يجب إدخال كمية مرتجعة صحيحة (أكبر من صفر)';
  END IF;

  SELECT * INTO v_sale FROM sales_orders WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب البيع غير موجود';
  END IF;

  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن عمل استبدال أو مرتجع لطلب ملغي (%)', v_sale.order_number;
  END IF;

  SELECT * INTO v_line
  FROM sales_order_items
  WHERE sales_order_id = p_sale_id AND variant_id = p_return_variant_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف المحدد غير موجود داخل هذا الطلب';
  END IF;

  IF p_return_qty > v_line.quantity THEN
    RAISE EXCEPTION 'الكمية المرتجعة (%) أكبر من الكمية الموجودة في الطلب (%)', p_return_qty, v_line.quantity;
  END IF;

  -- Lock & restore returned variant stock
  SELECT * INTO v_ret_var FROM model_variants WHERE id = p_return_variant_id FOR UPDATE;
  IF FOUND THEN
    UPDATE model_variants
    SET finished_goods_qty = finished_goods_qty + p_return_qty
    WHERE id = p_return_variant_id;

    INSERT INTO inventory_movements (
      item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'finished_good', p_return_variant_id, 'sale_return', p_return_qty,
      COALESCE(v_line.unit_cogs_snapshot, v_ret_var.avg_unit_cogs, 0),
      'sales_order', p_sale_id,
      CASE
        WHEN p_replacement_variant_id IS NOT NULL THEN 'استبدال مقاس/لون — طلب ' || v_sale.order_number
        ELSE 'مرتجع جزئي — طلب ' || v_sale.order_number
      END
    );
  END IF;

  -- Adjust or delete returned sales_order_items line
  v_new_qty := v_line.quantity - p_return_qty;
  IF v_new_qty <= 0 THEN
    DELETE FROM sales_order_items WHERE id = v_line.id;
  ELSE
    UPDATE sales_order_items
    SET quantity = v_new_qty
    WHERE id = v_line.id;
  END IF;

  -- Handle replacement variant if this is an exchange
  IF p_replacement_variant_id IS NOT NULL AND COALESCE(p_replacement_qty, 0) > 0 THEN
    SELECT * INTO v_rep_var FROM model_variants WHERE id = p_replacement_variant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف البديل المختار غير موجود';
    END IF;
    IF v_rep_var.finished_goods_qty < p_replacement_qty THEN
      RAISE EXCEPTION 'المخزون غير كافٍ للصنف البديل (%): المطلوب % والمتاح %',
        v_rep_var.variant_sku, p_replacement_qty, v_rep_var.finished_goods_qty;
    END IF;

    UPDATE model_variants
    SET finished_goods_qty = finished_goods_qty - p_replacement_qty
    WHERE id = p_replacement_variant_id;

    INSERT INTO inventory_movements (
      item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'finished_good', p_replacement_variant_id, 'sale_out', -p_replacement_qty,
      COALESCE(v_rep_var.avg_unit_cogs, 0),
      'sales_order', p_sale_id,
      'صرف بديل (استبدال) — طلب ' || v_sale.order_number
    );

    -- Add replacement item (or increment if already in the order)
    IF EXISTS (
      SELECT 1 FROM sales_order_items
      WHERE sales_order_id = p_sale_id AND variant_id = p_replacement_variant_id
    ) THEN
      UPDATE sales_order_items
      SET quantity = quantity + p_replacement_qty
      WHERE sales_order_id = p_sale_id AND variant_id = p_replacement_variant_id;
    ELSE
      INSERT INTO sales_order_items (
        sales_order_id, variant_id, quantity, unit_price, unit_cogs_snapshot
      ) VALUES (
        p_sale_id,
        p_replacement_variant_id,
        p_replacement_qty,
        GREATEST(0, COALESCE(v_line.unit_price, v_rep_var.retail_price, 0) + (COALESCE(p_price_diff, 0) / p_replacement_qty)),
        COALESCE(v_rep_var.avg_unit_cogs, 0)
      );
    END IF;
  END IF;

  -- Recalculate order totals
  SELECT
    COALESCE(SUM(quantity * unit_price), 0),
    COALESCE(SUM(quantity * unit_cogs_snapshot), 0)
  INTO v_new_subtotal, v_new_cogs
  FROM sales_order_items
  WHERE sales_order_id = p_sale_id;

  v_new_total := GREATEST(0, ROUND(v_new_subtotal - COALESCE(v_sale.discount_amount, 0) + COALESCE(v_sale.shipping_fee, 0), 2));
  v_new_paid := LEAST(COALESCE(v_sale.paid_amount, 0), v_new_total);
  v_new_remaining := GREATEST(0, ROUND(v_new_total - v_new_paid, 2));
  v_new_pay_status := CASE
    WHEN v_new_remaining <= 0.01 AND v_new_total > 0 THEN 'مدفوع بالكامل'
    WHEN v_new_paid > 0 THEN 'دفع جزئي'
    ELSE 'لم يدفع'
  END;

  v_note_entry := CASE
    WHEN p_replacement_variant_id IS NOT NULL THEN
      'استبدال ' || p_return_qty || ' قطعة (' || COALESCE(v_ret_var.color || '/' || v_ret_var.size, '') || ' ← ' ||
      COALESCE(v_rep_var.color || '/' || v_rep_var.size, '') || ')'
    ELSE
      'مرتجع ' || p_return_qty || ' قطعة (' || COALESCE(v_ret_var.color || '/' || v_ret_var.size, '') || ')'
  END || CASE WHEN NULLIF(TRIM(p_notes), '') IS NOT NULL THEN ' • ' || TRIM(p_notes) ELSE '' END;

  UPDATE sales_orders
  SET
    subtotal = v_new_subtotal,
    total_amount = v_new_total,
    total_cogs = v_new_cogs,
    paid_amount = v_new_paid,
    remaining_debt = v_new_remaining,
    payment_status = v_new_pay_status,
    status = CASE WHEN v_new_subtotal <= 0 THEN 'returned'::sales_order_status ELSE status END,
    fulfillment_status = CASE WHEN v_new_subtotal <= 0 THEN 'مرتجع' ELSE fulfillment_status END,
    notes = CASE
      WHEN NULLIF(TRIM(COALESCE(notes, '')), '') IS NOT NULL THEN notes || ' | ' || v_note_entry
      ELSE v_note_entry
    END
  WHERE id = p_sale_id;
END;
$$;

-- 3) Optional Role-Based Access Control (Admin vs Staff)
CREATE TABLE IF NOT EXISTS user_roles (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  display_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  has_auth_role BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_auth_role;
  ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
  IF has_auth_role THEN
    DROP POLICY IF EXISTS "authenticated_manage_user_roles" ON user_roles;
    CREATE POLICY "authenticated_manage_user_roles"
      ON user_roles FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION get_my_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims JSONB := NULL;
  v_email TEXT := NULL;
  v_role TEXT := NULL;
BEGIN
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;

  v_email := LOWER(NULLIF(v_claims ->> 'email', ''));
  IF v_email IS NULL THEN
    RETURN 'admin';
  END IF;

  SELECT role INTO v_role FROM user_roles WHERE LOWER(email) = v_email LIMIT 1;
  RETURN COALESCE(v_role, 'admin');
END;
$$;
