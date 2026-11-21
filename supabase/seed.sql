-- ============================================================================
-- DressCode ERP — Seed Data + Full-Cycle Demo Transaction
-- Demonstrates: Purchase Order Receipt -> Production Batch -> Sales Order
-- ============================================================================

INSERT INTO app_settings (id, brand_name, website, currency, estimated_monthly_volume)
VALUES (1, 'DressCode', 'dresscode-clothing.com', 'EGP', 600)
ON CONFLICT (id) DO NOTHING;

-- 1. Suppliers
INSERT INTO suppliers (id, name, phone, specialty) VALUES
  ('11111111-1111-1111-1111-111111111101', 'شركة النور للأقمشة - العتبة', '01001234561', 'أقمشة كريب وبطانات'),
  ('11111111-1111-1111-1111-111111111102', 'مؤسسة الشرق للتوريدات النسيجية', '01001234562', 'لينين طبيعي وأقمشة صيفية'),
  ('11111111-1111-1111-1111-111111111103', 'مطبعة إيليت للتيكت المنسوج', '01001234563', 'تيكت DressCode وكروت السعر'),
  ('11111111-1111-1111-1111-111111111104', 'المتحدة لمستلزمات الخياطة', '01001234564', 'سحابات وأزرار وخيوط')
ON CONFLICT (id) DO NOTHING;

-- 2. Workshops
INSERT INTO workshops (id, name, phone, specialty) VALUES
  ('22222222-2222-2222-2222-222222222201', 'ورشة المعلم طارق للقص الحديث', '01112223301', 'القص والباترون'),
  ('22222222-2222-2222-2222-222222222202', 'مصنع الأناقة للتشغيل (العبور)', '01112223302', 'الخياطة والسرفلة'),
  ('22222222-2222-2222-2222-222222222203', 'أتيليه فنون التطريز', '01112223303', 'التطريز اليدوي والكمبيوتر'),
  ('22222222-2222-2222-2222-222222222204', 'وحدة تشطيب وكي دريس كود', '01112223304', 'الكي والفحص والتغليف')
ON CONFLICT (id) DO NOTHING;

-- 3. Fabrics
INSERT INTO fabrics (id, code, name, supplier_id, supplier_name, unit, price_per_unit, width_cm, default_waste_pct, stock_qty) VALUES
  ('33333333-3333-3333-3333-333333333301', 'CR-ND-01', 'كريب ندى كوري أصلي', '11111111-1111-1111-1111-111111111101', 'شركة النور للأقمشة - العتبة', 'meter', 145, 150, 6, 120),
  ('33333333-3333-3333-3333-333333333302', 'LN-SM-04', 'لينين طبيعي 100% صيفي', '11111111-1111-1111-1111-111111111102', 'مؤسسة الشرق للتوريدات النسيجية', 'meter', 185, 145, 8, 90),
  ('33333333-3333-3333-3333-333333333303', 'LN-RZ-02', 'بطانة روزالين قطنية باردة', '11111111-1111-1111-1111-111111111101', 'شركة النور للأقمشة - العتبة', 'meter', 65, 150, 5, 150)
ON CONFLICT (id) DO NOTHING;

-- 4. Trims & Accessories
INSERT INTO trims (id, code, name, category, supplier_id, supplier_name, purchase_unit, pack_price, units_per_pack, unit_label, stock_qty) VALUES
  ('44444444-4444-4444-4444-444444444401', 'TR-LBL-01', 'تيكت DressCode منسوج (حرير برونزي)', 'تيكت وهوية البراند', '11111111-1111-1111-1111-111111111103', 'مطبعة إيليت للتيكت المنسوج', 'pack', 1200, 500, 'تيكت', 500),
  ('44444444-4444-4444-4444-444444444402', 'TR-BAG-01', 'كيس تغليف DressCode الفاخر (مات سيلفر)', 'التغليف والهوية', '11111111-1111-1111-1111-111111111103', 'مطبعة إيليت للتيكت المنسوج', 'pack', 1450, 100, 'كيس', 300),
  ('44444444-4444-4444-4444-444444444403', 'TR-ZIP-50', 'سحاب مخفي YKK طول 50 سم', 'سحابات', '11111111-1111-1111-1111-111111111104', 'المتحدة لمستلزمات الخياطة', 'dozen', 156, 12, 'سحاب', 120),
  ('44444444-4444-4444-4444-444444444404', 'TR-BTN-18', 'أزرار لؤلؤي مطفي بإطار برونزي', 'أزرار', '11111111-1111-1111-1111-111111111104', 'المتحدة لمستلزمات الخياطة', 'dozen', 96, 12, 'زر', 360)
ON CONFLICT (id) DO NOTHING;

-- 5. Outsourced Operations Catalog
INSERT INTO outsourced_operations (id, name, workshop_id, workshop_name, billing_type, cost, batch_size, lead_time_days) VALUES
  ('55555555-5555-5555-5555-555555555501', 'القص (باترون ومقصدار)', '22222222-2222-2222-2222-222222222201', 'ورشة المعلم طارق للقص الحديث', 'per_piece', 28, 1, 1),
  ('55555555-5555-5555-5555-555555555502', 'الخياطة والتقفيل الأساسي', '22222222-2222-2222-2222-222222222202', 'مصنع الأناقة للتشغيل (العبور)', 'per_piece', 115, 1, 4),
  ('55555555-5555-5555-5555-555555555503', 'التطريز للأكمام', '22222222-2222-2222-2222-222222222203', 'أتيليه فنون التطريز', 'per_batch', 2750, 50, 3),
  ('55555555-5555-5555-5555-555555555504', 'الكي بالبخار والتشطيب النهائي', '22222222-2222-2222-2222-222222222204', 'وحدة تشطيب وكي دريس كود', 'per_piece', 25, 1, 1)
ON CONFLICT (id) DO NOTHING;

-- 6. Monthly Overhead
INSERT INTO overhead_items (id, name, category, monthly_amount) VALUES
  ('66666666-6666-6666-6666-666666666601', 'إيجار الأتيليه والمخزن', 'rent', 18000),
  ('66666666-6666-6666-6666-666666666602', 'كهرباء ومياه وإنترنت', 'utilities', 3500),
  ('66666666-6666-6666-6666-666666666603', 'صيانة ماكينات العينات', 'maintenance', 2200),
  ('66666666-6666-6666-6666-666666666604', 'التسويق وإعلانات المتجر الإلكتروني', 'marketing', 22000),
  ('66666666-6666-6666-6666-666666666605', 'كراتين ومستلزمات الشحن', 'shipping', 6500)
ON CONFLICT (id) DO NOTHING;

-- 7. Models & Color/Size Variants
INSERT INTO models (id, sku, name, category, season, status, target_margin_pct) VALUES
  ('77777777-7777-7777-7777-777777777701', 'DC-ABY-2604', 'عباية كريب ندى كلاسيك بتطريز برونزي', 'عباية', 'خريف / شتاء 2026', 'active', 75),
  ('77777777-7777-7777-7777-777777777702', 'DC-CRD-2601', 'كارديجان صيفي لينين أوفرسايز', 'كارديجان', 'صيف 2026', 'active', 65)
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_variants (id, model_id, variant_sku, color, size, retail_price) VALUES
  ('88888888-8888-8888-8888-888888888801', '77777777-7777-7777-7777-777777777701', 'DC-ABY-2604-BLK-M', 'أسود فحمي', 'M', 1450),
  ('88888888-8888-8888-8888-888888888802', '77777777-7777-7777-7777-777777777701', 'DC-ABY-2604-BLK-L', 'أسود فحمي', 'L', 1450),
  ('88888888-8888-8888-8888-888888888803', '77777777-7777-7777-7777-777777777702', 'DC-CRD-2601-BGE-F', 'بيج رملي', 'Free Size', 1250)
ON CONFLICT (id) DO NOTHING;

-- BOM for Abaya DC-ABY-2604
INSERT INTO model_fabrics (model_id, fabric_id, consumption, waste_pct) VALUES
  ('77777777-7777-7777-7777-777777777701', '33333333-3333-3333-3333-333333333301', 3.1, 6);

INSERT INTO model_trims (model_id, trim_id, quantity) VALUES
  ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444401', 1),
  ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444402', 1),
  ('77777777-7777-7777-7777-777777777701', '44444444-4444-4444-4444-444444444403', 1);

INSERT INTO model_labor_steps (model_id, operation_id, workshop_id, name, workshop_name, billing_type, cost, batch_size, sequence_order) VALUES
  ('77777777-7777-7777-7777-777777777701', '55555555-5555-5555-5555-555555555501', '22222222-2222-2222-2222-222222222201', 'القص (باترون ومقصدار)', 'ورشة المعلم طارق للقص الحديث', 'per_piece', 30, 1, 1),
  ('77777777-7777-7777-7777-777777777701', '55555555-5555-5555-5555-555555555502', '22222222-2222-2222-2222-222222222202', 'الخياطة والتقفيل الأساسي', 'مصنع الأناقة للتشغيل (العبور)', 'per_piece', 125, 1, 2),
  ('77777777-7777-7777-7777-777777777701', '55555555-5555-5555-5555-555555555503', '22222222-2222-2222-2222-222222222203', 'التطريز للأكمام', 'أتيليه فنون التطريز', 'per_batch', 2750, 50, 3),
  ('77777777-7777-7777-7777-777777777701', '55555555-5555-5555-5555-555555555504', '22222222-2222-2222-2222-222222222204', 'الكي بالبخار والتشطيب النهائي', 'وحدة تشطيب وكي دريس كود', 'per_piece', 28, 1, 4);

-- 8. Full-Cycle Demo: Purchase -> Manufacturing -> Sales
-- Step A: Purchase 100m of Crepe Nada at 150 EGP/m -> updates WAC & stock
INSERT INTO purchase_orders (id, po_number, supplier_id, supplier_name, status)
VALUES ('99999999-9999-9999-9999-999999999901', 'PO-2026-001', '11111111-1111-1111-1111-111111111101', 'شركة النور للأقمشة - العتبة', 'ordered')
ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_order_items (purchase_order_id, item_type, fabric_id, description, quantity, unit_price)
VALUES ('99999999-9999-9999-9999-999999999901', 'fabric', '33333333-3333-3333-3333-333333333301', 'كريب ندى كوري أصلي - تشغيلة خريف', 100, 150);

SELECT receive_purchase_order('99999999-9999-9999-9999-999999999901');

-- Step B: Produce 20 pieces of DC-ABY-2604 (10 M + 10 L) -> deducts BOM raw materials & produces finished goods
INSERT INTO production_orders (id, batch_number, model_id, planned_qty, notes)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'PRD-2026-001', '77777777-7777-7777-7777-777777777701', 20, 'تشغيلة افتتاحية للمتجر الإلكتروني')
ON CONFLICT (id) DO NOTHING;

INSERT INTO production_order_variants (production_order_id, variant_id, planned_qty) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', '88888888-8888-8888-8888-888888888801', 10),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', '88888888-8888-8888-8888-888888888802', 10);

SELECT issue_production_order('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01');
SELECT complete_production_order('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01');

-- Step C: Sell 3 pieces online -> deducts finished goods, snapshots COGS, calculates gross profit
INSERT INTO sales_orders (id, order_number, customer_name, channel, discount_amount, shipping_fee)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', 'SO-2026-001', 'سارة أحمد (طلب متجر إلكتروني)', 'online_store', 100, 65)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_order_items (sales_order_id, variant_id, quantity, unit_price) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', '88888888-8888-8888-8888-888888888801', 2, 1450),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01', '88888888-8888-8888-8888-888888888802', 1, 1450);

SELECT confirm_sales_order('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01');
