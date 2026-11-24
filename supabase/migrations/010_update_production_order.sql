-- ============================================================================
-- DressCode ERP — Migration 010: Edit / Update Production Orders Safely
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- Adds `update_production_order(...)`:
-- - `planned`: allows editing model, workshop, variant quantities, agreed labor
--   total, and notes; recalculates `planned_qty` and syncs workshop_id on any
--   prior advance financial transactions.
-- - `in_progress`: locks `model_id`, allows editing workshop, variant breakdown
--   / planned quantities (without re-issuing raw materials), agreed labor total,
--   and notes.
-- - `completed`: locks `model_id` and received variant quantities, allows
--   editing workshop, agreed labor total, and notes — atomically reconciling
--   `workshops.balance_payable` (including workshop transfers) and updating
--   `actual_labor_cost` and `actual_unit_cogs`.
-- ============================================================================

-- Ensure Migration 005 columns exist on production_orders (idempotent safety)
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workshop_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agreed_labor_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (agreed_labor_total >= 0),
  ADD COLUMN IF NOT EXISTS paid_to_workshop NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_to_workshop >= 0);

CREATE OR REPLACE FUNCTION update_production_order(
  p_prod_id UUID,
  p_model_id UUID DEFAULT NULL,
  p_workshop_id UUID DEFAULT NULL,
  p_workshop_name TEXT DEFAULT '',
  p_agreed_labor_total NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_variants JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_target_model_id UUID;
  v_new_workshop_name TEXT;
  v_new_labor NUMERIC(14, 2);
  v_old_labor NUMERIC(14, 2);
  v_paid NUMERIC(14, 2);
  v_old_unpaid NUMERIC(14, 2);
  v_new_unpaid NUMERIC(14, 2);
  v_new_planned_qty INTEGER := 0;
  v_new_cogs NUMERIC(12, 2);
  v_item JSONB;
  v_var_id UUID;
  v_qty INTEGER;
  v_valid_var BOOLEAN;
BEGIN
  SELECT * INTO v_prod FROM production_orders WHERE id = p_prod_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر التصنيع غير موجود';
  END IF;

  IF v_prod.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن تعديل أمر تصنيع ملغي';
  END IF;

  v_new_labor := GREATEST(0, ROUND(COALESCE(p_agreed_labor_total, 0), 2));
  v_new_workshop_name := COALESCE(NULLIF(TRIM(p_workshop_name), ''), '');

  -- Enforce model immutability once materials are issued or batch is completed
  IF v_prod.status <> 'planned' AND p_model_id IS NOT NULL AND p_model_id <> v_prod.model_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير الموديل بعد صرف الخامات أو اكتمال أمر التصنيع';
  END IF;

  v_target_model_id := CASE
    WHEN v_prod.status = 'planned' AND p_model_id IS NOT NULL THEN p_model_id
    ELSE v_prod.model_id
  END;

  -- A) Planned or In-Progress: update variants (if supplied), workshop, labor, notes
  IF v_prod.status IN ('planned', 'in_progress') THEN
    v_new_planned_qty := v_prod.planned_qty;

    IF p_variants IS NOT NULL THEN
      IF jsonb_typeof(p_variants) <> 'array' THEN
        RAISE EXCEPTION 'صيغة قائمة المقاسات والألوان غير صالحة';
      END IF;

      DELETE FROM production_order_variants WHERE production_order_id = p_prod_id;
      v_new_planned_qty := 0;

      FOR v_item IN SELECT * FROM jsonb_array_elements(p_variants)
      LOOP
        v_var_id := (v_item->>'variant_id')::UUID;
        v_qty := COALESCE((v_item->>'planned_qty')::INTEGER, 0);

        IF v_qty <= 0 THEN
          CONTINUE;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM model_variants
          WHERE id = v_var_id AND model_id = v_target_model_id
        ) INTO v_valid_var;

        IF NOT v_valid_var THEN
          RAISE EXCEPTION 'أحد المقاسات/الألوان المحددة لا يتبع الموديل المختار';
        END IF;

        INSERT INTO production_order_variants (
          production_order_id, variant_id, planned_qty, completed_qty
        ) VALUES (
          p_prod_id, v_var_id, v_qty, 0
        )
        ON CONFLICT (production_order_id, variant_id)
        DO UPDATE SET planned_qty = EXCLUDED.planned_qty;

        v_new_planned_qty := v_new_planned_qty + v_qty;
      END LOOP;

      IF v_new_planned_qty <= 0 THEN
        RAISE EXCEPTION 'يجب إدخال كمية واحدة على الأقل لأمر التصنيع';
      END IF;
    END IF;

    UPDATE production_orders
    SET
      model_id = v_target_model_id,
      workshop_id = p_workshop_id,
      workshop_name = v_new_workshop_name,
      agreed_labor_total = v_new_labor,
      planned_qty = v_new_planned_qty,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = p_prod_id;

    IF p_workshop_id IS DISTINCT FROM v_prod.workshop_id THEN
      UPDATE financial_transactions
      SET workshop_id = p_workshop_id
      WHERE reference_type = 'production_order'
        AND reference_id = p_prod_id;
    END IF;

    RETURN;
  END IF;

  -- B) Completed: reconcile workshop balance_payable & recalculate actual_unit_cogs
  IF v_prod.status = 'completed' THEN
    v_old_labor := COALESCE(NULLIF(v_prod.actual_labor_cost, 0), v_prod.agreed_labor_total, 0);
    v_paid := COALESCE(v_prod.paid_to_workshop, 0);
    v_old_unpaid := GREATEST(v_old_labor - v_paid, 0);
    v_new_unpaid := GREATEST(v_new_labor - v_paid, 0);

    IF v_prod.workshop_id IS NOT DISTINCT FROM p_workshop_id THEN
      IF p_workshop_id IS NOT NULL AND v_new_unpaid <> v_old_unpaid THEN
        UPDATE workshops
        SET balance_payable = GREATEST(0, balance_payable + ROUND(v_new_unpaid - v_old_unpaid, 2))
        WHERE id = p_workshop_id;
      END IF;
    ELSE
      IF v_prod.workshop_id IS NOT NULL AND v_old_unpaid > 0 THEN
        UPDATE workshops
        SET balance_payable = GREATEST(0, balance_payable - ROUND(v_old_unpaid, 2))
        WHERE id = v_prod.workshop_id;
      END IF;

      IF p_workshop_id IS NOT NULL AND v_new_unpaid > 0 THEN
        UPDATE workshops
        SET balance_payable = balance_payable + ROUND(v_new_unpaid, 2)
        WHERE id = p_workshop_id;
      END IF;

      UPDATE financial_transactions
      SET workshop_id = p_workshop_id
      WHERE reference_type = 'production_order'
        AND reference_id = p_prod_id;
    END IF;

    v_new_cogs := CASE
      WHEN COALESCE(v_prod.completed_qty, 0) > 0 THEN
        ROUND(
          (COALESCE(v_prod.actual_material_cost, 0) + v_new_labor + COALESCE(v_prod.allocated_overhead_cost, 0))
          / v_prod.completed_qty,
          2
        )
      ELSE v_prod.actual_unit_cogs
    END;

    UPDATE production_orders
    SET
      workshop_id = p_workshop_id,
      workshop_name = v_new_workshop_name,
      agreed_labor_total = v_new_labor,
      actual_labor_cost = v_new_labor,
      actual_unit_cogs = v_new_cogs,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = p_prod_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
