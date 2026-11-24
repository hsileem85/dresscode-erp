-- ============================================================================
-- DressCode ERP — Migration 013: Safe Shortage Override for issue_production_order
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- Replaces `issue_production_order(UUID)` with
-- `issue_production_order(p_prod_id UUID, p_allow_shortage BOOLEAN DEFAULT FALSE)`:
-- - By default (`p_allow_shortage = FALSE`), strictly validates that every
--   required fabric and effective trim (explicit + auto-included) has enough
--   `stock_qty` and raises a clear Arabic exception if short.
-- - When explicitly confirmed by the user (`p_allow_shortage = TRUE`), allows
--   issuing the batch while clamping stock deduction to available stock
--   (`LEAST(GREATEST(stock_qty, 0), v_req_qty)`) so raw stock never goes
--   negative and `delete_production_order` reverses the exact deducted qty,
--   while still computing full `actual_material_cost` for accurate COGS.
-- ============================================================================

DROP FUNCTION IF EXISTS issue_production_order(UUID);

CREATE OR REPLACE FUNCTION issue_production_order(
  p_prod_id UUID,
  p_allow_shortage BOOLEAN DEFAULT FALSE
)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_fab RECORD;
  v_trim RECORD;
  v_step RECORD;
  v_req_qty NUMERIC(14, 3);
  v_deduct_qty NUMERIC(14, 3);
  v_mat_cost NUMERIC(14, 2) := 0;
  v_step_total NUMERIC(14, 2);
BEGIN
  SELECT * INTO v_prod FROM production_orders WHERE id = p_prod_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر التصنيع غير موجود';
  END IF;
  IF v_prod.status <> 'planned' THEN
    RAISE EXCEPTION 'أمر التصنيع (%) يجب أن يكون في حالة تجهيز القص لصرف الخامات', v_prod.batch_number;
  END IF;

  -- Deduct fabrics (consumption * (1 + waste%) * planned_qty)
  FOR v_fab IN
    SELECT mf.fabric_id, mf.consumption, mf.waste_pct, f.name, f.stock_qty, f.price_per_unit
    FROM model_fabrics mf
    JOIN fabrics f ON f.id = mf.fabric_id
    WHERE mf.model_id = v_prod.model_id
    ORDER BY f.id
    FOR UPDATE OF f
  LOOP
    v_req_qty := ROUND(v_fab.consumption * (1 + v_fab.waste_pct / 100.0) * v_prod.planned_qty, 3);
    IF v_req_qty <= 0 THEN
      CONTINUE;
    END IF;

    IF NOT COALESCE(p_allow_shortage, FALSE) AND v_fab.stock_qty < v_req_qty THEN
      RAISE EXCEPTION 'رصيد القماش (%) غير كافٍ: المطلوب % والمتاح %', v_fab.name, v_req_qty, v_fab.stock_qty;
    END IF;

    v_deduct_qty := CASE
      WHEN COALESCE(p_allow_shortage, FALSE) THEN LEAST(GREATEST(v_fab.stock_qty, 0), v_req_qty)
      ELSE v_req_qty
    END;

    v_mat_cost := v_mat_cost + (v_req_qty * v_fab.price_per_unit);

    IF v_deduct_qty > 0 THEN
      UPDATE fabrics SET stock_qty = stock_qty - v_deduct_qty WHERE id = v_fab.fabric_id;

      INSERT INTO inventory_movements (
        item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'fabric', v_fab.fabric_id, 'production_issue', -v_deduct_qty, v_fab.price_per_unit,
        'production_order', p_prod_id, 'صرف للتصنيع ' || v_prod.batch_number
      );
    END IF;
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
    ORDER BY t.id
    FOR UPDATE OF t
  LOOP
    v_req_qty := ROUND(v_trim.quantity * v_prod.planned_qty, 3);
    IF v_req_qty <= 0 THEN
      CONTINUE;
    END IF;

    IF NOT COALESCE(p_allow_shortage, FALSE) AND v_trim.stock_qty < v_req_qty THEN
      RAISE EXCEPTION 'رصيد الكلفة (%) غير كافٍ: المطلوب % والمتاح %', v_trim.name, v_req_qty, v_trim.stock_qty;
    END IF;

    v_deduct_qty := CASE
      WHEN COALESCE(p_allow_shortage, FALSE) THEN LEAST(GREATEST(v_trim.stock_qty, 0), v_req_qty)
      ELSE v_req_qty
    END;

    v_mat_cost := v_mat_cost + (v_req_qty * v_trim.unit_cost);

    IF v_deduct_qty > 0 THEN
      UPDATE trims SET stock_qty = stock_qty - v_deduct_qty WHERE id = v_trim.trim_id;

      INSERT INTO inventory_movements (
        item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'trim', v_trim.trim_id, 'production_issue', -v_deduct_qty, v_trim.unit_cost,
        'production_order', p_prod_id, 'صرف للتصنيع ' || v_prod.batch_number
      );
    END IF;
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
