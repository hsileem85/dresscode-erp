import React, { useMemo, useState } from 'react';
import {
  Building,
  Plus,
  Printer,
  Sliders,
  Trash2,
} from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useERP } from '../../context/ERPContext';
import { newUuid } from '../../lib/supabase';
import type { OverheadItem } from '../../types/erp';
import {
  calculateModelCost,
  formatMoney,
  formatNumber,
  getOverheadPerPiece,
  getTotalMonthlyOverhead,
  OVERHEAD_CATEGORY_LABELS,
} from '../../utils/calculations';

const CHART_COLORS = ['#1A1A1E', '#A67C52', '#8E8B82', '#D4B896', '#3D6B59'];

export const CostCalculatorView: React.FC = () => {
  const {
    state,
    selectedModelId,
    setSelectedModelId,
    setMonthlyVolume,
    saveOverheadItem,
    deleteOverheadItem,
    saveModel,
  } = useERP();

  const activeModel = useMemo(
    () => state.models.find((m) => m.id === selectedModelId) || state.models[0] || null,
    [state.models, selectedModelId]
  );

  const [pricingMode, setPricingMode] = useState<'markup' | 'margin'>('markup');
  const [simulatedPct, setSimulatedPct] = useState<number>(
    activeModel?.targetMarginPct ?? 65
  );
  const [newOverheadName, setNewOverheadName] = useState('');
  const [newOverheadCategory, setNewOverheadCategory] =
    useState<OverheadItem['category']>('other');
  const [newOverheadAmount, setNewOverheadAmount] = useState<number>(0);

  const handleModelChange = (id: string) => {
    setSelectedModelId(id);
    const m = state.models.find((x) => x.id === id);
    if (m) setSimulatedPct(m.targetMarginPct);
  };

  const totalMonthlyOverhead = getTotalMonthlyOverhead(state.overhead);
  const overheadPerPiece = getOverheadPerPiece(state.overhead);

  const breakdown = useMemo(() => {
    if (!activeModel) return null;
    return calculateModelCost(
      activeModel,
      state.fabrics,
      state.trims,
      state.overhead,
      simulatedPct,
      pricingMode
    );
  }, [activeModel, state.fabrics, state.trims, state.overhead, simulatedPct, pricingMode]);

  const pieData = useMemo(() => {
    if (!breakdown) return [];
    return [
      { name: 'الأقمشة بالهالك', value: Number(breakdown.fabricCost.toFixed(2)) },
      { name: 'التشغيل الخارجي', value: Number(breakdown.directLaborCost.toFixed(2)) },
      {
        name: 'المصاريف غير المباشرة',
        value: Number(breakdown.indirectOverheadCost.toFixed(2)),
      },
      { name: 'الكلف والإكسسوارات', value: Number(breakdown.trimCost.toFixed(2)) },
      { name: 'صافي الربح للقطعة', value: Number(breakdown.profitPerPiece.toFixed(2)) },
    ].filter((d) => d.value > 0);
  }, [breakdown]);

  const handleAddOverhead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOverheadName.trim()) return;
    saveOverheadItem({
      id: newUuid(),
      name: newOverheadName.trim(),
      category: newOverheadCategory,
      monthlyAmount: Number(newOverheadAmount) || 0,
    });
    setNewOverheadName('');
    setNewOverheadAmount(0);
  };

  const applyMarginToModel = () => {
    if (!activeModel) return;
    saveModel({ ...activeModel, targetMarginPct: simulatedPct });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 sm:gap-6 items-start">
        {/* Right Column: Indirect Monthly Overhead Allocator */}
        <div className="xl:col-span-5 bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#F0EFEA]">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#F6EFE7] text-[#A67C52] flex items-center justify-center shrink-0">
                <Building className="w-4 h-4" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-[#1A1A1E]">
                  المصاريف غير المباشرة الشهرية
                </h2>
                <p className="text-[11px] text-[#6E6C66]">
                  توزّع تلقائياً على حجم الإنتاج الشهري المتوقع
                </p>
              </div>
            </div>
          </div>

          {/* Monthly Volume Control */}
          <div className="rounded-xl bg-[#FAF9F7] border border-[#E5E3DD] p-3.5 sm:p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="monthly-volume-input"
                className="text-xs font-bold text-[#1A1A1E]"
              >
                حجم الإنتاج الشهري المتوقع (قطعة)
              </label>
              <input
                id="monthly-volume-input"
                type="number"
                min="1"
                value={state.overhead.estimatedMonthlyVolume}
                onChange={(e) => setMonthlyVolume(Number(e.target.value) || 1)}
                className="w-24 sm:w-28 rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-sm font-bold text-center tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#EAE8E2]">
              <div>
                <div className="text-[11px] text-[#6E6C66]">إجمالي المصاريف الشهرية</div>
                <div className="text-sm font-bold text-[#1A1A1E] tabular-nums mt-0.5">
                  {formatMoney(totalMonthlyOverhead, state.currency)}
                </div>
              </div>
              <div className="text-left">
                <div className="text-[11px] text-[#7B5836]">نصيب القطعة الواحدة</div>
                <div className="text-base font-extrabold text-[#8E6742] tabular-nums mt-0.5">
                  {formatMoney(overheadPerPiece, state.currency)}
                </div>
              </div>
            </div>
          </div>

          {/* Overhead Items List */}
          <div className="space-y-2.5">
            {state.overhead.items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 p-3 rounded-xl border border-[#EFECE6] hover:border-[#D8D4CC] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#1A1A1E] truncate">
                    {item.name}
                  </div>
                  <div className="text-[10px] text-[#6E6C66]">
                    {OVERHEAD_CATEGORY_LABELS[item.category]}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={item.monthlyAmount}
                    onChange={(e) =>
                      saveOverheadItem({
                        ...item,
                        monthlyAmount: Number(e.target.value) || 0,
                      })
                    }
                    aria-label={`مبلغ ${item.name}`}
                    className="w-20 sm:w-24 rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2 py-1 text-xs font-bold text-left tabular-nums focus:outline-none focus:border-[#A67C52]"
                  />
                  <button
                    type="button"
                    onClick={() => deleteOverheadItem(item.id)}
                    aria-label="حذف البند"
                    className="p-1 text-[#9C9990] hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add New Overhead Item */}
          <form
            onSubmit={handleAddOverhead}
            className="pt-3 border-t border-[#F0EFEA] space-y-2.5 no-print"
          >
            <div className="text-xs font-semibold text-[#1A1A1E]">
              إضافة بند مصاريف غير مباشرة
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={newOverheadName}
                onChange={(e) => setNewOverheadName(e.target.value)}
                placeholder="مثال: رواتب إدارة / تصوير"
                className="col-span-2 sm:col-span-5 rounded-lg border border-[#E5E3DD] px-2.5 py-2 sm:py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
              />
              <select
                value={newOverheadCategory}
                onChange={(e) =>
                  setNewOverheadCategory(e.target.value as OverheadItem['category'])
                }
                className="sm:col-span-3 rounded-lg border border-[#E5E3DD] bg-white px-2 py-2 sm:py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
              >
                {Object.entries(OVERHEAD_CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                value={newOverheadAmount || ''}
                onChange={(e) => setNewOverheadAmount(Number(e.target.value))}
                placeholder="المبلغ"
                className="sm:col-span-2 rounded-lg border border-[#E5E3DD] px-2 py-2 sm:py-1.5 text-xs tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
              <button
                type="submit"
                className="col-span-2 sm:col-span-2 inline-flex items-center justify-center gap-1 rounded-lg bg-[#1A1A1E] hover:bg-[#2E2E35] text-white py-2 sm:py-1.5 text-xs font-bold cursor-pointer"
                aria-label="إضافة بند"
              >
                <Plus className="w-4 h-4" />
                <span className="sm:hidden">إضافة البند</span>
              </button>
            </div>
          </form>
        </div>

        {/* Left Column: Pricing Engine & Breakdown Chart */}
        <div className="xl:col-span-7 space-y-5">
          <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#F0EFEA]">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-[#1A1A1E] text-[#BD956D] flex items-center justify-center shrink-0">
                  <Sliders className="w-4 h-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[#1A1A1E]">
                    محرك التسعير ومحاكاة هامش الربح
                  </h2>
                  <p className="text-[11px] text-[#6E6C66]">
                    احسب السعر المقترح لمتجر dresscode-clothing.com بدقة
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => window.print()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-[#1A1A1E] bg-[#F3F2EE] hover:bg-[#E5E3DD] px-3 py-2 rounded-xl transition-colors cursor-pointer no-print"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة بطاقة التسعير</span>
              </button>
            </div>

            {/* Model Selector & Pricing Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                  اختر الموديل
                </label>
                <select
                  value={activeModel?.id || ''}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] px-3.5 py-2.5 text-sm font-semibold text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
                >
                  {state.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                  طريقة احتساب الربح
                </label>
                <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#F3F2EE] p-1">
                  <button
                    type="button"
                    onClick={() => setPricingMode('markup')}
                    className={`py-2 px-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer ${
                      pricingMode === 'markup'
                        ? 'bg-[#1A1A1E] text-white'
                        : 'text-[#6E6C66]'
                    }`}
                  >
                    نسبة على التكلفة
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricingMode('margin')}
                    className={`py-2 px-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer ${
                      pricingMode === 'margin'
                        ? 'bg-[#1A1A1E] text-white'
                        : 'text-[#6E6C66]'
                    }`}
                  >
                    هامش من السعر
                  </button>
                </div>
              </div>
            </div>

            {/* Target Margin Slider */}
            <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] p-3.5 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#7B5836]">
                  {pricingMode === 'markup'
                    ? 'نسبة الإضافة على التكلفة (Markup %)'
                    : 'هامش الربح المستهدف من سعر البيع (Profit Margin %)'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-extrabold text-[#8E6742] tabular-nums">
                    {simulatedPct}%
                  </span>
                  {activeModel && simulatedPct !== activeModel.targetMarginPct && (
                    <button
                      type="button"
                      onClick={applyMarginToModel}
                      className="text-[11px] font-semibold bg-[#A67C52] hover:bg-[#8E6742] text-white px-2.5 py-1 rounded-lg cursor-pointer no-print"
                    >
                      اعتماد للموديل
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={10}
                max={pricingMode === 'margin' ? 85 : 200}
                step={1}
                value={simulatedPct}
                onChange={(e) => setSimulatedPct(Number(e.target.value))}
                className="w-full bronze-slider cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[#7B5836]/80 tabular-nums">
                <span>10%</span>
                <span>50%</span>
                <span>{pricingMode === 'margin' ? '85%' : '120%'}</span>
                {pricingMode === 'markup' && <span>200%</span>}
              </div>
            </div>

            {/* Detailed Cost Breakdown + Pie Chart */}
            {breakdown && activeModel && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center pt-2">
                {/* Breakdown Lines */}
                <div className="md:col-span-7 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 py-2 border-b border-[#F0EFEA] text-xs sm:text-sm">
                    <span className="text-[#4B4A46]">تكلفة الخامات والكلف (بالهالك)</span>
                    <span className="font-bold text-[#1A1A1E] tabular-nums shrink-0">
                      {formatMoney(breakdown.directMaterialCost, state.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-2 border-b border-[#F0EFEA] text-xs sm:text-sm">
                    <span className="text-[#4B4A46]">تكلفة العمالة والتشغيل الخارجي</span>
                    <span className="font-bold text-[#1A1A1E] tabular-nums shrink-0">
                      {formatMoney(breakdown.directLaborCost, state.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-2 border-b border-[#F0EFEA] text-xs sm:text-sm">
                    <span className="text-[#4B4A46]">نصيب القطعة من المصاريف غير المباشرة</span>
                    <span className="font-bold text-[#1A1A1E] tabular-nums shrink-0">
                      {formatMoney(breakdown.indirectOverheadCost, state.currency)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-[#F3F2EE] text-xs sm:text-sm">
                    <span className="font-bold text-[#1A1A1E]">التكلفة الإجمالية للقطعة</span>
                    <span className="text-sm sm:text-base font-extrabold text-[#1A1A1E] tabular-nums shrink-0">
                      {formatMoney(breakdown.totalUnitCost, state.currency)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 py-3 px-4 rounded-xl bg-[#1A1A1E] text-white">
                    <div>
                      <div className="text-xs text-[#D4B896]">سعر البيع المقترح للمتجر</div>
                      <div className="text-[11px] text-[#B4B2AA] mt-0.5">
                        صافي ربح {formatMoney(breakdown.profitPerPiece, state.currency)} (
                        {formatNumber(breakdown.effectiveMarginOnPricePct, 1)}% من السعر)
                      </div>
                    </div>
                    <div className="text-lg sm:text-xl font-extrabold text-[#BD956D] tabular-nums">
                      {formatMoney(breakdown.suggestedRetailPrice, state.currency)}
                    </div>
                  </div>
                </div>

                {/* Pie Chart */}
                <div className="md:col-span-5 flex flex-col items-center">
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={78}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {pieData.map((_, i) => (
                            <Cell
                              key={i}
                              fill={CHART_COLORS[i % CHART_COLORS.length]}
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
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 mt-1">
                    {pieData.map((item, i) => (
                      <div key={item.name} className="flex items-center gap-1.5 text-[11px]">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                          }}
                        />
                        <span className="text-[#4B4A46]">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
