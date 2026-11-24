-- ============================================================================
-- DressCode ERP — Migration 016: Purchase Order Shipping Cost (Pro-Rata Landed Cost)
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) Adds `shipping_cost` to `purchase_orders` (total freight/delivery fee on the PO)
-- 2) Adds `shipping_allocated` to `purchase_order_items` (pro-rata shipping share per line)
-- 3) Updates `receive_purchase_order(p_po_id)` so:
--    - Fabric & trim Weighted Average Cost (WAC) uses landed unit cost:
--      unit_price + (shipping_allocated / quantity)
--    - `inventory_movements.unit_cost` logs the landed unit cost
--    - `purchase_orders.total_amount` = SUM(line_total) + shipping_cost
-- 4) Updates `cancel_purchase_order(p_po_id)` to log matching landed unit cost on reversal
-- ============================================================================

-- 1) Schema additions (idempotent)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(14, 2) NOT NULL DEFAULT 0
  CHECK (shipping_cost >= 0);

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS shipping_allocated NUMERIC(14, 2) NOT NULL DEFAULT 0
  CHECK (shipping_allocated >= 0);

-- 2) Updated receive_purchase_order with pro-rata shipping allocation into WAC & PO total
CREATE OR REPLACE FUNCTION receive_purchase_order(p_po_id UUID)
RETURNS VOID AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_items_total NUMERIC(14, 2) := 0;
  v_total NUMERIC(14, 2) := 0;
  v_old_qty NUMERIC(14, 3);
  v_old_cost NUMERIC(12, 4);
  v_new_qty NUMERIC(14, 3);
  v_added_units NUMERIC(14, 3);
  v_shipping_alloc NUMERIC(14, 2);
  v_landed_unit_cost NUMERIC(12, 4);
  v_landed_pack_cost NUMERIC(12, 4);
  v_unit_cost NUMERIC(12, 4);
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
    v_items_total := v_items_total + v_item.line_total;
    v_shipping_alloc := COALESCE(v_item.shipping_allocated, 0);

    IF v_item.item_type = 'fabric' THEN
      SELECT stock_qty, price_per_unit INTO v_old_qty, v_old_cost
      FROM fabrics WHERE id = v_item.fabric_id FOR UPDATE;

      v_landed_unit_cost := v_item.unit_price + (v_shipping_alloc / NULLIF(v_item.quantity, 0));
      v_new_qty := GREATEST(v_old_qty, 0) + v_item.quantity;

      UPDATE fabrics
      SET
        stock_qty = stock_qty + v_item.quantity,
        price_per_unit = ROUND(
          ((GREATEST(v_old_qty, 0) * v_old_cost) + (v_item.quantity * v_landed_unit_cost)) / NULLIF(v_new_qty, 0),
          2
        )
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
      SELECT stock_qty, unit_cost INTO v_old_qty, v_old_cost
      FROM trims WHERE id = v_item.trim_id FOR UPDATE;

      v_added_units := v_item.quantity * v_item.units_per_pack;
      v_landed_pack_cost := v_item.unit_price + (v_shipping_alloc / NULLIF(v_item.quantity, 0));
      v_unit_cost := v_landed_pack_cost / v_item.units_per_pack;
      v_new_qty := GREATEST(v_old_qty, 0) + v_added_units;

      UPDATE trims
      SET
        stock_qty = stock_qty + v_added_units,
        pack_price = ROUND(
          (((GREATEST(v_old_qty, 0) * v_old_cost) + (v_added_units * v_unit_cost)) / NULLIF(v_new_qty, 0)) * units_per_pack,
          2
        )
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

  v_total := v_items_total + COALESCE(v_po.shipping_cost, 0);

  UPDATE purchase_orders
  SET status = 'received', total_amount = v_total, received_at = NOW()
  WHERE id = p_po_id;

  IF v_po.supplier_id IS NOT NULL THEN
    UPDATE suppliers
    SET balance_payable = balance_payable + v_total
    WHERE id = v_po.supplier_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 3) Keep cancel_purchase_order consistent with landed unit costs
CREATE OR REPLACE FUNCTION cancel_purchase_order(p_po_id UUID)
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

  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'أمر الشراء % ملغي بالفعل', v_po.po_number;
  END IF;

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
            RAISE EXCEPTION 'لا يمكن إلغاء أمر الشراء لأن جزءاً من القماش (%) تم استخدامه بالفعل — الرصيد المتاح % أقل من كمية الأمر %',
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
            'purchase_order', p_po_id, 'إلغاء أمر شراء ' || v_po.po_number
          );
        END IF;

      ELSIF v_item.item_type = 'trim' AND v_item.trim_id IS NOT NULL THEN
        SELECT stock_qty, name INTO v_cur_qty, v_item_name
        FROM trims WHERE id = v_item.trim_id FOR UPDATE;

        IF FOUND THEN
          v_removed_units := v_item.quantity * GREATEST(v_item.units_per_pack, 1);
          v_unit_cost := (v_item.unit_price + (v_shipping_alloc / NULLIF(v_item.quantity, 0))) / GREATEST(v_item.units_per_pack, 1);

          IF v_cur_qty < v_removed_units THEN
            RAISE EXCEPTION 'لا يمكن إلغاء أمر الشراء لأن جزءاً من الكلفة (%) تم استخدامه بالفعل — الرصيد المتاح % أقل من كمية الأمر %',
              v_item_name, v_cur_qty, v_removed_units;
          END IF;

          UPDATE trims
          SET stock_qty = stock_qty - v_removed_units
          WHERE id = v_item.trim_id;

          INSERT INTO inventory_movements (
            item_type, trim_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
          ) VALUES (
            'trim', v_item.trim_id, 'adjustment', -v_removed_units, ROUND(v_unit_cost, 4),
            'purchase_order', p_po_id, 'إلغاء أمر شراء ' || v_po.po_number
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

  UPDATE purchase_orders
  SET status = 'cancelled'
  WHERE id = p_po_id;
END;
$$ LANGUAGE plpgsql;
