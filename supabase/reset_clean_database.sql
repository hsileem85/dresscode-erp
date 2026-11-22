-- ============================================================================
-- DressCode ERP — Clean Database Reset (Truncate All Business Data)
-- Keeps:
--   - auth.users (your Supabase login accounts)
--   - app_settings (brand name, currency, monthly volume row id = 1)
--   - lookup_values (dropdown lists: categories, platforms, governorates, etc.)
--
-- Clears ALL transactional & master data so you can start feeding real data.
-- Run this in Supabase Dashboard -> SQL Editor -> New Query -> Run.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tbl TEXT;
  tables_to_truncate TEXT[] := ARRAY[
    -- Sales & Orders
    'sales_order_items',
    'sales_orders',

    -- Production & WIP
    'production_workshop_logs',
    'production_order_variants',
    'production_orders',

    -- Purchases
    'purchase_order_items',
    'purchase_orders',

    -- Ledgers, Cashbox, Expenses & Partner Capital
    'inventory_movements',
    'financial_transactions',
    'expenses',
    'partner_contributions',

    -- Models & BOM
    'model_fabrics',
    'model_trims',
    'model_labor_steps',
    'model_variants',
    'models',

    -- Raw Materials, Operations & Indirect Overhead
    'outsourced_operations',
    'fabrics',
    'trims',
    'overhead_items',

    -- Master Directories (CRM, Suppliers, Workshops)
    'customers',
    'suppliers',
    'workshops'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_truncate LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE;', tbl);
    END IF;
  END LOOP;
END $$;

-- Ensure core app_settings row (id = 1) exists for production/overhead RPCs
INSERT INTO public.app_settings (id, brand_name, website, currency, estimated_monthly_volume)
VALUES (1, 'DressCode', 'dresscode-clothing.com', 'EGP', 600)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Quick verification (every count below should be 0)
SELECT 'suppliers' AS table_name, COUNT(*) AS rows FROM suppliers
UNION ALL SELECT 'workshops', COUNT(*) FROM workshops
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'fabrics', COUNT(*) FROM fabrics
UNION ALL SELECT 'trims', COUNT(*) FROM trims
UNION ALL SELECT 'outsourced_operations', COUNT(*) FROM outsourced_operations
UNION ALL SELECT 'models', COUNT(*) FROM models
UNION ALL SELECT 'model_variants', COUNT(*) FROM model_variants
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'production_orders', COUNT(*) FROM production_orders
UNION ALL SELECT 'sales_orders', COUNT(*) FROM sales_orders
UNION ALL SELECT 'expenses', COUNT(*) FROM expenses
UNION ALL SELECT 'partner_contributions', COUNT(*) FROM partner_contributions
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'overhead_items', COUNT(*) FROM overhead_items;
