-- ============================================================================
-- DressCode ERP — Migration 018: System Audit Trail & Monthly Archiving (500 MB Safe)
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) Creates compact `audit_logs` table recording WHO (user id/email/name),
--    WHEN (timestamp + YYYY-MM month key), WHAT (entity, record summary),
--    ACTION (INSERT / UPDATE / DELETE), and CHANGED FIELDS (diff-only on UPDATE
--    to minimize storage footprint within Supabase's 500 MB free tier).
-- 2) Attaches automatic triggers to all 17 core business tables so every add,
--    edit, and delete (direct or via RPCs) is logged automatically.
-- 3) Provides storage & monthly archive maintenance RPCs:
--    - `get_audit_log_stats()` -> DB size vs 500 MB, audit_logs size, per-month counts
--    - `purge_audit_logs_for_month(p_month TEXT)` -> frees space after monthly export
--    - `purge_audit_logs_older_than(p_keep_days INT)` -> retention cleanup
-- ============================================================================

-- 1) Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  log_month TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM'),
  table_name TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id TEXT,
  record_summary TEXT,
  actor_id UUID,
  actor_email TEXT,
  actor_name TEXT,
  changed_fields JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at ON audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_month ON audit_logs (log_month, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs (table_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_email, occurred_at DESC);

-- Enable RLS for Supabase authenticated users
DO $$
DECLARE
  has_auth_role BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_auth_role;
  ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
  IF has_auth_role THEN
    DROP POLICY IF EXISTS "authenticated_read_audit_logs" ON audit_logs;
    CREATE POLICY "authenticated_read_audit_logs"
      ON audit_logs FOR SELECT TO authenticated USING (true);

    DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON audit_logs;
    CREATE POLICY "authenticated_insert_audit_logs"
      ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);

    DROP POLICY IF EXISTS "authenticated_delete_audit_logs" ON audit_logs;
    CREATE POLICY "authenticated_delete_audit_logs"
      ON audit_logs FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- 2) Generic Storage-Optimized Audit Trigger Function
CREATE OR REPLACE FUNCTION fn_dresscode_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims JSONB := NULL;
  v_actor_id UUID := NULL;
  v_actor_email TEXT := NULL;
  v_actor_name TEXT := NULL;
  v_old_json JSONB := NULL;
  v_new_json JSONB := NULL;
  v_src_json JSONB := NULL;
  v_diff JSONB := '{}'::JSONB;
  v_key TEXT;
  v_record_id TEXT := NULL;
  v_summary TEXT := NULL;
  v_entity_label TEXT;
BEGIN
  -- Friendly Arabic module name
  v_entity_label := CASE TG_TABLE_NAME
    WHEN 'purchase_orders'          THEN 'أمر شراء'
    WHEN 'sales_orders'             THEN 'أمر بيع'
    WHEN 'production_orders'        THEN 'أمر تصنيع'
    WHEN 'production_workshop_logs' THEN 'حركة ورشة'
    WHEN 'expenses'                 THEN 'مصروف'
    WHEN 'partner_contributions'    THEN 'مساهمة شريك'
    WHEN 'financial_transactions'   THEN 'حركة مالية'
    WHEN 'fabrics'                  THEN 'قماش'
    WHEN 'trims'                    THEN 'كلفة / إكسسوار'
    WHEN 'models'                   THEN 'موديل'
    WHEN 'model_variants'           THEN 'مقاس / منتج تام'
    WHEN 'outsourced_operations'    THEN 'تشغيل خارجي'
    WHEN 'customers'                THEN 'عميل'
    WHEN 'suppliers'                THEN 'مورد'
    WHEN 'workshops'                THEN 'ورشة'
    WHEN 'overhead_items'           THEN 'مصاريف غير مباشرة'
    WHEN 'app_settings'             THEN 'إعدادات النظام'
    ELSE TG_TABLE_NAME
  END;

  -- Extract authenticated user identity safely from Supabase JWT claims
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;

  IF v_claims IS NOT NULL THEN
    BEGIN
      v_actor_id := NULLIF(v_claims ->> 'sub', '')::UUID;
    EXCEPTION WHEN OTHERS THEN
      v_actor_id := NULL;
    END;
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

  -- Build compact payload / diff
  IF TG_OP = 'INSERT' THEN
    v_new_json := to_jsonb(NEW);
    v_src_json := v_new_json;
    v_diff := jsonb_strip_nulls(v_new_json - ARRAY['created_at', 'updated_at']);
  ELSIF TG_OP = 'DELETE' THEN
    v_old_json := to_jsonb(OLD);
    v_src_json := v_old_json;
    v_diff := jsonb_strip_nulls(v_old_json - ARRAY['created_at', 'updated_at']);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    v_src_json := v_new_json;

    FOR v_key IN SELECT jsonb_object_keys(v_new_json) LOOP
      IF v_key IN ('created_at', 'updated_at') THEN
        CONTINUE;
      END IF;
      IF (v_old_json -> v_key) IS DISTINCT FROM (v_new_json -> v_key) THEN
        v_diff := v_diff || jsonb_build_object(
          v_key,
          jsonb_build_object('old', v_old_json -> v_key, 'new', v_new_json -> v_key)
        );
      END IF;
    END LOOP;

    -- Skip no-op updates to keep DB storage minimal
    IF v_diff = '{}'::JSONB THEN
      RETURN NEW;
    END IF;
  END IF;

  v_record_id := v_src_json ->> 'id';

  -- Human-readable record summary
  v_summary := CASE TG_TABLE_NAME
    WHEN 'purchase_orders' THEN
      COALESCE(v_src_json ->> 'po_number', '') || ' • ' || COALESCE(v_src_json ->> 'supplier_name', '')
    WHEN 'sales_orders' THEN
      COALESCE(v_src_json ->> 'order_number', '') || ' • ' || COALESCE(v_src_json ->> 'customer_name', '')
    WHEN 'production_orders' THEN
      COALESCE(v_src_json ->> 'batch_number', '') ||
      CASE WHEN NULLIF(v_src_json ->> 'workshop_name', '') IS NOT NULL
           THEN ' • ' || (v_src_json ->> 'workshop_name')
           ELSE '' END
    WHEN 'production_workshop_logs' THEN
      COALESCE(v_src_json ->> 'workshop_name', '') || ' • ' || COALESCE(v_src_json ->> 'log_type', '') ||
      ' (' || COALESCE(v_src_json ->> 'amount', '0') || ')'
    WHEN 'expenses' THEN
      COALESCE(v_src_json ->> 'category', '') ||
      CASE WHEN NULLIF(v_src_json ->> 'description', '') IS NOT NULL
           THEN ' • ' || (v_src_json ->> 'description')
           ELSE '' END ||
      ' (' || COALESCE(v_src_json ->> 'amount', '0') || ')'
    WHEN 'partner_contributions' THEN
      COALESCE(v_src_json ->> 'partner_name', '') || ' (' || COALESCE(v_src_json ->> 'amount', '0') || ')'
    WHEN 'financial_transactions' THEN
      COALESCE(v_src_json ->> 'category', '') ||
      CASE WHEN NULLIF(v_src_json ->> 'description', '') IS NOT NULL
           THEN ' • ' || (v_src_json ->> 'description')
           ELSE '' END
    WHEN 'models' THEN
      COALESCE(v_src_json ->> 'name', '') ||
      CASE WHEN NULLIF(v_src_json ->> 'sku', '') IS NOT NULL
           THEN ' (' || (v_src_json ->> 'sku') || ')'
           ELSE '' END
    WHEN 'model_variants' THEN
      COALESCE(v_src_json ->> 'variant_sku', '') || ' • ' ||
      COALESCE(v_src_json ->> 'color', '') || '/' || COALESCE(v_src_json ->> 'size', '')
    WHEN 'app_settings' THEN
      'إعدادات النظام (' || COALESCE(v_src_json ->> 'currency', 'EGP') || ')'
    ELSE
      COALESCE(v_src_json ->> 'name', v_record_id, TG_TABLE_NAME)
  END;

  INSERT INTO audit_logs (
    occurred_at,
    log_month,
    table_name,
    entity_label,
    action,
    record_id,
    record_summary,
    actor_id,
    actor_email,
    actor_name,
    changed_fields
  ) VALUES (
    NOW(),
    TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM'),
    TG_TABLE_NAME,
    v_entity_label,
    TG_OP,
    v_record_id,
    LEFT(COALESCE(v_summary, ''), 220),
    v_actor_id,
    v_actor_email,
    v_actor_name,
    v_diff
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Attach Triggers Idempotently to Core Tables (only if table exists)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'purchase_orders',
    'sales_orders',
    'production_orders',
    'production_workshop_logs',
    'expenses',
    'partner_contributions',
    'financial_transactions',
    'fabrics',
    'trims',
    'models',
    'model_variants',
    'outsourced_operations',
    'customers',
    'suppliers',
    'workshops',
    'overhead_items',
    'app_settings'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON %I;', tbl, tbl);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_dresscode_audit_trigger();',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- 4) Storage & Monthly Breakdown Stats RPC (for 500 MB DB Monitoring)
CREATE OR REPLACE FUNCTION get_audit_log_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_rows BIGINT := 0;
  v_table_bytes BIGINT := 0;
  v_db_bytes BIGINT := 0;
  v_months JSONB := '[]'::JSONB;
BEGIN
  SELECT COUNT(*) INTO v_total_rows FROM audit_logs;
  SELECT pg_total_relation_size('public.audit_logs') INTO v_table_bytes;
  SELECT pg_database_size(current_database()) INTO v_db_bytes;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'month', m.log_month,
        'row_count', m.row_count,
        'oldest_at', m.oldest_at,
        'newest_at', m.newest_at
      )
      ORDER BY m.log_month DESC
    ),
    '[]'::JSONB
  )
  INTO v_months
  FROM (
    SELECT
      log_month,
      COUNT(*)::BIGINT AS row_count,
      MIN(occurred_at) AS oldest_at,
      MAX(occurred_at) AS newest_at
    FROM audit_logs
    GROUP BY log_month
  ) m;

  RETURN jsonb_build_object(
    'total_rows', v_total_rows,
    'audit_table_bytes', v_table_bytes,
    'audit_table_mb', ROUND(v_table_bytes / 1048576.0, 2),
    'db_total_bytes', v_db_bytes,
    'db_total_mb', ROUND(v_db_bytes / 1048576.0, 2),
    'db_limit_mb', 500,
    'months', v_months
  );
END;
$$;

-- 5) Monthly Purge RPC (Run after exporting/archiving a month's logs)
CREATE OR REPLACE FUNCTION purge_audit_logs_for_month(p_month TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'صيغة الشهر غير صالحة، يجب أن تكون YYYY-MM';
  END IF;

  DELETE FROM audit_logs WHERE log_month = p_month;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 6) Retention Purge RPC (Keep last N days)
CREATE OR REPLACE FUNCTION purge_audit_logs_older_than(p_keep_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
  v_days INT := GREATEST(COALESCE(p_keep_days, 30), 1);
BEGIN
  DELETE FROM audit_logs
  WHERE occurred_at < (NOW() - make_interval(days => v_days));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
