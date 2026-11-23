-- ============================================================================
-- DressCode ERP — Migration 006: Add 'weight' (بالوزن) to trim_purchase_unit ENUM
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================

ALTER TYPE trim_purchase_unit ADD VALUE IF NOT EXISTS 'weight';
