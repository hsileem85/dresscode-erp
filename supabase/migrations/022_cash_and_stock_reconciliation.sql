-- ============================================================================
-- DressCode ERP — Migration 022: Cash & Stock Reconciliation (الجرد والتسوية)
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) Creates `reconciliation_sessions` to store historical Cash & Stock
--    physical counts, variances, channel breakdowns, and line-by-line diffs.
-- 2) Creates atomic RPC `apply_stock_reconciliation(...)` to update fabrics,
--    trims, and finished-goods variants, log `inventory_movements` ('adjustment'),
--    and record the reconciliation snapshot in a single database transaction.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reconciliation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_number TEXT NOT NULL,
  rec_type TEXT NOT NULL CHECK (rec_type IN ('cash', 'stock')),
  stock_scope TEXT,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  system_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  actual_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  variance_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  items_counted INTEGER NOT NULL DEFAULT 0,
  items_adjusted INTEGER NOT NULL DEFAULT 0,
  adjustment_posted BOOLEAN NOT NULL DEFAULT FALSE,
  actor_email TEXT,
  actor_name TEXT,
  notes TEXT,
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_sessions_at
  ON reconciliation_sessions (reconciled_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_sessions_type
  ON reconciliation_sessions (rec_type, reconciled_at DESC);

-- Enable RLS for Supabase authenticated users
DO $$
DECLARE
  has_auth_role BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_auth_role;
  ALTER TABLE reconciliation_sessions ENABLE ROW LEVEL SECURITY;
  IF has_auth_role THEN
    DROP POLICY IF EXISTS "authenticated_full_access_reconciliation_sessions" ON reconciliation_sessions;
    CREATE POLICY "authenticated_full_access_reconciliation_sessions"
      ON reconciliation_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Attach audit trigger if migration 018 is installed
DO $$
BEGIN
  IF to_regprocedure('fn_dresscode_audit_trigger()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_reconciliation_sessions ON reconciliation_sessions;
    CREATE TRIGGER trg_audit_reconciliation_sessions
      AFTER INSERT OR UPDATE OR DELETE ON reconciliation_sessions
      FOR EACH ROW EXECUTE FUNCTION fn_dresscode_audit_trigger();
  END IF;
END $$;

-- Atomic Stock Reconciliation RPC
CREATE OR REPLACE FUNCTION apply_stock_reconciliation(
  p_reconciliation_number TEXT,
  p_stock_scope TEXT,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_post_adjustments BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID := gen_random_uuid();
  v_item JSONB;
  v_item_type TEXT;
  v_item_id UUID;
  v_actual_qty NUMERIC(14, 3);
  v_system_qty NUMERIC(14, 3);
  v_delta NUMERIC(14, 3);
  v_unit_cost NUMERIC(12, 4);
  v_line_note TEXT;
  v_system_total NUMERIC(14, 2) := 0;
  v_actual_total NUMERIC(14, 2) := 0;
  v_counted INT := 0;
  v_adjusted INT := 0;
  v_claims JSONB := NULL;
  v_actor_email TEXT := NULL;
  v_actor_name TEXT := NULL;
  v_details JSONB := '[]'::jsonb;
  v_item_name TEXT;
  v_unit_label TEXT;
BEGIN
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;

  IF v_claims IS NOT NULL THEN
    v_actor_email := NULLIF(v_claims ->> 'email', '');
    v_actor_name := COALESCE(
      NULLIF(v_claims -> 'user_metadata' ->> 'full_name', ''),
      NULLIF(v_claims -> 'user_metadata' ->> 'name', ''),
      v_actor_email,
      current_user
    );
  ELSE
    v_actor_email := current_user;
    v_actor_name := current_user;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إدخال جرد فعلي لصنف واحد على الأقل قبل الاعتماد';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_type := v_item ->> 'itemType';
    v_item_id := (v_item ->> 'itemId')::UUID;
    v_actual_qty := GREATEST(0, COALESCE((v_item ->> 'actualQty')::NUMERIC, 0));
    v_line_note := NULLIF(BTRIM(COALESCE(v_item ->> 'note', '')), '');
    v_item_name := COALESCE(v_item ->> 'itemName', '');
    v_unit_label := COALESCE(v_item ->> 'unitLabel', '');

    IF v_item_type = 'fabric' THEN
      v_actual_qty := ROUND(v_actual_qty, 3);
      SELECT COALESCE(stock_qty, 0), COALESCE(price_per_unit, 0), COALESCE(NULLIF(v_item_name, ''), name)
      INTO v_system_qty, v_unit_cost, v_item_name
      FROM fabrics WHERE id = v_item_id FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_delta := ROUND(v_actual_qty - v_system_qty, 3);
      IF p_post_adjustments AND ABS(v_delta) >= 0.001 THEN
        UPDATE fabrics SET stock_qty = v_actual_qty WHERE id = v_item_id;
        INSERT INTO inventory_movements (
          item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
        ) VALUES (
          'fabric', v_item_id, 'adjustment', v_delta, ROUND(v_unit_cost, 4),
          'reconciliation', v_session_id,
          'تسوية جرد (' || p_reconciliation_number || ')' ||
            CASE WHEN COALESCE(v_line_note, p_notes) IS NOT NULL THEN ' — ' || COALESCE(v_line_note, p_notes) ELSE '' END
        );
        v_adjusted := v_adjusted + 1;
      END IF;

    ELSIF v_item_type = 'trim' THEN
      v_actual_qty := TRUNC(v_actual_qty);
      SELECT COALESCE(stock_qty, 0), COALESCE(unit_cost, 0), COALESCE(NULLIF(v_item_name, ''), name)
      INTO v_system_qty, v_unit_cost, v_item_name
      FROM trims WHERE id = v_item_id FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_delta := ROUND(v_actual_qty - v_system_qty, 3);
      IF p_post_adjustments AND ABS(v_delta) >= 0.001 THEN
        UPDATE trims SET stock_qty = v_actual_qty WHERE id = v_item_id;
        INSERT INTO inventory_movements (
          item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
        ) VALUES (
          'trim', v_item_id, 'adjustment', v_delta, ROUND(v_unit_cost, 4),
          'reconciliation', v_session_id,
          'تسوية جرد (' || p_reconciliation_number || ')' ||
            CASE WHEN COALESCE(v_line_note, p_notes) IS NOT NULL THEN ' — ' || COALESCE(v_line_note, p_notes) ELSE '' END
        );
        v_adjusted := v_adjusted + 1;
      END IF;

    ELSIF v_item_type = 'finished_good' THEN
      v_actual_qty := TRUNC(v_actual_qty);
      SELECT COALESCE(finished_goods_qty, 0), COALESCE(avg_unit_cogs, 0)
      INTO v_system_qty, v_unit_cost
      FROM model_variants WHERE id = v_item_id FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_delta := TRUNC(v_actual_qty) - v_system_qty;
      IF p_post_adjustments AND ABS(v_delta) >= 1 THEN
        UPDATE model_variants SET finished_goods_qty = TRUNC(v_actual_qty)::INTEGER WHERE id = v_item_id;
        INSERT INTO inventory_movements (
          item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
        ) VALUES (
          'finished_good', v_item_id, 'adjustment', v_delta, ROUND(v_unit_cost, 4),
          'reconciliation', v_session_id,
          'تسوية جرد (' || p_reconciliation_number || ')' ||
            CASE WHEN COALESCE(v_line_note, p_notes) IS NOT NULL THEN ' — ' || COALESCE(v_line_note, p_notes) ELSE '' END
        );
        v_adjusted := v_adjusted + 1;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    v_counted := v_counted + 1;
    v_system_total := v_system_total + ROUND(v_system_qty * v_unit_cost, 2);
    v_actual_total := v_actual_total + ROUND(v_actual_qty * v_unit_cost, 2);

    v_details := v_details || jsonb_build_array(
      jsonb_build_object(
        'itemType', v_item_type,
        'itemId', v_item_id,
        'itemName', v_item_name,
        'unitLabel', v_unit_label,
        'systemQty', v_system_qty,
        'actualQty', v_actual_qty,
        'qtyDelta', v_delta,
        'unitCost', ROUND(v_unit_cost, 4),
        'valueDelta', ROUND(v_delta * v_unit_cost, 2),
        'note', COALESCE(v_line_note, '')
      )
    );
  END LOOP;

  INSERT INTO reconciliation_sessions (
    id,
    reconciliation_number,
    rec_type,
    stock_scope,
    reconciled_at,
    system_value,
    actual_value,
    variance_value,
    items_counted,
    items_adjusted,
    adjustment_posted,
    actor_email,
    actor_name,
    notes,
    details
  ) VALUES (
    v_session_id,
    p_reconciliation_number,
    'stock',
    COALESCE(p_stock_scope, 'all'),
    NOW(),
    ROUND(v_system_total, 2),
    ROUND(v_actual_total, 2),
    ROUND(v_actual_total - v_system_total, 2),
    v_counted,
    v_adjusted,
    p_post_adjustments AND v_adjusted > 0,
    v_actor_email,
    v_actor_name,
    p_notes,
    v_details
  );

  RETURN v_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_stock_reconciliation(TEXT, TEXT, JSONB, TEXT, BOOLEAN) TO authenticated;
