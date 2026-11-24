-- ============================================================================
-- DressCode ERP — Migration 012: Supply Groups for Materials & Trims Tabs
-- (الكلف / مستلزمات التصنيع / مستلزمات البراند)
-- Target: PostgreSQL 15+ / Supabase (100% additive & idempotent)
-- ============================================================================

ALTER TABLE trims
  ADD COLUMN IF NOT EXISTS supply_group TEXT
    CHECK (supply_group IN ('trims', 'manufacturing', 'brand'));

-- Backfill existing items into their logical tab based on category and name
UPDATE trims
SET supply_group = CASE
  WHEN category ILIKE '%براند%'
    OR category ILIKE '%تيكت%'
    OR category ILIKE '%تغليف%'
    OR category ILIKE '%هوية%'
    OR category ILIKE '%شنط%'
    OR category ILIKE '%كروت%'
    OR name ILIKE '%تيكت%'
    OR name ILIKE '%شنط%'
    OR name ILIKE '%كيس%'
    OR name ILIKE '%تغليف%'
    OR name ILIKE '%كرت%'
    OR name ILIKE '%كروت%'
    OR name ILIKE '%ستيكر%'
    OR name ILIKE '%ليبل%'
    OR name ILIKE '%براند%'
    OR name ILIKE '%شكر%'
  THEN 'brand'
  WHEN category ILIKE '%تصنيع%'
    OR category ILIKE '%خيوط%'
    OR category ILIKE '%خيط%'
    OR category ILIKE '%باترون%'
    OR category ILIKE '%مقص%'
    OR category ILIKE '%أدوات%'
    OR category ILIKE '%ادوات%'
    OR name ILIKE '%باترون%'
    OR name ILIKE '%مقص%'
    OR name ILIKE '%خيط%'
    OR name ILIKE '%خيوط%'
    OR name ILIKE '%بكر%'
    OR name ILIKE '%إبر%'
    OR name ILIKE '%ابر%'
    OR name ILIKE '%دبوس%'
    OR name ILIKE '%دبابيس%'
    OR name ILIKE '%طباشير%'
    OR name ILIKE '%ماركر%'
    OR name ILIKE '%مازورة%'
    OR name ILIKE '%مسطرة%'
  THEN 'manufacturing'
  ELSE 'trims'
END
WHERE supply_group IS NULL;

-- Add lookup categories for manufacturing supplies & brand packaging if lookup_values exists
DO $$
BEGIN
  IF to_regclass('public.lookup_values') IS NOT NULL THEN
    INSERT INTO lookup_values (group_key, label, sort_order) VALUES
      ('trim_categories', 'مستلزمات التصنيع', 7),
      ('trim_categories', 'ورق باترون وأدوات قص', 8),
      ('trim_categories', 'شنط وكروت البراند', 9)
    ON CONFLICT (group_key, label) DO NOTHING;
  END IF;
END $$;
