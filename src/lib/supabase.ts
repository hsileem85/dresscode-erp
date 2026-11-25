import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_LOOKUPS } from '../data/defaultLookups';
import type {
  AuditAction,
  AuditLogEntry,
  AuditLogStats,
  CurrencyCode,
  Customer,
  ERPState,
  ExpenseRecord,
  Fabric,
  InventoryMovement,
  LookupGroupKey,
  LookupItem,
  ModelVariant,
  OutsourcedOperation,
  OverheadItem,
  PartnerContribution,
  ProductModel,
  ProductionOrder,
  PurchaseOrder,
  SalesOrder,
  Supplier,
  TrimAccessory,
  Workshop,
} from '../types/erp';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseKey = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
)?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseKey!)
  : null;

export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function db(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }
  return supabase;
}

export function computePaymentStatus(
  totalAmount: number,
  paidAmount: number
): SalesOrder['paymentStatus'] {
  if (paidAmount <= 0) return 'لم يدفع';
  if (paidAmount >= totalAmount) return 'مدفوع بالكامل';
  return 'دفع جزئي';
}

export async function fetchFullERPState(): Promise<{
  state: ERPState;
  migration003Missing: boolean;
}> {
  const client = db();
  const [
    settingsRes,
    suppliersRes,
    workshopsRes,
    customersRes,
    lookupsRes,
    fabricsRes,
    trimsRes,
    opsRes,
    modelsRes,
    variantsRes,
    mFabRes,
    mTrimRes,
    mLaborRes,
    overheadRes,
    expensesRes,
    partnersRes,
    poRes,
    poItemsRes,
    prodRes,
    prodVarRes,
    salesRes,
    salesItemsRes,
    movesRes,
  ] = await Promise.all([
    client.from('app_settings').select('*').eq('id', 1).maybeSingle(),
    client.from('suppliers').select('*').order('created_at', { ascending: false }),
    client.from('workshops').select('*').order('created_at', { ascending: false }),
    client.from('customers').select('*').order('created_at', { ascending: false }),
    client.from('lookup_values').select('*').order('sort_order'),
    client.from('fabrics').select('*').order('created_at', { ascending: false }),
    client.from('trims').select('*').order('created_at', { ascending: false }),
    client.from('outsourced_operations').select('*').order('created_at', { ascending: false }),
    client.from('models').select('*').order('created_at', { ascending: false }),
    client.from('model_variants').select('*').order('variant_sku'),
    client.from('model_fabrics').select('*'),
    client.from('model_trims').select('*'),
    client.from('model_labor_steps').select('*').order('sequence_order'),
    client.from('overhead_items').select('*').order('created_at'),
    client.from('expenses').select('*').order('expense_date', { ascending: false }),
    client.from('partner_contributions').select('*').order('contribution_date', { ascending: false }),
    client.from('purchase_orders').select('*').order('created_at', { ascending: false }),
    client.from('purchase_order_items').select('*'),
    client.from('production_orders').select('*').order('created_at', { ascending: false }),
    client.from('production_order_variants').select('*'),
    client.from('sales_orders').select('*').order('order_date', { ascending: false }),
    client.from('sales_order_items').select('*'),
    client
      .from('inventory_movements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  // Gracefully detect if Migration 003 hasn't been executed yet in Supabase
  const migration003Missing = Boolean(expensesRes.error || partnersRes.error);

  const coreErrors = [
    settingsRes.error,
    suppliersRes.error,
    workshopsRes.error,
    customersRes.error,
    fabricsRes.error,
    trimsRes.error,
    opsRes.error,
    modelsRes.error,
    variantsRes.error,
    mFabRes.error,
    mTrimRes.error,
    mLaborRes.error,
    overheadRes.error,
    poRes.error,
    poItemsRes.error,
    prodRes.error,
    prodVarRes.error,
    salesRes.error,
    salesItemsRes.error,
    movesRes.error,
  ].filter(Boolean);

  if (coreErrors.length > 0) {
    throw new Error(coreErrors[0]!.message);
  }

  const suppliers: Supplier[] = (suppliersRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    contactName: r.contact_name || '',
    phone: r.phone || '',
    address: r.address || '',
    specialty: r.specialty || '',
    balancePayable: Number(r.balance_payable) || 0,
    notes: r.notes || '',
  }));

  const workshops: Workshop[] = (workshopsRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    contactName: r.contact_name || '',
    phone: r.phone || '',
    address: r.address || '',
    specialty: r.specialty || '',
    balancePayable: Number(r.balance_payable) || 0,
    notes: r.notes || '',
  }));

  const lookups: LookupItem[] =
    !lookupsRes.error && Array.isArray(lookupsRes.data) && lookupsRes.data.length > 0
      ? lookupsRes.data.map((l) => ({
          id: l.id,
          groupKey: l.group_key as LookupGroupKey,
          label: l.label,
          sortOrder: Number(l.sort_order) || 0,
        }))
      : DEFAULT_LOOKUPS;

  const customers: Customer[] = (customersRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone || '',
    platform: r.platform || 'واتساب',
    governorate: r.governorate || r.city || '',
    customerType: r.customer_type || 'retail',
    notes: r.notes || '',
  }));

  const fabrics: Fabric[] = (fabricsRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    supplierId: r.supplier_id,
    supplier: r.supplier_name || 'مورد عام',
    unit: r.unit,
    pricePerUnit: Number(r.price_per_unit) || 0,
    widthCm: Number(r.width_cm) || 150,
    defaultWastePct: Number(r.default_waste_pct) || 6,
    stockQty: Number(r.stock_qty) || 0,
    reorderLevel: Number(r.reorder_level) || 20,
    colorOrCode: r.code || '',
    notes: r.notes || '',
  }));

  const trims: TrimAccessory[] = (trimsRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category || 'إكسسوارات',
    supplyGroup:
      r.supply_group === 'trims' ||
      r.supply_group === 'manufacturing' ||
      r.supply_group === 'brand'
        ? r.supply_group
        : undefined,
    supplierId: r.supplier_id,
    supplier: r.supplier_name || 'مورد عام',
    purchaseUnit: r.purchase_unit,
    packPrice: Number(r.pack_price) || 0,
    unitsPerPack: Number(r.units_per_pack) || 1,
    unitLabel: r.unit_label || 'قطعة',
    stockQty: Number(r.stock_qty) || 0,
    reorderLevel: Number(r.reorder_level) || 50,
    autoIncludeInBom: Boolean(r.auto_include_in_bom),
    defaultQtyPerPiece:
      r.default_qty_per_piece != null ? Number(r.default_qty_per_piece) : 1,
    notes: r.notes || '',
  }));

  const operations: OutsourcedOperation[] = (opsRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    workshopId: r.workshop_id,
    workshopName: r.workshop_name || 'ورشة خارجية',
    billingType: r.billing_type,
    cost: Number(r.cost) || 0,
    batchSize: Number(r.batch_size) || 1,
    leadTimeDays: Number(r.lead_time_days) || 1,
    services: Array.isArray(r.services)
      ? r.services.map((s: Record<string, unknown>) => ({
          id: String(s.id || newUuid()),
          name: String(s.name || ''),
          cost: Number(s.cost) || 0,
        }))
      : [],
    suppliedMaterials: Array.isArray(r.supplied_materials)
      ? r.supplied_materials.map((m: Record<string, unknown>) => ({
          id: String(m.id || newUuid()),
          name: String(m.name || ''),
          trimId: (m.trimId as string | null | undefined) ?? (m.trim_id as string | null | undefined) ?? null,
          quantity: Number(m.quantity) || 0,
          unit: String(m.unit || 'قطعة'),
          unitPrice: Number(m.unitPrice ?? m.unit_price) || 0,
        }))
      : [],
    notes: r.notes || '',
  }));

  const allVariants: ModelVariant[] = (variantsRes.data || []).map((r) => ({
    id: r.id,
    modelId: r.model_id,
    variantSku: r.variant_sku,
    color: r.color,
    size: r.size,
    finishedGoodsQty: Number(r.finished_goods_qty) || 0,
    avgUnitCogs: Number(r.avg_unit_cogs) || 0,
    retailPrice: Number(r.retail_price) || 0,
    reorderLevel: Number(r.reorder_level) || 5,
  }));

  const models: ProductModel[] = (modelsRes.data || []).map((m) => ({
    id: m.id,
    sku: m.sku,
    name: m.name,
    category: m.category,
    season: m.season,
    status: m.status,
    targetMarginPct: Number(m.target_margin_pct) || 65,
    actualRetailPrice: Number(m.actual_retail_price) || 0,
    compareAtPrice: Number(m.compare_at_price) || 0,
    quickFabricCost: Number(m.quick_fabric_cost) || 0,
    quickShippingCost: Number(m.quick_shipping_cost) || 0,
    quickOverlockCost: Number(m.quick_overlock_cost) || 0,
    quickPackagingCost: Number(m.quick_packaging_cost) || 0,
    quickSewingCost: Number(m.quick_sewing_cost) || 0,
    quickAccessoriesCost: Number(m.quick_accessories_cost) || 0,
    initialStock: Number(m.initial_stock) || 0,
    notes: m.notes || '',
    updatedAt: String(m.updated_at || '').slice(0, 10),
    fabrics: (mFabRes.data || [])
      .filter((f) => f.model_id === m.id)
      .map((f) => ({
        id: f.id,
        fabricId: f.fabric_id,
        consumption: Number(f.consumption) || 0,
        wastePct: Number(f.waste_pct) || 0,
      })),
    trims: (mTrimRes.data || [])
      .filter((t) => t.model_id === m.id)
      .map((t) => ({
        id: t.id,
        trimId: t.trim_id,
        quantity: Number(t.quantity) || 0,
      })),
    laborSteps: (mLaborRes.data || [])
      .filter((l) => l.model_id === m.id)
      .map((l) => ({
        id: l.id,
        operationId: l.operation_id,
        workshopId: l.workshop_id,
        name: l.name,
        workshopName: l.workshop_name,
        billingType: l.billing_type,
        cost: Number(l.cost) || 0,
        batchSize: Number(l.batch_size) || 1,
      })),
    variants: allVariants.filter((v) => v.modelId === m.id),
  }));

  const overheadItems: OverheadItem[] = (overheadRes.data || []).map((o) => ({
    id: o.id,
    name: o.name,
    category: o.category,
    monthlyAmount: Number(o.monthly_amount) || 0,
    notes: o.notes || '',
  }));

  const expenses: ExpenseRecord[] = (expensesRes.data || []).map((e) => ({
    id: e.id,
    expenseDate: e.expense_date,
    title: e.title,
    category: e.category || 'متغير',
    isRawMaterialPurchase: Boolean(e.is_raw_material_purchase),
    amount: Number(e.amount) || 0,
    paymentMethod: e.payment_method || 'كاش',
    notes: e.notes || '',
  }));

  const partnerContributions: PartnerContribution[] = (partnersRes.data || []).map((p) => ({
    id: p.id,
    partnerName: p.partner_name,
    contributionDate: p.contribution_date,
    amount: Number(p.amount) || 0,
    notes: p.notes || '',
  }));

  const purchaseOrders: PurchaseOrder[] = (poRes.data || []).map((po) => ({
    id: po.id,
    poNumber: po.po_number,
    supplierId: po.supplier_id,
    supplierName: po.supplier_name,
    orderDate: po.order_date,
    receivedAt: po.received_at,
    status: po.status,
    shippingCost: Number(po.shipping_cost) || 0,
    totalAmount: Number(po.total_amount) || 0,
    paidAmount: Number(po.paid_amount) || 0,
    notes: po.notes || '',
    items: (poItemsRes.data || [])
      .filter((it) => it.purchase_order_id === po.id)
      .map((it) => ({
        id: it.id,
        itemType: it.item_type,
        fabricId: it.fabric_id,
        trimId: it.trim_id,
        description: it.description,
        quantity: Number(it.quantity) || 0,
        unitsPerPack: Number(it.units_per_pack) || 1,
        unitPrice: Number(it.unit_price) || 0,
        shippingAllocated: Number(it.shipping_allocated) || 0,
        lineTotal: Number(it.line_total) || 0,
      })),
  }));

  const productionOrders: ProductionOrder[] = (prodRes.data || []).map((p) => ({
    id: p.id,
    batchNumber: p.batch_number,
    modelId: p.model_id,
    workshopId: p.workshop_id ?? null,
    workshopName: p.workshop_name || '',
    agreedLaborTotal: Number(p.agreed_labor_total) || Number(p.actual_labor_cost) || 0,
    paidToWorkshop: Number(p.paid_to_workshop) || 0,
    status: p.status,
    plannedQty: Number(p.planned_qty) || 0,
    completedQty: Number(p.completed_qty) || 0,
    actualMaterialCost: Number(p.actual_material_cost) || 0,
    actualLaborCost: Number(p.actual_labor_cost) || 0,
    allocatedOverheadCost: Number(p.allocated_overhead_cost) || 0,
    actualUnitCogs: Number(p.actual_unit_cogs) || 0,
    notes: p.notes || '',
    createdAt: String(p.created_at || '').slice(0, 10),
    variants: (prodVarRes.data || [])
      .filter((pv) => pv.production_order_id === p.id)
      .map((pv) => ({
        id: pv.id,
        variantId: pv.variant_id,
        plannedQty: Number(pv.planned_qty) || 0,
        completedQty: Number(pv.completed_qty) || 0,
      })),
  }));

  const salesOrders: SalesOrder[] = (salesRes.data || []).map((s) => {
    const totalAmount = Number(s.total_amount) || 0;
    const paidAmount = Number(s.paid_amount) || 0;
    const remainingDebt =
      s.remaining_debt !== undefined
        ? Number(s.remaining_debt) || 0
        : Math.max(totalAmount - paidAmount, 0);
    return {
      id: s.id,
      orderNumber: s.order_number,
      customerId: s.customer_id,
      customerName: s.customer_name,
      channel: s.channel,
      platform: s.platform || (s.channel === 'online_store' ? 'المتجر' : 'واتساب'),
      orderDate: s.order_date,
      status: s.status,
      fulfillmentStatus: s.fulfillment_status || 'مكتمل',
      subtotal: Number(s.subtotal) || 0,
      discountAmount: Number(s.discount_amount) || 0,
      shippingFee: Number(s.shipping_fee) || 0,
      totalAmount,
      paidAmount,
      remainingDebt,
      paymentStatus:
        (s.payment_status as SalesOrder['paymentStatus']) ||
        computePaymentStatus(totalAmount, paidAmount),
      totalCogs: Number(s.total_cogs) || 0,
      grossProfit: Number(s.gross_profit) || 0,
      notes: s.notes || '',
      items: (salesItemsRes.data || [])
        .filter((it) => it.sales_order_id === s.id)
        .map((it) => ({
          id: it.id,
          variantId: it.variant_id,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unit_price) || 0,
          unitCogsSnapshot: Number(it.unit_cogs_snapshot) || 0,
          lineTotal: Number(it.line_total) || 0,
          lineCogs: Number(it.line_cogs) || 0,
        })),
    };
  });

  const inventoryMovements: InventoryMovement[] = (movesRes.data || []).map((mv) => ({
    id: mv.id,
    itemType: mv.item_type,
    fabricId: mv.fabric_id,
    trimId: mv.trim_id,
    variantId: mv.variant_id,
    movementType: mv.movement_type,
    qtyDelta: Number(mv.qty_delta) || 0,
    unitCost: Number(mv.unit_cost) || 0,
    referenceType: mv.reference_type,
    notes: mv.notes,
    createdAt: mv.created_at,
  }));

  return {
    migration003Missing,
    state: {
      currency: (settingsRes.data?.currency as CurrencyCode) || 'EGP',
      suppliers,
      workshops,
      customers,
      lookups,
      fabrics,
      trims,
      operations,
      models,
      overhead: {
        estimatedMonthlyVolume: Number(settingsRes.data?.estimated_monthly_volume) || 600,
        items: overheadItems,
      },
      expenses,
      partnerContributions,
      purchaseOrders,
      productionOrders,
      salesOrders,
      inventoryMovements,
    },
  };
}

export const erpDb = {
  async updateSettings(patch: { currency?: CurrencyCode; estimatedMonthlyVolume?: number }) {
    const payload: Record<string, unknown> = { id: 1 };
    if (patch.currency) payload.currency = patch.currency;
    if (patch.estimatedMonthlyVolume !== undefined) {
      payload.estimated_monthly_volume = patch.estimatedMonthlyVolume;
    }
    const { error } = await db().from('app_settings').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  },

  async upsertSupplier(s: Supplier) {
    const { error } = await db().from('suppliers').upsert({
      id: s.id,
      name: s.name,
      contact_name: s.contactName || null,
      phone: s.phone || null,
      address: s.address || null,
      specialty: s.specialty || null,
      balance_payable: s.balancePayable ?? 0,
      notes: s.notes || null,
    });
    if (error) throw error;
  },

  async deleteSupplier(id: string) {
    const { error } = await db().from('suppliers').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertWorkshop(w: Workshop) {
    const { error } = await db().from('workshops').upsert({
      id: w.id,
      name: w.name,
      contact_name: w.contactName || null,
      phone: w.phone || null,
      address: w.address || null,
      specialty: w.specialty || null,
      balance_payable: w.balancePayable ?? 0,
      notes: w.notes || null,
    });
    if (error) throw error;
  },

  async deleteWorkshop(id: string) {
    const { error } = await db().from('workshops').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertLookup(l: LookupItem) {
    const { error } = await db().from('lookup_values').upsert({
      id: l.id,
      group_key: l.groupKey,
      label: l.label,
      sort_order: l.sortOrder,
    });
    if (error) throw error;
  },

  async deleteLookup(id: string) {
    const { error } = await db().from('lookup_values').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertCustomer(c: Customer) {
    const { error } = await db().from('customers').upsert({
      id: c.id,
      name: c.name,
      phone: c.phone || null,
      platform: c.platform || 'واتساب',
      governorate: c.governorate || null,
      city: c.governorate || null,
      customer_type: c.customerType || 'retail',
      notes: c.notes || null,
    });
    if (error) throw error;
  },

  async deleteCustomer(id: string) {
    const { error } = await db().from('customers').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertExpense(e: ExpenseRecord) {
    const { error } = await db().from('expenses').upsert({
      id: e.id,
      expense_date: e.expenseDate,
      title: e.title,
      category: e.category,
      is_raw_material_purchase: e.isRawMaterialPurchase,
      amount: e.amount,
      payment_method: e.paymentMethod,
      notes: e.notes || null,
    });
    if (error) throw error;
  },

  async deleteExpense(id: string) {
    const { error } = await db().from('expenses').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertPartnerContribution(p: PartnerContribution) {
    const { error } = await db().from('partner_contributions').upsert({
      id: p.id,
      partner_name: p.partnerName,
      contribution_date: p.contributionDate,
      amount: p.amount,
      notes: p.notes || null,
    });
    if (error) throw error;
  },

  async deletePartnerContribution(id: string) {
    const { error } = await db().from('partner_contributions').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertFabric(f: Fabric) {
    const { error } = await db().from('fabrics').upsert({
      id: f.id,
      code: f.colorOrCode || null,
      name: f.name,
      supplier_id: f.supplierId || null,
      supplier_name: f.supplier || 'مورد عام',
      unit: f.unit,
      price_per_unit: f.pricePerUnit,
      width_cm: f.widthCm,
      default_waste_pct: f.defaultWastePct,
      stock_qty: f.stockQty ?? 0,
      reorder_level: f.reorderLevel ?? 20,
      notes: f.notes || null,
    });
    if (error) throw error;
  },

  async deleteFabric(id: string) {
    const { error } = await db().from('fabrics').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertTrim(t: TrimAccessory) {
    const baseRow = {
      id: t.id,
      name: t.name,
      category: t.category,
      supplier_id: t.supplierId || null,
      supplier_name: t.supplier || 'مورد عام',
      purchase_unit: t.purchaseUnit,
      pack_price: t.packPrice,
      units_per_pack: t.unitsPerPack,
      unit_label: t.unitLabel,
      stock_qty: t.stockQty ?? 0,
      reorder_level: t.reorderLevel ?? 50,
      auto_include_in_bom: Boolean(t.autoIncludeInBom),
      default_qty_per_piece: Math.max(0, Number(t.defaultQtyPerPiece ?? 1) || 0),
      notes: t.notes || null,
    };

    const { error } = await db().from('trims').upsert({
      ...baseRow,
      supply_group: t.supplyGroup || null,
    });
    if (!error) return;

    const missingCol =
      error.code === 'PGRST204' ||
      error.code === '42703' ||
      error.message?.includes('supply_group') ||
      error.message?.includes('column');

    if (missingCol) {
      const retry = await db().from('trims').upsert(baseRow);
      if (retry.error) throw retry.error;
      return;
    }

    throw error;
  },

  async deleteTrim(id: string) {
    const { error } = await db().from('trims').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertOperation(op: OutsourcedOperation) {
    const baseRow = {
      id: op.id,
      name: op.name,
      workshop_id: op.workshopId || null,
      workshop_name: op.workshopName,
      billing_type: op.billingType,
      cost: op.cost,
      batch_size: op.batchSize,
      lead_time_days: op.leadTimeDays ?? 1,
      notes: op.notes || null,
    };

    const { error } = await db().from('outsourced_operations').upsert({
      ...baseRow,
      services: op.services || [],
      supplied_materials: op.suppliedMaterials || [],
    });

    if (!error) return;

    // Graceful fallback if Migration 011 hasn't been executed yet in Supabase
    const missingCols =
      error.code === 'PGRST204' ||
      error.code === '42703' ||
      error.message?.includes('services') ||
      error.message?.includes('supplied_materials') ||
      error.message?.includes('column');

    if (missingCols) {
      const retry = await db().from('outsourced_operations').upsert(baseRow);
      if (retry.error) throw retry.error;
      if ((op.services?.length || 0) > 0 || (op.suppliedMaterials?.length || 0) > 0) {
        throw new Error(
          'تم حفظ المرحلة الأساسية، ولكن لحفظ تفاصيل الخدمات المتعددة والخامات المشتراة من الورشة سحابياً يرجى تشغيل ملف التحديث 011_operation_services_and_materials.sql في Supabase SQL Editor.'
        );
      }
      return;
    }

    throw error;
  },

  async deleteOperation(id: string) {
    const { error } = await db().from('outsourced_operations').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertModel(m: ProductModel) {
    const client = db();
    const { error: mErr } = await client.from('models').upsert({
      id: m.id,
      sku: m.sku,
      name: m.name,
      category: m.category,
      season: m.season,
      status: m.status,
      target_margin_pct: m.targetMarginPct,
      actual_retail_price: m.actualRetailPrice ?? 0,
      compare_at_price: m.compareAtPrice ?? 0,
      quick_fabric_cost: m.quickFabricCost ?? 0,
      quick_shipping_cost: m.quickShippingCost ?? 0,
      quick_overlock_cost: m.quickOverlockCost ?? 0,
      quick_packaging_cost: m.quickPackagingCost ?? 0,
      quick_sewing_cost: m.quickSewingCost ?? 0,
      quick_accessories_cost: m.quickAccessoriesCost ?? 0,
      initial_stock: m.initialStock ?? 0,
      notes: m.notes || null,
    });
    if (mErr) throw mErr;

    await Promise.all([
      client.from('model_fabrics').delete().eq('model_id', m.id),
      client.from('model_trims').delete().eq('model_id', m.id),
      client.from('model_labor_steps').delete().eq('model_id', m.id),
    ]);

    if (m.fabrics.length > 0) {
      const { error } = await client.from('model_fabrics').insert(
        m.fabrics.map((f) => ({
          id: f.id,
          model_id: m.id,
          fabric_id: f.fabricId,
          consumption: f.consumption,
          waste_pct: f.wastePct,
        }))
      );
      if (error) throw error;
    }

    if (m.trims.length > 0) {
      const { error } = await client.from('model_trims').insert(
        m.trims.map((t) => ({
          id: t.id,
          model_id: m.id,
          trim_id: t.trimId,
          quantity: t.quantity,
        }))
      );
      if (error) throw error;
    }

    if (m.laborSteps.length > 0) {
      const { error } = await client.from('model_labor_steps').insert(
        m.laborSteps.map((l, idx) => ({
          id: l.id,
          model_id: m.id,
          operation_id: l.operationId || null,
          workshop_id: l.workshopId || null,
          name: l.name,
          workshop_name: l.workshopName,
          billing_type: l.billingType,
          cost: l.cost,
          batch_size: l.batchSize,
          sequence_order: idx + 1,
        }))
      );
      if (error) throw error;
    }
  },

  async deleteModel(id: string) {
    const { error } = await db().from('models').delete().eq('id', id);
    if (error) throw error;
  },

  async updateAllModelsTargetMargin(targetMarginPct: number) {
    const safe = Math.max(0, Math.round((Number(targetMarginPct) || 0) * 100) / 100);
    const { error } = await db()
      .from('models')
      .update({ target_margin_pct: safe })
      .not('id', 'is', null);
    if (error) throw error;
  },

  async createVariant(v: Omit<ModelVariant, 'id'>) {
    const id = newUuid();
    const { error } = await db().from('model_variants').insert({
      id,
      model_id: v.modelId,
      variant_sku: v.variantSku,
      color: v.color,
      size: v.size,
      finished_goods_qty: v.finishedGoodsQty,
      avg_unit_cogs: v.avgUnitCogs,
      retail_price: v.retailPrice,
      reorder_level: v.reorderLevel,
    });
    if (error) throw error;

    if (v.finishedGoodsQty > 0) {
      await db().from('inventory_movements').insert({
        item_type: 'finished_good',
        variant_id: id,
        movement_type: 'adjustment',
        qty_delta: v.finishedGoodsQty,
        unit_cost: v.avgUnitCogs,
        reference_type: 'manual',
        notes: `رصيد افتتاحي منتج تام (${v.variantSku})`,
      });
    }
  },

  async updateVariant(v: ModelVariant, qtyDelta = 0) {
    const { error } = await db()
      .from('model_variants')
      .update({
        color: v.color,
        size: v.size,
        finished_goods_qty: v.finishedGoodsQty,
        avg_unit_cogs: v.avgUnitCogs,
        retail_price: v.retailPrice,
        reorder_level: v.reorderLevel,
      })
      .eq('id', v.id);
    if (error) throw error;

    if (qtyDelta !== 0) {
      await db().from('inventory_movements').insert({
        item_type: 'finished_good',
        variant_id: v.id,
        movement_type: 'adjustment',
        qty_delta: qtyDelta,
        unit_cost: v.avgUnitCogs,
        reference_type: 'manual',
        notes: `تعديل رصيد منتج تام (${v.variantSku})`,
      });
    }
  },

  async deleteVariant(variantId: string) {
    const { error } = await db().rpc('delete_model_variant', { p_variant_id: variantId });
    if (!error) return;

    const missingFn =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('delete_model_variant');

    if (missingFn) {
      const { error: delErr } = await db().from('model_variants').delete().eq('id', variantId);
      if (!delErr) return;
      if (delErr.code === '23503') {
        throw new Error(
          'لا يمكن حذف هذا الصنف لأنه مرتبط بمبيعات أو أوامر تصنيع مسجلة — احذف السجلات المرتبطة أولاً.'
        );
      }
      throw delErr;
    }

    throw error;
  },

  async upsertOverheadItem(item: OverheadItem) {
    const { error } = await db().from('overhead_items').upsert({
      id: item.id,
      name: item.name,
      category: item.category,
      monthly_amount: item.monthlyAmount,
      notes: item.notes || null,
    });
    if (error) throw error;
  },

  async deleteOverheadItem(id: string) {
    const { error } = await db().from('overhead_items').delete().eq('id', id);
    if (error) throw error;
  },

  async createPurchaseOrder(po: {
    poNumber: string;
    supplierId?: string | null;
    supplierName: string;
    shippingCost?: number;
    notes?: string;
    items: {
      itemType: 'fabric' | 'trim';
      fabricId?: string | null;
      trimId?: string | null;
      description: string;
      quantity: number;
      unitsPerPack: number;
      unitPrice: number;
      shippingAllocated?: number;
    }[];
  }) {
    const client = db();
    const id = newUuid();
    const shipping = Math.max(0, Math.round((Number(po.shippingCost) || 0) * 100) / 100);
    const itemsSubtotal = po.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const total = Math.round((itemsSubtotal + shipping) * 100) / 100;

    const isMissingShippingCol = (err: { code?: string; message?: string } | null) =>
      !!err &&
      (err.code === '42703' ||
        err.code === 'PGRST204' ||
        err.message?.includes('shipping_cost') ||
        err.message?.includes('shipping_allocated'));

    const { error: poErr } = await client.from('purchase_orders').insert({
      id,
      po_number: po.poNumber,
      supplier_id: po.supplierId || null,
      supplier_name: po.supplierName,
      status: 'ordered',
      shipping_cost: shipping,
      total_amount: total,
      notes: po.notes || null,
    });

    if (!poErr) {
      const { error: itemsErr } = await client.from('purchase_order_items').insert(
        po.items.map((it) => ({
          id: newUuid(),
          purchase_order_id: id,
          item_type: it.itemType,
          fabric_id: it.fabricId || null,
          trim_id: it.trimId || null,
          description: it.description,
          quantity: it.quantity,
          units_per_pack: it.unitsPerPack,
          unit_price: it.unitPrice,
          shipping_allocated: Math.max(
            0,
            Math.round((Number(it.shippingAllocated) || 0) * 100) / 100
          ),
        }))
      );
      if (!itemsErr) return id;
      if (!isMissingShippingCol(itemsErr)) throw itemsErr;
      // Clean up header if items insert failed due to missing shipping_allocated column
      await client.from('purchase_orders').delete().eq('id', id);
    } else if (!isMissingShippingCol(poErr)) {
      throw poErr;
    }

    // Fallback when migration 016 has not been executed yet:
    // bake pro-rata shipping directly into each line's unit_price so WAC & PO total remain accurate
    const shippingNote =
      shipping > 0
        ? `${po.notes ? `${po.notes} | ` : ''}شامل مصاريف شحن (${shipping}) موزعة بالتناسب`
        : po.notes || null;

    const fallbackItems = po.items.map((it) => {
      const alloc = Math.max(0, Number(it.shippingAllocated) || 0);
      const landedPrice =
        it.quantity > 0
          ? Math.round((it.unitPrice + alloc / it.quantity) * 100) / 100
          : it.unitPrice;
      return {
        id: newUuid(),
        purchase_order_id: id,
        item_type: it.itemType,
        fabric_id: it.fabricId || null,
        trim_id: it.trimId || null,
        description: it.description,
        quantity: it.quantity,
        units_per_pack: it.unitsPerPack,
        unit_price: landedPrice,
      };
    });

    const fallbackTotal =
      Math.round(fallbackItems.reduce((s, it) => s + it.quantity * it.unit_price, 0) * 100) / 100;

    const { error: fbPoErr } = await client.from('purchase_orders').insert({
      id,
      po_number: po.poNumber,
      supplier_id: po.supplierId || null,
      supplier_name: po.supplierName,
      status: 'ordered',
      total_amount: fallbackTotal,
      notes: shippingNote,
    });
    if (fbPoErr) throw fbPoErr;

    const { error: fbItemsErr } = await client
      .from('purchase_order_items')
      .insert(fallbackItems);
    if (fbItemsErr) throw fbItemsErr;
    return id;
  },

  async receivePurchaseOrder(poId: string) {
    const { error } = await db().rpc('receive_purchase_order', { p_po_id: poId });
    if (error) throw error;
  },

  async cancelPurchaseOrder(poId: string, currentStatus?: PurchaseOrder['status']) {
    const { error } = await db().rpc('cancel_purchase_order', { p_po_id: poId });
    if (!error) return;

    const missingFn =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('cancel_purchase_order');

    if (missingFn) {
      if (currentStatus !== 'received') {
        const { error: updErr } = await db()
          .from('purchase_orders')
          .update({ status: 'cancelled' })
          .eq('id', poId);
        if (updErr) throw updErr;
        return;
      }
      throw new Error(
        'لإلغاء أمر شراء تم استلامه بالفعل وخصم كمياته من المخزون، يرجى تشغيل ملف التحديث 008_cancel_purchase_order.sql في Supabase SQL Editor أولاً.'
      );
    }

    throw error;
  },

  async deletePurchaseOrder(poId: string, currentStatus?: PurchaseOrder['status']) {
    const { error } = await db().rpc('delete_purchase_order', { p_po_id: poId });
    if (!error) return;

    const missingFn =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('delete_purchase_order');

    if (missingFn) {
      if (currentStatus !== 'received') {
        const { error: delErr } = await db()
          .from('purchase_orders')
          .delete()
          .eq('id', poId);
        if (delErr) throw delErr;
        return;
      }
      throw new Error(
        'لحذف أمر شراء تم استلامه بالفعل وعكس كمياته من المخزون ورصيد المورد بأمان، يرجى تشغيل ملف التحديث 017_delete_purchase_order.sql في Supabase SQL Editor أولاً.'
      );
    }

    throw error;
  },

  async createProductionOrder(payload: {
    batchNumber: string;
    modelId: string;
    workshopId?: string | null;
    workshopName?: string;
    agreedLaborTotal?: number;
    advancePayment?: number;
    paymentMethod?: string;
    notes?: string;
    variants: { variantId: string; plannedQty: number }[];
  }) {
    const client = db();
    const id = newUuid();
    const plannedQty = payload.variants.reduce((s, v) => s + v.plannedQty, 0);

    const fullRow = {
      id,
      batch_number: payload.batchNumber,
      model_id: payload.modelId,
      workshop_id: payload.workshopId || null,
      workshop_name: payload.workshopName || '',
      agreed_labor_total: Math.max(0, Number(payload.agreedLaborTotal) || 0),
      paid_to_workshop: 0,
      planned_qty: plannedQty,
      status: 'planned',
      notes: payload.notes || null,
    };

    let { error: pErr } = await client.from('production_orders').insert(fullRow);
    // Graceful fallback if Migration 005 hasn't been executed yet in Supabase
    if (pErr && pErr.message?.includes('column')) {
      const retry = await client.from('production_orders').insert({
        id,
        batch_number: payload.batchNumber,
        model_id: payload.modelId,
        planned_qty: plannedQty,
        status: 'planned',
        notes: payload.notes || null,
      });
      pErr = retry.error;
    }
    if (pErr) throw pErr;

    const { error: vErr } = await client.from('production_order_variants').insert(
      payload.variants.map((v) => ({
        id: newUuid(),
        production_order_id: id,
        variant_id: v.variantId,
        planned_qty: v.plannedQty,
      }))
    );
    if (vErr) throw vErr;

    if (payload.advancePayment && payload.advancePayment > 0) {
      await this.recordWorkshopPayment(
        id,
        payload.advancePayment,
        payload.paymentMethod || 'كاش',
        `دفعة تحت الحساب للورشة — ${payload.workshopName || 'ورشة خارجية'} (${payload.batchNumber})`
      );
    }

    return id;
  },

  async issueProductionOrder(prodId: string, allowShortage = false) {
    const client = db();
    if (!allowShortage) {
      const { error } = await client.rpc('issue_production_order', { p_prod_id: prodId });
      if (error) throw error;
      return;
    }

    const { error } = await client.rpc('issue_production_order', {
      p_prod_id: prodId,
      p_allow_shortage: true,
    });
    if (!error) return;

    const missingOverload =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('issue_production_order');

    if (!missingOverload) throw error;

    // Seamless fallback if Migration 013 hasn't been executed yet in Supabase
    const { data: prod, error: prodErr } = await client
      .from('production_orders')
      .select('*')
      .eq('id', prodId)
      .single();
    if (prodErr || !prod) throw prodErr || new Error('أمر التصنيع غير موجود');
    if (prod.status !== 'planned') {
      throw new Error(`أمر التصنيع (${prod.batch_number}) يجب أن يكون في حالة تجهيز القص`);
    }

    const plannedQty = Number(prod.planned_qty) || 0;
    const [mFabRes, mTrimRes, autoTrimRes, mLaborRes, existingLogsRes] = await Promise.all([
      client
        .from('model_fabrics')
        .select('fabric_id, consumption, waste_pct')
        .eq('model_id', prod.model_id),
      client
        .from('model_trims')
        .select('trim_id, quantity')
        .eq('model_id', prod.model_id),
      client
        .from('trims')
        .select('id, stock_qty, unit_cost, auto_include_in_bom, default_qty_per_piece')
        .eq('auto_include_in_bom', true),
      client
        .from('model_labor_steps')
        .select('*')
        .eq('model_id', prod.model_id)
        .order('sequence_order'),
      client
        .from('production_workshop_logs')
        .select('id')
        .eq('production_order_id', prodId)
        .limit(1),
    ]);

    if (mFabRes.error) throw mFabRes.error;
    if (mTrimRes.error) throw mTrimRes.error;
    if (mLaborRes.error) throw mLaborRes.error;

    let matCost = 0;

    // 1) Deduct available fabrics
    const fabricIds = (mFabRes.data || []).map((r) => r.fabric_id);
    if (fabricIds.length > 0) {
      const { data: fabRows, error: fabErr } = await client
        .from('fabrics')
        .select('id, stock_qty, price_per_unit')
        .in('id', fabricIds);
      if (fabErr) throw fabErr;
      const fabMap = new Map((fabRows || []).map((f) => [f.id, f]));

      for (const mf of mFabRes.data || []) {
        const fab = fabMap.get(mf.fabric_id);
        if (!fab) continue;
        const reqQty =
          Math.round(
            Number(mf.consumption) * (1 + Number(mf.waste_pct) / 100) * plannedQty * 1000
          ) / 1000;
        if (reqQty <= 0) continue;
        const curStock = Number(fab.stock_qty) || 0;
        const price = Number(fab.price_per_unit) || 0;
        const deductQty = Math.min(Math.max(curStock, 0), reqQty);
        matCost += reqQty * price;

        if (deductQty > 0) {
          const nextStock = Math.round((curStock - deductQty) * 1000) / 1000;
          fab.stock_qty = nextStock;
          const { error: uErr } = await client
            .from('fabrics')
            .update({ stock_qty: nextStock })
            .eq('id', mf.fabric_id);
          if (uErr) throw uErr;

          await client.from('inventory_movements').insert({
            item_type: 'fabric',
            fabric_id: mf.fabric_id,
            movement_type: 'production_issue',
            qty_delta: -deductQty,
            unit_cost: price,
            reference_type: 'production_order',
            reference_id: prodId,
            notes: `صرف للتصنيع ${prod.batch_number}`,
          });
        }
      }
    }

    // 2) Deduct available effective trims (explicit + auto-included)
    const explicitTrimIds = new Set((mTrimRes.data || []).map((t) => t.trim_id));
    const effectiveTrims: { trimId: string; quantity: number }[] = [
      ...(mTrimRes.data || []).map((t) => ({
        trimId: t.trim_id as string,
        quantity: Number(t.quantity) || 0,
      })),
      ...((autoTrimRes.error ? [] : autoTrimRes.data) || [])
        .filter((t) => !explicitTrimIds.has(t.id))
        .map((t) => ({
          trimId: t.id as string,
          quantity: Number(t.default_qty_per_piece ?? 1) || 0,
        })),
    ].filter((t) => t.quantity > 0);

    const trimIds = Array.from(new Set(effectiveTrims.map((t) => t.trimId)));
    if (trimIds.length > 0) {
      const { data: trimRows, error: trimErr } = await client
        .from('trims')
        .select('id, stock_qty, unit_cost')
        .in('id', trimIds);
      if (trimErr) throw trimErr;
      const trimMap = new Map((trimRows || []).map((t) => [t.id, t]));

      for (const et of effectiveTrims) {
        const tr = trimMap.get(et.trimId);
        if (!tr) continue;
        const reqQty = Math.round(et.quantity * plannedQty * 1000) / 1000;
        if (reqQty <= 0) continue;
        const curStock = Number(tr.stock_qty) || 0;
        const unitCost = Number(tr.unit_cost) || 0;
        const deductQty = Math.min(Math.max(curStock, 0), reqQty);
        matCost += reqQty * unitCost;

        if (deductQty > 0) {
          const nextStock = Math.round((curStock - deductQty) * 1000) / 1000;
          tr.stock_qty = nextStock;
          const { error: uErr } = await client
            .from('trims')
            .update({ stock_qty: nextStock })
            .eq('id', et.trimId);
          if (uErr) throw uErr;

          await client.from('inventory_movements').insert({
            item_type: 'trim',
            trim_id: et.trimId,
            movement_type: 'production_issue',
            qty_delta: -deductQty,
            unit_cost: unitCost,
            reference_type: 'production_order',
            reference_id: prodId,
            notes: `صرف للتصنيع ${prod.batch_number}`,
          });
        }
      }
    }

    // 3) Copy BOM labor steps into workshop logs if none exist yet
    if ((existingLogsRes.data || []).length === 0 && (mLaborRes.data || []).length > 0) {
      const logsPayload = (mLaborRes.data || []).map((step) => {
        const stepCost = Number(step.cost) || 0;
        const batchSize = Math.max(1, Number(step.batch_size) || 1);
        const stepTotal =
          step.billing_type === 'per_batch'
            ? (stepCost / batchSize) * plannedQty
            : stepCost * plannedQty;
        return {
          production_order_id: prodId,
          workshop_id: step.workshop_id || null,
          workshop_name: step.workshop_name || 'ورشة خارجية',
          step_name: step.name,
          billing_type: step.billing_type,
          agreed_cost: stepCost,
          batch_size: batchSize,
          total_step_cost: Math.round(stepTotal * 100) / 100,
        };
      });
      const { error: logErr } = await client.from('production_workshop_logs').insert(logsPayload);
      if (logErr) throw logErr;
    }

    // 4) Mark production order in_progress
    const { error: updErr } = await client
      .from('production_orders')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
        actual_material_cost: Math.round(matCost * 100) / 100,
      })
      .eq('id', prodId);
    if (updErr) throw updErr;
  },

  async completeProductionOrder(prodId: string) {
    const { error } = await db().rpc('complete_production_order', { p_prod_id: prodId });
    if (error) throw error;
  },

  async recordWorkshopPayment(
    prodId: string,
    amount: number,
    paymentMethod = 'كاش',
    notes?: string
  ) {
    const { error } = await db().rpc('record_workshop_payment', {
      p_prod_id: prodId,
      p_amount: amount,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
    });
    if (error) {
      if (error.message?.includes('record_workshop_payment')) {
        throw new Error(
          'يرجى تنفيذ ملف التحديث 005_workshop_advances_payouts.sql في Supabase SQL Editor لتفعيل دفعات الورش تلقائياً.'
        );
      }
      throw error;
    }
  },

  async deleteProductionOrder(
    prodId: string,
    currentStatus?: ProductionOrder['status'],
    paidToWorkshop = 0
  ) {
    const { error } = await db().rpc('delete_production_order', { p_prod_id: prodId });
    if (!error) return;

    const missingFn =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('delete_production_order');

    if (missingFn) {
      if (
        (currentStatus === 'planned' || currentStatus === 'cancelled') &&
        paidToWorkshop <= 0
      ) {
        const { error: delErr } = await db().from('production_orders').delete().eq('id', prodId);
        if (delErr) throw delErr;
        return;
      }
      throw new Error(
        'لحذف أمر تصنيع تم صرف خاماته أو استلامه أو تسجيل دفعات ورشة عليه مع عكس الأرصدة تلقائياً، يرجى تشغيل ملف التحديث 009_delete_production_and_variants.sql في Supabase SQL Editor أولاً.'
      );
    }

    throw error;
  },

  async updateProductionOrder(
    payload: {
      id: string;
      modelId: string;
      workshopId?: string | null;
      workshopName?: string;
      agreedLaborTotal: number;
      paidToWorkshop?: number;
      notes?: string;
      variants?: { variantId: string; plannedQty: number }[];
    },
    currentOrder?: Pick<
      ProductionOrder,
      | 'batchNumber'
      | 'status'
      | 'workshopId'
      | 'agreedLaborTotal'
      | 'actualLaborCost'
      | 'paidToWorkshop'
      | 'completedQty'
      | 'actualMaterialCost'
      | 'allocatedOverheadCost'
      | 'actualUnitCogs'
    >
  ) {
    const client = db();
    const variantsJson =
      payload.variants && currentOrder?.status !== 'completed'
        ? payload.variants
            .filter((v) => v.plannedQty > 0)
            .map((v) => ({ variant_id: v.variantId, planned_qty: v.plannedQty }))
        : null;

    const newLabor = Math.max(0, Math.round((Number(payload.agreedLaborTotal) || 0) * 100) / 100);
    const oldPaid = Math.max(0, Number(currentOrder?.paidToWorkshop) || 0);
    const newPaid =
      payload.paidToWorkshop !== undefined
        ? Math.max(0, Math.round((Number(payload.paidToWorkshop) || 0) * 100) / 100)
        : oldPaid;

    const { error } = await client.rpc('update_production_order', {
      p_prod_id: payload.id,
      p_model_id: payload.modelId,
      p_workshop_id: payload.workshopId || null,
      p_workshop_name: payload.workshopName || '',
      p_agreed_labor_total: newLabor,
      p_notes: payload.notes || null,
      p_variants: variantsJson,
      p_paid_to_workshop: newPaid,
    });
    if (!error) return;

    const missingFn =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('update_production_order');

    if (missingFn) {
      const status = currentOrder?.status;
      const batchNumber = currentOrder?.batchNumber || '';
      const paidChanged = Math.round(oldPaid * 100) !== Math.round(newPaid * 100);

      // Reconcile financial_transactions & cashbox (expenses) if paidToWorkshop changed
      if (paidChanged) {
        const { data: lastTx } = await client
          .from('financial_transactions')
          .select('payment_method')
          .eq('reference_type', 'production_order')
          .eq('reference_id', payload.id)
          .eq('tx_type', 'workshop_payout')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const payMethod = (lastTx?.payment_method as string | undefined) || 'كاش';

        await client
          .from('financial_transactions')
          .delete()
          .eq('reference_type', 'production_order')
          .eq('reference_id', payload.id)
          .eq('tx_type', 'workshop_payout');

        if (batchNumber) {
          await client
            .from('expenses')
            .delete()
            .eq('is_raw_material_purchase', true)
            .eq('category', 'خامات')
            .eq('notes', `تشغيلة ${batchNumber}`);
        }

        if (newPaid > 0) {
          const payoutLabel = `${
            status === 'completed' ? 'مدفوعات الورشة' : 'دفعة تحت الحساب للورشة'
          } — ${payload.workshopName || 'ورشة خارجية'}${batchNumber ? ` (${batchNumber})` : ''}`;

          await client.from('financial_transactions').insert({
            tx_type: 'workshop_payout',
            amount: newPaid,
            workshop_id: payload.workshopId || null,
            reference_type: 'production_order',
            reference_id: payload.id,
            payment_method: payMethod,
            notes: payoutLabel,
          });

          if (batchNumber) {
            await client.from('expenses').insert({
              expense_date: new Date().toISOString().slice(0, 10),
              title: payoutLabel,
              category: 'خامات',
              is_raw_material_purchase: true,
              amount: newPaid,
              payment_method: payMethod,
              notes: `تشغيلة ${batchNumber}`,
            });
          }
        }
      } else if ((currentOrder?.workshopId || null) !== (payload.workshopId || null)) {
        await client
          .from('financial_transactions')
          .update({ workshop_id: payload.workshopId || null })
          .eq('reference_type', 'production_order')
          .eq('reference_id', payload.id);
      }

      if (status === 'completed') {
        const oldLabor = currentOrder?.actualLaborCost || currentOrder?.agreedLaborTotal || 0;
        const oldUnpaid = Math.max(0, oldLabor - oldPaid);
        const newUnpaid = Math.max(0, newLabor - newPaid);
        const oldWsId = currentOrder?.workshopId || null;
        const newWsId = payload.workshopId || null;

        if (oldWsId === newWsId) {
          if (newWsId && Math.round((newUnpaid - oldUnpaid) * 100) !== 0) {
            const { data: wsRow } = await client
              .from('workshops')
              .select('balance_payable')
              .eq('id', newWsId)
              .maybeSingle();
            if (wsRow) {
              const nextBal = Math.max(
                0,
                Math.round(((Number(wsRow.balance_payable) || 0) + (newUnpaid - oldUnpaid)) * 100) /
                  100
              );
              await client
                .from('workshops')
                .update({ balance_payable: nextBal })
                .eq('id', newWsId);
            }
          }
        } else {
          if (oldWsId && oldUnpaid > 0) {
            const { data: oldWs } = await client
              .from('workshops')
              .select('balance_payable')
              .eq('id', oldWsId)
              .maybeSingle();
            if (oldWs) {
              const nextBal = Math.max(
                0,
                Math.round(((Number(oldWs.balance_payable) || 0) - oldUnpaid) * 100) / 100
              );
              await client
                .from('workshops')
                .update({ balance_payable: nextBal })
                .eq('id', oldWsId);
            }
          }
          if (newWsId && newUnpaid > 0) {
            const { data: newWs } = await client
              .from('workshops')
              .select('balance_payable')
              .eq('id', newWsId)
              .maybeSingle();
            if (newWs) {
              const nextBal =
                Math.round(((Number(newWs.balance_payable) || 0) + newUnpaid) * 100) / 100;
              await client
                .from('workshops')
                .update({ balance_payable: nextBal })
                .eq('id', newWsId);
            }
          }
        }

        const completedQty = Number(currentOrder?.completedQty) || 0;
        const nextCogs =
          completedQty > 0
            ? Math.round(
                (((Number(currentOrder?.actualMaterialCost) || 0) +
                  newLabor +
                  (Number(currentOrder?.allocatedOverheadCost) || 0)) /
                  completedQty) *
                  100
              ) / 100
            : Number(currentOrder?.actualUnitCogs) || 0;

        const { error: compUpdErr } = await client
          .from('production_orders')
          .update({
            workshop_id: payload.workshopId || null,
            workshop_name: payload.workshopName || '',
            agreed_labor_total: newLabor,
            actual_labor_cost: newLabor,
            paid_to_workshop: newPaid,
            actual_unit_cogs: nextCogs,
            notes: payload.notes?.trim() || null,
          })
          .eq('id', payload.id);
        if (compUpdErr) throw compUpdErr;
        return;
      }

      // Direct fallback for planned / in_progress orders
      const cleanVariants = (payload.variants || []).filter((v) => v.plannedQty > 0);
      const plannedQty = cleanVariants.reduce((s, v) => s + v.plannedQty, 0);

      const updatePatch: Record<string, unknown> = {
        workshop_id: payload.workshopId || null,
        workshop_name: payload.workshopName || '',
        agreed_labor_total: newLabor,
        paid_to_workshop: newPaid,
        notes: payload.notes?.trim() || null,
      };
      if (status === 'planned') {
        updatePatch.model_id = payload.modelId;
      }
      if (cleanVariants.length > 0 && plannedQty > 0) {
        updatePatch.planned_qty = plannedQty;
      }

      const { error: updErr } = await client
        .from('production_orders')
        .update(updatePatch)
        .eq('id', payload.id);
      if (updErr) throw updErr;

      if (cleanVariants.length > 0) {
        const { error: delVarErr } = await client
          .from('production_order_variants')
          .delete()
          .eq('production_order_id', payload.id);
        if (delVarErr) throw delVarErr;

        const { error: insVarErr } = await client.from('production_order_variants').insert(
          cleanVariants.map((v) => ({
            id: newUuid(),
            production_order_id: payload.id,
            variant_id: v.variantId,
            planned_qty: v.plannedQty,
          }))
        );
        if (insVarErr) throw insVarErr;
      }
      return;
    }

    throw error;
  },

  async createSalesOrder(payload: {
    orderNumber: string;
    customerId?: string | null;
    customerName: string;
    channel: SalesOrder['channel'];
    platform: string;
    discountAmount: number;
    shippingFee: number;
    paidAmount: number;
    fulfillmentStatus: string;
    notes?: string;
    items: { variantId: string; quantity: number; unitPrice: number }[];
  }) {
    const client = db();
    const id = newUuid();
    const subtotal = payload.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const totalAmount = subtotal - payload.discountAmount + payload.shippingFee;
    const { error: sErr } = await client.from('sales_orders').insert({
      id,
      order_number: payload.orderNumber,
      customer_id: payload.customerId || null,
      customer_name: payload.customerName,
      channel: payload.channel,
      platform: payload.platform,
      fulfillment_status: payload.fulfillmentStatus,
      status: 'draft',
      subtotal,
      discount_amount: payload.discountAmount,
      shipping_fee: payload.shippingFee,
      total_amount: totalAmount,
      paid_amount: payload.paidAmount,
      notes: payload.notes || null,
    });
    if (sErr) throw sErr;

    const { error: iErr } = await client.from('sales_order_items').insert(
      payload.items.map((it) => ({
        id: newUuid(),
        sales_order_id: id,
        variant_id: it.variantId,
        quantity: it.quantity,
        unit_price: it.unitPrice,
      }))
    );
    if (iErr) throw iErr;
    return id;
  },

  async confirmSalesOrder(saleId: string) {
    const { error } = await db().rpc('confirm_sales_order', { p_sale_id: saleId });
    if (error) throw error;
  },

  async recordSalesPayment(saleId: string, amount: number, method = 'تحويل') {
    const { error } = await db().rpc('record_sales_payment', {
      p_sale_id: saleId,
      p_payment_amount: amount,
      p_payment_method: method,
    });
    if (error) throw error;
  },

  async updateSalesFulfillment(saleId: string, fulfillmentStatus: string) {
    const { error } = await db()
      .from('sales_orders')
      .update({ fulfillment_status: fulfillmentStatus })
      .eq('id', saleId);
    if (error) throw error;
  },

  async cancelSalesOrder(
    saleId: string,
    currentOrder?: Pick<SalesOrder, 'orderNumber' | 'status' | 'paidAmount' | 'customerId' | 'items'>
  ) {
    const client = db();
    const { error } = await client.rpc('cancel_sales_order', { p_sale_id: saleId });
    if (!error) return;

    const missingFn =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('cancel_sales_order');
    if (!missingFn) throw error;

    // Seamless fallback if Migration 015 hasn't been executed yet in Supabase
    const status = currentOrder?.status;
    if (status === 'cancelled') return;

    const shouldRestoreStock =
      status === 'confirmed' || status === 'shipped' || status === 'delivered';

    if (shouldRestoreStock && currentOrder?.items?.length) {
      const varIds = Array.from(new Set(currentOrder.items.map((it) => it.variantId)));
      const { data: varRows, error: varErr } = await client
        .from('model_variants')
        .select('id, finished_goods_qty')
        .in('id', varIds);
      if (varErr) throw varErr;
      const varMap = new Map((varRows || []).map((v) => [v.id, Number(v.finished_goods_qty) || 0]));

      for (const it of currentOrder.items) {
        const curQty = varMap.get(it.variantId);
        if (curQty === undefined) continue;
        const nextQty = curQty + it.quantity;
        varMap.set(it.variantId, nextQty);
        const { error: uErr } = await client
          .from('model_variants')
          .update({ finished_goods_qty: nextQty })
          .eq('id', it.variantId);
        if (uErr) throw uErr;

        await client.from('inventory_movements').insert({
          item_type: 'finished_good',
          variant_id: it.variantId,
          movement_type: 'sale_return',
          qty_delta: it.quantity,
          unit_cost: it.unitCogsSnapshot || 0,
          reference_type: 'sales_order',
          reference_id: saleId,
          notes: `إرجاع مخزون — إلغاء طلب بيع ${currentOrder.orderNumber}`,
        });
      }
    }

    if ((currentOrder?.paidAmount || 0) > 0) {
      await client.from('financial_transactions').insert({
        tx_type: 'refund',
        amount: Math.round((currentOrder?.paidAmount || 0) * 100) / 100,
        customer_id: currentOrder?.customerId || null,
        reference_type: 'sales_order',
        reference_id: saleId,
        payment_method: 'تحويل',
        notes: `إلغاء طلب بيع ${currentOrder?.orderNumber || ''}`,
      });
    }

    const { error: updErr } = await client
      .from('sales_orders')
      .update({ status: 'cancelled', fulfillment_status: 'ملغي' })
      .eq('id', saleId);
    if (updErr) throw updErr;
  },

  async deleteSalesOrder(
    saleId: string,
    currentOrder?: Pick<SalesOrder, 'orderNumber' | 'status' | 'items'>
  ) {
    const client = db();
    const { error } = await client.rpc('delete_sales_order', { p_sale_id: saleId });
    if (!error) return;

    const missingFn =
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.message?.includes('delete_sales_order');
    if (!missingFn) throw error;

    // Seamless fallback if Migration 015 hasn't been executed yet in Supabase
    const status = currentOrder?.status;
    const shouldRestoreStock =
      status === 'confirmed' || status === 'shipped' || status === 'delivered';

    if (shouldRestoreStock && currentOrder?.items?.length) {
      const varIds = Array.from(new Set(currentOrder.items.map((it) => it.variantId)));
      const { data: varRows, error: varErr } = await client
        .from('model_variants')
        .select('id, finished_goods_qty')
        .in('id', varIds);
      if (varErr) throw varErr;
      const varMap = new Map((varRows || []).map((v) => [v.id, Number(v.finished_goods_qty) || 0]));

      for (const it of currentOrder.items) {
        const curQty = varMap.get(it.variantId);
        if (curQty === undefined) continue;
        const nextQty = curQty + it.quantity;
        varMap.set(it.variantId, nextQty);
        const { error: uErr } = await client
          .from('model_variants')
          .update({ finished_goods_qty: nextQty })
          .eq('id', it.variantId);
        if (uErr) throw uErr;

        await client.from('inventory_movements').insert({
          item_type: 'finished_good',
          variant_id: it.variantId,
          movement_type: 'sale_return',
          qty_delta: it.quantity,
          unit_cost: it.unitCogsSnapshot || 0,
          reference_type: 'sales_order',
          reference_id: saleId,
          notes: `عكس مبيعات — حذف طلب بيع ${currentOrder.orderNumber}`,
        });
      }
    }

    await client
      .from('financial_transactions')
      .delete()
      .eq('reference_type', 'sales_order')
      .eq('reference_id', saleId);

    const { error: delErr } = await client.from('sales_orders').delete().eq('id', saleId);
    if (delErr) throw delErr;
  },

  async fetchAuditLogs(filters?: {
    month?: string;
    tableName?: string;
    action?: AuditAction | '';
    actorEmail?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: AuditLogEntry[]; totalCount: number; missingMigration: boolean }> {
    const client = db();
    const limit = filters?.limit ?? 100;
    const offset = filters?.offset ?? 0;

    let query = client
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters?.month) query = query.eq('log_month', filters.month);
    if (filters?.tableName) query = query.eq('table_name', filters.tableName);
    if (filters?.action) query = query.eq('action', filters.action);
    if (filters?.actorEmail) query = query.eq('actor_email', filters.actorEmail);
    if (filters?.search?.trim()) {
      const q = filters.search.trim().replace(/,/g, ' ');
      query = query.or(
        `record_summary.ilike.%${q}%,actor_email.ilike.%${q}%,actor_name.ilike.%${q}%,entity_label.ilike.%${q}%`
      );
    }

    const { data, error, count } = await query;
    if (error) {
      const missing =
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message?.includes('audit_logs');
      if (missing) {
        return { rows: [], totalCount: 0, missingMigration: true };
      }
      throw error;
    }

    const rows: AuditLogEntry[] = (data || []).map((r) => ({
      id: Number(r.id),
      occurredAt: r.occurred_at,
      logMonth: r.log_month,
      tableName: r.table_name,
      entityLabel: r.entity_label,
      action: r.action as AuditAction,
      recordId: r.record_id ?? null,
      recordSummary: r.record_summary || '',
      actorId: r.actor_id ?? null,
      actorEmail: r.actor_email || 'system',
      actorName: r.actor_name || r.actor_email || 'system',
      changedFields: (r.changed_fields as Record<string, unknown> | null) ?? null,
    }));

    return { rows, totalCount: count ?? rows.length, missingMigration: false };
  },

  async fetchAllAuditLogsForMonth(month: string): Promise<AuditLogEntry[]> {
    const client = db();
    const all: AuditLogEntry[] = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const { data, error } = await client
        .from('audit_logs')
        .select('*')
        .eq('log_month', month)
        .order('occurred_at', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      const chunk = data || [];
      for (const r of chunk) {
        all.push({
          id: Number(r.id),
          occurredAt: r.occurred_at,
          logMonth: r.log_month,
          tableName: r.table_name,
          entityLabel: r.entity_label,
          action: r.action as AuditAction,
          recordId: r.record_id ?? null,
          recordSummary: r.record_summary || '',
          actorId: r.actor_id ?? null,
          actorEmail: r.actor_email || 'system',
          actorName: r.actor_name || r.actor_email || 'system',
          changedFields: (r.changed_fields as Record<string, unknown> | null) ?? null,
        });
      }
      if (chunk.length < pageSize) break;
      offset += pageSize;
    }

    return all;
  },

  async getAuditLogStats(): Promise<{ stats: AuditLogStats | null; missingMigration: boolean }> {
    const { data, error } = await db().rpc('get_audit_log_stats');
    if (error) {
      const missing =
        error.code === '42883' ||
        error.code === 'PGRST202' ||
        error.code === '42P01' ||
        error.message?.includes('get_audit_log_stats') ||
        error.message?.includes('audit_logs');
      if (missing) {
        return { stats: null, missingMigration: true };
      }
      throw error;
    }

    const raw = (data || {}) as Record<string, unknown>;
    const rawMonths = Array.isArray(raw.months) ? raw.months : [];
    const stats: AuditLogStats = {
      totalRows: Number(raw.total_rows) || 0,
      auditTableBytes: Number(raw.audit_table_bytes) || 0,
      auditTableMb: Number(raw.audit_table_mb) || 0,
      dbTotalBytes: Number(raw.db_total_bytes) || 0,
      dbTotalMb: Number(raw.db_total_mb) || 0,
      dbLimitMb: Number(raw.db_limit_mb) || 500,
      months: rawMonths.map((m) => {
        const obj = m as Record<string, unknown>;
        return {
          month: String(obj.month || ''),
          rowCount: Number(obj.row_count) || 0,
          oldestAt: String(obj.oldest_at || ''),
          newestAt: String(obj.newest_at || ''),
        };
      }),
    };
    return { stats, missingMigration: false };
  },

  async purgeAuditLogsForMonth(month: string): Promise<number> {
    const { data, error } = await db().rpc('purge_audit_logs_for_month', { p_month: month });
    if (error) throw error;
    return Number(data) || 0;
  },

  async purgeAuditLogsOlderThan(keepDays: number): Promise<number> {
    const { data, error } = await db().rpc('purge_audit_logs_older_than', {
      p_keep_days: keepDays,
    });
    if (error) throw error;
    return Number(data) || 0;
  },
};
