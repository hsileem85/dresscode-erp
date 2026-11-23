-- ============================================================================
-- DressCode ERP — Migration 008: Cancel Purchase Order (Atomic Stock & Supplier Reversal)
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) Prevents receiving an already-cancelled PO in `receive_purchase_order`
-- 2) Adds `cancel_purchase_order(p_po_id UUID)`:
--    - If PO is `draft` / `ordered`: marks status = 'cancelled'
--    - If PO is `received`: validates stock availability, atomically deducts
--      the received fabric/trim quantities back out, logs `adjustment`
--      inventory movements, reverses supplier `balance_payable`, and marks
--      status = 'cancelled'
-- ============================================================================

-- 1) Guard receive_purchase_order against cancelled POs
CREATE OR REPLACE FUNCTION receive_purchase_order(p_po_id UUID)
RETURNS VOID AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_total NUMERIC(14, 2) := 0;
  v_old_qty NUMERIC(14, 3);
  v_old_cost NUMERIC(12, 4);
  v_new_qty NUMERIC(14, 3);
  v_added_units NUMERIC(14, 3);
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
    v_total := v_total + v_item.line_total;

    IF v_item.item_type = 'fabric' THEN
      SELECT stock_qty, price_per_unit INTO v_old_qty, v_old_cost
      FROM fabrics WHERE id = v_item.fabric_id FOR UPDATE;

      v_new_qty := GREATEST(v_old_qty, 0) + v_item.quantity;
      UPDATE fabrics
      SET
        stock_qty = stock_qty + v_item.quantity,
        price_per_unit = ROUND(
          ((GREATEST(v_old_qty, 0) * v_old_cost) + (v_item.quantity * v_item.unit_price)) / NULLIF(v_new_qty, 0),
          2
        )
      WHERE id = v_item.fabric_id;

      INSERT INTO inventory_movements (
        item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
      ) VALUES (
        'fabric', v_item.fabric_id, 'purchase_in', v_item.quantity, v_item.unit_price,
        'purchase_order', p_po_id, 'استلام أمر شراء ' || v_po.po_number
      );

    ELSIF v_item.item_type = 'trim' THEN
      SELECT stock_qty, unit_cost INTO v_old_qty, v_old_cost
      FROM trims WHERE id = v_item.trim_id FOR UPDATE;

      v_added_units := v_item.quantity * v_item.units_per_pack;
      v_unit_cost := v_item.unit_price / v_item.units_per_pack;
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
        'trim', v_item.trim_id, 'purchase_in', v_added_units, v_unit_cost,
        'purchase_order', p_po_id, 'استلام أمر شراء ' || v_po.po_number
      );
    END IF;
  END LOOP;

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

-- 2) Atomic Cancel Purchase Order RPC
CREATE OR REPLACE FUNCTION cancel_purchase_order(p_po_id UUID)
RETURNS VOID AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_cur_qty NUMERIC(14, 3);
  v_item_name TEXT;
  v_removed_units NUMERIC(14, 3);
  v_unit_cost NUMERIC(12, 4);
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء غير موجود';
  END IF;

  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'أمر الشراء % ملغي بالفعل', v_po.po_number;
  END IF;

  -- If already received, safely reverse inventory and supplier balance
  IF v_po.status = 'received' THEN
    FOR v_item IN
      SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id
    LOOP
      IF v_item.item_type = 'fabric' AND v_item.fabric_id IS NOT NULL THEN
        SELECT stock_qty, name INTO v_cur_qty, v_item_name
        FROM fabrics WHERE id = v_item.fabric_id FOR UPDATE;

        IF FOUND THEN
          IF v_cur_qty < v_item.quantity THEN
            RAISE EXCEPTION 'لا يمكن إلغاء أمر الشراء لأن جزءاً من القماش (%) تم استخدامه بالفعل — الرصيد المتاح % أقل من كمية الأمر %',
              v_item_name, v_cur_qty, v_item.quantity;
          END IF;

          UPDATE fabrics
          SET stock_qty = stock_qty - v_item.quantity
          WHERE id = v_item.fabric_id;

          INSERT INTO inventory_movements (
            item_type, fabric_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
          ) VALUES (
            'fabric', v_item.fabric_id, 'adjustment', -v_item.quantity, v_item.unit_price,
            'purchase_order', p_po_id, 'إلغاء أمر شراء ' || v_po.po_number
          );
        END IF;

      ELSIF v_item.item_type = 'trim' AND v_item.trim_id IS NOT NULL THEN
        SELECT stock_qty, name INTO v_cur_qty, v_item_name
        FROM trims WHERE id = v_item.trim_id FOR UPDATE;

        IF FOUND THEN
          v_removed_units := v_item.quantity * GREATEST(v_item.units_per_pack, 1);
          v_unit_cost := v_item.unit_price / GREATEST(v_item.units_per_pack, 1);

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
            'trim', v_item.trim_id, 'adjustment', -v_removed_units, v_unit_cost,
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
