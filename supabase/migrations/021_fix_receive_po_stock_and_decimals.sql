-- ============================================================================
-- DressCode ERP — Migration 021: Harden receive_purchase_order & Decimal Fabric Quantities
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) Ensures `purchase_orders.shipping_cost` and `purchase_order_items.shipping_allocated` exist
-- 2) Ensures `purchase_order_items.quantity`, `fabrics.stock_qty`, `trims.stock_qty`,
--    and `inventory_movements.qty_delta` support fractional fabric quantities (NUMERIC(14,3), e.g. 4.5m)
-- 3) Hardens `receive_purchase_order(p_po_id UUID)`:
--    - Runs as SECURITY DEFINER (with search_path = public) so RLS can never silently
--      cause 0-row updates on fabrics/trims/inventory_movements
--    - Guards against NULL stock_qty / price_per_unit / unit_cost via COALESCE
--    - Validates that the PO actually contains items and that every referenced fabric/trim exists
--    - Updates fabrics.stock_qty / trims.stock_qty, WAC, inventory_movements, PO status, and supplier payable atomically
-- ============================================================================

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(14, 2) NOT NULL DEFAULT 0
  CHECK (shipping_cost >= 0);

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS shipping_allocated NUMERIC(14, 2) NOT NULL DEFAULT 0
  CHECK (shipping_allocated >= 0);

CREATE OR REPLACE FUNCTION receive_purchase_order(p_po_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_item_count INTEGER := 0;
  v_items_total NUMERIC(14, 2) := 0;
  v_total NUMERIC(14, 2) := 0;
  v_old_qty NUMERIC(14, 3);
  v_old_cost NUMERIC(12, 4);
  v_new_qty NUMERIC(14, 3);
  v_added_units NUMERIC(14, 3);
  v_units_per_pack NUMERIC(12, 3);
  v_shipping_alloc NUMERIC(14, 2);
  v_landed_unit_cost NUMERIC(12, 4);
  v_landed_pack_cost NUMERIC(12, 4);
  v_unit_cost NUMERIC(12, 4);
  v_calc_price NUMERIC(12, 2);
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود';
  END IF;
  IF v_po.status = 'received' THEN
    RAISE EXCEPTION 'أمر الشراء % تم استلامه بالفعل', v_po.po_number;
  END IF;
  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'أمر الشراء % ملغي ولا يمكن استلامه', v_po.po_number;
  END IF;

  FOR v_item IN
    SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
  LOOP
    v_item_count := v_item_count + 1;
    v_items_total := v_items_total + COALESCE(v_item.line_total, v_item.quantity * v_item.unit_price, 0);
    v_shipping_alloc := COALESCE(v_item.shipping_allocated, 0);

    IF v_item.item_type = 'fabric' THEN
      IF v_item.fabric_id IS NULL THEN
        RAISE EXCEPTION 'يوجد بند قماش في أمر الشراء % غير مرتبط بقماش مسجل', v_po.po_number;
      END IF;

      SELECT COALESCE(stock_qty, 0), COALESCE(price_per_unit, 0)
      INTO v_old_qty, v_old_cost
      FROM fabrics WHERE id = v_item.fabric_id FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'القماش المرتبط ببند (%) غير موجود في قاعدة البيانات', v_item.description;
      END IF;

      v_landed_unit_cost := COALESCE(v_item.unit_price, 0) + (v_shipping_alloc / NULLIF(v_item.quantity, 0));
      v_new_qty := GREATEST(v_old_qty, 0) + v_item.quantity;
      v_calc_price := COALESCE(
        ROUND(
          ((GREATEST(v_old_qty, 0) * v_old_cost) + (v_item.quantity * v_landed_unit_cost)) / NULLIF(v_new_qty, 0),
          2
        ),
        ROUND(v_landed_unit_cost, 2)
      );

      UPDATE fabrics
      SET
        stock_qty = ROUND(COALESCE(stock_qty, 0) + v_item.quantity, 3),
        price_per_unit = GREATEST(v_calc_price, 0)
      WHERE id = v_item.fabric_id;

      INSERT INTO inventory_movements (
        item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'fabric', v_item.fabric_id, 'purchase_in', v_item.quantity, ROUND(v_landed_unit_cost, 4),
        'purchase_order', p_po_id,
        CASE
          WHEN v_shipping_alloc > 0 THEN 'استلام أمر شراء ' || v_po.po_number || ' (شامل شحن)'
          ELSE 'استلام أمر شراء ' || v_po.po_number
        END
      );

    ELSIF v_item.item_type = 'trim' THEN
      IF v_item.trim_id IS NULL THEN
        RAISE EXCEPTION 'يوجد بند كلفة في أمر الشراء % غير مرتبط بكلفة مسجلة', v_po.po_number;
      END IF;

      SELECT COALESCE(stock_qty, 0), COALESCE(unit_cost, 0), GREATEST(COALESCE(units_per_pack, 1), 1)
      INTO v_old_qty, v_old_cost, v_units_per_pack
      FROM trims WHERE id = v_item.trim_id FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'الكلفة المرتبطة ببند (%) غير موجودة في قاعدة البيانات', v_item.description;
      END IF;

      v_units_per_pack := GREATEST(COALESCE(v_item.units_per_pack, v_units_per_pack, 1), 1);
      v_added_units := v_item.quantity * v_units_per_pack;
      v_landed_pack_cost := COALESCE(v_item.unit_price, 0) + (v_shipping_alloc / NULLIF(v_item.quantity, 0));
      v_unit_cost := v_landed_pack_cost / v_units_per_pack;
      v_new_qty := GREATEST(v_old_qty, 0) + v_added_units;
      v_calc_price := COALESCE(
        ROUND(
          (((GREATEST(v_old_qty, 0) * v_old_cost) + (v_added_units * v_unit_cost)) / NULLIF(v_new_qty, 0)) * v_units_per_pack,
          2
        ),
        ROUND(v_landed_pack_cost, 2)
      );

      UPDATE trims
      SET
        stock_qty = ROUND(COALESCE(stock_qty, 0) + v_added_units, 3),
        pack_price = GREATEST(v_calc_price, 0)
      WHERE id = v_item.trim_id;

      INSERT INTO inventory_movements (
        item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'trim', v_item.trim_id, 'purchase_in', v_added_units, ROUND(v_unit_cost, 4),
        'purchase_order', p_po_id,
        CASE
          WHEN v_shipping_alloc > 0 THEN 'استلام أمر شراء ' || v_po.po_number || ' (شامل شحن)'
          ELSE 'استلام أمر شراء ' || v_po.po_number
        END
      );
    END IF;
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'أمر الشراء % لا يحتوي على أي أصناف لاستلامها بالمخزن', v_po.po_number;
  END IF;

  v_total := ROUND(v_items_total + COALESCE(v_po.shipping_cost, 0), 2);

  UPDATE purchase_orders
  SET status = 'received', total_amount = v_total, received_at = NOW()
  WHERE id = p_po_id;

  IF v_po.supplier_id IS NOT NULL THEN
    UPDATE suppliers
    SET balance_payable = COALESCE(balance_payable, 0) + v_total
    WHERE id = v_po.supplier_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION receive_purchase_order(UUID) TO authenticated;
