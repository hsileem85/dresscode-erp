-- ============================================================================
-- DressCode ERP — Migration 007: Auto-Included Trims in BOM Costing
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) Adds `auto_include_in_bom` flag & `default_qty_per_piece` to `trims`
-- 2) Allows `model_trims.quantity >= 0` so any single model can exclude (0) or
--    override an auto-included trim without double-counting
-- 3) Pre-enables the 5 standard DressCode packaging/tag items automatically
-- 4) Updates `v_model_cost_summary` and `issue_production_order` to stay in sync
-- ============================================================================

-- 1) Add auto-BOM columns to trims
ALTER TABLE trims
  ADD COLUMN IF NOT EXISTS auto_include_in_bom BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_qty_per_piece NUMERIC(12, 3) NOT NULL DEFAULT 1
    CHECK (default_qty_per_piece >= 0);

-- 2) Allow quantity = 0 in model_trims (used when excluding an auto-trim for a specific model)
ALTER TABLE model_trims DROP CONSTRAINT IF EXISTS model_trims_quantity_check;
ALTER TABLE model_trims ADD CONSTRAINT model_trims_quantity_check CHECK (quantity >= 0);

-- 3) Pre-enable the 5 standard DressCode items (everything except زراير كبس)
UPDATE trims
SET auto_include_in_bom = TRUE,
    default_qty_per_piece = 1
WHERE TRIM(name) IN (
  'خيط التيكت',
  'شنطة سوستة',
  'شنط البراند',
  'كروت البراند',
  'كروت شكر'
);

-- 4) Keep v_model_cost_summary aligned with explicit + auto-included trims
CREATE OR REPLACE VIEW v_model_cost_summary AS
WITH overhead_unit AS (
  SELECT
    COALESCE(SUM(o.monthly_amount), 0) / GREATEST(s.estimated_monthly_volume, 1) AS overhead_per_piece
  FROM app_settings s
  LEFT JOIN overhead_items o ON TRUE
  WHERE s.id = 1
  GROUP BY s.estimated_monthly_volume
),
fab_costs AS (
  SELECT
    mf.model_id,
    SUM(mf.consumption * (1 + mf.waste_pct / 100.0) * f.price_per_unit) AS fabric_cost
  FROM model_fabrics mf
  JOIN fabrics f ON f.id = mf.fabric_id
  GROUP BY mf.model_id
),
effective_trims AS (
  -- Explicit model trims (including per-model overrides/exclusions)
  SELECT mt.model_id, mt.trim_id, mt.quantity
  FROM model_trims mt
  UNION ALL
  -- Auto-included trims not explicitly overridden on that model
  SELECT m.id AS model_id, t.id AS trim_id, t.default_qty_per_piece AS quantity
  FROM models m
  CROSS JOIN trims t
  WHERE t.auto_include_in_bom = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM model_trims mt
      WHERE mt.model_id = m.id AND mt.trim_id = t.id
    )
),
trim_costs AS (
  SELECT
    et.model_id,
    SUM(et.quantity * t.unit_cost) AS trim_cost
  FROM effective_trims et
  JOIN trims t ON t.id = et.trim_id
  GROUP BY et.model_id
),
labor_costs AS (
  SELECT
    ml.model_id,
    SUM(CASE WHEN ml.billing_type = 'per_batch' THEN ml.cost / ml.batch_size ELSE ml.cost END) AS labor_cost
  FROM model_labor_steps ml
  GROUP BY ml.model_id
)
SELECT
  m.id AS model_id,
  m.sku,
  m.name,
  m.category,
  m.season,
  m.status,
  ROUND(COALESCE(fc.fabric_cost, 0), 2) AS fabric_cost,
  ROUND(COALESCE(tc.trim_cost, 0), 2) AS trim_cost,
  ROUND(COALESCE(fc.fabric_cost, 0) + COALESCE(tc.trim_cost, 0), 2) AS direct_material_cost,
  ROUND(COALESCE(lc.labor_cost, 0), 2) AS direct_labor_cost,
  ROUND(COALESCE(ou.overhead_per_piece, 0), 2) AS indirect_overhead_cost,
  ROUND(
    COALESCE(fc.fabric_cost, 0) + COALESCE(tc.trim_cost, 0) + COALESCE(lc.labor_cost, 0) + COALESCE(ou.overhead_per_piece, 0),
    2
  ) AS total_unit_cost,
  m.target_margin_pct,
  ROUND(
    (COALESCE(fc.fabric_cost, 0) + COALESCE(tc.trim_cost, 0) + COALESCE(lc.labor_cost, 0) + COALESCE(ou.overhead_per_piece, 0))
    * (1 + m.target_margin_pct / 100.0),
    2
  ) AS suggested_retail_price
FROM models m
CROSS JOIN overhead_unit ou
LEFT JOIN fab_costs fc ON fc.model_id = m.id
LEFT JOIN trim_costs tc ON tc.model_id = m.id
LEFT JOIN labor_costs lc ON lc.model_id = m.id;

-- 5) Keep issue_production_order aligned with explicit + auto-included trims
CREATE OR REPLACE FUNCTION issue_production_order(p_prod_id UUID)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_fab RECORD;
  v_trim RECORD;
  v_step RECORD;
  v_req_qty NUMERIC(14, 3);
  v_mat_cost NUMERIC(14, 2) := 0;
  v_step_total NUMERIC(14, 2);
BEGIN
  SELECT * INTO v_prod FROM production_orders WHERE id = p_prod_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production order % not found', p_prod_id;
  END IF;
  IF v_prod.status <> 'planned' THEN
    RAISE EXCEPTION 'Production order % must be in planned status', v_prod.batch_number;
  END IF;

  -- Deduct fabrics (consumption * (1 + waste%) * planned_qty)
  FOR v_fab IN
    SELECT mf.fabric_id, mf.consumption, mf.waste_pct, f.name, f.stock_qty, f.price_per_unit
    FROM model_fabrics mf
    JOIN fabrics f ON f.id = mf.fabric_id
    WHERE mf.model_id = v_prod.model_id
  LOOP
    v_req_qty := ROUND(v_fab.consumption * (1 + v_fab.waste_pct / 100.0) * v_prod.planned_qty, 3);
    IF v_fab.stock_qty < v_req_qty THEN
      RAISE EXCEPTION 'رصيد القماش (%) غير كافٍ: المطلوب % والمتاح %', v_fab.name, v_req_qty, v_fab.stock_qty;
    END IF;

    UPDATE fabrics SET stock_qty = stock_qty - v_req_qty WHERE id = v_fab.fabric_id;
    v_mat_cost := v_mat_cost + (v_req_qty * v_fab.price_per_unit);

    INSERT INTO inventory_movements (
      item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'fabric', v_fab.fabric_id, 'production_issue', -v_req_qty, v_fab.price_per_unit,
      'production_order', p_prod_id, 'صرف للتصنيع ' || v_prod.batch_number
    );
  END LOOP;

  -- Deduct effective trims: explicit model_trims + auto-included trims not overridden
  FOR v_trim IN
    SELECT eff.trim_id, eff.quantity, t.name, t.stock_qty, t.unit_cost
    FROM (
      SELECT mt.trim_id, mt.quantity
      FROM model_trims mt
      WHERE mt.model_id = v_prod.model_id
      UNION ALL
      SELECT t2.id AS trim_id, t2.default_qty_per_piece AS quantity
      FROM trims t2
      WHERE t2.auto_include_in_bom = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM model_trims mt2
          WHERE mt2.model_id = v_prod.model_id AND mt2.trim_id = t2.id
        )
    ) eff
    JOIN trims t ON t.id = eff.trim_id
    WHERE eff.quantity > 0
  LOOP
    v_req_qty := ROUND(v_trim.quantity * v_prod.planned_qty, 3);
    IF v_req_qty <= 0 THEN
      CONTINUE;
    END IF;
    IF v_trim.stock_qty < v_req_qty THEN
      RAISE EXCEPTION 'رصيد الكلفة (%) غير كافٍ: المطلوب % والمتاح %', v_trim.name, v_req_qty, v_trim.stock_qty;
    END IF;

    UPDATE trims SET stock_qty = stock_qty - v_req_qty WHERE id = v_trim.trim_id;
    v_mat_cost := v_mat_cost + (v_req_qty * v_trim.unit_cost);

    INSERT INTO inventory_movements (
      item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'trim', v_trim.trim_id, 'production_issue', -v_req_qty, v_trim.unit_cost,
      'production_order', p_prod_id, 'صرف للتصنيع ' || v_prod.batch_number
    );
  END LOOP;

  -- Copy BOM outsourced labor steps into workshop logs if none exist yet
  IF NOT EXISTS (SELECT 1 FROM production_workshop_logs WHERE production_order_id = p_prod_id) THEN
    FOR v_step IN
      SELECT * FROM model_labor_steps WHERE model_id = v_prod.model_id ORDER BY sequence_order
    LOOP
      v_step_total := CASE
        WHEN v_step.billing_type = 'per_batch' THEN (v_step.cost / v_step.batch_size) * v_prod.planned_qty
        ELSE v_step.cost * v_prod.planned_qty
      END;

      INSERT INTO production_workshop_logs (
        production_order_id, workshop_id, workshop_name, step_name,
        billing_type, agreed_cost, batch_size, total_step_cost
      ) VALUES (
        p_prod_id, v_step.workshop_id, v_step.workshop_name, v_step.name,
        v_step.billing_type, v_step.cost, v_step.batch_size, ROUND(v_step_total, 2)
      );
    END LOOP;
  END IF;

  UPDATE production_orders
  SET status = 'in_progress', started_at = NOW(), actual_material_cost = ROUND(v_mat_cost, 2)
  WHERE id = p_prod_id;
END;
$$ LANGUAGE plpgsql;
