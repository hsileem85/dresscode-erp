-- ============================================================================
-- DressCode ERP — Migration 015: Cancel & Delete Sales Orders (Atomic Reversal)
-- Target: PostgreSQL 15+ / Supabase (idempotent)
-- ============================================================================
-- 1) `cancel_sales_order(p_sale_id UUID)`:
--    - If order was confirmed/shipped/delivered: atomically restores sold
--      quantities back to `model_variants.finished_goods_qty` and logs
--      `sale_return` inventory movements.
--    - Logs a `refund` entry in `financial_transactions` if `paid_amount > 0`.
--    - Marks `status = 'cancelled'` (and `fulfillment_status = 'ملغي'` if column
--      exists), excluding it from revenue, P&L, cashbox, and customer CRM.
--
-- 2) `delete_sales_order(p_sale_id UUID)`:
--    - If order was confirmed/shipped/delivered (stock not yet reversed):
--      atomically restores sold quantities back to `model_variants` and logs
--      `sale_return` inventory movements.
--    - Removes linked `financial_transactions` for this sales order.
--    - Deletes the `sales_orders` row (cascading `sales_order_items`).
-- ============================================================================

CREATE OR REPLACE FUNCTION cancel_sales_order(p_sale_id UUID)
RETURNS VOID AS $$
DECLARE
  v_sale sales_orders%ROWTYPE;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales_orders WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب البيع غير موجود';
  END IF;

  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'طلب البيع (%) ملغي بالفعل', v_sale.order_number;
  END IF;

  -- Restore finished-goods inventory only if stock was deducted on confirmation
  IF v_sale.status IN ('confirmed', 'shipped', 'delivered') THEN
    FOR v_item IN
      SELECT soi.variant_id, soi.quantity, soi.unit_cogs_snapshot
      FROM sales_order_items soi
      WHERE soi.sales_order_id = p_sale_id
      ORDER BY soi.variant_id
    LOOP
      PERFORM 1 FROM model_variants WHERE id = v_item.variant_id FOR UPDATE;
      IF FOUND THEN
        UPDATE model_variants
        SET finished_goods_qty = finished_goods_qty + v_item.quantity
        WHERE id = v_item.variant_id;

        INSERT INTO inventory_movements (
          item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
        ) VALUES (
          'finished_good',
          v_item.variant_id,
          'sale_return',
          v_item.quantity,
          COALESCE(v_item.unit_cogs_snapshot, 0),
          'sales_order',
          p_sale_id,
          'إرجاع مخزون — إلغاء طلب بيع ' || v_sale.order_number
        );
      END IF;
    END LOOP;
  END IF;

  -- Record refund entry in financial ledger if payments were collected
  IF COALESCE(v_sale.paid_amount, 0) > 0 THEN
    INSERT INTO financial_transactions (
      tx_type, amount, customer_id, reference_type, reference_id, payment_method, notes
    ) VALUES (
      'refund',
      ROUND(v_sale.paid_amount, 2),
      v_sale.customer_id,
      'sales_order',
      p_sale_id,
      'تحويل',
      'إلغاء طلب بيع ' || v_sale.order_number
    );
  END IF;

  UPDATE sales_orders
  SET
    status = 'cancelled',
    fulfillment_status = 'ملغي'
  WHERE id = p_sale_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_sales_order(p_sale_id UUID)
RETURNS VOID AS $$
DECLARE
  v_sale sales_orders%ROWTYPE;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales_orders WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب البيع غير موجود';
  END IF;

  -- Restore finished-goods inventory only if stock was deducted and not already reversed
  IF v_sale.status IN ('confirmed', 'shipped', 'delivered') THEN
    FOR v_item IN
      SELECT soi.variant_id, soi.quantity, soi.unit_cogs_snapshot
      FROM sales_order_items soi
      WHERE soi.sales_order_id = p_sale_id
      ORDER BY soi.variant_id
    LOOP
      PERFORM 1 FROM model_variants WHERE id = v_item.variant_id FOR UPDATE;
      IF FOUND THEN
        UPDATE model_variants
        SET finished_goods_qty = finished_goods_qty + v_item.quantity
        WHERE id = v_item.variant_id;

        INSERT INTO inventory_movements (
          item_type, variant_id, movement_type, qty_delta, unit_cost, reference_type, reference_id, notes
        ) VALUES (
          'finished_good',
          v_item.variant_id,
          'sale_return',
          v_item.quantity,
          COALESCE(v_item.unit_cogs_snapshot, 0),
          'sales_order',
          p_sale_id,
          'عكس مبيعات — حذف طلب بيع ' || v_sale.order_number
        );
      END IF;
    END LOOP;
  END IF;

  DELETE FROM financial_transactions
  WHERE reference_type = 'sales_order'
    AND reference_id = p_sale_id;

  DELETE FROM sales_orders WHERE id = p_sale_id;
END;
$$ LANGUAGE plpgsql;
