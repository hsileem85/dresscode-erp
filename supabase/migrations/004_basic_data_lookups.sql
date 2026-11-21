-- ============================================================================
-- DressCode ERP — Migration 004: Configurable Lookups Table (البيانات الأساسية)
-- Target: PostgreSQL 15+ / Supabase (100% additive)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lookup_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key TEXT NOT NULL, -- model_categories | trim_categories | platforms | governorates | expense_categories | payment_methods | sizes | colors
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_key, label)
);

CREATE INDEX IF NOT EXISTS idx_lookup_values_group ON lookup_values(group_key, sort_order);

-- Seed DressCode default lookup values
INSERT INTO lookup_values (group_key, label, sort_order) VALUES
  ('model_categories', 'عباية', 1),
  ('model_categories', 'فستان', 2),
  ('model_categories', 'كارديجان', 3),
  ('model_categories', 'كيمونو', 4),
  ('model_categories', 'تونك', 5),
  ('model_categories', 'بلوزة', 6),
  ('model_categories', 'طقم', 7),
  ('model_categories', 'بنطال واسع', 8),
  ('model_categories', 'جيبة', 9),
  ('model_categories', 'بيزك', 10),

  ('trim_categories', 'تيكت وهوية البراند', 1),
  ('trim_categories', 'التغليف والهوية', 2),
  ('trim_categories', 'سحابات', 3),
  ('trim_categories', 'أزرار', 4),
  ('trim_categories', 'خيوط', 5),
  ('trim_categories', 'إكسسوارات', 6),

  ('platforms', 'واتساب', 1),
  ('platforms', 'انستجرام', 2),
  ('platforms', 'المتجر', 3),
  ('platforms', 'مباشر', 4),

  ('governorates', 'العريش', 1),
  ('governorates', 'القاهرة', 2),
  ('governorates', 'الجيزة', 3),
  ('governorates', 'الإسكندرية', 4),
  ('governorates', 'السويس', 5),
  ('governorates', 'بورسعيد', 6),
  ('governorates', 'الإمارات', 7),

  ('expense_categories', 'ثابت', 1),
  ('expense_categories', 'متغير', 2),
  ('expense_categories', 'تسويق', 3),
  ('expense_categories', 'خامات', 4),

  ('payment_methods', 'كاش', 1),
  ('payment_methods', 'تحويل', 2),
  ('payment_methods', 'إنستاباي', 3),
  ('payment_methods', 'فودافون كاش', 4),

  ('sizes', 'Free Size', 1),
  ('sizes', 'S', 2),
  ('sizes', 'M', 3),
  ('sizes', 'L', 4),
  ('sizes', 'XL', 5),
  ('sizes', 'XXL', 6),

  ('colors', 'أسود فحمي', 1),
  ('colors', 'بيج رملي', 2),
  ('colors', 'أبيض', 3),
  ('colors', 'كحلي', 4),
  ('colors', 'زيتوني', 5),
  ('colors', 'نبيتي', 6),
  ('colors', 'موف', 7)
ON CONFLICT (group_key, label) DO NOTHING;

-- Enable RLS safely for Supabase
DO $$
DECLARE
  has_auth_role BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_auth_role;
  ALTER TABLE lookup_values ENABLE ROW LEVEL SECURITY;
  IF has_auth_role THEN
    DROP POLICY IF EXISTS "authenticated_full_access_lookup_values" ON lookup_values;
    CREATE POLICY "authenticated_full_access_lookup_values"
      ON lookup_values FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
