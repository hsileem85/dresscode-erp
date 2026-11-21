import React, { useMemo, useState } from 'react';
import {
  ArrowUpLeft,
  Calculator,
  Layers,
  Package,
  Percent,
  Scissors,
  TrendingUp,
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

export const DashboardView: React.FC = () => {
  const { state, openModelInBOM, openModelInCalculator, setActiveTab } = useERP();
  const [pieScope, setPieScope] = useState<string>('all');

  const modelSummaries = useMemo(() => {
    return state.models.map((model) => ({
      model,
      cost: calculateModelCost(model, state.fabrics, state.trims, state.overhead),
    }));
  }, [state]);

  const kpis = useMemo(() => {
    const count = modelSummaries.length;
    const avgCost =
      count > 0
        ? modelSummaries.reduce((s, m) => s + m.cost.totalUnitCost, 0) / count
        : 0;
    const avgRetail =
      count > 0
        ? modelSummaries.reduce((s, m) => s + m.cost.suggestedRetailPrice, 0) / count
        : 0;
    const avgMarginOnPrice =
      count > 0
        ? modelSummaries.reduce((s, m) => s + m.cost.effectiveMarginOnPricePct, 0) / count
        : 0;
    const overheadPerPiece = getOverheadPerPiece(state.overhead);

    return {
      modelCount: count,
      materialsCount: state.fabrics.length + state.trims.length,
      avgCost,
      avgRetail,
      avgMarginOnPrice,
      overheadPerPiece,
    };
  }, [modelSummaries, state.fabrics.length, state.trims.length, state.overhead]);

  const pieData = useMemo(() => {
    if (modelSummaries.length === 0) return [];

    if (pieScope === 'all') {
      const n = modelSummaries.length;
      const avgFab = modelSummaries.reduce((s, m) => s + m.cost.fabricCost, 0) / n;
      const avgTrim = modelSummaries.reduce((s, m) => s + m.cost.trimCost, 0) / n;
      const avgLabor =
        modelSummaries.reduce((s, m) => s + m.cost.directLaborCost, 0) / n;
      const avgOver =
        modelSummaries.reduce((s, m) => s + m.cost.indirectOverheadCost, 0) / n;

      return [
        { name: 'الأقمشة (بالهالك)', value: Number(avgFab.toFixed(2)) },
        { name: 'التشغيل الخارجي', value: Number(avgLabor.toFixed(2)) },
        { name: 'المصاريف غير المباشرة', value: Number(avgOver.toFixed(2)) },
        { name: 'الكلف والإكسسوارات', value: Number(avgTrim.toFixed(2)) },
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
  }, [modelSummaries, pieScope]);

  const barData = useMemo(() => {
    return modelSummaries.map(({ model, cost }) => ({
      name: model.name.length > 18 ? `${model.name.slice(0, 18)}…` : model.name,
      التكلفة: Number(cost.totalUnitCost.toFixed(2)),
      'سعر البيع': Number(cost.suggestedRetailPrice.toFixed(2)),
      الربح: Number(cost.profitPerPiece.toFixed(2)),
    }));
  }, [modelSummaries]);

  const pieTotal = pieData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">إجمالي الموديلات</span>
            <span className="w-9 h-9 rounded-xl bg-[#F6EFE7] text-[#A67C52] flex items-center justify-center">
              <Scissors className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums">
              {kpis.modelCount} موديل
            </div>
            <p className="text-xs text-[#6E6C66] mt-1">
              {state.fabrics.length} قماش • {state.trims.length} كلفة وإكسسوار
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">متوسط تكلفة القطعة</span>
            <span className="w-9 h-9 rounded-xl bg-[#F3F2EE] text-[#1A1A1E] flex items-center justify-center">
              <Package className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums">
              {formatMoney(kpis.avgCost, state.currency)}
            </div>
            <p className="text-xs text-[#6E6C66] mt-1">
              نصيب المصاريف غير المباشرة: {formatMoney(kpis.overheadPerPiece, state.currency)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">متوسط سعر البيع المقترح</span>
            <span className="w-9 h-9 rounded-xl bg-[#F6EFE7] text-[#8E6742] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold text-[#8E6742] tabular-nums">
              {formatMoney(kpis.avgRetail, state.currency)}
            </div>
            <p className="text-xs text-[#6E6C66] mt-1">
              متوسط الربح: {formatMoney(kpis.avgRetail - kpis.avgCost, state.currency)} / قطعة
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6E6C66]">متوسط هامش الربح الفعلي</span>
            <span className="w-9 h-9 rounded-xl bg-[#1A1A1E] text-[#BD956D] flex items-center justify-center">
              <Percent className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums">
              {formatNumber(kpis.avgMarginOnPrice, 1)}%
            </div>
            <p className="text-xs text-[#6E6C66] mt-1">
              على أساس حجم إنتاج {state.overhead.estimatedMonthlyVolume} قطعة / شهر
            </p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Cost Breakdown Pie Chart */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-[#1A1A1E]">
                توزيع هيكل التكلفة
              </h2>
              <p className="text-xs text-[#6E6C66]">
                نسبة الخامات والتشغيل والمصاريف غير المباشرة
              </p>
            </div>
            <select
              value={pieScope}
              onChange={(e) => setPieScope(e.target.value)}
              aria-label="اختيار الموديل للرسم البياني"
              className="rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2.5 py-1.5 text-xs text-[#1A1A1E] focus:outline-none focus:border-[#A67C52] max-w-[165px]"
            >
              <option value="all">متوسط كل الموديلات</option>
              {state.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={PIE_COLORS[idx % PIE_COLORS.length]}
                      stroke="none"
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown) =>
                    formatMoney(Number(value) || 0, state.currency)
                  }
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #E5E3DD',
                    fontFamily: 'Cairo, sans-serif',
                    fontSize: '12px',
                    direction: 'rtl',
                  }}
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
                    <div className="text-[#1A1A1E] font-medium truncate">
                      {entry.name}
                    </div>
                    <div className="text-[#6E6C66] tabular-nums">
                      {formatNumber(pct, 1)}% ({formatMoney(entry.value, state.currency)})
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bar Chart: Cost vs Retail Price */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-[#1A1A1E]">
                مقارنة التكلفة بسعر البيع المقترح
              </h2>
              <p className="text-xs text-[#6E6C66]">
                إجمالي تكلفة القطعة مقابل سعر البيع المستهدف على المتجر
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('calculator')}
              className="text-xs font-semibold text-[#A67C52] hover:text-[#7B5836] inline-flex items-center gap-1 cursor-pointer"
            >
              <span>حاسبة التسعير</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#EEEDE8" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#6E6C66', fontSize: 11 }}
                  axisLine={{ stroke: '#E5E3DD' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#6E6C66', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: unknown) =>
                    formatMoney(Number(value) || 0, state.currency)
                  }
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #E5E3DD',
                    fontFamily: 'Cairo, sans-serif',
                    fontSize: '12px',
                    direction: 'rtl',
                  }}
                />
                <Bar dataKey="التكلفة" fill="#1A1A1E" radius={[6, 6, 0, 0]} maxBarSize={36} />
                <Bar dataKey="سعر البيع" fill="#A67C52" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Models Cost Summary Table */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E3DD] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1E]">
              ملخص تكاليف موديلات DressCode
            </h2>
            <p className="text-xs text-[#6E6C66]">
              تفصيل سريع للخامات والتشغيل والمصاريف وسعر البيع المقترح
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('materials')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1A1A1E] bg-[#F3F2EE] hover:bg-[#E5E3DD] px-3 py-2 rounded-xl transition-colors cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-[#A67C52]" />
              إدارة الخامات
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('models')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#A67C52] hover:bg-[#8E6742] px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5" />
              تعديل الموديلات
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3.5 px-4 font-semibold">الموديل / الكود</th>
                <th className="py-3.5 px-4 font-semibold">الخامات والكلف</th>
                <th className="py-3.5 px-4 font-semibold">التشغيل الخارجي</th>
                <th className="py-3.5 px-4 font-semibold">غير المباشرة</th>
                <th className="py-3.5 px-4 font-semibold">إجمالي التكلفة</th>
                <th className="py-3.5 px-4 font-semibold">سعر البيع المقترح</th>
                <th className="py-3.5 px-4 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {modelSummaries.map(({ model, cost }) => (
                <tr
                  key={model.id}
                  className="hover:bg-[#FAF9F7]/80 transition-colors"
                >
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-[#1A1A1E]">{model.name}</div>
                    <div className="text-xs text-[#6E6C66] flex items-center gap-2 mt-0.5">
                      <span className="font-mono">{model.sku}</span>
                      <span>•</span>
                      <span>{model.category}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 tabular-nums text-[#1A1A1E]">
                    {formatMoney(cost.directMaterialCost, state.currency)}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums text-[#1A1A1E]">
                    {formatMoney(cost.directLaborCost, state.currency)}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums text-[#6E6C66]">
                    {formatMoney(cost.indirectOverheadCost, state.currency)}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums font-bold text-[#1A1A1E]">
                    {formatMoney(cost.totalUnitCost, state.currency)}
                  </td>
                  <td className="py-3.5 px-4 tabular-nums">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-[#F6EFE7] text-[#8E6742] font-bold">
                      {formatMoney(cost.suggestedRetailPrice, state.currency)}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openModelInBOM(model.id)}
                        className="text-xs font-medium text-[#1A1A1E] hover:text-[#A67C52] px-2.5 py-1 rounded-lg border border-[#E5E3DD] hover:border-[#A67C52] transition-colors cursor-pointer"
                      >
                        بطاقة BOM
                      </button>
                      <button
                        type="button"
                        onClick={() => openModelInCalculator(model.id)}
                        className="p-1.5 rounded-lg text-[#A67C52] hover:bg-[#F6EFE7] transition-colors cursor-pointer"
                        title="فتح في حاسبة التسعير"
                      >
                        <Calculator className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {modelSummaries.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#6E6C66] text-sm">
                    لا توجد موديلات مسجلة حالياً. ابدأ بإضافة موديل جديد من قسم الموديلات.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
