-- ============================================================================
-- DressCode ERP — Migration 009: Delete Production Orders & Finished Goods Variants
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) Adds `delete_model_variant(p_variant_id UUID)`:
--    - Protects against deleting a variant referenced by any sales order
--      (`sales_order_items`) or production order (`production_order_variants`)
--    - Logs an `adjustment` audit movement if the variant had remaining stock
--    - Deletes the `model_variants` row cleanly
--
-- 2) Adds `delete_production_order(p_prod_id UUID)`:
--    - If `completed`: validates finished-goods availability per variant
--      (blocks deletion if any received pieces were already sold/consumed),
--      atomically deducts the received finished goods back out of
--      `model_variants`, logs `adjustment` movements, and reverses any
--      remaining unpaid workshop balance from `workshops.balance_payable`
--    - If `in_progress` or `completed`: atomically restores every fabric and
--      trim originally issued for this batch (from `inventory_movements`
--      `production_issue`/`production_waste`) and logs `adjustment` movements
--    - Reverses any workshop advance/settlement payments recorded against this
--      batch from `financial_transactions` and `expenses` (cashbox)
--    - Deletes the `production_orders` row (cascading `production_order_variants`
--      and `production_workshop_logs`)
-- ============================================================================

-- Ensure Migration 005 columns exist on production_orders (idempotent safety)
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS workshop_id UUID REFERENCES workshops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workshop_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agreed_labor_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (agreed_labor_total >= 0),
  ADD COLUMN IF NOT EXISTS paid_to_workshop NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_to_workshop >= 0);

-- 1) Safe Delete Finished-Goods Variant RPC
CREATE OR REPLACE FUNCTION delete_model_variant(p_variant_id UUID)
RETURNS VOID AS $$
DECLARE
  v_var model_variants%ROWTYPE;
  v_sales_count INTEGER := 0;
  v_prod_count INTEGER := 0;
BEGIN
  SELECT * INTO v_var FROM model_variants WHERE id = p_variant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود في مخزون المنتج التام';
  END IF;

  SELECT COUNT(*) INTO v_sales_count
  FROM sales_order_items
  WHERE variant_id = p_variant_id;

  IF v_sales_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف الصنف (% — % / %) لأنه مرتبط بعدد % بند/طلب مبيعات — احذف أو عدّل المبيعات المرتبطة أولاً',
      v_var.variant_sku, v_var.color, v_var.size, v_sales_count;
  END IF;

  SELECT COUNT(*) INTO v_prod_count
  FROM production_order_variants
  WHERE variant_id = p_variant_id;

  IF v_prod_count > 0 THEN
    RAISE EXCEPTION 'لا يمكن حذف الصنف (% — % / %) لأنه مرتبط بعدد % أمر تصنيع — احذف أوامر التصنيع المرتبطة أولاً',
      v_var.variant_sku, v_var.color, v_var.size, v_prod_count;
  END IF;

  DELETE FROM model_variants WHERE id = p_variant_id;

  IF COALESCE(v_var.finished_goods_qty, 0) <> 0 THEN
    INSERT INTO inventory_movements (
      item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
    ) VALUES (
      'finished_good',
      NULL,
      'adjustment',
      -v_var.finished_goods_qty,
      COALESCE(v_var.avg_unit_cogs, 0),
      'manual',
      p_variant_id,
      'حذف صنف منتج تام (' || v_var.variant_sku || ' — ' || v_var.color || ' / ' || v_var.size || ')'
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 2) Atomic Delete Production Order RPC (with Safe Raw Stock, Finished Goods & Workshop Reversal)
CREATE OR REPLACE FUNCTION delete_production_order(p_prod_id UUID)
RETURNS VOID AS $$
DECLARE
  v_prod production_orders%ROWTYPE;
  v_var RECORD;
  v_mv RECORD;
  v_wlog RECORD;
  v_labor_total NUMERIC(14, 2) := 0;
  v_unpaid_labor NUMERIC(14, 2) := 0;
BEGIN
  SELECT * INTO v_prod FROM production_orders WHERE id = p_prod_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر التصنيع غير موجود';
  END IF;

  -- A) If completed: validate & deduct received finished goods and reverse unpaid workshop payable
  IF v_prod.status = 'completed' THEN
    FOR v_var IN
      SELECT
        pov.variant_id,
        pov.completed_qty,
        mv.variant_sku,
        mv.color,
        mv.size,
        mv.finished_goods_qty
      FROM production_order_variants pov
      JOIN model_variants mv ON mv.id = pov.variant_id
      WHERE pov.production_order_id = p_prod_id
        AND pov.completed_qty > 0
      ORDER BY mv.id
      FOR UPDATE OF mv
    LOOP
      IF v_var.finished_goods_qty < v_var.completed_qty THEN
        RAISE EXCEPTION 'لا يمكن حذف أمر التصنيع (%) لأن جزءاً من المنتج التام (% — % / %) تم بيعه أو سحبه بالفعل — الرصيد المتاح % أقل من الكمية المستلمة %',
          v_prod.batch_number, v_var.variant_sku, v_var.color, v_var.size, v_var.finished_goods_qty, v_var.completed_qty;
      END IF;

      UPDATE model_variants
      SET finished_goods_qty = finished_goods_qty - v_var.completed_qty
      WHERE id = v_var.variant_id;

      INSERT INTO inventory_movements (
        item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'finished_good',
        v_var.variant_id,
        'adjustment',
        -v_var.completed_qty,
        COALESCE(v_prod.actual_unit_cogs, 0),
        'production_order',
        p_prod_id,
        'عكس استلام منتج تام — حذف أمر تصنيع ' || v_prod.batch_number
      );
    END LOOP;

    -- Reverse any unpaid workshop balance accrued upon completion
    IF v_prod.workshop_id IS NOT NULL THEN
      v_labor_total := COALESCE(NULLIF(v_prod.actual_labor_cost, 0), v_prod.agreed_labor_total, 0);
      v_unpaid_labor := GREATEST(v_labor_total - COALESCE(v_prod.paid_to_workshop, 0), 0);

      IF v_unpaid_labor > 0 THEN
        UPDATE workshops
        SET balance_payable = GREATEST(0, balance_payable - ROUND(v_unpaid_labor, 2))
        WHERE id = v_prod.workshop_id;
      END IF;
    ELSE
      -- Legacy pre-005 fallback: reverse payables accrued per completed workshop log step
      FOR v_wlog IN
        SELECT workshop_id, SUM(total_step_cost) AS total_accrued
        FROM production_workshop_logs
        WHERE production_order_id = p_prod_id
          AND is_completed = TRUE
          AND workshop_id IS NOT NULL
        GROUP BY workshop_id
      LOOP
        UPDATE workshops
        SET balance_payable = GREATEST(0, balance_payable - ROUND(v_wlog.total_accrued, 2))
        WHERE id = v_wlog.workshop_id;
      END LOOP;
    END IF;
  END IF;

  -- B) If materials were issued (in_progress or completed): restore exact issued fabrics & trims
  IF v_prod.status IN ('in_progress', 'completed') THEN
    FOR v_mv IN
      SELECT item_type, fabric_id, trim_id, ABS(qty_delta) AS restore_qty, unit_cost
      FROM inventory_movements
      WHERE reference_type = 'production_order'
        AND reference_id = p_prod_id
        AND movement_type IN ('production_issue', 'production_waste')
        AND qty_delta < 0
      ORDER BY id
    LOOP
      IF v_mv.item_type = 'fabric' AND v_mv.fabric_id IS NOT NULL THEN
        PERFORM 1 FROM fabrics WHERE id = v_mv.fabric_id FOR UPDATE;
        IF FOUND THEN
          UPDATE fabrics
          SET stock_qty = stock_qty + v_mv.restore_qty
          WHERE id = v_mv.fabric_id;

          INSERT INTO inventory_movements (
            item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
          ) VALUES (
            'fabric',
            v_mv.fabric_id,
            'adjustment',
            v_mv.restore_qty,
            v_mv.unit_cost,
            'production_order',
            p_prod_id,
            'عكس صرف قماش — حذف أمر تصنيع ' || v_prod.batch_number
          );
        END IF;

      ELSIF v_mv.item_type = 'trim' AND v_mv.trim_id IS NOT NULL THEN
        PERFORM 1 FROM trims WHERE id = v_mv.trim_id FOR UPDATE;
        IF FOUND THEN
          UPDATE trims
          SET stock_qty = stock_qty + v_mv.restore_qty
          WHERE id = v_mv.trim_id;

          INSERT INTO inventory_movements (
            item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
          ) VALUES (
            'trim',
            v_mv.trim_id,
            'adjustment',
            v_mv.restore_qty,
            v_mv.unit_cost,
            'production_order',
            p_prod_id,
            'عكس صرف كلفة — حذف أمر تصنيع ' || v_prod.batch_number
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- C) Reverse any workshop advance/settlement payouts logged for this production order
  DELETE FROM financial_transactions
  WHERE reference_type = 'production_order'
    AND reference_id = p_prod_id;

  IF to_regclass('public.expenses') IS NOT NULL THEN
    DELETE FROM expenses
    WHERE is_raw_material_purchase = TRUE
      AND category = 'خامات'
      AND notes = 'تشغيلة ' || v_prod.batch_number;
  END IF;

  -- D) Delete the production order (cascades production_order_variants & production_workshop_logs)
  DELETE FROM production_orders WHERE id = p_prod_id;
END;
$$ LANGUAGE plpgsql;
