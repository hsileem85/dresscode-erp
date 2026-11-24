-- ============================================================================
-- DressCode ERP — Migration 017: Atomic Delete Purchase Order
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- Adds `delete_purchase_order(p_po_id UUID)`:
--   - If PO is `draft` / `ordered` / `cancelled`: deletes the PO and its items
--     (cancelled POs already had stock & supplier balance reversed).
--   - If PO is `received`: validates stock availability for every fabric/trim
--     item, atomically deducts the received quantities back out, logs
--     `adjustment` inventory movements, reverses supplier `balance_payable`,
--     and permanently deletes the purchase order (cascading `purchase_order_items`).
-- ============================================================================

-- Ensure shipping columns exist idempotently (safe regardless of migration order)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(14, 2) NOT NULL DEFAULT 0
  CHECK (shipping_cost >= 0);

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS shipping_allocated NUMERIC(14, 2) NOT NULL DEFAULT 0
  CHECK (shipping_allocated >= 0);

CREATE OR REPLACE FUNCTION delete_purchase_order(p_po_id UUID)
RETURNS VOID AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_cur_qty NUMERIC(14, 3);
  v_item_name TEXT;
  v_removed_units NUMERIC(14, 3);
  v_shipping_alloc NUMERIC(14, 2);
  v_landed_unit_cost NUMERIC(12, 4);
  v_unit_cost NUMERIC(12, 4);
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود';
  END IF;

  -- If already received, safely reverse inventory and supplier balance before deleting
  IF v_po.status = 'received' THEN
    FOR v_item IN
      SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
    LOOP
      v_shipping_alloc := COALESCE(v_item.shipping_allocated, 0);

      IF v_item.item_type = 'fabric' AND v_item.fabric_id IS NOT NULL THEN
        SELECT stock_qty, name INTO v_cur_qty, v_item_name
        FROM fabrics WHERE id = v_item.fabric_id FOR UPDATE;

        IF FOUND THEN
          IF v_cur_qty < v_item.quantity THEN
            RAISE EXCEPTION 'لا يمكن حذف أمر الشراء لأن جزءاً من القماش (%) تم استخدامه بالفعل — الرصيد المتاح % أقل من كمية الأمر %',
              v_item_name, v_cur_qty, v_item.quantity;
          END IF;

          v_landed_unit_cost := v_item.unit_price + (v_shipping_alloc / NULLIF(v_item.quantity, 0));

          UPDATE fabrics
          SET stock_qty = stock_qty - v_item.quantity
          WHERE id = v_item.fabric_id;

          INSERT INTO inventory_movements (
            item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
          ) VALUES (
            'fabric', v_item.fabric_id, 'adjustment', -v_item.quantity, ROUND(v_landed_unit_cost, 4),
            'purchase_order', p_po_id, 'حذف أمر شراء ' || v_po.po_number
          );
        END IF;

      ELSIF v_item.item_type = 'trim' AND v_item.trim_id IS NOT NULL THEN
        SELECT stock_qty, name INTO v_cur_qty, v_item_name
        FROM trims WHERE id = v_item.trim_id FOR UPDATE;

        IF FOUND THEN
          v_removed_units := v_item.quantity * GREATEST(v_item.units_per_pack, 1);
          v_unit_cost := (v_item.unit_price + (v_shipping_alloc / NULLIF(v_item.quantity, 0))) / GREATEST(v_item.units_per_pack, 1);

          IF v_cur_qty < v_removed_units THEN
            RAISE EXCEPTION 'لا يمكن حذف أمر الشراء لأن جزءاً من الكلفة (%) تم استخدامه بالفعل — الرصيد المتاح % أقل من كمية الأمر %',
              v_item_name, v_cur_qty, v_removed_units;
          END IF;

          UPDATE trims
          SET stock_qty = stock_qty - v_removed_units
          WHERE id = v_item.trim_id;

          INSERT INTO inventory_movements (
            item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
          ) VALUES (
            'trim', v_item.trim_id, 'adjustment', -v_removed_units, ROUND(v_unit_cost, 4),
            'purchase_order', p_po_id, 'حذف أمر شراء ' || v_po.po_number
          );
        END IF;
      END IF;
    END LOOP;

    IF v_po.supplier_id IS NOT NULL THEN
      UPDATE suppliers
      SET balance_payable = GREATEST(0, balance_payable - v_po.total_amount)
      WHERE id = v_po.supplier_id;
    END IF;
  END IF;

  -- Permanently delete the purchase order (purchase_order_items cascades automatically)
  DELETE FROM purchase_orders WHERE id = p_po_id;
END;
$$ LANGUAGE plpgsql;
