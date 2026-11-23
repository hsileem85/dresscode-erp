-- ============================================================================
-- DressCode ERP — Migration 005: Outsourced Workshop Advances & Final Settlement
-- Supports giving cut fabric to an external workshop with optional advance
-- payments ("دفعة تحت الحساب") and final balance settlement upon delivery
-- ("الباقي مع الاستلام"), automatically deducting from Cashbox without
-- double-counting operating expenses in P&L.
-- Target: PostgreSQL 15+ / Supabase (100% additive & idempotent)
-- ============================================================================

-- 1. Add workshop & payout tracking columns to production_orders
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workshop_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agreed_labor_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (agreed_labor_total >= 0),
  ADD COLUMN IF NOT EXISTS paid_to_workshop NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_to_workshop >= 0);

-- 2. Atomic RPC: Record a Workshop Advance ("دفعة تحت الحساب") or Final Settlement
CREATE OR REPLACE FUNCTION record_workshop_payment(
  p_prod_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'كاش',
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_label TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ الدفعة للورشة يجب أن يكون أكبر من صفر';
  END IF;

  SELECT * INTO v_prod FROM production_orders WHERE id = p_prod_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر التصنيع % غير موجود', p_prod_id;
  END IF;

  -- Increment paid_to_workshop on the production batch
  UPDATE production_orders
  SET paid_to_workshop = paid_to_workshop + ROUND(p_amount, 2)
  WHERE id = p_prod_id;

  -- If the batch was already completed and accrued to workshop balance_payable, reduce the payable
  IF v_prod.status = 'completed' AND v_prod.workshop_id IS NOT NULL THEN
    UPDATE workshops
    SET balance_payable = GREATEST(balance_payable - ROUND(p_amount, 2), 0)
    WHERE id = v_prod.workshop_id;
  END IF;

  v_label := COALESCE(
    NULLIF(TRIM(p_notes), ''),
    CASE
      WHEN v_prod.status = 'completed' THEN 'سداد مستحقات الورشة — '
      ELSE 'دفعة تحت الحساب للورشة — '
    END || COALESCE(NULLIF(v_prod.workshop_name, ''), 'ورشة خارجية') || ' (' || v_prod.batch_number || ')'
  );

  -- Log in financial_transactions ledger
  INSERT INTO financial_transactions (
    tx_type, amount, workshop_id, reference_type, reference_id, payment_method, notes
  ) VALUES (
    'workshop_payout',
    ROUND(p_amount, 2),
    v_prod.workshop_id,
    'production_order',
    p_prod_id,
    COALESCE(NULLIF(p_payment_method, ''), 'كاش'),
    v_label
  );

  -- Deduct from live Cashbox (expenses table with is_raw_material_purchase = TRUE so P&L does NOT double-count COGS)
  IF to_regclass('public.expenses') IS NOT NULL THEN
    INSERT INTO expenses (
      expense_date, title, category, is_raw_material_purchase, amount, payment_method, notes
    ) VALUES (
      CURRENT_DATE,
      v_label,
      'خامات',
      TRUE,
      ROUND(p_amount, 2),
      COALESCE(NULLIF(p_payment_method, ''), 'كاش'),
      'تشغيلة ' || v_prod.batch_number
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 3. Update complete_production_order to respect agreed_labor_total & prior workshop advances
CREATE OR REPLACE FUNCTION complete_production_order(p_prod_id UUID)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_var RECORD;
  v_wlog RECORD;
  v_total_completed INTEGER := 0;
  v_labor_cost NUMERIC(14, 2) := 0;
  v_unpaid_labor NUMERIC(14, 2) := 0;
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

  -- Mark workshop logs completed & sum BOM labor cost
  FOR v_wlog IN
    SELECT * FROM production_workshop_logs WHERE production_order_id = p_prod_id FOR UPDATE
  LOOP
    v_labor_cost := v_labor_cost + v_wlog.total_step_cost;
    IF NOT v_wlog.is_completed THEN
      UPDATE production_workshop_logs
      SET is_completed = TRUE, completed_at = NOW()
      WHERE id = v_wlog.id;
    END IF;
  END LOOP;

  -- Prefer explicit agreed_labor_total if set on the batch
  IF COALESCE(v_prod.agreed_labor_total, 0) > 0 THEN
    v_labor_cost := v_prod.agreed_labor_total;
  END IF;

  -- Accrue ONLY the unpaid remainder (total labor - advance already paid) to workshop balance_payable
  v_unpaid_labor := GREATEST(v_labor_cost - COALESCE(v_prod.paid_to_workshop, 0), 0);
  IF v_prod.workshop_id IS NOT NULL AND v_unpaid_labor > 0 THEN
    UPDATE workshops
    SET balance_payable = balance_payable + ROUND(v_unpaid_labor, 2)
    WHERE id = v_prod.workshop_id;
  END IF;

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
    agreed_labor_total = CASE WHEN agreed_labor_total > 0 THEN agreed_labor_total ELSE ROUND(v_labor_cost, 2) END,
    allocated_overhead_cost = v_allocated_overhead,
    actual_unit_cogs = v_unit_cogs
  WHERE id = p_prod_id;
END;
$$ LANGUAGE plpgsql;
