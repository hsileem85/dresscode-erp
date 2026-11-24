-- ============================================================================
-- DressCode ERP — Migration 014: Support Editing Paid-to-Workshop Advance Amount
-- inside `update_production_order` (with Cashbox, Ledger & Workshop Reconciliation)
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================

DROP FUNCTION IF EXISTS update_production_order(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, JSONB);

CREATE OR REPLACE FUNCTION update_production_order(
  p_prod_id UUID,
  p_model_id UUID DEFAULT NULL,
  p_workshop_id UUID DEFAULT NULL,
  p_workshop_name TEXT DEFAULT '',
  p_agreed_labor_total NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_variants JSONB DEFAULT NULL,
  p_paid_to_workshop NUMERIC DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_target_model_id UUID;
  v_new_workshop_name TEXT;
  v_new_labor NUMERIC(14, 2);
  v_old_labor NUMERIC(14, 2);
  v_old_paid NUMERIC(14, 2);
  v_new_paid NUMERIC(14, 2);
  v_old_unpaid NUMERIC(14, 2);
  v_new_unpaid NUMERIC(14, 2);
  v_new_planned_qty INTEGER := 0;
  v_new_cogs NUMERIC(12, 2);
  v_pay_method TEXT := 'كاش';
  v_payout_label TEXT;
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
  v_old_paid := COALESCE(v_prod.paid_to_workshop, 0);
  v_new_paid := CASE
    WHEN p_paid_to_workshop IS NOT NULL THEN GREATEST(0, ROUND(p_paid_to_workshop, 2))
    ELSE v_old_paid
  END;

  -- Enforce model immutability once materials are issued or batch is completed
  IF v_prod.status <> 'planned' AND p_model_id IS NOT NULL AND p_model_id <> v_prod.model_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير الموديل بعد صرف الخامات أو اكتمال أمر التصنيع';
  END IF;

  v_target_model_id := CASE
    WHEN v_prod.status = 'planned' AND p_model_id IS NOT NULL THEN p_model_id
    ELSE v_prod.model_id
  END;

  -- Reconcile financial_transactions & cashbox (expenses) if paid_to_workshop changed
  IF v_new_paid <> v_old_paid THEN
    SELECT COALESCE(NULLIF(payment_method, ''), 'كاش')
    INTO v_pay_method
    FROM financial_transactions
    WHERE reference_type = 'production_order'
      AND reference_id = p_prod_id
      AND tx_type = 'workshop_payout'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_pay_method IS NULL THEN
      v_pay_method := 'كاش';
    END IF;

    DELETE FROM financial_transactions
    WHERE reference_type = 'production_order'
      AND reference_id = p_prod_id
      AND tx_type = 'workshop_payout';

    IF to_regclass('public.expenses') IS NOT NULL THEN
      DELETE FROM expenses
      WHERE is_raw_material_purchase = TRUE
        AND category = 'خامات'
        AND notes = 'تشغيلة ' || v_prod.batch_number;
    END IF;

    IF v_new_paid > 0 THEN
      v_payout_label :=
        CASE
          WHEN v_prod.status = 'completed' THEN 'مدفوعات الورشة — '
          ELSE 'دفعة تحت الحساب للورشة — '
        END || COALESCE(NULLIF(v_new_workshop_name, ''), 'ورشة خارجية') || ' (' || v_prod.batch_number || ')';

      INSERT INTO financial_transactions (
        tx_type, amount, workshop_id, reference_type, reference_id, payment_method, notes
      ) VALUES (
        'workshop_payout',
        v_new_paid,
        p_workshop_id,
        'production_order',
        p_prod_id,
        v_pay_method,
        v_payout_label
      );

      IF to_regclass('public.expenses') IS NOT NULL THEN
        INSERT INTO expenses (
          expense_date, title, category, is_raw_material_purchase, amount, payment_method, notes
        ) VALUES (
          CURRENT_DATE,
          v_payout_label,
          'خامات',
          TRUE,
          v_new_paid,
          v_pay_method,
          'تشغيلة ' || v_prod.batch_number
        );
      END IF;
    END IF;
  ELSIF p_workshop_id IS DISTINCT FROM v_prod.workshop_id THEN
    UPDATE financial_transactions
    SET workshop_id = p_workshop_id
    WHERE reference_type = 'production_order'
      AND reference_id = p_prod_id;
  END IF;

  -- A) Planned or In-Progress
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
      paid_to_workshop = v_new_paid,
      planned_qty = v_new_planned_qty,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = p_prod_id;

    RETURN;
  END IF;

  -- B) Completed: reconcile workshop balance_payable & recalculate actual_unit_cogs
  IF v_prod.status = 'completed' THEN
    v_old_labor := COALESCE(NULLIF(v_prod.actual_labor_cost, 0), v_prod.agreed_labor_total, 0);
    v_old_unpaid := GREATEST(v_old_labor - v_old_paid, 0);
    v_new_unpaid := GREATEST(v_new_labor - v_new_paid, 0);

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
      paid_to_workshop = v_new_paid,
      actual_unit_cogs = v_new_cogs,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = p_prod_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
