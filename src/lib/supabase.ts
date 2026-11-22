import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_LOOKUPS } from '../data/defaultLookups';
import type {
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
      .limit(80),
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
    supplierId: r.supplier_id,
    supplier: r.supplier_name || 'مورد عام',
    purchaseUnit: r.purchase_unit,
    packPrice: Number(r.pack_price) || 0,
    unitsPerPack: Number(r.units_per_pack) || 1,
    unitLabel: r.unit_label || 'قطعة',
    stockQty: Number(r.stock_qty) || 0,
    reorderLevel: Number(r.reorder_level) || 50,
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
        lineTotal: Number(it.line_total) || 0,
      })),
  }));

  const productionOrders: ProductionOrder[] = (prodRes.data || []).map((p) => ({
    id: p.id,
    batchNumber: p.batch_number,
    modelId: p.model_id,
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
    const { error } = await db().from('trims').upsert({
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
      notes: t.notes || null,
    });
    if (error) throw error;
  },

  async deleteTrim(id: string) {
    const { error } = await db().from('trims').delete().eq('id', id);
    if (error) throw error;
  },

  async upsertOperation(op: OutsourcedOperation) {
    const { error } = await db().from('outsourced_operations').upsert({
      id: op.id,
      name: op.name,
      workshop_id: op.workshopId || null,
      workshop_name: op.workshopName,
      billing_type: op.billingType,
      cost: op.cost,
      batch_size: op.batchSize,
      lead_time_days: op.leadTimeDays ?? 1,
      notes: op.notes || null,
    });
    if (error) throw error;
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
    notes?: string;
    items: {
      itemType: 'fabric' | 'trim';
      fabricId?: string | null;
      trimId?: string | null;
      description: string;
      quantity: number;
      unitsPerPack: number;
      unitPrice: number;
    }[];
  }) {
    const client = db();
    const id = newUuid();
    const total = po.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const { error: poErr } = await client.from('purchase_orders').insert({
      id,
      po_number: po.poNumber,
      supplier_id: po.supplierId || null,
      supplier_name: po.supplierName,
      status: 'ordered',
      total_amount: total,
      notes: po.notes || null,
    });
    if (poErr) throw poErr;

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
      }))
    );
    if (itemsErr) throw itemsErr;
    return id;
  },

  async receivePurchaseOrder(poId: string) {
    const { error } = await db().rpc('receive_purchase_order', { p_po_id: poId });
    if (error) throw error;
  },

  async createProductionOrder(payload: {
    batchNumber: string;
    modelId: string;
    notes?: string;
    variants: { variantId: string; plannedQty: number }[];
  }) {
    const client = db();
    const id = newUuid();
    const plannedQty = payload.variants.reduce((s, v) => s + v.plannedQty, 0);
    const { error: pErr } = await client.from('production_orders').insert({
      id,
      batch_number: payload.batchNumber,
      model_id: payload.modelId,
      planned_qty: plannedQty,
      status: 'planned',
      notes: payload.notes || null,
    });
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
    return id;
  },

  async issueProductionOrder(prodId: string) {
    const { error } = await db().rpc('issue_production_order', { p_prod_id: prodId });
    if (error) throw error;
  },

  async completeProductionOrder(prodId: string) {
    const { error } = await db().rpc('complete_production_order', { p_prod_id: prodId });
    if (error) throw error;
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
};
