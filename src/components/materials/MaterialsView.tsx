import React, { useMemo, useState } from 'react';
import {
  Edit3,
  Layers,
  PackageOpen,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { newUuid } from '../../lib/supabase';
import type {
  Fabric,
  FabricUnit,
  TrimAccessory,
  TrimPurchaseUnit,
} from '../../types/erp';
import {
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  getTrimUnitCost,
  PURCHASE_UNIT_LABELS,
} from '../../utils/calculations';
import { Modal } from '../common/Modal';

type SubTab = 'fabrics' | 'trims';

const EMPTY_FABRIC: Omit<Fabric, 'id'> = {
  name: '',
  supplier: '',
  unit: 'meter',
  pricePerUnit: 0,
  widthCm: 150,
  defaultWastePct: 6,
  stockQty: 0,
  reorderLevel: 20,
  colorOrCode: '',
  notes: '',
};

const EMPTY_TRIM: Omit<TrimAccessory, 'id'> = {
  name: '',
  category: 'إكسسوارات',
  supplier: '',
  purchaseUnit: 'dozen',
  packPrice: 0,
  unitsPerPack: 12,
  unitLabel: 'قطعة',
  stockQty: 0,
  reorderLevel: 50,
  notes: '',
};

export const MaterialsView: React.FC = () => {
  const { state, saveFabric, deleteFabric, saveTrim, deleteTrim } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('fabrics');
  const [query, setQuery] = useState('');

  // Fabric modal state
  const [fabricModalOpen, setFabricModalOpen] = useState(false);
  const [editingFabricId, setEditingFabricId] = useState<string | null>(null);
  const [fabricForm, setFabricForm] = useState<Omit<Fabric, 'id'>>(EMPTY_FABRIC);

  // Trim modal state
  const [trimModalOpen, setTrimModalOpen] = useState(false);
  const [editingTrimId, setEditingTrimId] = useState<string | null>(null);
  const [trimForm, setTrimForm] = useState<Omit<TrimAccessory, 'id'>>(EMPTY_TRIM);

  const filteredFabrics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.fabrics;
    return state.fabrics.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.supplier.toLowerCase().includes(q) ||
        (f.colorOrCode || '').toLowerCase().includes(q)
    );
  }, [state.fabrics, query]);

  const filteredTrims = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.trims;
    return state.trims.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.supplier.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
    );
  }, [state.trims, query]);

  const openNewFabric = () => {
    setEditingFabricId(null);
    setFabricForm(EMPTY_FABRIC);
    setFabricModalOpen(true);
  };

  const openEditFabric = (fabric: Fabric) => {
    setEditingFabricId(fabric.id);
    setFabricForm({
      name: fabric.name,
      supplierId: fabric.supplierId,
      supplier: fabric.supplier,
      unit: fabric.unit,
      pricePerUnit: fabric.pricePerUnit,
      widthCm: fabric.widthCm,
      defaultWastePct: fabric.defaultWastePct,
      stockQty: fabric.stockQty ?? 0,
      reorderLevel: fabric.reorderLevel ?? 20,
      colorOrCode: fabric.colorOrCode || '',
      notes: fabric.notes || '',
    });
    setFabricModalOpen(true);
  };

  const handleFabricSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fabricForm.name.trim()) return;
    saveFabric({
      id: editingFabricId || newUuid(),
      ...fabricForm,
      pricePerUnit: Number(fabricForm.pricePerUnit) || 0,
      widthCm: Number(fabricForm.widthCm) || 150,
      defaultWastePct: Number(fabricForm.defaultWastePct) || 0,
    });
    setFabricModalOpen(false);
  };

  const openNewTrim = () => {
    setEditingTrimId(null);
    setTrimForm(EMPTY_TRIM);
    setTrimModalOpen(true);
  };

  const openEditTrim = (trim: TrimAccessory) => {
    setEditingTrimId(trim.id);
    setTrimForm({
      name: trim.name,
      category: trim.category,
      supplierId: trim.supplierId,
      supplier: trim.supplier,
      purchaseUnit: trim.purchaseUnit,
      packPrice: trim.packPrice,
      unitsPerPack: trim.unitsPerPack,
      unitLabel: trim.unitLabel,
      stockQty: trim.stockQty ?? 0,
      reorderLevel: trim.reorderLevel ?? 50,
      notes: trim.notes || '',
    });
    setTrimModalOpen(true);
  };

  const handleTrimUnitPreset = (unit: TrimPurchaseUnit) => {
    const defaultQty =
      unit === 'dozen'
        ? 12
        : unit === 'piece'
        ? 1
        : unit === 'weight'
        ? 1000
        : trimForm.unitsPerPack || 100;
    setTrimForm((prev) => ({
      ...prev,
      purchaseUnit: unit,
      unitsPerPack: defaultQty,
      unitLabel: unit === 'weight' ? 'جرام' : prev.unitLabel === 'جرام' ? 'قطعة' : prev.unitLabel,
    }));
  };

  const handleTrimSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimForm.name.trim()) return;
    saveTrim({
      id: editingTrimId || newUuid(),
      ...trimForm,
      packPrice: Number(trimForm.packPrice) || 0,
      unitsPerPack: Math.max(1, Number(trimForm.unitsPerPack) || 1),
    });
    setTrimModalOpen(false);
  };

  const previewTrimUnitCost =
    (Number(trimForm.packPrice) || 0) / Math.max(1, Number(trimForm.unitsPerPack) || 1);

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 bg-white p-3.5 sm:p-4 rounded-2xl border border-[#E5E3DD]">
        <div className="grid grid-cols-2 sm:inline-flex rounded-xl bg-[#F3F2EE] p-1 w-full md:w-auto">
          <button
            id="tab-fabrics"
            type="button"
            onClick={() => setSubTab('fabrics')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              subTab === 'fabrics'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <Layers className="w-4 h-4 text-[#BD956D] shrink-0" />
            <span>الأقمشة ({state.fabrics.length})</span>
          </button>
          <button
            id="tab-trims"
            type="button"
            onClick={() => setSubTab('trims')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              subTab === 'trims'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <PackageOpen className="w-4 h-4 text-[#BD956D] shrink-0" />
            <span>الكلف ({state.trims.length})</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9C9990] absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                subTab === 'fabrics'
                  ? 'ابحث باسم القماش أو المورد...'
                  : 'ابحث باسم الكلفة أو التصنيف...'
              }
              className="w-full sm:w-64 rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-sm text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
            />
          </div>

          <button
            id={subTab === 'fabrics' ? 'btn-add-fabric' : 'btn-add-trim'}
            type="button"
            onClick={subTab === 'fabrics' ? openNewFabric : openNewTrim}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-sm font-semibold px-4 py-2.5 sm:py-2 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{subTab === 'fabrics' ? 'إضافة قماش جديد' : 'إضافة كلفة / إكسسوار'}</span>
          </button>
        </div>
      </div>

      {/* Fabrics List (Mobile Cards + Desktop Table) */}
      {subTab === 'fabrics' && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
          <div className="md:hidden divide-y divide-[#F0EFEA]">
            {filteredFabrics.map((fabric) => {
              const effectivePrice =
                fabric.pricePerUnit * (1 + fabric.defaultWastePct / 100);
              return (
                <div key={fabric.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-[#1A1A1E]">{fabric.name}</div>
                      <div className="text-xs text-[#6E6C66] mt-0.5">{fabric.supplier}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditFabric(fabric)}
                        className="p-2 rounded-lg bg-[#FAF9F7] text-[#4B4A46] cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteFabric(fabric.id)}
                        className="p-2 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] bg-[#FAF9F7] rounded-xl p-2.5">
                    <div>
                      <div className="text-[#6E6C66]">السعر</div>
                      <div className="font-bold tabular-nums">
                        {formatMoney(fabric.pricePerUnit, state.currency)}/{FABRIC_UNIT_LABELS[fabric.unit]}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6E6C66]">العرض / هالك</div>
                      <div className="font-semibold tabular-nums">
                        {fabric.widthCm}سم • {fabric.defaultWastePct}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6E6C66]">بالهالك</div>
                      <div className="font-bold text-[#8E6742] tabular-nums">
                        {formatMoney(effectivePrice, state.currency)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredFabrics.length === 0 && (
              <div className="p-8 text-center text-xs text-[#6E6C66]">
                لا توجد أقمشة مطابقة للبحث.
              </div>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">اسم القماش</th>
                  <th className="py-3.5 px-4 font-semibold">المورد</th>
                  <th className="py-3.5 px-4 font-semibold">السعر / الوحدة</th>
                  <th className="py-3.5 px-4 font-semibold">العرض</th>
                  <th className="py-3.5 px-4 font-semibold">الهالك الافتراضي</th>
                  <th className="py-3.5 px-4 font-semibold">التكلفة الفعلية بالهالك</th>
                  <th className="py-3.5 px-4 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EFEA]">
                {filteredFabrics.map((fabric) => {
                  const effectivePrice =
                    fabric.pricePerUnit * (1 + fabric.defaultWastePct / 100);
                  return (
                    <tr key={fabric.id} className="hover:bg-[#FAF9F7]/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[#1A1A1E]">{fabric.name}</div>
                        {(fabric.colorOrCode || fabric.notes) && (
                          <div className="text-xs text-[#6E6C66] mt-0.5 truncate max-w-xs">
                            {fabric.colorOrCode && (
                              <span className="font-mono text-[#8E6742] ml-2">
                                [{fabric.colorOrCode}]
                              </span>
                            )}
                            {fabric.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-[#4B4A46]">{fabric.supplier}</td>
                      <td className="py-3.5 px-4 tabular-nums font-semibold text-[#1A1A1E]">
                        {formatMoney(fabric.pricePerUnit, state.currency)}{' '}
                        <span className="text-xs font-normal text-[#6E6C66]">
                          / {FABRIC_UNIT_LABELS[fabric.unit]}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-[#4B4A46]">
                        {fabric.widthCm} سم
                      </td>
                      <td className="py-3.5 px-4 tabular-nums">
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-[#F3F2EE] text-[#1A1A1E] text-xs font-semibold">
                          {fabric.defaultWastePct}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums font-bold text-[#8E6742]">
                        {formatMoney(effectivePrice, state.currency)}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditFabric(fabric)}
                            aria-label="تعديل القماش"
                            className="p-1.5 rounded-lg text-[#4B4A46] hover:text-[#1A1A1E] hover:bg-[#F3F2EE] cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteFabric(fabric.id)}
                            aria-label="حذف القماش"
                            className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredFabrics.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[#6E6C66]">
                      لا توجد أقمشة مطابقة للبحث.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trims & Accessories List (Mobile Cards + Desktop Table) */}
      {subTab === 'trims' && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
          <div className="md:hidden divide-y divide-[#F0EFEA]">
            {filteredTrims.map((trim) => {
              const unitCost = getTrimUnitCost(trim);
              return (
                <div key={trim.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-[#1A1A1E]">{trim.name}</div>
                      <span className="inline-flex mt-1 px-2 py-0.5 rounded-full bg-[#F6EFE7] text-[#8E6742] text-[11px] font-medium">
                        {trim.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditTrim(trim)}
                        className="p-2 rounded-lg bg-[#FAF9F7] text-[#4B4A46] cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTrim(trim.id)}
                        className="p-2 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-[#FAF9F7] rounded-xl p-2.5">
                    <div>
                      <div className="text-[#6E6C66]">
                        العبوة ({formatNumber(trim.unitsPerPack, 0)} {trim.unitLabel})
                      </div>
                      <div className="font-semibold tabular-nums">
                        {formatMoney(trim.packPrice, state.currency)} / {PURCHASE_UNIT_LABELS[trim.purchaseUnit]}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6E6C66]">تكلفة الوحدة</div>
                      <div className="font-bold text-[#8E6742] tabular-nums">
                        {formatMoney(unitCost, state.currency)} / {trim.unitLabel}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredTrims.length === 0 && (
              <div className="p-8 text-center text-xs text-[#6E6C66]">
                لا توجد كلف أو إكسسوارات مطابقة للبحث.
              </div>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">اسم الكلفة / الإكسسوار</th>
                  <th className="py-3.5 px-4 font-semibold">التصنيف</th>
                  <th className="py-3.5 px-4 font-semibold">المورد</th>
                  <th className="py-3.5 px-4 font-semibold">شراء بالعبوة</th>
                  <th className="py-3.5 px-4 font-semibold">تحويل الوحدة</th>
                  <th className="py-3.5 px-4 font-semibold">تكلفة الوحدة الواحدة</th>
                  <th className="py-3.5 px-4 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EFEA]">
                {filteredTrims.map((trim) => {
                  const unitCost = getTrimUnitCost(trim);
                  return (
                    <tr key={trim.id} className="hover:bg-[#FAF9F7]/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[#1A1A1E]">{trim.name}</div>
                        {trim.notes && (
                          <div className="text-xs text-[#6E6C66] mt-0.5 truncate max-w-xs">
                            {trim.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#F6EFE7] text-[#8E6742] text-xs font-medium">
                          {trim.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[#4B4A46]">{trim.supplier}</td>
                      <td className="py-3.5 px-4 tabular-nums text-[#1A1A1E]">
                        {formatMoney(trim.packPrice, state.currency)}{' '}
                        <span className="text-xs text-[#6E6C66]">
                          / {PURCHASE_UNIT_LABELS[trim.purchaseUnit]}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-xs text-[#6E6C66]">
                        {formatNumber(trim.unitsPerPack, 0)} {trim.unitLabel}
                      </td>
                      <td className="py-3.5 px-4 tabular-nums font-bold text-[#8E6742]">
                        {formatMoney(unitCost, state.currency)}{' '}
                        <span className="text-xs font-normal text-[#6E6C66]">
                          / {trim.unitLabel}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditTrim(trim)}
                            aria-label="تعديل الكلفة"
                            className="p-1.5 rounded-lg text-[#4B4A46] hover:text-[#1A1A1E] hover:bg-[#F3F2EE] cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTrim(trim.id)}
                            aria-label="حذف الكلفة"
                            className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredTrims.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[#6E6C66]">
                      لا توجد كلف أو إكسسوارات مطابقة للبحث.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fabric Modal */}
      <Modal
        open={fabricModalOpen}
        onClose={() => setFabricModalOpen(false)}
        title={editingFabricId ? 'تعديل بيانات القماش' : 'إضافة قماش جديد'}
        subtitle="أدخل سعر المتر أو الكيلو ونسبة الهالك الافتراضية لاستخدامها تلقائياً في بطاقة الموديل"
      >
        <form onSubmit={handleFabricSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                اسم القماش *
              </label>
              <input
                type="text"
                required
                value={fabricForm.name}
                onChange={(e) => setFabricForm({ ...fabricForm, name: e.target.value })}
                placeholder="مثال: كريب ندى كوري أصلي"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                المورد
              </label>
              <select
                value={fabricForm.supplierId || ''}
                onChange={(e) => {
                  const sup = state.suppliers.find((s) => s.id === e.target.value);
                  setFabricForm({
                    ...fabricForm,
                    supplierId: sup ? sup.id : null,
                    supplier: sup ? sup.name : fabricForm.supplier || 'مورد عام',
                  });
                }}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              >
                <option value="">-- اختر المورد من البيانات الأساسية --</option>
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                كود / لون القماش
              </label>
              <input
                type="text"
                value={fabricForm.colorOrCode}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, colorOrCode: e.target.value })
                }
                placeholder="مثال: CR-ND-01"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                وحدة التسعير
              </label>
              <select
                value={fabricForm.unit}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, unit: e.target.value as FabricUnit })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                <option value="meter">بالمتر</option>
                <option value="kg">بالكيلو</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                السعر لكل {FABRIC_UNIT_LABELS[fabricForm.unit]} *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={fabricForm.pricePerUnit}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, pricePerUnit: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                العرض (سم)
              </label>
              <input
                type="number"
                min="10"
                value={fabricForm.widthCm}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, widthCm: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                نسبة الهالك الافتراضية (%)
              </label>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={fabricForm.defaultWastePct}
                onChange={(e) =>
                  setFabricForm({
                    ...fabricForm,
                    defaultWastePct: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                ملاحظات
              </label>
              <textarea
                rows={2}
                value={fabricForm.notes}
                onChange={(e) => setFabricForm({ ...fabricForm, notes: e.target.value })}
                placeholder="ملاحظات عن الانكماش أو طبيعة القماش..."
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setFabricModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-[#1A1A1E] hover:bg-[#2E2E35] text-white cursor-pointer"
            >
              {editingFabricId ? 'حفظ التعديلات' : 'إضافة القماش'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Trim Modal with Live Unit Conversion */}
      <Modal
        open={trimModalOpen}
        onClose={() => setTrimModalOpen(false)}
        title={editingTrimId ? 'تعديل الكلفة / الإكسسوار' : 'إضافة كلفة / إكسسوار جديد'}
        subtitle="أدخل سعر العبوة أو الدستة أو اللّفة وسيتم احتساب تكلفة القطعة الواحدة تلقائياً"
      >
        <form onSubmit={handleTrimSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                اسم الكلفة / الإكسسوار *
              </label>
              <input
                type="text"
                required
                value={trimForm.name}
                onChange={(e) => setTrimForm({ ...trimForm, name: e.target.value })}
                placeholder="مثال: تيكت DressCode منسوج / سحاب مخفي / أزرار لؤلؤ"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                التصنيف
              </label>
              <select
                value={trimForm.category}
                onChange={(e) => setTrimForm({ ...trimForm, category: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                {getLookupLabels(state.lookups, 'trim_categories').map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                المورد
              </label>
              <select
                value={trimForm.supplierId || ''}
                onChange={(e) => {
                  const sup = state.suppliers.find((s) => s.id === e.target.value);
                  setTrimForm({
                    ...trimForm,
                    supplierId: sup ? sup.id : null,
                    supplier: sup ? sup.name : trimForm.supplier || 'مورد عام',
                  });
                }}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              >
                <option value="">-- اختر المورد من البيانات الأساسية --</option>
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                وحدة الشراء
              </label>
              <select
                value={trimForm.purchaseUnit}
                onChange={(e) =>
                  handleTrimUnitPreset(e.target.value as TrimPurchaseUnit)
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                {Object.entries(PURCHASE_UNIT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                سعر الشراء للعبوة / الدستة *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={trimForm.packPrice}
                onChange={(e) =>
                  setTrimForm({ ...trimForm, packPrice: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                عدد الوحدات داخل العبوة *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                required
                value={trimForm.unitsPerPack}
                onChange={(e) =>
                  setTrimForm({ ...trimForm, unitsPerPack: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                مسمى الوحدة الواحدة
              </label>
              <input
                type="text"
                value={trimForm.unitLabel}
                onChange={(e) => setTrimForm({ ...trimForm, unitLabel: e.target.value })}
                placeholder="مثال: زر / تيكت / سحاب / كيس"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>
          </div>

          {/* Live Unit Conversion Banner */}
          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#7B5836]">
              التكلفة المحسوبة لكل ({trimForm.unitLabel || 'قطعة'}):
            </span>
            <span className="text-base font-bold text-[#8E6742] tabular-nums">
              {formatMoney(previewTrimUnitCost, state.currency)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setTrimModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-[#1A1A1E] hover:bg-[#2E2E35] text-white cursor-pointer"
            >
              {editingTrimId ? 'حفظ التعديلات' : 'إضافة الكلفة'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
