-- ============================================================================
-- DressCode ERP — Migration 011: Multi-Service & Workshop-Supplied Materials
-- on Outsourced Operations (التشغيل الخارجي)
-- Target: PostgreSQL 15+ / Supabase (100% additive & idempotent)
-- ============================================================================
-- Allows each outsourced operation stage (`outsourced_operations`) to bundle:
-- 1) `services`: multiple workshop services performed together in the same
--    stage (e.g., قص + سرفلة + كي وبخار + تطريز) with optional per-service cost
-- 2) `supplied_materials`: buttons, trims, zippers, threads, or accessories
--    purchased directly from the workshop within the same stage
-- The existing `cost` column stores the combined total (services + supplied
-- materials), so `unit_cost`, BOM costing, and production orders stay in sync.
-- ============================================================================

ALTER TABLE outsourced_operations
  ADD COLUMN IF NOT EXISTS services JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS supplied_materials JSONB NOT NULL DEFAULT '[]'::jsonb;
