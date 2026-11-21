import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpLeft,
  Calculator,
  Crown,
  Layers,
  Package,
  Percent,
  Scissors,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import {
  calculateModelCost,
  formatMoney,
  formatNumber,
  getOverheadPerPiece,
} from '../../utils/calculations';

const PIE_COLORS = ['#1A1A1E', '#A67C52', '#8E8B82', '#D4B896'];

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيه',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export const DashboardView: React.FC = () => {
  const { state, openModelInBOM, openModelInCalculator, setActiveTab } = useERP();
  const [pieScope, setPieScope] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all'); // 'all' or '01'..'12'

  const modelSummaries = useMemo(() => {
    return state.models.map((model) => ({
      model,
      cost: calculateModelCost(model, state.fabrics, state.trims, state.overhead),
    }));
  }, [state]);

  // P&L & Cashbox Analytics matching الارباح والخسائر + dashboard sheets
  const pnl = useMemo(() => {
    const orders = state.salesOrders.filter((o) => {
      if (o.status === 'cancelled') return false;
      if (selectedMonth === 'all') return true;
      return o.orderDate?.slice(5, 7) === selectedMonth;
    });

    const expenses = state.expenses.filter((e) => {
      if (selectedMonth === 'all') return true;
      return e.expenseDate?.slice(5, 7) === selectedMonth;
    });

    const totalSales = orders.reduce((s, o) => s + (o.subtotal - o.discountAmount), 0);
    const totalCollected = orders.reduce((s, o) => s + o.paidAmount, 0);
    const totalDebts = orders.reduce((s, o) => s + o.remainingDebt, 0);
    const ordersCount = orders.length;
    const avgOrderValue = ordersCount > 0 ? totalSales / ordersCount : 0;
    const totalCogs = orders.reduce((s, o) => s + o.totalCogs, 0);
    const grossProfit = totalSales - totalCogs;
    const grossMarginPct = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;

    // Separate Operating Expenses (no COGS double-counting!)
    const opExList = expenses.filter((e) => !e.isRawMaterialPurchase);
    const fixedExp = opExList
      .filter((e) => e.category === 'ثابت')
      .reduce((s, e) => s + e.amount, 0);
    const variableExp = opExList
      .filter((e) => e.category === 'متغير')
      .reduce((s, e) => s + e.amount, 0);
    const marketingExp = opExList
      .filter((e) => e.category === 'تسويق')
      .reduce((s, e) => s + e.amount, 0);
    const totalOperatingExp = opExList.reduce((s, e) => s + e.amount, 0);
    const netProfit = grossProfit - totalOperatingExp;
    const netMarginPct = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
    const breakEvenSales =
      grossMarginPct > 0 ? (totalOperatingExp / (grossMarginPct / 100)) : 0;

    const totalPartnerCapital = state.partnerContributions.reduce((s, p) => s + p.amount, 0);
    const allCollections = state.salesOrders
      .filter((o) => o.status !== 'cancelled')
      .reduce((s, o) => s + o.paidAmount, 0);
    const allCashOut = state.expenses.reduce((s, e) => s + e.amount, 0);
    const availableCash = totalPartnerCapital + allCollections - allCashOut;

    return {
      totalSales,
      totalCollected,
      totalDebts,
      ordersCount,
      avgOrderValue,
      totalCogs,
      grossProfit,
      grossMarginPct,
      fixedExp,
      variableExp,
      marketingExp,
      totalOperatingExp,
      netProfit,
      netMarginPct,
      breakEvenSales,
      availableCash,
    };
  }, [state.salesOrders, state.expenses, state.partnerContributions, selectedMonth]);

  // 12-Month Breakdown Table (يناير -> ديسمبر)
  const monthlyRows = useMemo(() => {
    return MONTHS_AR.map((label, idx) => {
      const mm = String(idx + 1).padStart(2, '0');
      const orders = state.salesOrders.filter(
        (o) => o.status !== 'cancelled' && o.orderDate?.slice(5, 7) === mm
      );
      const opEx = state.expenses
        .filter((e) => !e.isRawMaterialPurchase && e.expenseDate?.slice(5, 7) === mm)
        .reduce((s, e) => s + e.amount, 0);
      const sales = orders.reduce((s, o) => s + (o.subtotal - o.discountAmount), 0);
      const cogs = orders.reduce((s, o) => s + o.totalCogs, 0);
      const gross = sales - cogs;
      const net = gross - opEx;
      const marginPct = sales > 0 ? (gross / sales) * 100 : 0;
      return {
        mm,
        label,
        sales,
        cogs,
        gross,
        opEx,
        net,
        marginPct,
        ordersCount: orders.length,
      };
    });
  }, [state.salesOrders, state.expenses]);

  // Top Customers
  const topCustomers = useMemo(() => {
    const map = new Map<string, { name: string; spent: number; orders: number }>();
    state.salesOrders
      .filter((o) => o.status !== 'cancelled')
      .forEach((o) => {
        const key = o.customerName.trim();
        const prev = map.get(key) || { name: key, spent: 0, orders: 0 };
        prev.spent += o.totalAmount;
        prev.orders += 1;
        map.set(key, prev);
      });
    return Array.from(map.values())
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 6);
  }, [state.salesOrders]);

  // Low/Out-of-Stock Alerts
  const stockAlerts = useMemo(() => {
    const items: { sku: string; name: string; qty: number; type: string }[] = [];
    state.models.forEach((m) => {
      m.variants.forEach((v) => {
        if (v.finishedGoodsQty <= v.reorderLevel) {
          items.push({
            sku: v.variantSku,
            name: `${m.name} (${v.size})`,
            qty: v.finishedGoodsQty,
            type: 'منتج تام',
          });
        }
      });
    });
    state.fabrics.forEach((f) => {
      if (f.stockQty <= f.reorderLevel) {
        items.push({
          sku: f.colorOrCode || 'FAB',
          name: f.name,
          qty: f.stockQty,
          type: 'قماش',
        });
      }
    });
    return items;
  }, [state.models, state.fabrics]);

  const pieData = useMemo(() => {
    if (modelSummaries.length === 0) return [];
    if (pieScope === 'all') {
      const n = modelSummaries.length;
      return [
        {
          name: 'الأقمشة (بالهالك)',
          value: Number(
            (modelSummaries.reduce((s, m) => s + m.cost.fabricCost, 0) / n).toFixed(2)
          ),
        },
        {
          name: 'التشغيل الخارجي',
          value: Number(
            (modelSummaries.reduce((s, m) => s + m.cost.directLaborCost, 0) / n).toFixed(2)
          ),
        },
        {
          name: 'المصاريف غير المباشرة',
          value: Number(getOverheadPerPiece(state.overhead).toFixed(2)),
        },
        {
          name: 'الكلف والإكسسوارات',
          value: Number(
            (modelSummaries.reduce((s, m) => s + m.cost.trimCost, 0) / n).toFixed(2)
          ),
        },
      ].filter((d) => d.value > 0);
    }
    const found = modelSummaries.find((m) => m.model.id === pieScope);
    if (!found) return [];
    return [
      { name: 'الأقمشة (بالهالك)', value: Number(found.cost.fabricCost.toFixed(2)) },
      { name: 'التشغيل الخارجي', value: Number(found.cost.directLaborCost.toFixed(2)) },
      {
        name: 'المصاريف غير المباشرة',
        value: Number(found.cost.indirectOverheadCost.toFixed(2)),
      },
      { name: 'الكلف والإكسسوارات', value: Number(found.cost.trimCost.toFixed(2)) },
    ].filter((d) => d.value > 0);
  }, [modelSummaries, pieScope, state.overhead]);

  const barData = useMemo(() => {
    return modelSummaries.slice(0, 8).map(({ model, cost }) => ({
      name: model.name.length > 16 ? `${model.name.slice(0, 16)}…` : model.name,
      التكلفة: Number(cost.totalUnitCost.toFixed(2)),
      'سعر البيع': Number(
        (model.actualRetailPrice && model.actualRetailPrice > 0
          ? model.actualRetailPrice
          : cost.suggestedRetailPrice
        ).toFixed(2)
      ),
    }));
  }, [modelSummaries]);

  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-6">
      {/* Month Filter Bar */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[#1A1A1E]">
            تقرير الأرباح والخسائر واللوحة التنفيذية (P&L)
          </h2>
          <p className="text-xs text-[#6E6C66]">
            حساب تلقائي للمبيعات، التحصيل، الديون، تكلفة البضاعة، المصروفات التشغيلية، ونقطة التعادل
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-[#6E6C66]">الشهر المعروض:</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] px-3 py-1.5 text-xs font-bold text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
          >
            <option value="all">إجمالي السنة (كل الشهور)</option>
            {MONTHS_AR.map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, '0')}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Executive P&L KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">إجمالي المبيعات</span>
            <span className="w-9 h-9 rounded-xl bg-[#F6EFE7] text-[#A67C52] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums mt-3">
            {formatMoney(pnl.totalSales, state.currency)}
          </div>
          <p className="text-xs text-[#6E6C66] mt-1">
            {pnl.ordersCount} طلب • متوسط الطلب {formatMoney(pnl.avgOrderValue, state.currency)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">مجمل الربح / صافي الربح</span>
            <span className="w-9 h-9 rounded-xl bg-[#1A1A1E] text-[#BD956D] flex items-center justify-center">
              <Percent className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums mt-3">
            {formatMoney(pnl.netProfit, state.currency)}
          </div>
          <p className="text-xs text-[#6E6C66] mt-1">
            مجمل الربح {formatMoney(pnl.grossProfit, state.currency)} ({formatNumber(pnl.grossMarginPct, 1)}%)
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">
              المصروفات التشغيلية ونقطة التعادل
            </span>
            <span className="w-9 h-9 rounded-xl bg-[#F3F2EE] text-[#1A1A1E] flex items-center justify-center">
              <Package className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums mt-3">
            {formatMoney(pnl.totalOperatingExp, state.currency)}
          </div>
          <p className="text-xs text-[#6E6C66] mt-1">
            نقطة التعادل: {formatMoney(pnl.breakEvenSales, state.currency)}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">المتاح بالخزنة / الديون</span>
            <span className="w-9 h-9 rounded-xl bg-[#F6EFE7] text-[#8E6742] flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl font-bold text-[#8E6742] tabular-nums mt-3">
            {formatMoney(pnl.availableCash, state.currency)}
          </div>
          <p className="text-xs text-[#6E6C66] mt-1">
            ديون العملاء المستحقة:{' '}
            <span className={pnl.totalDebts > 0 ? 'text-red-600 font-bold' : ''}>
              {formatMoney(pnl.totalDebts, state.currency)}
            </span>
          </p>
        </div>
      </div>

      {/* 12-Month Detailed P&L Table */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E3DD] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#1A1A1E]">
              الملخص الشهري التلقائي للأرباح والخسائر (يناير — ديسمبر)
            </h2>
            <p className="text-xs text-[#6E6C66]">
              المصروفات التشغيلية مفصولة عن مشتريات الخامات لتجنب ازدواج التكلفة
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('expenses')}
            className="text-xs font-bold text-[#A67C52] hover:text-[#7B5836] cursor-pointer"
          >
            إدارة المصروفات والخزنة ←
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
              <tr>
                <th className="py-2.5 px-3.5">الشهر</th>
                <th className="py-2.5 px-3.5">عدد الطلبات</th>
                <th className="py-2.5 px-3.5">المبيعات</th>
                <th className="py-2.5 px-3.5">تكلفة البضاعة (COGS)</th>
                <th className="py-2.5 px-3.5">إجمالي الربح</th>
                <th className="py-2.5 px-3.5">المصروفات التشغيلية</th>
                <th className="py-2.5 px-3.5">صافي الربح</th>
                <th className="py-2.5 px-3.5">الهامش %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {monthlyRows
                .filter((r) => r.sales > 0 || r.opEx > 0)
                .map((r) => (
                  <tr key={r.mm} className="hover:bg-[#FAF9F7]">
                    <td className="py-2.5 px-3.5 font-bold">{r.label}</td>
                    <td className="py-2.5 px-3.5 tabular-nums">{r.ordersCount}</td>
                    <td className="py-2.5 px-3.5 tabular-nums font-semibold">
                      {formatMoney(r.sales, state.currency)}
                    </td>
                    <td className="py-2.5 px-3.5 tabular-nums text-[#6E6C66]">
                      {formatMoney(r.cogs, state.currency)}
                    </td>
                    <td className="py-2.5 px-3.5 tabular-nums font-semibold text-[#8E6742]">
                      {formatMoney(r.gross, state.currency)}
                    </td>
                    <td className="py-2.5 px-3.5 tabular-nums text-[#6E6C66]">
                      {formatMoney(r.opEx, state.currency)}
                    </td>
                    <td
                      className={`py-2.5 px-3.5 tabular-nums font-bold ${
                        r.net >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {formatMoney(r.net, state.currency)}
                    </td>
                    <td className="py-2.5 px-3.5 tabular-nums">
                      {formatNumber(r.marginPct, 1)}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-[#1A1A1E]">توزيع هيكل التكلفة</h2>
              <p className="text-xs text-[#6E6C66]">نسبة الخامات والتشغيل والمصاريف</p>
            </div>
            <select
              value={pieScope}
              onChange={(e) => setPieScope(e.target.value)}
              className="rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2.5 py-1.5 text-xs max-w-[165px]"
            >
              <option value="all">متوسط كل الموديلات</option>
              {state.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={54}
                  outerRadius={88}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown) =>
                    formatMoney(Number(value) || 0, state.currency)
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mt-3 pt-3 border-t border-[#F3F2EE]">
            {pieData.map((entry, idx) => {
              const pct = pieTotal > 0 ? (entry.value / pieTotal) * 100 : 0;
              return (
                <div key={entry.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                  />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{entry.name}</div>
                    <div className="text-[#6E6C66] tabular-nums">
                      {formatNumber(pct, 1)}% ({formatMoney(entry.value, state.currency)})
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-[#1A1A1E]">
                مقارنة التكلفة بسعر البيع
              </h2>
              <p className="text-xs text-[#6E6C66]">
                أحدث الموديلات في DressCode
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('calculator')}
              className="text-xs font-semibold text-[#A67C52] inline-flex items-center gap-1 cursor-pointer"
            >
              <span>حاسبة التسعير</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEEDE8" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#6E6C66', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6E6C66', fontSize: 11 }} />
                <Tooltip
                  formatter={(value: unknown) =>
                    formatMoney(Number(value) || 0, state.currency)
                  }
                />
                <Bar dataKey="التكلفة" fill="#1A1A1E" radius={[6, 6, 0, 0]} maxBarSize={32} />
                <Bar dataKey="سعر البيع" fill="#A67C52" radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Customers + Low Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-[#A67C52]" />
              <h2 className="text-sm font-bold text-[#1A1A1E]">أفضل العملاء حسب المشتريات</h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('customers')}
              className="text-xs font-semibold text-[#A67C52] cursor-pointer"
            >
              كل العملاء ←
            </button>
          </div>
          <div className="divide-y divide-[#F0EFEA]">
            {topCustomers.map((c) => (
              <div key={c.name} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-[#1A1A1E]">{c.name}</span>
                  <span className="text-[#6E6C66] mr-2">({c.orders} طلب)</span>
                </div>
                <span className="font-extrabold text-[#8E6742] tabular-nums">
                  {formatMoney(c.spent, state.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h2 className="text-sm font-bold text-[#1A1A1E]">
                تنبيهات المخزون ({stockAlerts.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('production')}
              className="text-xs font-semibold text-[#A67C52] cursor-pointer"
            >
              إدارة المخزون ←
            </button>
          </div>
          <div className="divide-y divide-[#F0EFEA] max-h-56 overflow-y-auto">
            {stockAlerts.slice(0, 10).map((item, idx) => (
              <div key={idx} className="py-2 flex items-center justify-between text-xs">
                <div className="truncate max-w-[70%]">
                  <span className="font-semibold text-[#1A1A1E]">{item.name}</span>
                  <span className="text-[#6E6C66] mr-1.5 font-mono">[{item.sku}]</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full font-bold tabular-nums ${
                    item.qty <= 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {item.qty <= 0 ? 'نفذ المخزون' : `متبقي ${item.qty}`}
                </span>
              </div>
            ))}
            {stockAlerts.length === 0 && (
              <p className="text-xs text-emerald-700 py-4 text-center">
                كافة الأصناف فوق حد إعادة الطلب ✓
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Models Quick Summary */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E3DD] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1E]">
              ملخص تكاليف موديلات DressCode ({state.models.length} موديل)
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('materials')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#F3F2EE] px-3 py-2 rounded-xl cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-[#A67C52]" />
              الخامات
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('models')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#A67C52] px-3.5 py-2 rounded-xl cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5" />
              الموديلات
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">الموديل / الكود</th>
                <th className="py-3 px-4">التكلفة المباشرة</th>
                <th className="py-3 px-4">الإجمالية (بالغير مباشرة)</th>
                <th className="py-3 px-4">السعر المقترح</th>
                <th className="py-3 px-4">السعر الفعلي</th>
                <th className="py-3 px-4">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {modelSummaries.slice(0, 12).map(({ model, cost }) => (
                <tr key={model.id} className="hover:bg-[#FAF9F7]/80">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#1A1A1E]">{model.name}</div>
                    <div className="text-xs text-[#6E6C66]">
                      <span className="font-mono">{model.sku}</span> • {model.category}
                    </div>
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    {formatMoney(cost.directMaterialCost + cost.directLaborCost, state.currency)}
                  </td>
                  <td className="py-3 px-4 tabular-nums font-bold">
                    {formatMoney(cost.totalUnitCost, state.currency)}
                  </td>
                  <td className="py-3 px-4 tabular-nums text-[#6E6C66]">
                    {formatMoney(cost.suggestedRetailPrice, state.currency)}
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    <span className="inline-flex px-2.5 py-0.5 rounded-lg bg-[#F6EFE7] text-[#8E6742] font-bold">
                      {formatMoney(
                        model.actualRetailPrice && model.actualRetailPrice > 0
                          ? model.actualRetailPrice
                          : cost.suggestedRetailPrice,
                        state.currency
                      )}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openModelInBOM(model.id)}
                        className="text-xs border border-[#E5E3DD] px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        BOM
                      </button>
                      <button
                        type="button"
                        onClick={() => openModelInCalculator(model.id)}
                        className="p-1 text-[#A67C52] hover:bg-[#F6EFE7] rounded-lg cursor-pointer"
                      >
                        <Calculator className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
