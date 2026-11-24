import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Clock,
  Edit3,
  Hammer,
  Layers,
  Package,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { newUuid } from '../../lib/supabase';
import type {
  LaborBillingType,
  OperationMaterialItem,
  OperationServiceItem,
  OutsourcedOperation,
} from '../../types/erp';
import {
  blockNonIntegerKey,
  formatMoney,
  getLaborStepUnitCost,
  getTrimUnitCost,
  toWholeQty,
} from '../../utils/calculations';
import { Modal } from '../common/Modal';

interface OperationFormState {
  name: string;
  workshopId?: string | null;
  workshopName: string;
  billingType: LaborBillingType;
  laborCost: number;
  batchSize: number;
  leadTimeDays: number;
  services: OperationServiceItem[];
  suppliedMaterials: OperationMaterialItem[];
  notes: string;
}

const EMPTY_FORM: OperationFormState = {
  name: '',
  workshopId: null,
  workshopName: '',
  billingType: 'per_piece',
  laborCost: 0,
  batchSize: 1,
  leadTimeDays: 1,
  services: [],
  suppliedMaterials: [],
  notes: '',
};

const QUICK_SERVICE_PRESETS = [
  'القص (باترون ومقصدار)',
  'الخياطة والتقفيل',
  'السرفلة والأوفرلوك',
  'الكي بالبخار والتشطيب',
  'التطريز (يدوي / كمبيوتر)',
  'تكسير البليسيه',
  'عراوي وتركيب زراير',
  'فحص الجودة والتغليف',
];

const QUICK_MATERIAL_PRESETS: { name: string; unit: string }[] = [
  { name: 'زراير', unit: 'قطعة' },
  { name: 'سوستة', unit: 'قطعة' },
  { name: 'خيوط', unit: 'بكرة' },
  { name: 'فازلين / حشو', unit: 'متر' },
  { name: 'إكسسوار إضافي', unit: 'قطعة' },
];

const calcMaterialsTotal = (items: OperationMaterialItem[]) =>
  Math.round(
    items.reduce(
      (sum, item) =>
        sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0),
      0
    ) * 100
  ) / 100;

const calcServicesTotal = (items: OperationServiceItem[]) =>
  Math.round(
    items.reduce((sum, item) => sum + Math.max(0, Number(item.cost) || 0), 0) * 100
  ) / 100;

export const OutsourcedLaborView: React.FC = () => {
  const { state, saveOperation, deleteOperation } = useERP();
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OperationFormState>(EMPTY_FORM);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.operations;
    return state.operations.filter(
      (op) =>
        op.name.toLowerCase().includes(q) ||
        op.workshopName.toLowerCase().includes(q) ||
        (op.services || []).some((s) => s.name.toLowerCase().includes(q)) ||
        (op.suppliedMaterials || []).some((m) => m.name.toLowerCase().includes(q))
    );
  }, [state.operations, query]);

  const uniqueWorkshops = useMemo(() => {
    const set = new Set(state.operations.map((o) => o.workshopName));
    return set.size;
  }, [state.operations]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setNameManuallyEdited(false);
    setModalOpen(true);
  };

  const openEdit = (op: OutsourcedOperation) => {
    const services = (op.services || []).map((s) => ({ ...s }));
    const suppliedMaterials = (op.suppliedMaterials || []).map((m) => ({ ...m }));
    const materialsTotal = calcMaterialsTotal(suppliedMaterials);
    const servicesTotal = calcServicesTotal(services);
    const derivedLaborCost =
      servicesTotal > 0 ? servicesTotal : Math.max(0, Math.round((op.cost - materialsTotal) * 100) / 100);

    setEditingId(op.id);
    setForm({
      name: op.name,
      workshopId: op.workshopId ?? null,
      workshopName: op.workshopName,
      billingType: op.billingType,
      laborCost: derivedLaborCost,
      batchSize: op.batchSize,
      leadTimeDays: op.leadTimeDays ?? 1,
      services,
      suppliedMaterials,
      notes: op.notes || '',
    });
    setNameManuallyEdited(true);
    setModalOpen(true);
  };

  const syncAutoName = (nextServices: OperationServiceItem[], currentName: string) => {
    if (nameManuallyEdited && currentName.trim() !== '') return currentName;
    if (nextServices.length === 0) return currentName;
    return nextServices
      .map((s) => s.name.trim())
      .filter(Boolean)
      .join(' + ');
  };

  const togglePresetService = (presetName: string) => {
    setForm((prev) => {
      const exists = prev.services.some((s) => s.name === presetName);
      const nextServices = exists
        ? prev.services.filter((s) => s.name !== presetName)
        : [...prev.services, { id: newUuid(), name: presetName, cost: 0 }];
      return {
        ...prev,
        services: nextServices,
        name: syncAutoName(nextServices, prev.name),
      };
    });
  };

  const addCustomService = () => {
    setForm((prev) => ({
      ...prev,
      services: [...prev.services, { id: newUuid(), name: '', cost: 0 }],
    }));
  };

  const updateService = (id: string, patch: Partial<OperationServiceItem>) => {
    setForm((prev) => {
      const nextServices = prev.services.map((s) => (s.id === id ? { ...s, ...patch } : s));
      return {
        ...prev,
        services: nextServices,
        name: patch.name !== undefined ? syncAutoName(nextServices, prev.name) : prev.name,
      };
    });
  };

  const removeService = (id: string) => {
    setForm((prev) => {
      const nextServices = prev.services.filter((s) => s.id !== id);
      return {
        ...prev,
        services: nextServices,
        name: syncAutoName(nextServices, prev.name),
      };
    });
  };

  const addMaterialRow = (preset?: {
    name: string;
    unit: string;
    unitPrice?: number;
    trimId?: string | null;
  }) => {
    setForm((prev) => ({
      ...prev,
      suppliedMaterials: [
        ...prev.suppliedMaterials,
        {
          id: newUuid(),
          name: preset?.name || '',
          trimId: preset?.trimId ?? null,
          quantity: 1,
          unit: preset?.unit || 'قطعة',
          unitPrice: preset?.unitPrice ?? 0,
        },
      ],
    }));
  };

  const updateMaterialRow = (id: string, patch: Partial<OperationMaterialItem>) => {
    setForm((prev) => ({
      ...prev,
      suppliedMaterials: prev.suppliedMaterials.map((m) =>
        m.id === id ? { ...m, ...patch } : m
      ),
    }));
  };

  const removeMaterialRow = (id: string) => {
    setForm((prev) => ({
      ...prev,
      suppliedMaterials: prev.suppliedMaterials.filter((m) => m.id !== id),
    }));
  };

  const servicesItemizedTotal = calcServicesTotal(form.services);
  const hasItemizedServices = servicesItemizedTotal > 0;
  const effectiveLaborCost = hasItemizedServices
    ? servicesItemizedTotal
    : Math.max(0, Number(form.laborCost) || 0);
  const materialsTotal = calcMaterialsTotal(form.suppliedMaterials);
  const totalOperationCost = Math.round((effectiveLaborCost + materialsTotal) * 100) / 100;

  const previewUnitCost = getLaborStepUnitCost({
    billingType: form.billingType,
    cost: totalOperationCost,
    batchSize: Math.max(1, Number(form.batchSize) || 1),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanServices = form.services
      .map((s) => ({
        id: s.id,
        name: s.name.trim(),
        cost: Math.max(0, Number(s.cost) || 0),
      }))
      .filter((s) => s.name !== '');

    const cleanMaterials = form.suppliedMaterials
      .map((m) => ({
        id: m.id,
        name: m.name.trim(),
        trimId: m.trimId || null,
        quantity: Math.max(0, Number(m.quantity) || 0),
        unit: m.unit.trim() || 'قطعة',
        unitPrice: Math.max(0, Number(m.unitPrice) || 0),
      }))
      .filter((m) => m.name !== '' && m.quantity > 0);

    const finalName =
      form.name.trim() || cleanServices.map((s) => s.name).join(' + ');
    if (!finalName) return;

    const finalServicesTotal = calcServicesTotal(cleanServices);
    const finalMaterialsTotal = calcMaterialsTotal(cleanMaterials);
    const finalLabor =
      finalServicesTotal > 0 ? finalServicesTotal : Math.max(0, Number(form.laborCost) || 0);
    const finalTotalCost = Math.round((finalLabor + finalMaterialsTotal) * 100) / 100;

    saveOperation({
      id: editingId || newUuid(),
      name: finalName,
      workshopId: form.workshopId || null,
      workshopName: form.workshopName.trim() || 'ورشة خارجية',
      billingType: form.billingType,
      cost: finalTotalCost,
      batchSize:
        form.billingType === 'per_batch' ? Math.max(1, Number(form.batchSize) || 1) : 1,
      leadTimeDays: Math.max(1, Number(form.leadTimeDays) || 1),
      services: cleanServices,
      suppliedMaterials: cleanMaterials,
      notes: form.notes.trim(),
    });
    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#F6EFE7] text-[#A67C52] flex items-center justify-center shrink-0">
            <Hammer className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[#6E6C66]">مراحل التشغيل المسجلة</div>
            <div className="text-xl font-bold text-[#1A1A1E] tabular-nums">
              {state.operations.length} مرحلة
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#F3F2EE] text-[#1A1A1E] flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[#6E6C66]">الورش والمصانع المتعاقدة</div>
            <div className="text-xl font-bold text-[#1A1A1E] tabular-nums">
              {uniqueWorkshops} ورشة / مصنع
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#1A1A1E] text-[#BD956D] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[#6E6C66]">متوسط تكلفة المرحلة للقطعة</div>
            <div className="text-xl font-bold text-[#1A1A1E] tabular-nums">
              {formatMoney(
                state.operations.length > 0
                  ? state.operations.reduce(
                      (sum, op) => sum + getLaborStepUnitCost(op),
                      0
                    ) / state.operations.length
                  : 0,
                state.currency
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Search & Add Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[#E5E3DD]">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#9C9990] absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم المرحلة، خدمة (سرفلة، كي، تطريز)، خامة (زراير)، أو الورشة"
            className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-sm text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
          />
        </div>
        <button
          id="btn-add-operation"
          type="button"
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-sm font-semibold px-4 py-2 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مرحلة تشغيل جديدة</span>
        </button>
      </div>

      {/* Operations List (Mobile Cards + Desktop Table) */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {filtered.map((op) => {
            const unitCost = getLaborStepUnitCost(op);
            const services = op.services || [];
            const materials = op.suppliedMaterials || [];
            const matTotal = calcMaterialsTotal(materials);
            return (
              <div key={op.id} className="p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1A1A1E]">{op.name}</div>
                    <div className="text-xs text-[#6E6C66] mt-0.5">{op.workshopName}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(op)}
                      className="p-2 rounded-lg bg-[#FAF9F7] text-[#4B4A46] cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteOperation(op.id)}
                      className="p-2 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {(services.length > 0 || materials.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F6EFE7] text-[#7B5836]"
                      >
                        {s.name}
                        {s.cost > 0 && (
                          <span className="tabular-nums opacity-80">
                            ({formatMoney(s.cost, state.currency)})
                          </span>
                        )}
                      </span>
                    ))}
                    {materials.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200"
                      >
                        <Package className="w-2.5 h-2.5" />
                        {m.name} ({m.quantity} {m.unit})
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs bg-[#FAF9F7] rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full bg-white border border-[#E5E3DD] font-semibold">
                      {op.billingType === 'per_batch' ? `باتش (${op.batchSize})` : 'بالقطعة'}
                    </span>
                    {matTotal > 0 && (
                      <span className="text-[10px] text-emerald-700 font-semibold tabular-nums">
                        شامل خامات {formatMoney(matTotal, state.currency)}
                      </span>
                    )}
                  </div>
                  <span className="font-bold text-[#8E6742] tabular-nums">
                    {formatMoney(unitCost, state.currency)} / قطعة
                  </span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-xs text-[#6E6C66]">
              لا توجد مراحل تشغيل مطابقة للبحث.
            </div>
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3.5 px-4 font-semibold">المرحلة / الخدمات والخامات</th>
                <th className="py-3.5 px-4 font-semibold">الورشة / العامل</th>
                <th className="py-3.5 px-4 font-semibold">نظام المحاسبة</th>
                <th className="py-3.5 px-4 font-semibold">الإجمالي المتفق عليه</th>
                <th className="py-3.5 px-4 font-semibold">تكلفة القطعة الواحدة</th>
                <th className="py-3.5 px-4 font-semibold">مدة التنفيذ</th>
                <th className="py-3.5 px-4 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {filtered.map((op) => {
                const unitCost = getLaborStepUnitCost(op);
                const services = op.services || [];
                const materials = op.suppliedMaterials || [];
                const matTotal = calcMaterialsTotal(materials);
                return (
                  <tr key={op.id} className="hover:bg-[#FAF9F7]/80 transition-colors">
                    <td className="py-3.5 px-4 max-w-md">
                      <div className="font-semibold text-[#1A1A1E]">{op.name}</div>
                      {(services.length > 0 || materials.length > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {services.map((s) => (
                            <span
                              key={s.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#F6EFE7] text-[#7B5836]"
                            >
                              {s.name}
                              {s.cost > 0 && (
                                <span className="tabular-nums opacity-80">
                                  ({formatMoney(s.cost, state.currency)})
                                </span>
                              )}
                            </span>
                          ))}
                          {materials.map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                            >
                              <Package className="w-3 h-3" />
                              {m.name} ({m.quantity} {m.unit}
                              {m.unitPrice > 0
                                ? ` • ${formatMoney(m.quantity * m.unitPrice, state.currency)}`
                                : ''}
                              )
                            </span>
                          ))}
                        </div>
                      )}
                      {op.notes && (
                        <div className="text-xs text-[#6E6C66] mt-1 truncate max-w-sm">
                          {op.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-[#4B4A46]">{op.workshopName}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          op.billingType === 'per_batch'
                            ? 'bg-[#F6EFE7] text-[#8E6742]'
                            : 'bg-[#F3F2EE] text-[#1A1A1E]'
                        }`}
                      >
                        {op.billingType === 'per_batch'
                          ? `بالباتش (${op.batchSize} قطعة)`
                          : 'بالقطعة'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 tabular-nums text-[#1A1A1E]">
                      <div className="font-semibold">{formatMoney(op.cost, state.currency)}</div>
                      {matTotal > 0 && (
                        <div className="text-[11px] text-emerald-700 font-medium mt-0.5">
                          منها خامات: {formatMoney(matTotal, state.currency)}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 tabular-nums font-bold text-[#8E6742]">
                      {formatMoney(unitCost, state.currency)}
                    </td>
                    <td className="py-3.5 px-4 text-[#6E6C66] text-xs">
                      {op.leadTimeDays || 1} يوم
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(op)}
                          aria-label="تعديل المرحلة"
                          className="p-1.5 rounded-lg text-[#4B4A46] hover:text-[#1A1A1E] hover:bg-[#F3F2EE] cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOperation(op.id)}
                          aria-label="حذف المرحلة"
                          className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#6E6C66]">
                    لا توجد مراحل تشغيل مطابقة للبحث.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'تعديل مرحلة التشغيل الخارجي' : 'إضافة مرحلة تشغيل خارجي'}
        subtitle="يمكنك تجميع أكثر من خدمة في نفس المرحلة (قص، سرفلة، كي وبخار، تطريز...) وإضافة أي خامات أو زراير مشتراة من نفس الورشة"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Multi-Service Selection */}
          <div className="rounded-xl bg-[#FAF9F7] border border-[#E5E3DD] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#1A1A1E]">
                <Layers className="w-4 h-4 text-[#A67C52]" />
                <span>الخدمات المشمولة في هذه المرحلة (يمكن اختيار أكثر من خدمة):</span>
              </div>
              <button
                type="button"
                onClick={addCustomService}
                className="inline-flex items-center gap-1 text-[11px] font-bold bg-white hover:bg-[#F6EFE7] text-[#8E6742] border border-[#E5E3DD] px-2.5 py-1 rounded-lg cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                خدمة مخصصة
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_SERVICE_PRESETS.map((preset) => {
                const active = form.services.some((s) => s.name === preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => togglePresetService(preset)}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#A67C52] text-white border-[#A67C52] font-semibold'
                        : 'bg-white hover:bg-[#F6EFE7] hover:text-[#8E6742] text-[#1A1A1E] border-[#E5E3DD]'
                    }`}
                  >
                    {active && <Check className="w-3 h-3" />}
                    <span>{preset}</span>
                  </button>
                );
              })}
            </div>

            {form.services.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[#EAE8E2]">
                <div className="flex items-center justify-between text-[11px] text-[#6E6C66]">
                  <span>الخدمات المختارة ({form.services.length}):</span>
                  <span>
                    سعر كل خدمة اختياري — اتركه 0 لإدخال سعر مجمع بالأسفل
                  </span>
                </div>
                {form.services.map((srv) => (
                  <div
                    key={srv.id}
                    className="grid grid-cols-12 gap-2 items-center bg-white border border-[#EAE8E2] rounded-xl p-2"
                  >
                    <input
                      type="text"
                      required
                      value={srv.name}
                      onChange={(e) => updateService(srv.id, { name: e.target.value })}
                      placeholder="اسم الخدمة (مثال: كي وبخار)"
                      className="col-span-7 sm:col-span-8 rounded-lg border border-[#E5E3DD] px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={srv.cost}
                      onChange={(e) =>
                        updateService(srv.id, { cost: Math.max(0, Number(e.target.value) || 0) })
                      }
                      placeholder="السعر"
                      title={
                        form.billingType === 'per_batch'
                          ? 'تكلفة هذه الخدمة للباتش'
                          : 'تكلفة هذه الخدمة للقطعة'
                      }
                      className="col-span-4 sm:col-span-3 rounded-lg border border-[#E5E3DD] px-2 py-1.5 text-xs text-center tabular-nums focus:outline-none focus:border-[#A67C52]"
                    />
                    <button
                      type="button"
                      onClick={() => removeService(srv.id)}
                      aria-label="إزالة الخدمة"
                      className="col-span-1 flex justify-center p-1 text-[#9C9990] hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                اسم المرحلة / الباقة *
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => {
                  setNameManuallyEdited(true);
                  setForm({ ...form, name: e.target.value });
                }}
                placeholder="مثال: قص + سرفلة + كي بالبخار (أو اختر الخدمات أعلاه للتعبئة التلقائية)"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                  اختر الورشة من البيانات الأساسية
                </label>
                <select
                  value={form.workshopId || ''}
                  onChange={(e) => {
                    const ws = state.workshops.find((w) => w.id === e.target.value);
                    setForm({
                      ...form,
                      workshopId: ws ? ws.id : null,
                      workshopName: ws ? ws.name : form.workshopName,
                    });
                  }}
                  className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="">-- اختر ورشة / مصنع --</option>
                  {state.workshops.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                  اسم الورشة / المصنع / العامل *
                </label>
                <input
                  type="text"
                  required
                  value={form.workshopName}
                  onChange={(e) => setForm({ ...form, workshopName: e.target.value })}
                  placeholder="مثال: مصنع الأناقة للتشغيل"
                  className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                نظام المحاسبة
              </label>
              <select
                value={form.billingType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    billingType: e.target.value as LaborBillingType,
                    batchSize: e.target.value === 'per_batch' ? Math.max(form.batchSize, 50) : 1,
                  })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                <option value="per_piece">بالقطعة الواحدة</option>
                <option value="per_batch">بالباتش / التشغيلة</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                {form.billingType === 'per_batch'
                  ? 'أجر خدمات التشغيل للباتش *'
                  : 'أجر خدمات التشغيل للقطعة *'}
                {hasItemizedServices && (
                  <span className="text-[10px] font-normal text-[#8E6742] mr-1">
                    (مجموع أسعار الخدمات)
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                disabled={hasItemizedServices}
                value={hasItemizedServices ? servicesItemizedTotal : form.laborCost}
                onChange={(e) => setForm({ ...form, laborCost: Number(e.target.value) })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52] disabled:bg-[#F3F2EE] disabled:text-[#4B4A46]"
              />
            </div>

            {form.billingType === 'per_batch' && (
              <div>
                <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                  عدد القطع في الباتش *
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  value={form.batchSize || ''}
                  onKeyDown={blockNonIntegerKey}
                  onChange={(e) =>
                    setForm({ ...form, batchSize: toWholeQty(e.target.value, 0) })
                  }
                  onBlur={() =>
                    setForm({ ...form, batchSize: toWholeQty(form.batchSize, 1) })
                  }
                  className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                مدة التنفيذ التقريبية (أيام)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                pattern="[0-9]*"
                value={form.leadTimeDays || ''}
                onKeyDown={blockNonIntegerKey}
                onChange={(e) =>
                  setForm({ ...form, leadTimeDays: toWholeQty(e.target.value, 0) })
                }
                onBlur={() =>
                  setForm({ ...form, leadTimeDays: toWholeQty(form.leadTimeDays, 1) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>
          </div>

          {/* Workshop-Supplied Materials / Accessories */}
          <div className="rounded-xl bg-emerald-50/40 border border-emerald-200/80 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                <Package className="w-4 h-4 text-emerald-700" />
                <span>خامات وإكسسوارات مشتراة من نفس الورشة (اختياري)</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {state.trims.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const trim = state.trims.find((t) => t.id === e.target.value);
                      if (trim) {
                        addMaterialRow({
                          name: trim.name,
                          unit: trim.unitLabel || 'قطعة',
                          unitPrice: Math.round(getTrimUnitCost(trim) * 100) / 100,
                          trimId: trim.id,
                        });
                        e.target.value = '';
                      }
                    }}
                    className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-900"
                  >
                    <option value="">+ اختيار من دليل الكلف...</option>
                    {state.trims.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({formatMoney(getTrimUnitCost(t), state.currency)} / {t.unitLabel})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => addMaterialRow()}
                  className="inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  خامة إضافية
                </button>
              </div>
            </div>

            {/* Quick material presets */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_MATERIAL_PRESETS.map((mp) => (
                <button
                  key={mp.name}
                  type="button"
                  onClick={() => addMaterialRow({ name: mp.name, unit: mp.unit })}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100/70 text-emerald-900 border border-emerald-200 transition-colors cursor-pointer"
                >
                  + {mp.name}
                </button>
              ))}
            </div>

            {form.suppliedMaterials.length > 0 ? (
              <div className="space-y-2">
                <div className="hidden sm:grid grid-cols-12 gap-2 px-2 text-[10px] font-semibold text-emerald-900/80">
                  <span className="col-span-4">الخامة / الإكسسوار</span>
                  <span className="col-span-2 text-center">
                    الكمية {form.billingType === 'per_batch' ? '(للباتش)' : '(للقطعة)'}
                  </span>
                  <span className="col-span-2 text-center">الوحدة</span>
                  <span className="col-span-2 text-center">سعر الوحدة</span>
                  <span className="col-span-1 text-center">الإجمالي</span>
                  <span className="col-span-1" />
                </div>
                {form.suppliedMaterials.map((mat) => {
                  const lineTotal =
                    Math.max(0, Number(mat.quantity) || 0) *
                    Math.max(0, Number(mat.unitPrice) || 0);
                  return (
                    <div
                      key={mat.id}
                      className="grid grid-cols-12 gap-2 items-center bg-white border border-emerald-200/70 rounded-xl p-2"
                    >
                      <input
                        type="text"
                        required
                        value={mat.name}
                        onChange={(e) => updateMaterialRow(mat.id, { name: e.target.value })}
                        placeholder="مثال: زراير لؤلؤ / سوستة"
                        className="col-span-12 sm:col-span-4 rounded-lg border border-[#E5E3DD] px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-600"
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={mat.quantity}
                        onKeyDown={blockNonIntegerKey}
                        onChange={(e) =>
                          updateMaterialRow(mat.id, {
                            quantity: toWholeQty(e.target.value, 0),
                          })
                        }
                        placeholder="الكمية"
                        className="col-span-4 sm:col-span-2 rounded-lg border border-[#E5E3DD] px-2 py-1.5 text-xs text-center tabular-nums"
                      />
                      <input
                        type="text"
                        value={mat.unit}
                        onChange={(e) => updateMaterialRow(mat.id, { unit: e.target.value })}
                        placeholder="قطعة"
                        className="col-span-3 sm:col-span-2 rounded-lg border border-[#E5E3DD] px-2 py-1.5 text-xs text-center"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={mat.unitPrice}
                        onChange={(e) =>
                          updateMaterialRow(mat.id, {
                            unitPrice: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        placeholder="السعر"
                        className="col-span-3 sm:col-span-2 rounded-lg border border-[#E5E3DD] px-2 py-1.5 text-xs text-center tabular-nums"
                      />
                      <div className="hidden sm:block sm:col-span-1 text-[11px] font-bold text-emerald-800 text-center tabular-nums">
                        {lineTotal.toFixed(1)}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMaterialRow(mat.id)}
                        aria-label="حذف الخامة"
                        className="col-span-2 sm:col-span-1 flex justify-center p-1 text-[#9C9990] hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-emerald-900/70">
                في حال توفر زراير أو سوست أو خيوط أو إكسسوارات لدى الورشة، أضفها هنا لتُحتسب تلقائياً
                ضمن إجمالي تكلفة هذه المرحلة.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
              ملاحظات
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="ملاحظات عن الجودة أو شروط التسليم أو الخامات الموفرة من الورشة..."
              className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
            />
          </div>

          {/* Live Cost Breakdown Summary */}
          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-[#6E6C66]">
              <span>
                أجر خدمات التشغيل {form.billingType === 'per_batch' ? '(للباتش)' : '(للقطعة)'}:
              </span>
              <span className="font-semibold text-[#1A1A1E] tabular-nums">
                {formatMoney(effectiveLaborCost, state.currency)}
              </span>
            </div>
            {materialsTotal > 0 && (
              <div className="flex items-center justify-between text-xs text-emerald-800">
                <span>
                  خامات وإكسسوارات مشتراة من الورشة{' '}
                  {form.billingType === 'per_batch' ? '(للباتش)' : '(للقطعة)'}:
                </span>
                <span className="font-semibold tabular-nums">
                  + {formatMoney(materialsTotal, state.currency)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1.5 border-t border-[#E6D5C3]">
              <span className="text-xs font-bold text-[#7B5836]">
                تكلفة المرحلة المحسوبة للقطعة الواحدة
                {form.billingType === 'per_batch'
                  ? ` (إجمالي الباتش ${formatMoney(totalOperationCost, state.currency)} ÷ ${Math.max(1, Number(form.batchSize) || 1)})`
                  : ''}
                :
              </span>
              <span className="text-base font-bold text-[#8E6742] tabular-nums">
                {formatMoney(previewUnitCost, state.currency)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-[#1A1A1E] hover:bg-[#2E2E35] text-white cursor-pointer"
            >
              {editingId ? 'حفظ التعديلات' : 'إضافة المرحلة'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
