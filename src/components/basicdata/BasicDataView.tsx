import React, { useMemo, useState } from 'react';
import {
  Building2,
  Database,
  Edit3,
  Hammer,
  ListChecks,
  Phone,
  Plus,
  Search,
  Trash2,
  Truck,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { LOOKUP_GROUPS } from '../../data/defaultLookups';
import { newUuid } from '../../lib/supabase';
import type { LookupGroupKey, Supplier, Workshop } from '../../types/erp';
import { formatMoney } from '../../utils/calculations';
import { Modal } from '../common/Modal';

type BasicTab = 'suppliers' | 'workshops' | 'lookups';

const EMPTY_SUPPLIER: Omit<Supplier, 'id'> = {
  name: '',
  contactName: '',
  phone: '',
  address: '',
  specialty: 'أقمشة',
  balancePayable: 0,
  notes: '',
};

const EMPTY_WORKSHOP: Omit<Workshop, 'id'> = {
  name: '',
  contactName: '',
  phone: '',
  address: '',
  specialty: 'خياطة وسرفلة',
  balancePayable: 0,
  notes: '',
};

export const BasicDataView: React.FC = () => {
  const {
    state,
    saveSupplier,
    deleteSupplier,
    saveWorkshop,
    deleteWorkshop,
    addLookupItem,
    deleteLookupItem,
  } = useERP();

  const [subTab, setSubTab] = useState<BasicTab>('suppliers');
  const [query, setQuery] = useState('');

  // Supplier modal
  const [supModalOpen, setSupModalOpen] = useState(false);
  const [editingSupId, setEditingSupId] = useState<string | null>(null);
  const [supForm, setSupForm] = useState<Omit<Supplier, 'id'>>(EMPTY_SUPPLIER);

  // Workshop modal
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const [editingWsId, setEditingWsId] = useState<string | null>(null);
  const [wsForm, setWsForm] = useState<Omit<Workshop, 'id'>>(EMPTY_WORKSHOP);

  // Lookup quick-add inputs per group
  const [lookupInputs, setLookupInputs] = useState<Record<string, string>>({});

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.suppliers;
    return state.suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.specialty || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q)
    );
  }, [state.suppliers, query]);

  const filteredWorkshops = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.workshops;
    return state.workshops.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.specialty || '').toLowerCase().includes(q) ||
        (w.phone || '').toLowerCase().includes(q)
    );
  }, [state.workshops, query]);

  const openNewSupplier = () => {
    setEditingSupId(null);
    setSupForm(EMPTY_SUPPLIER);
    setSupModalOpen(true);
  };

  const openEditSupplier = (s: Supplier) => {
    setEditingSupId(s.id);
    setSupForm({
      name: s.name,
      contactName: s.contactName || '',
      phone: s.phone || '',
      address: s.address || '',
      specialty: s.specialty || '',
      balancePayable: s.balancePayable || 0,
      notes: s.notes || '',
    });
    setSupModalOpen(true);
  };

  const handleSaveSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supForm.name.trim()) return;
    saveSupplier({
      id: editingSupId || newUuid(),
      ...supForm,
      name: supForm.name.trim(),
      balancePayable: Number(supForm.balancePayable) || 0,
    });
    setSupModalOpen(false);
  };

  const openNewWorkshop = () => {
    setEditingWsId(null);
    setWsForm(EMPTY_WORKSHOP);
    setWsModalOpen(true);
  };

  const openEditWorkshop = (w: Workshop) => {
    setEditingWsId(w.id);
    setWsForm({
      name: w.name,
      contactName: w.contactName || '',
      phone: w.phone || '',
      address: w.address || '',
      specialty: w.specialty || '',
      balancePayable: w.balancePayable || 0,
      notes: w.notes || '',
    });
    setWsModalOpen(true);
  };

  const handleSaveWorkshop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsForm.name.trim()) return;
    saveWorkshop({
      id: editingWsId || newUuid(),
      ...wsForm,
      name: wsForm.name.trim(),
      balancePayable: Number(wsForm.balancePayable) || 0,
    });
    setWsModalOpen(false);
  };

  const handleAddLookup = (groupKey: LookupGroupKey) => {
    const val = (lookupInputs[groupKey] || '').trim();
    if (!val) return;
    addLookupItem(groupKey, val);
    setLookupInputs((prev) => ({ ...prev, [groupKey]: '' }));
  };

  return (
    <div className="space-y-6">
      {/* Top Sub-Tabs & Toolbar */}
      <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#E5E3DD] flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
        <div className="grid grid-cols-3 sm:inline-flex rounded-xl bg-[#F3F2EE] p-1 gap-1 w-full lg:w-auto">
          <button
            id="basic-tab-suppliers"
            type="button"
            onClick={() => setSubTab('suppliers')}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2 rounded-lg text-[11px] sm:text-sm font-bold transition-all cursor-pointer ${
              subTab === 'suppliers'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <Truck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#BD956D] shrink-0" />
            <span className="truncate">الموردين ({state.suppliers.length})</span>
          </button>

          <button
            id="basic-tab-workshops"
            type="button"
            onClick={() => setSubTab('workshops')}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2 rounded-lg text-[11px] sm:text-sm font-bold transition-all cursor-pointer ${
              subTab === 'workshops'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <Hammer className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#BD956D] shrink-0" />
            <span className="truncate">الورش ({state.workshops.length})</span>
          </button>

          <button
            id="basic-tab-lookups"
            type="button"
            onClick={() => setSubTab('lookups')}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2 rounded-lg text-[11px] sm:text-sm font-bold transition-all cursor-pointer ${
              subTab === 'lookups'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#BD956D] shrink-0" />
            <span className="truncate">القوائم ({state.lookups.length})</span>
          </button>
        </div>

        {subTab !== 'lookups' && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-[#9C9990] absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  subTab === 'suppliers'
                    ? 'ابحث باسم المورد أو التخصص...'
                    : 'ابحث باسم الورشة أو التخصص...'
                }
                className="w-full sm:w-64 rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-xs"
              />
            </div>

            <button
              id={subTab === 'suppliers' ? 'btn-add-supplier' : 'btn-add-workshop'}
              type="button"
              onClick={subTab === 'suppliers' ? openNewSupplier : openNewWorkshop}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs sm:text-sm font-bold px-4 py-2.5 sm:py-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{subTab === 'suppliers' ? 'إضافة مورد جديد' : 'إضافة ورشة / مصنع'}</span>
            </button>
          </div>
        )}
      </div>

      {/* 1. Suppliers Tab */}
      {subTab === 'suppliers' && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-[#E5E3DD] bg-[#FAF9F7] flex items-center gap-2 text-xs font-bold text-[#1A1A1E]">
            <Building2 className="w-4 h-4 text-[#A67C52] shrink-0" />
            <span>دليل الموردين — يظهر تلقائياً في شاشات الأقمشة والكلف وأوامر الشراء</span>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-[#F0EFEA]">
            {filteredSuppliers.map((s) => (
              <div key={s.id} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1A1A1E]">{s.name}</div>
                    <span className="inline-flex mt-1 px-2 py-0.5 rounded-full bg-[#F6EFE7] text-[#8E6742] text-[11px] font-semibold">
                      {s.specialty || 'مورد عام'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditSupplier(s)}
                      className="p-2 rounded-lg bg-[#FAF9F7] text-[#4B4A46] cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSupplier(s.id)}
                      className="p-2 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E6C66] pt-1 border-t border-[#F5F4F0]">
                  <div className="flex items-center gap-3">
                    {s.phone && (
                      <a
                        href={`tel:${s.phone}`}
                        className="inline-flex items-center gap-1 text-[#8E6742] font-semibold"
                        dir="ltr"
                      >
                        <Phone className="w-3 h-3" />
                        {s.phone}
                      </a>
                    )}
                    {s.address && <span>{s.address}</span>}
                  </div>
                  <span className="font-bold text-[#1A1A1E] tabular-nums">
                    المستحق: {formatMoney(s.balancePayable, state.currency)}
                  </span>
                </div>
              </div>
            ))}
            {filteredSuppliers.length === 0 && (
              <div className="p-8 text-center text-xs text-[#6E6C66]">
                لا يوجد موردون مطابقون للبحث.
              </div>
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
                <tr>
                  <th className="py-3.5 px-4">اسم المورد</th>
                  <th className="py-3.5 px-4">التخصص</th>
                  <th className="py-3.5 px-4">التواصل / الهاتف</th>
                  <th className="py-3.5 px-4">العنوان</th>
                  <th className="py-3.5 px-4">الرصيد المستحق له</th>
                  <th className="py-3.5 px-4">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EFEA]">
                {filteredSuppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-[#FAF9F7]">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#1A1A1E]">{s.name}</div>
                      {s.notes && (
                        <div className="text-xs text-[#6E6C66] truncate max-w-xs">{s.notes}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#F6EFE7] text-[#8E6742] text-xs font-semibold">
                        {s.specialty || 'مورد عام'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#4B4A46]">
                      <div>{s.contactName || '—'}</div>
                      {s.phone && (
                        <div className="inline-flex items-center gap-1 text-[#6E6C66]" dir="ltr">
                          <Phone className="w-3 h-3 text-[#A67C52]" />
                          {s.phone}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#6E6C66]">{s.address || '—'}</td>
                    <td className="py-3.5 px-4 tabular-nums font-bold text-[#1A1A1E]">
                      {formatMoney(s.balancePayable, state.currency)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditSupplier(s)}
                          className="p-1.5 rounded-lg text-[#4B4A46] hover:bg-[#F3F2EE] cursor-pointer"
                          title="تعديل"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSupplier(s.id)}
                          className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSuppliers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-xs text-[#6E6C66]">
                      لا يوجد موردون مطابقون للبحث. اضغط «إضافة مورد جديد» لإضافة أول مورد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Workshops Tab */}
      {subTab === 'workshops' && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-[#E5E3DD] bg-[#FAF9F7] flex items-center gap-2 text-xs font-bold text-[#1A1A1E]">
            <Hammer className="w-4 h-4 text-[#A67C52] shrink-0" />
            <span>دليل الورش والمصانع الخارجية — يظهر تلقائياً في شاشة التشغيل الخارجي</span>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-[#F0EFEA]">
            {filteredWorkshops.map((w) => (
              <div key={w.id} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1A1A1E]">{w.name}</div>
                    <span className="inline-flex mt-1 px-2 py-0.5 rounded-full bg-[#F3F2EE] text-[#1A1A1E] text-[11px] font-semibold">
                      {w.specialty || 'تشغيل خارجي'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditWorkshop(w)}
                      className="p-2 rounded-lg bg-[#FAF9F7] text-[#4B4A46] cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteWorkshop(w.id)}
                      className="p-2 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E6C66] pt-1 border-t border-[#F5F4F0]">
                  {w.phone ? (
                    <a
                      href={`tel:${w.phone}`}
                      className="inline-flex items-center gap-1 text-[#8E6742] font-semibold"
                      dir="ltr"
                    >
                      <Phone className="w-3 h-3" />
                      {w.phone}
                    </a>
                  ) : (
                    <span>{w.address || '—'}</span>
                  )}
                  <span className="font-bold text-[#8E6742] tabular-nums">
                    المستحق: {formatMoney(w.balancePayable, state.currency)}
                  </span>
                </div>
              </div>
            ))}
            {filteredWorkshops.length === 0 && (
              <div className="p-8 text-center text-xs text-[#6E6C66]">
                لا توجد ورش مطابقة للبحث.
              </div>
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
                <tr>
                  <th className="py-3.5 px-4">اسم الورشة / المصنع</th>
                  <th className="py-3.5 px-4">التخصص</th>
                  <th className="py-3.5 px-4">التواصل / الهاتف</th>
                  <th className="py-3.5 px-4">العنوان</th>
                  <th className="py-3.5 px-4">الرصيد المستحق</th>
                  <th className="py-3.5 px-4">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EFEA]">
                {filteredWorkshops.map((w) => (
                  <tr key={w.id} className="hover:bg-[#FAF9F7]">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#1A1A1E]">{w.name}</div>
                      {w.notes && (
                        <div className="text-xs text-[#6E6C66] truncate max-w-xs">{w.notes}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#F3F2EE] text-[#1A1A1E] text-xs font-semibold">
                        {w.specialty || 'تشغيل خارجي'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#4B4A46]">
                      <div>{w.contactName || '—'}</div>
                      {w.phone && (
                        <div className="inline-flex items-center gap-1 text-[#6E6C66]" dir="ltr">
                          <Phone className="w-3 h-3 text-[#A67C52]" />
                          {w.phone}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#6E6C66]">{w.address || '—'}</td>
                    <td className="py-3.5 px-4 tabular-nums font-bold text-[#8E6742]">
                      {formatMoney(w.balancePayable, state.currency)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditWorkshop(w)}
                          className="p-1.5 rounded-lg text-[#4B4A46] hover:bg-[#F3F2EE] cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteWorkshop(w.id)}
                          className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredWorkshops.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-xs text-[#6E6C66]">
                      لا توجد ورش مطابقة للبحث.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Configurable Lookups Tab */}
      {subTab === 'lookups' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] px-4 py-3 flex items-center gap-2 text-xs text-[#7B5836]">
            <Database className="w-4 h-4 text-[#A67C52] shrink-0" />
            <span>
              أي قيمة تضيفها هنا تظهر فوراً في القوائم المنسدلة بجميع شاشات النظام (الموديلات، الكلف،
              العملاء، الطلبات، المصروفات، والمقاسات).
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {LOOKUP_GROUPS.map((group) => {
              const items = state.lookups
                .filter((l) => l.groupKey === group.key)
                .sort((a, b) => a.sortOrder - b.sortOrder);

              return (
                <div
                  key={group.key}
                  className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3.5"
                >
                  <div>
                    <h3 className="text-sm font-bold text-[#1A1A1E]">{group.title}</h3>
                    <p className="text-[11px] text-[#6E6C66] mt-0.5">{group.description}</p>
                  </div>

                  {/* Existing Pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((item) => (
                      <span
                        key={item.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF9F7] border border-[#E5E3DD] text-xs font-semibold text-[#1A1A1E]"
                      >
                        <span>{item.label}</span>
                        <button
                          type="button"
                          onClick={() => deleteLookupItem(item.id)}
                          aria-label={`حذف ${item.label}`}
                          className="text-[#9C9990] hover:text-red-600 cursor-pointer leading-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>

                  {/* Quick Add Form */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAddLookup(group.key);
                    }}
                    className="flex gap-2 pt-2 border-t border-[#F0EFEA]"
                  >
                    <input
                      type="text"
                      value={lookupInputs[group.key] || ''}
                      onChange={(e) =>
                        setLookupInputs((prev) => ({ ...prev, [group.key]: e.target.value }))
                      }
                      placeholder={group.placeholder}
                      className="flex-1 rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] px-3 py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold px-3.5 py-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#BD956D]" />
                      <span>إضافة</span>
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      <Modal
        open={supModalOpen}
        onClose={() => setSupModalOpen(false)}
        title={editingSupId ? 'تعديل بيانات المورد' : 'إضافة مورد جديد (المورد)'}
        subtitle="سيظهر المورد مباشرة في قوائم الأقمشة والكلف وأوامر الشراء"
      >
        <form onSubmit={handleSaveSupplier} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">اسم المورد / الشركة *</label>
              <input
                type="text"
                required
                value={supForm.name}
                onChange={(e) => setSupForm({ ...supForm, name: e.target.value })}
                placeholder="مثال: شركة النور للأقمشة - العتبة"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم المسؤول</label>
              <input
                type="text"
                value={supForm.contactName}
                onChange={(e) => setSupForm({ ...supForm, contactName: e.target.value })}
                placeholder="مثال: أ. محمود"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">رقم الهاتف / واتساب</label>
              <input
                type="text"
                dir="ltr"
                value={supForm.phone}
                onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })}
                placeholder="010xxxxxxxx"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm text-left"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التخصص</label>
              <input
                type="text"
                value={supForm.specialty}
                onChange={(e) => setSupForm({ ...supForm, specialty: e.target.value })}
                placeholder="أقمشة / كلف وتغليف / خيوط / تيكت"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الرصيد الافتتاحي المستحق</label>
              <input
                type="number"
                step="0.01"
                value={supForm.balancePayable}
                onChange={(e) =>
                  setSupForm({ ...supForm, balancePayable: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">العنوان</label>
              <input
                type="text"
                value={supForm.address}
                onChange={(e) => setSupForm({ ...supForm, address: e.target.value })}
                placeholder="العتبة / الأزهر / العبور..."
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">ملاحظات</label>
              <input
                type="text"
                value={supForm.notes}
                onChange={(e) => setSupForm({ ...supForm, notes: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setSupModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer"
            >
              {editingSupId ? 'حفظ التعديلات' : 'إضافة المورد'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Workshop Modal */}
      <Modal
        open={wsModalOpen}
        onClose={() => setWsModalOpen(false)}
        title={editingWsId ? 'تعديل بيانات الورشة / المصنع' : 'إضافة ورشة / مصنع تشغيل'}
        subtitle="ستظهر الورشة تلقائياً في شاشة التشغيل الخارجي وبطاقات الموديلات"
      >
        <form onSubmit={handleSaveWorkshop} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">اسم الورشة / المصنع *</label>
              <input
                type="text"
                required
                value={wsForm.name}
                onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })}
                placeholder="مثال: مصنع الأناقة للتشغيل"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم المسؤول / الأسطى</label>
              <input
                type="text"
                value={wsForm.contactName}
                onChange={(e) => setWsForm({ ...wsForm, contactName: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">رقم الهاتف</label>
              <input
                type="text"
                dir="ltr"
                value={wsForm.phone}
                onChange={(e) => setWsForm({ ...wsForm, phone: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm text-left"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التخصص</label>
              <input
                type="text"
                value={wsForm.specialty}
                onChange={(e) => setWsForm({ ...wsForm, specialty: e.target.value })}
                placeholder="قص / خياطة / سرفلة / تطريز / كي"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الرصيد الافتتاحي المستحق</label>
              <input
                type="number"
                step="0.01"
                value={wsForm.balancePayable}
                onChange={(e) =>
                  setWsForm({ ...wsForm, balancePayable: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">العنوان / ملاحظات</label>
              <input
                type="text"
                value={wsForm.address}
                onChange={(e) => setWsForm({ ...wsForm, address: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setWsModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer"
            >
              {editingWsId ? 'حفظ التعديلات' : 'إضافة الورشة'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
