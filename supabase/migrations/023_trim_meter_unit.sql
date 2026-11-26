-- ============================================================================
-- DressCode ERP — Migration 023: Add 'meter' (متر) to trim_purchase_unit ENUM
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- Supports measuring elastic bands (الأستك) and trim ribbons by the meter.
-- ============================================================================

ALTER TYPE trim_purchase_unit ADD VALUE IF NOT EXISTS 'meter';
