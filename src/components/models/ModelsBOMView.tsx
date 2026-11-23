import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Copy,
  Hammer,
  Layers,
  PackageOpen,
  Plus,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { newUuid } from '../../lib/supabase';
import type {
  ModelFabricItem,
  ModelLaborItem,
  ModelStatus,
  ModelTrimItem,
  ProductModel,
} from '../../types/erp';
import {
  calculateModelCost,
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  getAutoIncludedTrimsForModel,
  getFabricLineCost,
  getLaborStepUnitCost,
  getTrimLineCost,
  getTrimUnitCost,
} from '../../utils/calculations';

const STATUS_LABELS: Record<ModelStatus, string> = {
  active: 'إنتاج نشط',
  sampling: 'مرحلة العينة',
  archived: 'مؤرشف',
};

function createBlankModel(existingCount: number): ProductModel {
  return {
    id: newUuid(),
    name: 'موديل جديد',
    sku: `DC-NEW-${String(existingCount + 1).padStart(3, '0')}`,
    category: 'عباية',
    season: '2026',
    status: 'sampling',
    targetMarginPct: 65,
    fabrics: [],
    trims: [],
    laborSteps: [],
    variants: [],
    notes: '',
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

export const ModelsBOMView: React.FC = () => {
  const {
    state,
    selectedModelId,
    setSelectedModelId,
    saveModel,
    deleteModel,
    duplicateModel,
    openModelInCalculator,
  } = useERP();

  const activeModel = useMemo(
    () => state.models.find((m) => m.id === selectedModelId) || state.models[0] || null,
    [state.models, selectedModelId]
  );

  const [draft, setDraft] = useState<ProductModel | null>(activeModel);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    setDraft(activeModel);
  }, [activeModel?.id]);

  const handleCreateNew = () => {
    const fresh = createBlankModel(state.models.length);
    saveModel(fresh);
    setDraft(fresh);
  };

  const handleSave = () => {
    if (!draft) return;
    saveModel(draft);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  };

  // Fabric lines
  const addFabricLine = () => {
    if (!draft) return;
    const defaultFab = state.fabrics[0];
    if (!defaultFab) return;
    const item: ModelFabricItem = {
      id: newUuid(),
      fabricId: defaultFab.id,
      consumption: 2.5,
      wastePct: defaultFab.defaultWastePct,
    };
    setDraft({ ...draft, fabrics: [...draft.fabrics, item] });
  };

  const updateFabricLine = (
    id: string,
    patch: Partial<ModelFabricItem>
  ) => {
    if (!draft) return;
    setDraft({
      ...draft,
      fabrics: draft.fabrics.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...patch };
        if (patch.fabricId) {
          const fab = state.fabrics.find((f) => f.id === patch.fabricId);
          if (fab) updated.wastePct = fab.defaultWastePct;
        }
        return updated;
      }),
    });
  };

  const removeFabricLine = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, fabrics: draft.fabrics.filter((f) => f.id !== id) });
  };

  // Trim lines (prefer non-auto trims when adding manually)
  const addTrimLine = () => {
    if (!draft) return;
    const usedIds = new Set(draft.trims.map((t) => t.trimId));
    const defaultTrim =
      state.trims.find((t) => !t.autoIncludeInBom && !usedIds.has(t.id)) ||
      state.trims.find((t) => !t.autoIncludeInBom) ||
      state.trims[0];
    if (!defaultTrim) return;
    const item: ModelTrimItem = {
      id: newUuid(),
      trimId: defaultTrim.id,
      quantity: defaultTrim.defaultQtyPerPiece ?? 1,
    };
    setDraft({ ...draft, trims: [...draft.trims, item] });
  };

  const overrideAutoTrim = (trimId: string, defaultQty: number) => {
    if (!draft) return;
    if (draft.trims.some((t) => t.trimId === trimId)) return;
    const item: ModelTrimItem = {
      id: newUuid(),
      trimId,
      quantity: defaultQty,
    };
    setDraft({ ...draft, trims: [...draft.trims, item] });
  };

  const updateTrimLine = (id: string, patch: Partial<ModelTrimItem>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      trims: draft.trims.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  };

  const removeTrimLine = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, trims: draft.trims.filter((t) => t.id !== id) });
  };

  // Labor lines
  const addLaborFromCatalog = (opId: string) => {
    if (!draft) return;
    const op = state.operations.find((o) => o.id === opId);
    const step: ModelLaborItem = op
      ? {
          id: newUuid(),
          operationId: op.id,
          workshopId: op.workshopId,
          name: op.name,
          workshopName: op.workshopName,
          billingType: op.billingType,
          cost: op.cost,
          batchSize: op.batchSize,
        }
      : {
          id: newUuid(),
          name: 'مرحلة تشغيل جديدة',
          workshopName: 'ورشة خارجية',
          billingType: 'per_piece',
          cost: 30,
          batchSize: 1,
        };
    setDraft({ ...draft, laborSteps: [...draft.laborSteps, step] });
  };

  const updateLaborLine = (id: string, patch: Partial<ModelLaborItem>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      laborSteps: draft.laborSteps.map((step) =>
        step.id === id ? { ...step, ...patch } : step
      ),
    });
  };

  const removeLaborLine = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      laborSteps: draft.laborSteps.filter((l) => l.id !== id),
    });
  };

  const liveCost = useMemo(() => {
    if (!draft) return null;
    return calculateModelCost(draft, state.fabrics, state.trims, state.overhead);
  }, [draft, state.fabrics, state.trims, state.overhead]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* Mobile/Tablet Model Picker Bar */}
      <div className="xl:hidden bg-white rounded-2xl border border-[#E5E3DD] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-[#1A1A1E]">
            اختر الموديل ({state.models.length})
          </span>
          <button
            type="button"
            onClick={handleCreateNew}
            className="inline-flex items-center gap-1 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold px-3 py-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>موديل جديد</span>
          </button>
        </div>
        <select
          value={draft?.id || ''}
          onChange={(e) => setSelectedModelId(e.target.value)}
          className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] px-3 py-2.5 text-sm font-bold text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
        >
          {state.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.sku})
            </option>
          ))}
        </select>
      </div>

      {/* Desktop Models Sidebar List */}
      <div className="hidden xl:block xl:col-span-4 bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="p-4 border-b border-[#E5E3DD] flex items-center justify-between gap-2 bg-[#FAF9F7]">
          <div>
            <h2 className="text-sm font-bold text-[#1A1A1E]">
              قائمة الموديلات ({state.models.length})
            </h2>
            <p className="text-[11px] text-[#6E6C66]">اختر موديلاً لتعديل بطاقة التكلفة</p>
          </div>
          <button
            id="btn-new-model"
            type="button"
            onClick={handleCreateNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-semibold px-3 py-2 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>موديل جديد</span>
          </button>
        </div>

        <div className="divide-y divide-[#F0EFEA] max-h-[650px] overflow-y-auto">
          {state.models.map((m) => {
            const c = calculateModelCost(m, state.fabrics, state.trims, state.overhead);
            const isSelected = draft?.id === m.id;
            return (
              <div
                key={m.id}
                onClick={() => setSelectedModelId(m.id)}
                className={`p-4 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#FBF8F4] border-r-4 border-r-[#A67C52]'
                    : 'hover:bg-[#FAF9F7]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1A1A1E] truncate">
                      {m.name}
                    </div>
                    <div className="text-[11px] text-[#6E6C66] flex items-center gap-1.5 mt-0.5">
                      <span className="font-mono">{m.sku}</span>
                      <span>•</span>
                      <span>{m.category}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      m.status === 'active'
                        ? 'bg-[#1A1A1E] text-white'
                        : m.status === 'sampling'
                        ? 'bg-[#F6EFE7] text-[#8E6742]'
                        : 'bg-[#E5E3DD] text-[#6E6C66]'
                    }`}
                  >
                    {STATUS_LABELS[m.status]}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs pt-2 border-t border-[#F0EFEA]">
                  <div>
                    <span className="text-[#6E6C66]">التكلفة: </span>
                    <span className="font-bold text-[#1A1A1E] tabular-nums">
                      {formatMoney(c.totalUnitCost, state.currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#6E6C66]">المقترح: </span>
                    <span className="font-bold text-[#8E6742] tabular-nums">
                      {formatMoney(c.suggestedRetailPrice, state.currency)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {state.models.length === 0 && (
            <div className="p-8 text-center text-xs text-[#6E6C66]">
              لا توجد موديلات بعد. اضغط على «موديل جديد» للبدء.
            </div>
          )}
        </div>
      </div>

      {/* Model BOM Editor */}
      <div className="xl:col-span-8 min-w-0 space-y-5">
        {!draft ? (
          <div className="bg-white rounded-2xl border border-[#E5E3DD] p-12 text-center">
            <Scissors className="w-10 h-10 text-[#A67C52] mx-auto mb-3" />
            <h3 className="text-base font-bold text-[#1A1A1E]">
              اختر موديلاً أو أنشئ بطاقة تكلفة جديدة
            </h3>
            <p className="text-xs text-[#6E6C66] mt-1">
              يمكنك إضافة عدة أقمشة مع نسبة الهالك، الكلف والإكسسوارات، ومراحل التشغيل الخارجي
            </p>
          </div>
        ) : (
          <>
            {/* Header Actions & Basic Info */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#F0EFEA]">
                <div>
                  <h2 className="text-base font-bold text-[#1A1A1E]">
                    بطاقة تكلفة الموديل (BOM)
                  </h2>
                  <p className="text-xs text-[#6E6C66]">
                    آخر تحديث: {draft.updatedAt}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openModelInCalculator(draft.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-[#E5E3DD] text-[#1A1A1E] hover:border-[#A67C52] hover:text-[#8E6742] transition-colors cursor-pointer"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    <span>حاسبة التسعير</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateModel(draft.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-[#E5E3DD] text-[#4B4A46] hover:bg-[#F3F2EE] transition-colors cursor-pointer"
                    title="نسخ الموديل"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteModel(draft.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    title="حذف الموديل"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    id="btn-save-model"
                    type="button"
                    onClick={handleSave}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white transition-colors cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5 text-[#BD956D]" />
                    <span>{savedToast ? 'تم الحفظ ✓' : 'حفظ البطاقة'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    اسم الموديل
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    كود الموديل (SKU)
                  </label>
                  <input
                    type="text"
                    value={draft.sku}
                    onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    الفئة
                  </label>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
                  >
                    {getLookupLabels(state.lookups, 'model_categories').map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    الموسم
                  </label>
                  <input
                    type="text"
                    value={draft.season}
                    onChange={(e) => setDraft({ ...draft, season: e.target.value })}
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    الحالة
                  </label>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({ ...draft, status: e.target.value as ModelStatus })
                    }
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="active">إنتاج نشط</option>
                    <option value="sampling">مرحلة العينة</option>
                    <option value="archived">مؤرشف</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    نسبة الربح المستهدفة (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="400"
                    value={draft.targetMarginPct}
                    onChange={(e) =>
                      setDraft({ ...draft, targetMarginPct: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    سعر البيع الفعلي
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={draft.actualRetailPrice ?? 0}
                    onChange={(e) =>
                      setDraft({ ...draft, actualRetailPrice: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm tabular-nums font-bold text-[#8E6742] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    السعر قبل الخصم (اختياري)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={draft.compareAtPrice ?? 0}
                    onChange={(e) =>
                      setDraft({ ...draft, compareAtPrice: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                    ملاحظات الباترون
                  </label>
                  <input
                    type="text"
                    value={draft.notes || ''}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    placeholder="ملاحظات اختيارية..."
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              {/* Quick Direct Costing (mirrors تكلفة المنتجات sheet — includes خياطة بره properly!) */}
              {draft.fabrics.length === 0 && draft.laborSteps.length === 0 && (
                <div className="pt-3 border-t border-[#F0EFEA] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#7B5836]">
                      التكلفة المباشرة السريعة (للموديلات الفردية — يشمل خياطة بره تلقائياً)
                    </span>
                    <span className="text-xs font-bold text-[#1A1A1E] tabular-nums">
                      الإجمالي المباشر:{' '}
                      {formatMoney(
                        (draft.quickFabricCost || 0) +
                          (draft.quickShippingCost || 0) +
                          (draft.quickOverlockCost || 0) +
                          (draft.quickPackagingCost || 0) +
                          (draft.quickSewingCost || 0) +
                          (draft.quickAccessoriesCost || 0),
                        state.currency
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                    {(
                      [
                        ['quickFabricCost', 'القماش'],
                        ['quickShippingCost', 'الشحن'],
                        ['quickOverlockCost', 'السرفلة'],
                        ['quickPackagingCost', 'الباكيدج'],
                        ['quickSewingCost', 'خياطة بره'],
                        ['quickAccessoriesCost', 'إكسسوارات'],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <label className="block text-[10px] font-semibold text-[#6E6C66] mb-1">
                          {label}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={draft[key] ?? 0}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: Number(e.target.value) })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2 py-1.5 text-xs tabular-nums focus:outline-none focus:border-[#A67C52]"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 1. Fabrics Section */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#A67C52]" />
                  <h3 className="text-sm font-bold text-[#1A1A1E]">
                    1. استهلاك الأقمشة والهالك
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={addFabricLine}
                  disabled={state.fabrics.length === 0}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#8E6742] bg-[#F6EFE7] hover:bg-[#EDE0D1] px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  إضافة قماش
                </button>
              </div>

              <div className="space-y-2.5">
                {draft.fabrics.map((line) => {
                  const fabric = state.fabrics.find((f) => f.id === line.fabricId);
                  const lineCost = getFabricLineCost(line, state.fabrics);
                  return (
                    <div
                      key={line.id}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl p-3"
                    >
                      <div className="sm:col-span-5">
                        <label className="block text-[10px] text-[#6E6C66] mb-1">
                          القماش
                        </label>
                        <select
                          value={line.fabricId}
                          onChange={(e) =>
                            updateFabricLine(line.id, { fabricId: e.target.value })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                        >
                          {state.fabrics.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} ({formatMoney(f.pricePerUnit, state.currency)}/
                              {FABRIC_UNIT_LABELS[f.unit]})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-[#6E6C66] mb-1">
                          الاستهلاك ({fabric ? FABRIC_UNIT_LABELS[fabric.unit] : 'متر'})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.05"
                          value={line.consumption}
                          onChange={(e) =>
                            updateFabricLine(line.id, {
                              consumption: Number(e.target.value),
                            })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs tabular-nums focus:outline-none focus:border-[#A67C52]"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-[#6E6C66] mb-1">
                          الهالك (%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="50"
                          step="0.5"
                          value={line.wastePct}
                          onChange={(e) =>
                            updateFabricLine(line.id, {
                              wastePct: Number(e.target.value),
                            })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs tabular-nums focus:outline-none focus:border-[#A67C52]"
                        />
                      </div>

                      <div className="sm:col-span-2 text-left sm:text-center">
                        <div className="text-[10px] text-[#6E6C66]">التكلفة بالهالك</div>
                        <div className="text-xs font-bold text-[#8E6742] tabular-nums mt-0.5">
                          {formatMoney(lineCost, state.currency)}
                        </div>
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeFabricLine(line.id)}
                          aria-label="حذف سطر القماش"
                          className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {draft.fabrics.length === 0 && (
                  <p className="text-xs text-[#6E6C66] py-3 text-center bg-[#FAF9F7] rounded-xl">
                    لم يتم إضافة أقمشة لهذا الموديل بعد.
                  </p>
                )}
              </div>
            </div>

            {/* 2. Trims & Accessories Section */}
            {(() => {
              const autoTrims = getAutoIncludedTrimsForModel(draft, state.trims);
              const autoTrimsTotal = autoTrims.reduce(
                (sum, item) => sum + getTrimLineCost(item, state.trims),
                0
              );
              return (
                <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <PackageOpen className="w-4 h-4 text-[#A67C52]" />
                      <h3 className="text-sm font-bold text-[#1A1A1E]">
                        2. الكلف والإكسسوارات والتغليف
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={addTrimLine}
                      disabled={state.trims.length === 0}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#8E6742] bg-[#F6EFE7] hover:bg-[#EDE0D1] px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      إضافة كلفة / إكسسوار
                    </button>
                  </div>

                  {/* Auto-Included Standard Trims Card */}
                  {autoTrims.length > 0 && (
                    <div className="rounded-xl border border-[#E6D5C3] bg-[#FBF8F4] p-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#7B5836]">
                          <Sparkles className="w-3.5 h-3.5 text-[#A67C52] shrink-0" />
                          <span>
                            بنود أساسية مُحتسبة تلقائياً في التكلفة ({autoTrims.length}{' '}
                            {autoTrims.length === 1 ? 'بند' : 'بنود'})
                          </span>
                        </div>
                        <span className="text-xs font-extrabold text-[#8E6742] bg-white border border-[#E6D5C3] px-2.5 py-0.5 rounded-full tabular-nums">
                          +{formatMoney(autoTrimsTotal, state.currency)} / قطعة
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {autoTrims.map((item) => {
                          const trim = state.trims.find((t) => t.id === item.trimId);
                          if (!trim) return null;
                          const lineCost = getTrimLineCost(item, state.trims);
                          return (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-2 bg-white border border-[#EDE3D7] rounded-lg px-3 py-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-[#1A1A1E] truncate">
                                  {trim.name}
                                </div>
                                <div className="text-[11px] text-[#6E6C66] tabular-nums">
                                  {formatNumber(item.quantity, 2)} {trim.unitLabel} ×{' '}
                                  {formatMoney(getTrimUnitCost(trim), state.currency)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-bold text-[#8E6742] tabular-nums">
                                  {formatMoney(lineCost, state.currency)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => overrideAutoTrim(trim.id, item.quantity)}
                                  title="تخصيص الكمية أو استثناء هذا البند لهذا الموديل فقط (ضع 0 للاستثناء)"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#6E6C66] bg-[#FAF9F7] border border-[#E5E3DD] hover:border-[#A67C52] hover:text-[#8E6742] transition-colors cursor-pointer"
                                >
                                  <SlidersHorizontal className="w-3 h-3" />
                                  <span>تخصيص</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <p className="text-[11px] text-[#7B5836]/80">
                        تُدار البنود التلقائية من شاشة <strong>الخامات والكلف ← الكلف والإكسسوارات</strong>. اضغط «تخصيص» إذا أردت تعديل كمية بند أو استثناءه (بوضع 0) لهذا الموديل فقط.
                      </p>
                    </div>
                  )}

                  {/* Explicit / Model-Specific Trims */}
                  <div className="space-y-2.5">
                    {draft.trims.map((line) => {
                      const trim = state.trims.find((t) => t.id === line.trimId);
                      const lineCost = getTrimLineCost(line, state.trims);
                      const isOverridingAuto = Boolean(trim?.autoIncludeInBom);
                      return (
                        <div
                          key={line.id}
                          className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl p-3"
                        >
                          <div className="sm:col-span-6">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <label className="block text-[10px] text-[#6E6C66]">
                                الكلفة / الإكسسوار
                              </label>
                              {isOverridingAuto && (
                                <span className="text-[10px] font-semibold text-[#8E6742] bg-[#F6EFE7] px-1.5 py-0.5 rounded">
                                  {line.quantity === 0
                                    ? 'مُستثنى لهذا الموديل'
                                    : 'تخصيص لبند تلقائي'}
                                </span>
                              )}
                            </div>
                            <select
                              value={line.trimId}
                              onChange={(e) =>
                                updateTrimLine(line.id, { trimId: e.target.value })
                              }
                              className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                            >
                              {state.trims.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                  {t.autoIncludeInBom ? ' (تلقائي)' : ''} (
                                  {formatMoney(getTrimUnitCost(t), state.currency)}/
                                  {t.unitLabel})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-3">
                            <label className="block text-[10px] text-[#6E6C66] mb-1">
                              الكمية للقطعة ({trim?.unitLabel || 'وحدة'})
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={line.quantity}
                              onChange={(e) =>
                                updateTrimLine(line.id, { quantity: Number(e.target.value) })
                              }
                              className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs tabular-nums focus:outline-none focus:border-[#A67C52]"
                            />
                          </div>

                          <div className="sm:col-span-2 text-left sm:text-center">
                            <div className="text-[10px] text-[#6E6C66]">الإجمالي</div>
                            <div className="text-xs font-bold text-[#8E6742] tabular-nums mt-0.5">
                              {formatMoney(lineCost, state.currency)}
                            </div>
                          </div>

                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeTrimLine(line.id)}
                              aria-label="حذف سطر الكلفة"
                              className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {draft.trims.length === 0 && (
                      <p className="text-xs text-[#6E6C66] py-3 text-center bg-[#FAF9F7] rounded-xl">
                        {autoTrims.length > 0
                          ? 'لا توجد كلف إضافية خاصة بهذا الموديل (مثل الزراير أو السوست) — البنود التلقائية أعلاه مُحتسبة بالفعل.'
                          : 'لم يتم إضافة كلف أو تيكت DressCode لهذا الموديل بعد.'}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 3. Outsourced Labor Steps Section */}
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Hammer className="w-4 h-4 text-[#A67C52]" />
                  <h3 className="text-sm font-bold text-[#1A1A1E]">
                    3. مراحل التشغيل والعمالة الخارجية
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        addLaborFromCatalog(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="w-full sm:w-auto max-w-full min-w-0 flex-1 sm:flex-initial rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2.5 py-2 sm:py-1.5 text-xs text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="">+ إضافة من دليل الورش...</option>
                    {state.operations.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.name} — {op.workshopName} (
                        {formatMoney(getLaborStepUnitCost(op), state.currency)})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => addLaborFromCatalog('')}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1 text-xs font-semibold text-[#8E6742] bg-[#F6EFE7] hover:bg-[#EDE0D1] px-3 py-2 sm:py-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    مرحلة مخصصة
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                {draft.laborSteps.map((step) => {
                  const unitCost = getLaborStepUnitCost(step);
                  return (
                    <div
                      key={step.id}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl p-3"
                    >
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] text-[#6E6C66] mb-1">
                          المرحلة
                        </label>
                        <input
                          type="text"
                          value={step.name}
                          onChange={(e) =>
                            updateLaborLine(step.id, { name: e.target.value })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[10px] text-[#6E6C66] mb-1">
                          الورشة / العامل
                        </label>
                        <input
                          type="text"
                          value={step.workshopName}
                          onChange={(e) =>
                            updateLaborLine(step.id, { workshopName: e.target.value })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-[#6E6C66] mb-1">
                          {step.billingType === 'per_batch' ? 'تكلفة الباتش' : 'تكلفة القطعة'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={step.cost}
                          onChange={(e) =>
                            updateLaborLine(step.id, { cost: Number(e.target.value) })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs tabular-nums focus:outline-none focus:border-[#A67C52]"
                        />
                      </div>

                      <div className="sm:col-span-1">
                        <label className="block text-[10px] text-[#6E6C66] mb-1">
                          العدد
                        </label>
                        <input
                          type="number"
                          min="1"
                          disabled={step.billingType === 'per_piece'}
                          value={step.billingType === 'per_batch' ? step.batchSize : 1}
                          onChange={(e) =>
                            updateLaborLine(step.id, {
                              batchSize: Math.max(1, Number(e.target.value)),
                            })
                          }
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs tabular-nums disabled:bg-[#F0EFEA] disabled:text-[#9C9990]"
                        />
                      </div>

                      <div className="sm:col-span-2 text-left sm:text-center">
                        <div className="text-[10px] text-[#6E6C66]">للقطعة</div>
                        <div className="text-xs font-bold text-[#8E6742] tabular-nums mt-0.5">
                          {formatMoney(unitCost, state.currency)}
                        </div>
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeLaborLine(step.id)}
                          aria-label="حذف مرحلة التشغيل"
                          className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {draft.laborSteps.length === 0 && (
                  <p className="text-xs text-[#6E6C66] py-3 text-center bg-[#FAF9F7] rounded-xl">
                    لم يتم إضافة مراحل تشغيل خارجي لهذا الموديل بعد.
                  </p>
                )}
              </div>
            </div>

            {/* Live Cost Card Summary */}
            {liveCost && (
              <div className="bg-[#1A1A1E] text-white rounded-2xl p-4 sm:p-6 shadow-md">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 items-center">
                  <div>
                    <div className="text-[11px] text-[#B4B2AA]">الخامات والكلف</div>
                    <div className="text-sm sm:text-base font-bold tabular-nums mt-0.5">
                      {formatMoney(liveCost.directMaterialCost, state.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#B4B2AA]">التشغيل الخارجي</div>
                    <div className="text-sm sm:text-base font-bold tabular-nums mt-0.5">
                      {formatMoney(liveCost.directLaborCost, state.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#B4B2AA]">غير المباشرة</div>
                    <div className="text-sm sm:text-base font-bold tabular-nums mt-0.5">
                      {formatMoney(liveCost.indirectOverheadCost, state.currency)}
                    </div>
                  </div>
                  <div className="sm:border-r sm:border-white/15 sm:pr-4">
                    <div className="text-[11px] text-[#D4B896]">التكلفة الإجمالية</div>
                    <div className="text-base sm:text-lg font-extrabold tabular-nums mt-0.5 text-white">
                      {formatMoney(liveCost.totalUnitCost, state.currency)}
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-1 bg-[#A67C52] rounded-xl p-3 text-center">
                    <div className="text-[11px] text-white/90">
                      سعر البيع المقترح (+{formatNumber(draft.targetMarginPct, 0)}%)
                    </div>
                    <div className="text-lg font-extrabold tabular-nums mt-0.5">
                      {formatMoney(liveCost.suggestedRetailPrice, state.currency)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
