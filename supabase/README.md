# DressCode ERP — PostgreSQL / Supabase Database Setup

This folder contains the complete, verified **PostgreSQL 15+** database for DressCode's full apparel cycle:
**Purchases → Raw Inventory (Weighted Average Cost) → BOM & Costing → Production Orders (WIP) → Finished Goods (Color/Size) → Sales & P&L**.

## Files
- `migrations/001_initial_dresscode_erp.sql` — 22 relational tables, enums, indexes, `updated_at` triggers, 3 reporting views (`v_model_cost_summary`, `v_monthly_pnl`, `v_low_stock_alerts`), and 4 atomic RPC functions (`receive_purchase_order`, `issue_production_order`, `complete_production_order`, `confirm_sales_order`).
- `migrations/002_supabase_rls.sql` — Row-Level Security (RLS) policies granting access to authenticated DressCode staff.
- `seed.sql` — DressCode sample data (suppliers, workshops, fabrics, trims, models, variants, overhead) plus an end-to-end demo transaction (PO receipt → 20-piece production batch → online sale).

## Quick Publish to Supabase (Free Cloud PostgreSQL — 3 Minutes)
1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New Query** and run these files in order:
   1. `supabase/migrations/001_initial_dresscode_erp.sql`
   2. `supabase/migrations/002_supabase_rls.sql`
   3. *(Optional sample data)* `supabase/seed.sql`
3. Go to **Project Settings → API**, copy your **Project URL** and **anon public key**, and place them into `.env.local` (see `.env.example`):
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Under **Authentication → Users**, create staff login accounts for your DressCode team.

## Self-Hosted PostgreSQL 15+
```bash
createdb dresscode_erp
psql -d dresscode_erp -f supabase/migrations/001_initial_dresscode_erp.sql
psql -d dresscode_erp -f supabase/migrations/002_supabase_rls.sql
psql -d dresscode_erp -f supabase/seed.sql
```
