import React, { useMemo, useState } from 'react';
import {
  Building2,
  Clock,
  Edit3,
  Hammer,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { newUuid } from '../../lib/supabase';
import type { LaborBillingType, OutsourcedOperation } from '../../types/erp';
import { formatMoney, getLaborStepUnitCost } from '../../utils/calculations';
import { Modal } from '../common/Modal';

const EMPTY_OP: Omit<OutsourcedOperation, 'id'> = {
  name: '',
  workshopName: '',
  billingType: 'per_piece',
  cost: 0,
  batchSize: 1,
  leadTimeDays: 1,
  notes: '',
};

const QUICK_PRESETS = [
  'القص (باترون ومقصدار)',
  'الخياطة والتقفيل',
  'السرفلة والأوفرلوك',
  'الكي بالبخار والتشطيب',
  'التطريز (يدوي / كمبيوتر)',
  'تكسير البليسيه',
  'فحص الجودة والتغليف',
];

export const OutsourcedLaborView: React.FC = () => {
  const { state, saveOperation, deleteOperation } = useERP();
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<OutsourcedOperation, 'id'>>(EMPTY_OP);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.operations;
    return state.operations.filter(
      (op) =>
        op.name.toLowerCase().includes(q) ||
        op.workshopName.toLowerCase().includes(q)
    );
  }, [state.operations, query]);

  const uniqueWorkshops = useMemo(() => {
    const set = new Set(state.operations.map((o) => o.workshopName));
    return set.size;
  }, [state.operations]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_OP);
    setModalOpen(true);
  };

  const openEdit = (op: OutsourcedOperation) => {
    setEditingId(op.id);
    setForm({
      name: op.name,
      workshopId: op.workshopId,
      workshopName: op.workshopName,
      billingType: op.billingType,
      cost: op.cost,
      batchSize: op.batchSize,
      leadTimeDays: op.leadTimeDays ?? 1,
      notes: op.notes || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    saveOperation({
      id: editingId || newUuid(),
      ...form,
      cost: Number(form.cost) || 0,
      batchSize:
        form.billingType === 'per_batch' ? Math.max(1, Number(form.batchSize) || 1) : 1,
      leadTimeDays: Number(form.leadTimeDays) || 1,
    });
    setModalOpen(false);
  };

  const previewUnitCost = getLaborStepUnitCost({
    billingType: form.billingType,
    cost: Number(form.cost) || 0,
    batchSize: Math.max(1, Number(form.batchSize) || 1),
  });

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
            placeholder="ابحث باسم المرحلة (القص، الخياطة، التطريز...) أو اسم الورشة"
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

      {/* Operations Table */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3.5 px-4 font-semibold">المرحلة / العملية</th>
                <th className="py-3.5 px-4 font-semibold">الورشة / العامل</th>
                <th className="py-3.5 px-4 font-semibold">نظام المحاسبة</th>
                <th className="py-3.5 px-4 font-semibold">السعر المتفق عليه</th>
                <th className="py-3.5 px-4 font-semibold">تكلفة القطعة الواحدة</th>
                <th className="py-3.5 px-4 font-semibold">مدة التنفيذ</th>
                <th className="py-3.5 px-4 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {filtered.map((op) => {
                const unitCost = getLaborStepUnitCost(op);
                return (
                  <tr key={op.id} className="hover:bg-[#FAF9F7]/80 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-[#1A1A1E]">{op.name}</div>
                      {op.notes && (
                        <div className="text-xs text-[#6E6C66] mt-0.5 truncate max-w-xs">
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
                      {formatMoney(op.cost, state.currency)}
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
        subtitle="يمكنك التسعير بالقطعة أو بالباتش/التشغيلة الكاملة لاستخدامها في بطاقات الموديلات"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick Presets */}
          <div>
            <span className="block text-[11px] font-semibold text-[#6E6C66] mb-1.5">
              اختيار سريع للمرحلة:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, name: preset }))}
                  className="text-xs px-2.5 py-1 rounded-lg bg-[#F3F2EE] hover:bg-[#F6EFE7] hover:text-[#8E6742] text-[#1A1A1E] transition-colors cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                اسم المرحلة / العملية *
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثال: الخياطة والتقفيل الأساسي"
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
                    batchSize: e.target.value === 'per_batch' ? 50 : 1,
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
                  ? 'تكلفة الباتش بالكامل *'
                  : 'تكلفة القطعة الواحدة *'}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
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
                  required
                  value={form.batchSize}
                  onChange={(e) =>
                    setForm({ ...form, batchSize: Number(e.target.value) })
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
                value={form.leadTimeDays}
                onChange={(e) =>
                  setForm({ ...form, leadTimeDays: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                ملاحظات
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="ملاحظات عن الجودة أو شروط التسليم..."
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>
          </div>

          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#7B5836]">
              تكلفة المرحلة المحسوبة للقطعة الواحدة:
            </span>
            <span className="text-base font-bold text-[#8E6742] tabular-nums">
              {formatMoney(previewUnitCost, state.currency)}
            </span>
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
