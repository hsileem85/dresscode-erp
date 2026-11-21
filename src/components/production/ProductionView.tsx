import React, { useMemo, useState } from 'react';
import { Boxes, CheckCircle2, Factory, Play, Plus } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { formatMoney } from '../../utils/calculations';
import { Modal } from '../common/Modal';

export const ProductionView: React.FC = () => {
  const {
    state,
    addModelVariant,
    createProductionBatch,
    issueProductionBatch,
    completeProductionBatch,
  } = useERP();

  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>(state.models[0]?.id || '');
  const [variantQtyMap, setVariantQtyMap] = useState<Record<string, number>>({});
  const [batchNotes, setBatchNotes] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // New variant form
  const [varModelId, setVarModelId] = useState<string>(state.models[0]?.id || '');
  const [varColor, setVarColor] = useState('أسود فحمي');
  const [varSize, setVarSize] = useState('M');
  const [varRetailPrice, setVarRetailPrice] = useState(1450);

  const allVariants = useMemo(
    () =>
      state.models.flatMap((m) =>
        m.variants.map((v) => ({ ...v, modelName: m.name, modelSku: m.sku }))
      ),
    [state.models]
  );

  const selectedModel = state.models.find((m) => m.id === selectedModelId);

  const handleCreateVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    const model = state.models.find((m) => m.id === varModelId);
    if (!model) return;
    const skuSuffix = `${varColor.slice(0, 3)}-${varSize}`.replace(/\s+/g, '');
    await addModelVariant({
      modelId: model.id,
      variantSku: `${model.sku}-${skuSuffix}-${Math.floor(Math.random() * 90 + 10)}`,
      color: varColor.trim(),
      size: varSize.trim(),
      finishedGoodsQty: 0,
      avgUnitCogs: 0,
      retailPrice: Number(varRetailPrice) || 0,
      reorderLevel: 5,
    });
    setVariantModalOpen(false);
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModel) return;
    const variants = selectedModel.variants
      .map((v) => ({ variantId: v.id, plannedQty: Number(variantQtyMap[v.id]) || 0 }))
      .filter((v) => v.plannedQty > 0);
    if (variants.length === 0) return;

    const batchNumber = `PRD-${new Date().getFullYear()}-${String(
      state.productionOrders.length + 1
    ).padStart(3, '0')}`;
    await createProductionBatch({
      batchNumber,
      modelId: selectedModel.id,
      notes: batchNotes,
      variants,
    });
    setBatchModalOpen(false);
    setVariantQtyMap({});
    setBatchNotes('');
  };

  const runAction = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  const totalFinishedPieces = allVariants.reduce((s, v) => s + v.finishedGoodsQty, 0);

  return (
    <div className="space-y-6">
      {/* Top Actions & KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">
            مخزون المنتج التام
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#1A1A1E] tabular-nums mt-1.5 sm:mt-2">
            {totalFinishedPieces} قطعة
          </div>
          <div className="text-[11px] sm:text-xs text-[#6E6C66] mt-1">
            موزّعة على {allVariants.length} مقاس ولون
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">
            تشغيلات التصنيع
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#8E6742] tabular-nums mt-1.5 sm:mt-2">
            {state.productionOrders.length} تشغيلة
          </div>
          <div className="text-[11px] sm:text-xs text-[#6E6C66] mt-1">
            {state.productionOrders.filter((p) => p.status === 'in_progress').length} قيد
            التشغيل بالورش
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 flex flex-col justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedModelId(state.models[0]?.id || '');
              setBatchModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold py-2.5 px-4 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>فتح أمر تصنيع (تشغيلة جديدة)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setVarModelId(state.models[0]?.id || '');
              setVariantModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F3F2EE] hover:bg-[#E5E3DD] text-[#1A1A1E] text-xs font-bold py-2 px-4 cursor-pointer"
          >
            <Boxes className="w-3.5 h-3.5 text-[#A67C52]" />
            <span>إضافة مقاس / لون (SKU) لموديل</span>
          </button>
        </div>
      </div>

      {/* Production Orders */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E3DD] flex items-center gap-2">
          <Factory className="w-4 h-4 text-[#A67C52] shrink-0" />
          <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
            أوامر التصنيع والتشغيل (صرف الخامات ← استلام منتج تام)
          </h2>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {state.productionOrders.map((po) => {
            const model = state.models.find((m) => m.id === po.modelId);
            return (
              <div key={po.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-xs text-[#6E6C66]">
                      {po.batchNumber}
                    </div>
                    <div className="font-bold text-sm text-[#1A1A1E] mt-0.5 truncate">
                      {model?.name || 'موديل'}
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      po.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : po.status === 'in_progress'
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-[#F3F2EE] text-[#4B4A46]'
                    }`}
                  >
                    {po.status === 'completed'
                      ? 'مكتملة'
                      : po.status === 'in_progress'
                      ? 'قيد التشغيل'
                      : 'مخططة'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-[#FAF9F7] rounded-xl p-2.5 border border-[#F0EFEA]">
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">الكمية</div>
                    <div className="font-bold tabular-nums mt-0.5">{po.plannedQty} قطعة</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">تكلفة القطعة (COGS)</div>
                    <div className="font-bold text-[#8E6742] tabular-nums mt-0.5">
                      {po.actualUnitCogs > 0
                        ? formatMoney(po.actualUnitCogs, state.currency)
                        : 'عند الإتمام'}
                    </div>
                  </div>
                </div>

                {po.status === 'planned' && (
                  <button
                    type="button"
                    disabled={busyId === po.id}
                    onClick={() => void runAction(po.id, () => issueProductionBatch(po.id))}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 text-[#BD956D]" />
                    صرف الخامات وبدء التشغيل
                  </button>
                )}
                {po.status === 'in_progress' && (
                  <button
                    type="button"
                    disabled={busyId === po.id}
                    onClick={() => void runAction(po.id, () => completeProductionBatch(po.id))}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-[#A67C52] text-white px-3 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    إتمام واستلام المنتج التام
                  </button>
                )}
              </div>
            );
          })}
          {state.productionOrders.length === 0 && (
            <div className="py-8 text-center text-xs text-[#6E6C66]">
              لا توجد تشغيلات تصنيع مسجلة بعد.
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">رقم التشغيلة</th>
                <th className="py-3 px-4">الموديل</th>
                <th className="py-3 px-4">الكمية</th>
                <th className="py-3 px-4">التكلفة الفعلية للقطعة (COGS)</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراء المرحلة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {state.productionOrders.map((po) => {
                const model = state.models.find((m) => m.id === po.modelId);
                return (
                  <tr key={po.id} className="hover:bg-[#FAF9F7]">
                    <td className="py-3 px-4 font-mono font-bold text-xs">{po.batchNumber}</td>
                    <td className="py-3 px-4 font-semibold">{model?.name || 'موديل'}</td>
                    <td className="py-3 px-4 tabular-nums">{po.plannedQty} قطعة</td>
                    <td className="py-3 px-4 tabular-nums font-bold text-[#8E6742]">
                      {po.actualUnitCogs > 0
                        ? formatMoney(po.actualUnitCogs, state.currency)
                        : 'يُحسب عند الإتمام'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          po.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700'
                            : po.status === 'in_progress'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-[#F3F2EE] text-[#4B4A46]'
                        }`}
                      >
                        {po.status === 'completed'
                          ? 'مكتملة (بالمخزن)'
                          : po.status === 'in_progress'
                          ? 'قيد التشغيل بالورش'
                          : 'مخططة'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {po.status === 'planned' && (
                        <button
                          type="button"
                          disabled={busyId === po.id}
                          onClick={() =>
                            void runAction(po.id, () => issueProductionBatch(po.id))
                          }
                          className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5 text-[#BD956D]" />
                          صرف الخامات وبدء التشغيل
                        </button>
                      )}
                      {po.status === 'in_progress' && (
                        <button
                          type="button"
                          disabled={busyId === po.id}
                          onClick={() =>
                            void runAction(po.id, () => completeProductionBatch(po.id))
                          }
                          className="inline-flex items-center gap-1 text-xs font-bold bg-[#A67C52] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          إتمام واستلام المنتج التام
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Finished Goods Inventory Matrix */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E3DD] flex items-center gap-2">
          <Boxes className="w-4 h-4 text-[#A67C52] shrink-0" />
          <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
            مخزون المنتج التام حسب اللون والمقاس (Finished Goods)
          </h2>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {allVariants.map((v) => (
            <div key={v.id} className="p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#1A1A1E] truncate">{v.modelName}</div>
                  <div className="text-[11px] text-[#6E6C66] mt-0.5">
                    {v.color} — <span className="font-bold text-[#1A1A1E]">{v.size}</span>
                    <span className="font-mono mr-1.5 text-[10px]">({v.variantSku})</span>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 px-2.5 py-0.5 rounded-lg text-xs font-extrabold tabular-nums ${
                    v.finishedGoodsQty <= v.reorderLevel
                      ? 'bg-red-100 text-red-700'
                      : 'bg-[#F6EFE7] text-[#8E6742]'
                  }`}
                >
                  {v.finishedGoodsQty} قطعة
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs bg-[#FAF9F7] rounded-xl p-2.5 border border-[#F0EFEA]">
                <div>
                  <div className="text-[10px] text-[#6E6C66]">متوسط التكلفة</div>
                  <div className="font-semibold tabular-nums mt-0.5">
                    {formatMoney(v.avgUnitCogs, state.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#6E6C66]">سعر البيع</div>
                  <div className="font-bold text-[#1A1A1E] tabular-nums mt-0.5">
                    {formatMoney(v.retailPrice, state.currency)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">SKU</th>
                <th className="py-3 px-4">الموديل</th>
                <th className="py-3 px-4">اللون / المقاس</th>
                <th className="py-3 px-4">الرصيد المتاح</th>
                <th className="py-3 px-4">متوسط تكلفة القطعة</th>
                <th className="py-3 px-4">سعر البيع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {allVariants.map((v) => (
                <tr key={v.id} className="hover:bg-[#FAF9F7]">
                  <td className="py-3 px-4 font-mono text-xs">{v.variantSku}</td>
                  <td className="py-3 px-4 font-semibold">{v.modelName}</td>
                  <td className="py-3 px-4 text-xs">
                    {v.color} — <span className="font-bold">{v.size}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-lg text-xs font-extrabold tabular-nums ${
                        v.finishedGoodsQty <= v.reorderLevel
                          ? 'bg-red-100 text-red-700'
                          : 'bg-[#F6EFE7] text-[#8E6742]'
                      }`}
                    >
                      {v.finishedGoodsQty} قطعة
                    </span>
                  </td>
                  <td className="py-3 px-4 tabular-nums text-xs">
                    {formatMoney(v.avgUnitCogs, state.currency)}
                  </td>
                  <td className="py-3 px-4 tabular-nums font-bold">
                    {formatMoney(v.retailPrice, state.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Batch Modal */}
      <Modal
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        title="فتح أمر تصنيع جديد (تشغيلة)"
        subtitle="اختر الموديل وحدد الكمية المطلوبة لكل لون ومقاس"
      >
        <form onSubmit={handleCreateBatch} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">الموديل</label>
            <select
              value={selectedModelId}
              onChange={(e) => {
                setSelectedModelId(e.target.value);
                setVariantQtyMap({});
              }}
              className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
            >
              {state.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.sku})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold">توزيع الكميات على الألوان والمقاسات:</div>
            {selectedModel && selectedModel.variants.length > 0 ? (
              selectedModel.variants.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl px-3 py-2"
                >
                  <div className="text-xs">
                    <span className="font-bold">{v.color}</span> — مقاس{' '}
                    <span className="font-bold">{v.size}</span>{' '}
                    <span className="text-[#6E6C66] font-mono">({v.variantSku})</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={variantQtyMap[v.id] ?? 0}
                    onChange={(e) =>
                      setVariantQtyMap((prev) => ({
                        ...prev,
                        [v.id]: Number(e.target.value),
                      }))
                    }
                    className="w-20 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1 text-xs text-center tabular-nums"
                  />
                </div>
              ))
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl">
                لا توجد مقاسات/ألوان مسجلة لهذا الموديل بعد. أضف مقاساً أولاً من زر «إضافة مقاس /
                لون».
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">ملاحظات التشغيلة</label>
            <input
              type="text"
              value={batchNotes}
              onChange={(e) => setBatchNotes(e.target.value)}
              placeholder="مثال: تشغيلة عيد الفطر"
              className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer"
            >
              إنشاء أمر التصنيع
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Variant Modal */}
      <Modal
        open={variantModalOpen}
        onClose={() => setVariantModalOpen(false)}
        title="إضافة مقاس ولون (Variant SKU)"
      >
        <form onSubmit={handleCreateVariant} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold mb-1">الموديل</label>
            <select
              value={varModelId}
              onChange={(e) => setVarModelId(e.target.value)}
              className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
            >
              {state.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">اللون</label>
              <input
                type="text"
                required
                value={varColor}
                onChange={(e) => setVarColor(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المقاس</label>
              <input
                type="text"
                required
                value={varSize}
                onChange={(e) => setVarSize(e.target.value)}
                placeholder="S / M / L / XL / Free Size"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">سعر البيع للمتجر</label>
            <input
              type="number"
              min="0"
              value={varRetailPrice}
              onChange={(e) => setVarRetailPrice(Number(e.target.value))}
              className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs tabular-nums"
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#A67C52] text-white text-xs font-bold cursor-pointer"
            >
              حفظ الصنف
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
