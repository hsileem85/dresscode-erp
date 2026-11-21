-- ============================================================================
-- DressCode ERP — Supabase Row-Level Security (RLS) Policies
-- Enables RLS on all tables and grants full access to authenticated DressCode users.
-- Safe to run on both Supabase and standalone PostgreSQL.
-- ============================================================================

DO $$
DECLARE
  tbl TEXT;
  has_auth_role BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_auth_role;

  FOREACH tbl IN ARRAY ARRAY[
    'app_settings',
    'suppliers',
    'workshops',
    'customers',
    'fabrics',
    'trims',
    'outsourced_operations',
    'models',
    'model_variants',
    'model_fabrics',
    'model_trims',
    'model_labor_steps',
    'overhead_items',
    'purchase_orders',
    'purchase_order_items',
    'production_orders',
    'production_order_variants',
    'production_workshop_logs',
    'sales_orders',
    'sales_order_items',
    'inventory_movements',
    'financial_transactions'
  ] LOOP
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
