import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Download,
  Factory,
  Layers,
  Package,
  Printer,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import { useERP } from '../../context/ERPContext';
import type { TrimSupplyGroup } from '../../types/erp';
import {
  calculateModelCost,
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  getTrimUnitCost,
} from '../../utils/calculations';

type ReportTab = 'profitability' | 'stock' | 'procurement' | 'customers';
type PeriodFilter = 'all' | 'this_month' | 'last_3m' | 'this_year' | 'custom';
type StockStatusFilter = 'all' | 'low' | 'out' | 'ok';

const SUPPLY_GROUP_LABELS: Record<TrimSupplyGroup, string> = {
  trims: 'كلف وإكسسوارات',
  manufacturing: 'مستلزمات تصنيع',
  brand: 'مستلزمات براند',
};

function getPeriodBounds(
  period: PeriodFilter,
  customFrom: string,
  customTo: string
): { from: string | null; to: string | null } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'this_month') {
    return {
      from: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      to: now.toISOString().slice(0, 10),
    };
  }
  if (period === 'last_3m') {
    const start = new Date(y, m - 2, 1);
    return {
      from: start.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    };
  }
  if (period === 'this_year') {
    return {
      from: `${y}-01-01`,
      to: now.toISOString().slice(0, 10),
    };
  }
  if (period === 'custom') {
    return {
      from: customFrom || null,
      to: customTo || null,
    };
  }
  return { from: null, to: null };
}

function inDateRange(dateStr: string | undefined, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const d = (dateStr || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export const ReportsView: React.FC = () => {
  const { state } = useERP();
  const [reportTab, setReportTab] = useState<ReportTab>('profitability');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [stockFilter, setStockFilter] = useState<StockStatusFilter>('all');

  const bounds = useMemo(
    () => getPeriodBounds(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  // Map variantId -> { model, variant } for accurate model profitability
  const variantLookup = useMemo(() => {
    const map = new Map<
      string,
      {
        modelId: string;
        modelName: string;
        modelSku: string;
        color: string;
        size: string;
        variantSku: string;
        unitCogs: number;
        retailPrice: number;
      }
    >();
    for (const model of state.models) {
      const calc = calculateModelCost(model, state.fabrics, state.trims, state.overhead);
      for (const v of model.variants || []) {
        map.set(v.id, {
          modelId: model.id,
          modelName: model.name,
          modelSku: model.sku,
          color: v.color,
          size: v.size,
          variantSku: v.variantSku,
          unitCogs: v.avgUnitCogs > 0 ? v.avgUnitCogs : calc.totalUnitCost,
          retailPrice: v.retailPrice > 0 ? v.retailPrice : calc.suggestedRetailPrice,
        });
      }
    }
    return map;
  }, [state.models, state.fabrics, state.trims, state.overhead]);

  // 1) Profitability Analytics
  const profitability = useMemo(() => {
    const activeOrders = state.salesOrders.filter(
      (o) =>
        o.status !== 'cancelled' &&
        o.status !== 'returned' &&
        inDateRange(o.orderDate, bounds.from, bounds.to)
    );
    const opExpenses = state.expenses.filter(
      (e) => !e.isRawMaterialPurchase && inDateRange(e.expenseDate, bounds.from, bounds.to)
    );

    const totalRevenue = activeOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const totalCollected = activeOrders.reduce((s, o) => s + (o.paidAmount || 0), 0);
    const totalCogs = activeOrders.reduce((s, o) => s + (o.totalCogs || 0), 0);
    const grossProfit = totalRevenue - totalCogs;
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const totalOpEx = opExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const netProfit = grossProfit - totalOpEx;
    const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const totalUnitsSold = activeOrders.reduce(
      (s, o) => s + o.items.reduce((is, it) => is + (it.quantity || 0), 0),
      0
    );

    // By Model
    const byModelMap = new Map<
      string,
      {
        modelId: string;
        name: string;
        sku: string;
        unitsSold: number;
        revenue: number;
        cogs: number;
        profit: number;
        marginPct: number;
      }
    >();

    for (const order of activeOrders) {
      const orderItemsTotal = order.items.reduce((s, it) => s + (it.lineTotal || 0), 0);
      const discountRatio =
        orderItemsTotal > 0 ? Math.min(1, (order.discountAmount || 0) / orderItemsTotal) : 0;

      for (const it of order.items) {
        const meta = variantLookup.get(it.variantId);
        const key = meta?.modelId || it.variantId;
        const name = meta?.modelName || 'موديل غير محدد';
        const sku = meta?.modelSku || '—';
        const netLineRevenue = (it.lineTotal || it.quantity * it.unitPrice) * (1 - discountRatio);
        const lineCogs =
          it.lineCogs > 0
            ? it.lineCogs
            : (it.unitCogsSnapshot > 0 ? it.unitCogsSnapshot : meta?.unitCogs || 0) * it.quantity;

        const existing = byModelMap.get(key) || {
          modelId: key,
          name,
          sku,
          unitsSold: 0,
          revenue: 0,
          cogs: 0,
          profit: 0,
          marginPct: 0,
        };
        existing.unitsSold += it.quantity;
        existing.revenue += netLineRevenue;
        existing.cogs += lineCogs;
        existing.profit = existing.revenue - existing.cogs;
        existing.marginPct = existing.revenue > 0 ? (existing.profit / existing.revenue) * 100 : 0;
        byModelMap.set(key, existing);
      }
    }

    const byModel = Array.from(byModelMap.values()).sort((a, b) => b.profit - a.profit);

    // Also compute BOM theoretical profitability for all models (even if 0 sold yet)
    const bomCatalog = state.models.map((m) => {
      const calc = calculateModelCost(m, state.fabrics, state.trims, state.overhead);
      const actualPrice = m.actualRetailPrice && m.actualRetailPrice > 0 ? m.actualRetailPrice : calc.suggestedRetailPrice;
      const actualProfit = actualPrice - calc.totalUnitCost;
      const actualMargin = actualPrice > 0 ? (actualProfit / actualPrice) * 100 : 0;
      const soldRow = byModelMap.get(m.id);
      return {
        id: m.id,
        name: m.name,
        sku: m.sku,
        unitCost: calc.totalUnitCost,
        retailPrice: actualPrice,
        unitProfit: actualProfit,
        marginPct: actualMargin,
        unitsSold: soldRow?.unitsSold || 0,
        realizedProfit: soldRow?.profit || 0,
      };
    });

    // By Platform / Channel
    const byPlatformMap = new Map<
      string,
      { platform: string; orders: number; units: number; revenue: number; profit: number }
    >();
    for (const o of activeOrders) {
      const key = o.platform || 'مباشر';
      const cur = byPlatformMap.get(key) || {
        platform: key,
        orders: 0,
        units: 0,
        revenue: 0,
        profit: 0,
      };
      cur.orders += 1;
      cur.units += o.items.reduce((s, it) => s + (it.quantity || 0), 0);
      cur.revenue += o.totalAmount || 0;
      cur.profit += (o.totalAmount || 0) - (o.totalCogs || 0);
      byPlatformMap.set(key, cur);
    }
    const byPlatform = Array.from(byPlatformMap.values()).sort((a, b) => b.revenue - a.revenue);

    // Monthly Trend (Revenue vs Gross Profit vs OpEx)
    const monthlyMap = new Map<
      string,
      { month: string; revenue: number; grossProfit: number; expenses: number; netProfit: number }
    >();
    for (const o of activeOrders) {
      const ym = (o.orderDate || '').slice(0, 7) || 'غير محدد';
      const cur = monthlyMap.get(ym) || {
        month: ym,
        revenue: 0,
        grossProfit: 0,
        expenses: 0,
        netProfit: 0,
      };
      cur.revenue += o.totalAmount || 0;
      cur.grossProfit += (o.totalAmount || 0) - (o.totalCogs || 0);
      monthlyMap.set(ym, cur);
    }
    for (const e of opExpenses) {
      const ym = (e.expenseDate || '').slice(0, 7) || 'غير محدد';
      const cur = monthlyMap.get(ym) || {
        month: ym,
        revenue: 0,
        grossProfit: 0,
        expenses: 0,
        netProfit: 0,
      };
      cur.expenses += e.amount || 0;
      monthlyMap.set(ym, cur);
    }
    const monthlyTrend = Array.from(monthlyMap.values())
      .map((m) => ({
        ...m,
        revenue: Math.round(m.revenue),
        grossProfit: Math.round(m.grossProfit),
        expenses: Math.round(m.expenses),
        netProfit: Math.round(m.grossProfit - m.expenses),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      orderCount: activeOrders.length,
      totalUnitsSold,
      totalRevenue,
      totalCollected,
      totalCogs,
      grossProfit,
      grossMarginPct,
      totalOpEx,
      netProfit,
      netMarginPct,
      byModel,
      bomCatalog,
      byPlatform,
      monthlyTrend,
    };
  }, [state.salesOrders, state.expenses, state.models, state.fabrics, state.trims, state.overhead, bounds, variantLookup]);

  // 2) Materials & Finished Goods Stock Valuation
  const stockReport = useMemo(() => {
    const fabricRows = state.fabrics.map((f) => {
      const qty = Math.max(0, Number(f.stockQty) || 0);
      const unitCost = Math.max(0, Number(f.pricePerUnit) || 0);
      const value = qty * unitCost;
      const status: 'out' | 'low' | 'ok' =
        qty <= 0 ? 'out' : qty <= (f.reorderLevel || 0) ? 'low' : 'ok';
      return {
        id: f.id,
        name: f.name,
        supplier: f.supplier || '—',
        unit: FABRIC_UNIT_LABELS[f.unit],
        qty,
        reorderLevel: f.reorderLevel || 0,
        unitCost,
        value,
        status,
      };
    });

    const trimRows = state.trims.map((t) => {
      const qty = Math.max(0, Number(t.stockQty) || 0);
      const unitCost = getTrimUnitCost(t);
      const value = qty * unitCost;
      const group: TrimSupplyGroup = t.supplyGroup || 'trims';
      const status: 'out' | 'low' | 'ok' =
        qty <= 0 ? 'out' : qty <= (t.reorderLevel || 0) ? 'low' : 'ok';
      return {
        id: t.id,
        name: t.name,
        category: t.category || '—',
        groupLabel: SUPPLY_GROUP_LABELS[group],
        supplier: t.supplier || '—',
        unit: t.unitLabel || 'قطعة',
        qty,
        reorderLevel: t.reorderLevel || 0,
        unitCost,
        value,
        status,
      };
    });

    const finishedRows: {
      id: string;
      modelName: string;
      sku: string;
      color: string;
      size: string;
      qty: number;
      unitCogs: number;
      retailPrice: number;
      costValue: number;
      retailValue: number;
      potentialProfit: number;
      status: 'out' | 'low' | 'ok';
    }[] = [];

    for (const m of state.models) {
      const calc = calculateModelCost(m, state.fabrics, state.trims, state.overhead);
      for (const v of m.variants || []) {
        const qty = Math.max(0, Number(v.finishedGoodsQty) || 0);
        const unitCogs = v.avgUnitCogs > 0 ? v.avgUnitCogs : calc.totalUnitCost;
        const retailPrice = v.retailPrice > 0 ? v.retailPrice : calc.suggestedRetailPrice;
        const costValue = qty * unitCogs;
        const retailValue = qty * retailPrice;
        const status: 'out' | 'low' | 'ok' =
          qty <= 0 ? 'out' : qty <= (v.reorderLevel || 3) ? 'low' : 'ok';
        finishedRows.push({
          id: v.id,
          modelName: m.name,
          sku: v.variantSku,
          color: v.color,
          size: v.size,
          qty,
          unitCogs,
          retailPrice,
          costValue,
          retailValue,
          potentialProfit: retailValue - costValue,
          status,
        });
      }
    }

    const totalFabricValue = fabricRows.reduce((s, r) => s + r.value, 0);
    const totalTrimValue = trimRows.reduce((s, r) => s + r.value, 0);
    const totalFinishedCostValue = finishedRows.reduce((s, r) => s + r.costValue, 0);
    const totalFinishedRetailValue = finishedRows.reduce((s, r) => s + r.retailValue, 0);
    const totalFinishedPieces = finishedRows.reduce((s, r) => s + r.qty, 0);
    const totalInventoryCostValue = totalFabricValue + totalTrimValue + totalFinishedCostValue;
    const lowStockCount =
      fabricRows.filter((r) => r.status !== 'ok').length +
      trimRows.filter((r) => r.status !== 'ok').length;

    const filterFn = <T extends { status: 'out' | 'low' | 'ok' }>(rows: T[]) => {
      if (stockFilter === 'all') return rows;
      if (stockFilter === 'low') return rows.filter((r) => r.status === 'low' || r.status === 'out');
      return rows.filter((r) => r.status === stockFilter);
    };

    return {
      fabricRows: filterFn(fabricRows).sort((a, b) => b.value - a.value),
      trimRows: filterFn(trimRows).sort((a, b) => b.value - a.value),
      finishedRows: filterFn(finishedRows).sort((a, b) => b.costValue - a.costValue),
      allFabricRows: fabricRows,
      allTrimRows: trimRows,
      allFinishedRows: finishedRows,
      totalFabricValue,
      totalTrimValue,
      totalFinishedCostValue,
      totalFinishedRetailValue,
      totalFinishedPieces,
      totalInventoryCostValue,
      lowStockCount,
    };
  }, [state.fabrics, state.trims, state.models, state.overhead, stockFilter]);

  // 3) Procurement, Suppliers & Workshops Report
  const procurementReport = useMemo(() => {
    const receivedPOs = state.purchaseOrders.filter(
      (p) => p.status === 'received' && inDateRange(p.orderDate, bounds.from, bounds.to)
    );
    const totalPurchased = receivedPOs.reduce((s, p) => s + (p.totalAmount || 0), 0);
    const totalShipping = receivedPOs.reduce((s, p) => s + (p.shippingCost || 0), 0);
    const totalSupplierPayable = state.suppliers.reduce((s, sup) => s + (sup.balancePayable || 0), 0);

    const bySupplierMap = new Map<
      string,
      { name: string; poCount: number; totalSpent: number; totalShipping: number; balancePayable: number }
    >();
    for (const sup of state.suppliers) {
      bySupplierMap.set(sup.name, {
        name: sup.name,
        poCount: 0,
        totalSpent: 0,
        totalShipping: 0,
        balancePayable: sup.balancePayable || 0,
      });
    }
    for (const po of receivedPOs) {
      const key = po.supplierName || 'مورد عام';
      const cur = bySupplierMap.get(key) || {
        name: key,
        poCount: 0,
        totalSpent: 0,
        totalShipping: 0,
        balancePayable: 0,
      };
      cur.poCount += 1;
      cur.totalSpent += po.totalAmount || 0;
      cur.totalShipping += po.shippingCost || 0;
      bySupplierMap.set(key, cur);
    }
    const supplierSummary = Array.from(bySupplierMap.values()).sort(
      (a, b) => b.totalSpent - a.totalSpent
    );

    const activeProd = state.productionOrders.filter(
      (p) => p.status !== 'cancelled' && inDateRange(p.createdAt, bounds.from, bounds.to)
    );
    const byWorkshopMap = new Map<
      string,
      {
        name: string;
        batches: number;
        plannedQty: number;
        completedQty: number;
        agreedLabor: number;
        paid: number;
        remaining: number;
      }
    >();
    for (const po of activeProd) {
      const key = po.workshopName || 'ورشة غير محددة';
      const cur = byWorkshopMap.get(key) || {
        name: key,
        batches: 0,
        plannedQty: 0,
        completedQty: 0,
        agreedLabor: 0,
        paid: 0,
        remaining: 0,
      };
      const agreed = po.agreedLaborTotal || po.actualLaborCost || 0;
      const paid = po.paidToWorkshop || 0;
      cur.batches += 1;
      cur.plannedQty += po.plannedQty || 0;
      cur.completedQty += po.completedQty || 0;
      cur.agreedLabor += agreed;
      cur.paid += paid;
      cur.remaining += Math.max(0, agreed - paid);
      byWorkshopMap.set(key, cur);
    }
    const workshopSummary = Array.from(byWorkshopMap.values()).sort(
      (a, b) => b.agreedLabor - a.agreedLabor
    );
    const totalWorkshopRemaining = workshopSummary.reduce((s, w) => s + w.remaining, 0);

    return {
      poCount: receivedPOs.length,
      totalPurchased,
      totalShipping,
      totalSupplierPayable,
      supplierSummary,
      workshopSummary,
      totalWorkshopRemaining,
      totalProductionBatches: activeProd.length,
    };
  }, [state.purchaseOrders, state.suppliers, state.productionOrders, bounds]);

  // 4) Customers & Receivables Report
  const customersReport = useMemo(() => {
    const activeOrders = state.salesOrders.filter(
      (o) =>
        o.status !== 'cancelled' &&
        o.status !== 'returned' &&
        inDateRange(o.orderDate, bounds.from, bounds.to)
    );
    const unpaidOrders = activeOrders
      .filter((o) => (o.remainingDebt || 0) > 0.01)
      .sort((a, b) => (b.remainingDebt || 0) - (a.remainingDebt || 0));

    const totalReceivables = unpaidOrders.reduce((s, o) => s + (o.remainingDebt || 0), 0);

    const byCustomerMap = new Map<
      string,
      {
        name: string;
        governorate: string;
        orders: number;
        totalSpent: number;
        paid: number;
        debt: number;
      }
    >();
    const govByCustomerId = new Map(state.customers.map((c) => [c.id, c.governorate || 'غير محدد']));
    const govByName = new Map(state.customers.map((c) => [c.name, c.governorate || 'غير محدد']));

    for (const o of activeOrders) {
      const key = o.customerName || 'عميل غير محدد';
      const gov =
        (o.customerId ? govByCustomerId.get(o.customerId) : undefined) ||
        govByName.get(key) ||
        'غير محدد';
      const cur = byCustomerMap.get(key) || {
        name: key,
        governorate: gov,
        orders: 0,
        totalSpent: 0,
        paid: 0,
        debt: 0,
      };
      cur.orders += 1;
      cur.totalSpent += o.totalAmount || 0;
      cur.paid += o.paidAmount || 0;
      cur.debt += o.remainingDebt || 0;
      byCustomerMap.set(key, cur);
    }
    const topCustomers = Array.from(byCustomerMap.values()).sort(
      (a, b) => b.totalSpent - a.totalSpent
    );

    const byGovMap = new Map<string, { governorate: string; orders: number; revenue: number }>();
    for (const c of topCustomers) {
      const cur = byGovMap.get(c.governorate) || {
        governorate: c.governorate,
        orders: 0,
        revenue: 0,
      };
      cur.orders += c.orders;
      cur.revenue += c.totalSpent;
      byGovMap.set(c.governorate, cur);
    }
    const byGovernorate = Array.from(byGovMap.values()).sort((a, b) => b.revenue - a.revenue);

    return {
      totalReceivables,
      unpaidOrders,
      topCustomers,
      byGovernorate,
      uniqueCustomers: topCustomers.length,
    };
  }, [state.salesOrders, state.customers, bounds]);

  // Multi-Sheet Excel Export
  const handleExportReportsExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Profitability by Model
    const profSheet = XLSX.utils.json_to_sheet(
      profitability.byModel.map((m) => ({
        'الموديل': m.name,
        'SKU': m.sku,
        'القطع المباعة': m.unitsSold,
        'صافي الإيراد': Number(m.revenue.toFixed(2)),
        'التكلفة (COGS)': Number(m.cogs.toFixed(2)),
        'صافي الربح': Number(m.profit.toFixed(2)),
        'هامش الربح %': Number(m.marginPct.toFixed(1)),
      }))
    );
    XLSX.utils.book_append_sheet(wb, profSheet, 'ربحية الموديلات');

    // Sheet 2: Fabric Stock Valuation
    const fabricSheet = XLSX.utils.json_to_sheet(
      stockReport.allFabricRows.map((f) => ({
        'القماش': f.name,
        'المورد': f.supplier,
        'الرصيد الحالي': f.qty,
        'الوحدة': f.unit,
        'حد إعادة الطلب': f.reorderLevel,
        'متوسط السعر (WAC)': Number(f.unitCost.toFixed(2)),
        'قيمة المخزون': Number(f.value.toFixed(2)),
        'الحالة': f.status === 'out' ? 'نفد' : f.status === 'low' ? 'نقص' : 'متوفر',
      }))
    );
    XLSX.utils.book_append_sheet(wb, fabricSheet, 'مخزون الأقمشة');

    // Sheet 3: Trims & Supplies Stock Valuation
    const trimSheet = XLSX.utils.json_to_sheet(
      stockReport.allTrimRows.map((t) => ({
        'الصنف': t.name,
        'القسم': t.groupLabel,
        'التصنيف': t.category,
        'المورد': t.supplier,
        'الرصيد': t.qty,
        'الوحدة': t.unit,
        'حد الطلب': t.reorderLevel,
        'تكلفة الوحدة': Number(t.unitCost.toFixed(2)),
        'قيمة المخزون': Number(t.value.toFixed(2)),
        'الحالة': t.status === 'out' ? 'نفد' : t.status === 'low' ? 'نقص' : 'متوفر',
      }))
    );
    XLSX.utils.book_append_sheet(wb, trimSheet, 'مخزون الكلف والمستلزمات');

    // Sheet 4: Finished Goods Valuation
    const fgSheet = XLSX.utils.json_to_sheet(
      stockReport.allFinishedRows.map((fg) => ({
        'الموديل': fg.modelName,
        'كود الصنف': fg.sku,
        'اللون': fg.color,
        'المقاس': fg.size,
        'الكمية المتاحة': fg.qty,
        'تكلفة القطعة': Number(fg.unitCogs.toFixed(2)),
        'سعر البيع': Number(fg.retailPrice.toFixed(2)),
        'القيمة بالتكلفة': Number(fg.costValue.toFixed(2)),
        'القيمة البيعية': Number(fg.retailValue.toFixed(2)),
        'الربح المتوقع': Number(fg.potentialProfit.toFixed(2)),
      }))
    );
    XLSX.utils.book_append_sheet(wb, fgSheet, 'مخزون المنتج التام');

    // Sheet 5: Customers & Receivables
    const custSheet = XLSX.utils.json_to_sheet(
      customersReport.topCustomers.map((c) => ({
        'العميل': c.name,
        'المحافظة': c.governorate,
        'عدد الطلبات': c.orders,
        'إجمالي المبيعات': Number(c.totalSpent.toFixed(2)),
        'المدفوع': Number(c.paid.toFixed(2)),
        'المتبقي (ذمم مدينة)': Number(c.debt.toFixed(2)),
      }))
    );
    XLSX.utils.book_append_sheet(wb, custSheet, 'العملاء والذمم');

    const dateTag = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `DressCode_Executive_Reports_${dateTag}.xlsx`);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Top Toolbar: Report Sub-tabs + Period Filter + Export/Print */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 bg-[#F3F2EE] p-1 rounded-xl">
            {(
              [
                { id: 'profitability', label: 'تقرير الربحية (P&L)', icon: TrendingUp },
                { id: 'stock', label: 'مخزون الخامات والتقييم', icon: Layers },
                { id: 'procurement', label: 'المشتريات والورش', icon: Factory },
                { id: 'customers', label: 'العملاء والذمم', icon: Users },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = reportTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setReportTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    active
                      ? 'bg-[#1A1A1E] text-white shadow-sm'
                      : 'text-[#6E6C66] hover:text-[#1A1A1E]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#BD956D]' : ''}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              onClick={handleExportReportsExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير التقارير Excel</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F3F2EE] hover:bg-[#E5E3DD] text-[#1A1A1E] text-xs font-bold cursor-pointer transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة</span>
            </button>
          </div>
        </div>

        {/* Date Filter Bar (for transactional reports) */}
        {reportTab !== 'stock' && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#F0EFEA] no-print">
            <span className="text-xs font-bold text-[#6E6C66]">الفترة الزمنية:</span>
            {(
              [
                { id: 'all', label: 'كل الفترات' },
                { id: 'this_month', label: 'هذا الشهر' },
                { id: 'last_3m', label: 'آخر 3 أشهر' },
                { id: 'this_year', label: 'هذا العام' },
                { id: 'custom', label: 'فترة مخصصة' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  period === p.id
                    ? 'bg-[#F6EFE7] text-[#8E6742] border border-[#E6D5C3]'
                    : 'bg-[#FAF9F7] text-[#6E6C66] border border-[#E5E3DD] hover:text-[#1A1A1E]'
                }`}
              >
                {p.label}
              </button>
            ))}
            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 mr-1">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-[#E5E3DD] px-2.5 py-1 text-xs"
                />
                <span className="text-xs text-[#6E6C66]">إلى</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-[#E5E3DD] px-2.5 py-1 text-xs"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===================== TAB 1: PROFITABILITY ===================== */}
      {reportTab === 'profitability' && (
        <div className="space-y-5">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">إجمالي المبيعات (صافي)</div>
              <div className="text-lg sm:text-xl font-extrabold text-[#1A1A1E] tabular-nums mt-1">
                {formatMoney(profitability.totalRevenue, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">
                {profitability.orderCount} طلب • {profitability.totalUnitsSold} قطعة
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">تكلفة البضاعة المباعة (COGS)</div>
              <div className="text-lg sm:text-xl font-extrabold text-[#4B4A46] tabular-nums mt-1">
                {formatMoney(profitability.totalCogs, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">خامات + تشغيل + غير مباشر</div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">مجمل الربح (Gross Profit)</div>
              <div className="text-lg sm:text-xl font-extrabold text-[#8E6742] tabular-nums mt-1">
                {formatMoney(profitability.grossProfit, state.currency)}
              </div>
              <div className="text-[11px] font-bold text-[#8E6742] mt-1 tabular-nums">
                هامش مجمل: {formatNumber(profitability.grossMarginPct, 1)}%
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">المصروفات التشغيلية</div>
              <div className="text-lg sm:text-xl font-extrabold text-red-700 tabular-nums mt-1">
                {formatMoney(profitability.totalOpEx, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">تشغيل + تسويق + ثابت</div>
            </div>

            <div
              className={`col-span-2 lg:col-span-1 rounded-2xl border p-4 ${
                profitability.netProfit >= 0
                  ? 'bg-[#1A1A1E] border-[#1A1A1E] text-white'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <div
                className={`text-[11px] font-semibold ${
                  profitability.netProfit >= 0 ? 'text-[#D4B896]' : 'text-red-700'
                }`}
              >
                صافي الربح الفعلي (Net P&L)
              </div>
              <div
                className={`text-lg sm:text-xl font-extrabold tabular-nums mt-1 ${
                  profitability.netProfit >= 0 ? 'text-[#BD956D]' : 'text-red-700'
                }`}
              >
                {formatMoney(profitability.netProfit, state.currency)}
              </div>
              <div
                className={`text-[11px] mt-1 tabular-nums ${
                  profitability.netProfit >= 0 ? 'text-[#B4B2AA]' : 'text-red-600'
                }`}
              >
                هامش صافي: {formatNumber(profitability.netMarginPct, 1)}%
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Monthly Revenue vs Net Profit Chart */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#A67C52]" />
                <h3 className="text-sm font-bold text-[#1A1A1E]">
                  اتجاه الإيرادات والأرباح الشهرية
                </h3>
              </div>
              {profitability.monthlyTrend.length > 0 ? (
                <div className="h-64 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profitability.monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EFECE6" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: unknown) =>
                          formatMoney(Number(value) || 0, state.currency)
                        }
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="revenue" name="الإيرادات" fill="#1A1A1E" radius={[6, 6, 0, 0]} />
                      <Bar
                        dataKey="grossProfit"
                        name="مجمل الربح"
                        fill="#A67C52"
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        dataKey="netProfit"
                        name="صافي الربح"
                        fill="#3D6B59"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-[#6E6C66]">
                  لا توجد مبيعات مسجلة في هذه الفترة لعرض الرسم البياني.
                </div>
              )}
            </div>

            {/* Channel / Platform Profitability */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#A67C52]" />
                <h3 className="text-sm font-bold text-[#1A1A1E]">
                  الربحية حسب قناة البيع (المنصة)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                    <tr>
                      <th className="py-2.5 px-3">القناة / المنصة</th>
                      <th className="py-2.5 px-3 text-center">الطلبات</th>
                      <th className="py-2.5 px-3 text-center">القطع</th>
                      <th className="py-2.5 px-3">الإيراد</th>
                      <th className="py-2.5 px-3">مجمل الربح</th>
                      <th className="py-2.5 px-3 text-center">الهامش %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {profitability.byPlatform.map((ch) => {
                      const pct = ch.revenue > 0 ? (ch.profit / ch.revenue) * 100 : 0;
                      return (
                        <tr key={ch.platform} className="hover:bg-[#FAF9F7]">
                          <td className="py-2.5 px-3 font-bold text-[#1A1A1E]">{ch.platform}</td>
                          <td className="py-2.5 px-3 text-center tabular-nums">{ch.orders}</td>
                          <td className="py-2.5 px-3 text-center tabular-nums">{ch.units}</td>
                          <td className="py-2.5 px-3 font-semibold tabular-nums">
                            {formatMoney(ch.revenue, state.currency)}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-emerald-700 tabular-nums">
                            {formatMoney(ch.profit, state.currency)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-[#8E6742] tabular-nums">
                            {formatNumber(pct, 1)}%
                          </td>
                        </tr>
                      );
                    })}
                    {profitability.byPlatform.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-[#6E6C66]">
                          لا توجد مبيعات في هذه الفترة.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Model Realized Profitability Table */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E3DD] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1A1A1E]">
                تقرير ربحية الموديلات (المبيعات المحققة vs بطاقة التكلفة)
              </h3>
              <span className="text-xs text-[#6E6C66]">{profitability.bomCatalog.length} موديل</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                  <tr>
                    <th className="py-2.5 px-4">الموديل</th>
                    <th className="py-2.5 px-3">تكلفة القطعة (BOM)</th>
                    <th className="py-2.5 px-3">سعر البيع</th>
                    <th className="py-2.5 px-3">ربح القطعة</th>
                    <th className="py-2.5 px-3 text-center">الهامش %</th>
                    <th className="py-2.5 px-3 text-center">المباع (قطعة)</th>
                    <th className="py-2.5 px-4">إجمالي الربح المحقق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EFEA]">
                  {profitability.bomCatalog
                    .slice()
                    .sort((a, b) => b.realizedProfit - a.realizedProfit || b.unitProfit - a.unitProfit)
                    .map((m) => (
                      <tr key={m.id} className="hover:bg-[#FAF9F7]">
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-[#1A1A1E]">{m.name}</div>
                          <div className="text-[10px] text-[#6E6C66] font-mono">{m.sku}</div>
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">
                          {formatMoney(m.unitCost, state.currency)}
                        </td>
                        <td className="py-2.5 px-3 font-semibold tabular-nums">
                          {formatMoney(m.retailPrice, state.currency)}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#8E6742] tabular-nums">
                          {formatMoney(m.unitProfit, state.currency)}
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              m.marginPct >= 35
                                ? 'bg-emerald-50 text-emerald-700'
                                : m.marginPct >= 20
                                  ? 'bg-[#F6EFE7] text-[#8E6742]'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {formatNumber(m.marginPct, 1)}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold tabular-nums">
                          {m.unitsSold}
                        </td>
                        <td className="py-2.5 px-4 font-extrabold text-emerald-700 tabular-nums">
                          {formatMoney(m.realizedProfit, state.currency)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 2: MATERIALS & STOCK VALUATION ===================== */}
      {reportTab === 'stock' && (
        <div className="space-y-5">
          {/* Valuation KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">قيمة مخزون الأقمشة</div>
              <div className="text-lg font-extrabold text-[#1A1A1E] tabular-nums mt-1">
                {formatMoney(stockReport.totalFabricValue, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">
                {stockReport.allFabricRows.length} صنف قماش
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">
                قيمة الكلف والمستلزمات
              </div>
              <div className="text-lg font-extrabold text-[#8E6742] tabular-nums mt-1">
                {formatMoney(stockReport.totalTrimValue, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">
                {stockReport.allTrimRows.length} صنف كلف / تصنيع / براند
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">
                المنتج التام (بالتكلفة)
              </div>
              <div className="text-lg font-extrabold text-[#1A1A1E] tabular-nums mt-1">
                {formatMoney(stockReport.totalFinishedCostValue, state.currency)}
              </div>
              <div className="text-[11px] text-emerald-700 font-semibold mt-1 tabular-nums">
                {stockReport.totalFinishedPieces} قطعة • بيعي:{' '}
                {formatMoney(stockReport.totalFinishedRetailValue, state.currency)}
              </div>
            </div>

            <div className="bg-[#1A1A1E] text-white rounded-2xl border border-[#1A1A1E] p-4">
              <div className="text-[11px] font-semibold text-[#D4B896]">إجمالي قيمة المخزون</div>
              <div className="text-lg font-extrabold text-[#BD956D] tabular-nums mt-1">
                {formatMoney(stockReport.totalInventoryCostValue, state.currency)}
              </div>
              <div className="text-[11px] text-[#B4B2AA] mt-1">رأس المال المستثمر بالمخزن</div>
            </div>

            <div className="col-span-2 lg:col-span-1 bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E6C66]">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>تنبيهات النواقص</span>
              </div>
              <div
                className={`text-lg font-extrabold tabular-nums mt-1 ${
                  stockReport.lowStockCount > 0 ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {stockReport.lowStockCount} صنف
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">تحت أو عند حد إعادة الطلب</div>
            </div>
          </div>

          {/* Stock Status Filter */}
          <div className="flex flex-wrap items-center gap-2 no-print">
            <span className="text-xs font-bold text-[#6E6C66]">تصفية حسب حالة المخزون:</span>
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'low', label: 'نواقص وحرج (تحت حد الطلب)' },
                { id: 'out', label: 'نفد المخزون (0)' },
                { id: 'ok', label: 'متوفر بشكل جيد' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStockFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  stockFilter === f.id
                    ? 'bg-[#1A1A1E] text-white'
                    : 'bg-white border border-[#E5E3DD] text-[#6E6C66] hover:text-[#1A1A1E]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Fabrics Stock Table */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E3DD] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#A67C52]" />
                <h3 className="text-sm font-bold text-[#1A1A1E]">
                  تقرير مخزون الأقمشة ({stockReport.fabricRows.length})
                </h3>
              </div>
              <span className="text-xs font-bold text-[#8E6742] tabular-nums">
                الإجمالي: {formatMoney(stockReport.fabricRows.reduce((s, r) => s + r.value, 0), state.currency)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                  <tr>
                    <th className="py-2.5 px-4">القماش</th>
                    <th className="py-2.5 px-3">المورد</th>
                    <th className="py-2.5 px-3 text-center">الرصيد الحالي</th>
                    <th className="py-2.5 px-3 text-center">حد الطلب</th>
                    <th className="py-2.5 px-3">متوسط التكلفة (WAC)</th>
                    <th className="py-2.5 px-3">قيمة المخزون</th>
                    <th className="py-2.5 px-4 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EFEA]">
                  {stockReport.fabricRows.map((f) => (
                    <tr key={f.id} className="hover:bg-[#FAF9F7]">
                      <td className="py-2.5 px-4 font-bold text-[#1A1A1E]">{f.name}</td>
                      <td className="py-2.5 px-3 text-[#6E6C66]">{f.supplier}</td>
                      <td className="py-2.5 px-3 text-center font-bold tabular-nums">
                        {formatNumber(f.qty, 1)} {f.unit}
                      </td>
                      <td className="py-2.5 px-3 text-center text-[#6E6C66] tabular-nums">
                        {f.reorderLevel}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {formatMoney(f.unitCost, state.currency)}
                      </td>
                      <td className="py-2.5 px-3 font-extrabold text-[#1A1A1E] tabular-nums">
                        {formatMoney(f.value, state.currency)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            f.status === 'out'
                              ? 'bg-red-100 text-red-700'
                              : f.status === 'low'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {f.status === 'out' ? 'نفد' : f.status === 'low' ? 'نقص' : 'متوفر'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {stockReport.fabricRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-[#6E6C66]">
                        لا توجد أصناف مطابقة للتصفية الحالية.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trims & Supplies Stock Table */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E3DD] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[#A67C52]" />
                <h3 className="text-sm font-bold text-[#1A1A1E]">
                  تقرير مخزون الكلف ومستلزمات التصنيع والبراند ({stockReport.trimRows.length})
                </h3>
              </div>
              <span className="text-xs font-bold text-[#8E6742] tabular-nums">
                الإجمالي: {formatMoney(stockReport.trimRows.reduce((s, r) => s + r.value, 0), state.currency)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                  <tr>
                    <th className="py-2.5 px-4">الصنف</th>
                    <th className="py-2.5 px-3">القسم</th>
                    <th className="py-2.5 px-3">التصنيف</th>
                    <th className="py-2.5 px-3 text-center">الرصيد</th>
                    <th className="py-2.5 px-3">تكلفة الوحدة</th>
                    <th className="py-2.5 px-3">قيمة المخزون</th>
                    <th className="py-2.5 px-4 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EFEA]">
                  {stockReport.trimRows.map((t) => (
                    <tr key={t.id} className="hover:bg-[#FAF9F7]">
                      <td className="py-2.5 px-4 font-bold text-[#1A1A1E]">{t.name}</td>
                      <td className="py-2.5 px-3 text-[#8E6742] font-semibold">{t.groupLabel}</td>
                      <td className="py-2.5 px-3 text-[#6E6C66]">{t.category}</td>
                      <td className="py-2.5 px-3 text-center font-bold tabular-nums">
                        {formatNumber(t.qty, 1)} {t.unit}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {formatMoney(t.unitCost, state.currency)}
                      </td>
                      <td className="py-2.5 px-3 font-extrabold text-[#1A1A1E] tabular-nums">
                        {formatMoney(t.value, state.currency)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            t.status === 'out'
                              ? 'bg-red-100 text-red-700'
                              : t.status === 'low'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {t.status === 'out' ? 'نفد' : t.status === 'low' ? 'نقص' : 'متوفر'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {stockReport.trimRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-[#6E6C66]">
                        لا توجد أصناف مطابقة للتصفية الحالية.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Finished Goods Valuation Table */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E5E3DD] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1A1A1E]">
                تقييم مخزون المنتج التام ({stockReport.finishedRows.length} مقاس/لون)
              </h3>
              <span className="text-xs font-bold text-emerald-700 tabular-nums">
                الربح المتوقع:{' '}
                {formatMoney(
                  stockReport.finishedRows.reduce((s, r) => s + r.potentialProfit, 0),
                  state.currency
                )}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                  <tr>
                    <th className="py-2.5 px-4">الموديل / الصنف</th>
                    <th className="py-2.5 px-3 text-center">اللون / المقاس</th>
                    <th className="py-2.5 px-3 text-center">الرصيد</th>
                    <th className="py-2.5 px-3">التكلفة</th>
                    <th className="py-2.5 px-3">سعر البيع</th>
                    <th className="py-2.5 px-3">القيمة بالتكلفة</th>
                    <th className="py-2.5 px-4">الربح المتوقع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EFEA]">
                  {stockReport.finishedRows.map((fg) => (
                    <tr key={fg.id} className="hover:bg-[#FAF9F7]">
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-[#1A1A1E]">{fg.modelName}</div>
                        <div className="text-[10px] text-[#6E6C66] font-mono">{fg.sku}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {fg.color} — {fg.size}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold tabular-nums">{fg.qty}</td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {formatMoney(fg.unitCogs, state.currency)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums">
                        {formatMoney(fg.retailPrice, state.currency)}
                      </td>
                      <td className="py-2.5 px-3 font-bold tabular-nums">
                        {formatMoney(fg.costValue, state.currency)}
                      </td>
                      <td className="py-2.5 px-4 font-extrabold text-emerald-700 tabular-nums">
                        {formatMoney(fg.potentialProfit, state.currency)}
                      </td>
                    </tr>
                  ))}
                  {stockReport.finishedRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-[#6E6C66]">
                        لا توجد أصناف منتج تام مطابقة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 3: PROCUREMENT, SUPPLIERS & WORKSHOPS ===================== */}
      {reportTab === 'procurement' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">إجمالي المشتريات المستلمة</div>
              <div className="text-lg font-extrabold text-[#1A1A1E] tabular-nums mt-1">
                {formatMoney(procurementReport.totalPurchased, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">
                {procurementReport.poCount} أمر شراء
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">مصاريف الشحن بالمشتريات</div>
              <div className="text-lg font-extrabold text-[#8E6742] tabular-nums mt-1">
                {formatMoney(procurementReport.totalShipping, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">محمّلة بالتناسب على التكلفة</div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">مستحقات الموردين</div>
              <div className="text-lg font-extrabold text-red-700 tabular-nums mt-1">
                {formatMoney(procurementReport.totalSupplierPayable, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">إجمالي أرصدة الموردين</div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">المتبقي للورش</div>
              <div className="text-lg font-extrabold text-amber-800 tabular-nums mt-1">
                {formatMoney(procurementReport.totalWorkshopRemaining, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">
                {procurementReport.totalProductionBatches} أمر تصنيع نشط
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Suppliers Table */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E5E3DD]">
                <h3 className="text-sm font-bold text-[#1A1A1E]">تحليل الموردين والمشتريات</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                    <tr>
                      <th className="py-2.5 px-4">المورد</th>
                      <th className="py-2.5 px-3 text-center">الأوامر</th>
                      <th className="py-2.5 px-3">المشتريات</th>
                      <th className="py-2.5 px-4">الرصيد المستحق</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {procurementReport.supplierSummary.map((s) => (
                      <tr key={s.name} className="hover:bg-[#FAF9F7]">
                        <td className="py-2.5 px-4 font-bold text-[#1A1A1E]">{s.name}</td>
                        <td className="py-2.5 px-3 text-center tabular-nums">{s.poCount}</td>
                        <td className="py-2.5 px-3 font-semibold tabular-nums">
                          {formatMoney(s.totalSpent, state.currency)}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-red-700 tabular-nums">
                          {formatMoney(s.balancePayable, state.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Workshops Table */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E5E3DD]">
                <h3 className="text-sm font-bold text-[#1A1A1E]">أداء وحسابات الورش</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                    <tr>
                      <th className="py-2.5 px-4">الورشة</th>
                      <th className="py-2.5 px-2 text-center">تشغيلات</th>
                      <th className="py-2.5 px-2 text-center">قطع (تم/مخطط)</th>
                      <th className="py-2.5 px-3">إجمالي الأجور</th>
                      <th className="py-2.5 px-3">المدفوع</th>
                      <th className="py-2.5 px-4">المتبقي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {procurementReport.workshopSummary.map((w) => (
                      <tr key={w.name} className="hover:bg-[#FAF9F7]">
                        <td className="py-2.5 px-4 font-bold text-[#1A1A1E]">{w.name}</td>
                        <td className="py-2.5 px-2 text-center tabular-nums">{w.batches}</td>
                        <td className="py-2.5 px-2 text-center tabular-nums">
                          {w.completedQty}/{w.plannedQty}
                        </td>
                        <td className="py-2.5 px-3 font-semibold tabular-nums">
                          {formatMoney(w.agreedLabor, state.currency)}
                        </td>
                        <td className="py-2.5 px-3 text-emerald-700 tabular-nums">
                          {formatMoney(w.paid, state.currency)}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-amber-800 tabular-nums">
                          {formatMoney(w.remaining, state.currency)}
                        </td>
                      </tr>
                    ))}
                    {procurementReport.workshopSummary.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-[#6E6C66]">
                          لا توجد أوامر تصنيع في هذه الفترة.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: CUSTOMERS & RECEIVABLES ===================== */}
      {reportTab === 'customers' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">إجمالي الذمم المدينة (لدى العملاء)</div>
              <div className="text-xl font-extrabold text-red-700 tabular-nums mt-1">
                {formatMoney(customersReport.totalReceivables, state.currency)}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">
                {customersReport.unpaidOrders.length} طلب غير مسدد بالكامل
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">العملاء النشطون بالفترة</div>
              <div className="text-xl font-extrabold text-[#1A1A1E] tabular-nums mt-1">
                {customersReport.uniqueCustomers} عميل
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1">
                من إجمالي {state.customers.length} عميل مسجل
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-[11px] font-semibold text-[#6E6C66]">أعلى محافظة مبيعاً</div>
              <div className="text-xl font-extrabold text-[#8E6742] mt-1">
                {customersReport.byGovernorate[0]?.governorate || '—'}
              </div>
              <div className="text-[11px] text-[#6E6C66] mt-1 tabular-nums">
                {customersReport.byGovernorate[0]
                  ? formatMoney(customersReport.byGovernorate[0].revenue, state.currency)
                  : 'لا توجد بيانات'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Top Customers */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E5E3DD]">
                <h3 className="text-sm font-bold text-[#1A1A1E]">أفضل العملاء مبيعاً</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                    <tr>
                      <th className="py-2.5 px-4">العميل</th>
                      <th className="py-2.5 px-3 text-center">الطلبات</th>
                      <th className="py-2.5 px-3">إجمالي المبيعات</th>
                      <th className="py-2.5 px-4">المتبقي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {customersReport.topCustomers.slice(0, 20).map((c) => (
                      <tr key={c.name} className="hover:bg-[#FAF9F7]">
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-[#1A1A1E]">{c.name}</div>
                          <div className="text-[10px] text-[#6E6C66]">{c.governorate}</div>
                        </td>
                        <td className="py-2.5 px-3 text-center tabular-nums">{c.orders}</td>
                        <td className="py-2.5 px-3 font-bold tabular-nums">
                          {formatMoney(c.totalSpent, state.currency)}
                        </td>
                        <td
                          className={`py-2.5 px-4 font-bold tabular-nums ${
                            c.debt > 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatMoney(c.debt, state.currency)}
                        </td>
                      </tr>
                    ))}
                    {customersReport.topCustomers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-[#6E6C66]">
                          لا توجد مبيعات في هذه الفترة.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Unpaid Orders / Receivables */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E5E3DD]">
                <h3 className="text-sm font-bold text-[#1A1A1E]">
                  الطلبات غير المسددة بالكامل ({customersReport.unpaidOrders.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                    <tr>
                      <th className="py-2.5 px-4">رقم الطلب / العميل</th>
                      <th className="py-2.5 px-3">الإجمالي</th>
                      <th className="py-2.5 px-3">المدفوع</th>
                      <th className="py-2.5 px-4">المتبقي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {customersReport.unpaidOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#FAF9F7]">
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-[#1A1A1E]">{o.customerName}</div>
                          <div className="text-[10px] text-[#6E6C66] font-mono">
                            {o.orderNumber} • {o.orderDate}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">
                          {formatMoney(o.totalAmount, state.currency)}
                        </td>
                        <td className="py-2.5 px-3 text-emerald-700 tabular-nums">
                          {formatMoney(o.paidAmount, state.currency)}
                        </td>
                        <td className="py-2.5 px-4 font-extrabold text-red-700 tabular-nums">
                          {formatMoney(o.remainingDebt, state.currency)}
                        </td>
                      </tr>
                    ))}
                    {customersReport.unpaidOrders.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-emerald-700 font-semibold">
                          ممتاز! جميع طلبات هذه الفترة مسددة بالكامل.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
