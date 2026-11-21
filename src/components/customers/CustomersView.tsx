import React, { useMemo, useState } from 'react';
import { Crown, Edit3, MapPin, Plus, Search, Trash2, Users } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { newUuid } from '../../lib/supabase';
import type { Customer } from '../../types/erp';
import { formatMoney } from '../../utils/calculations';
import { Modal } from '../common/Modal';

type Tier = 'مميز' | 'VIP' | 'عادي' | 'جديد';

const PLATFORMS = ['واتساب', 'انستجرام', 'المتجر', 'مباشر'];

const EMPTY_CUSTOMER: Omit<Customer, 'id'> = {
  name: '',
  phone: '',
  platform: 'واتساب',
  governorate: 'العريش',
  customerType: 'retail',
  notes: '',
};

export const CustomersView: React.FC = () => {
  const { state, saveCustomer, deleteCustomer } = useERP();
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [debtOnly, setDebtOnly] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Customer, 'id'>>(EMPTY_CUSTOMER);

  const enriched = useMemo(() => {
    return state.customers.map((c) => {
      const normName = c.name.trim().toLowerCase();
      const orders = state.salesOrders.filter(
        (o) =>
          o.status !== 'cancelled' &&
          (o.customerId === c.id || o.customerName.trim().toLowerCase() === normName)
      );
      const totalSpent = orders.reduce((s, o) => s + o.totalAmount, 0);
      const totalPaid = orders.reduce((s, o) => s + o.paidAmount, 0);
      const remainingDebt = orders.reduce((s, o) => s + o.remainingDebt, 0);
      const lastOrderDate = orders
        .map((o) => o.orderDate)
        .sort()
        .at(-1);

      let tier: Tier = 'عادي';
      if (totalSpent === 0) tier = 'جديد';
      else if (totalSpent >= 6000) tier = 'مميز';
      else if (totalSpent >= 4000) tier = 'VIP';

      return {
        customer: c,
        ordersCount: orders.length,
        totalSpent,
        totalPaid,
        remainingDebt,
        lastOrderDate: lastOrderDate || '—',
        tier,
      };
    });
  }, [state.customers, state.salesOrders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched
      .filter((row) => {
        if (tierFilter !== 'all' && row.tier !== tierFilter) return false;
        if (debtOnly && row.remainingDebt <= 0) return false;
        if (!q) return true;
        return (
          row.customer.name.toLowerCase().includes(q) ||
          (row.customer.phone || '').toLowerCase().includes(q) ||
          (row.customer.governorate || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.totalSpent - a.totalSpent);
  }, [enriched, query, tierFilter, debtOnly]);

  const totalDebt = enriched.reduce((s, r) => s + r.remainingDebt, 0);
  const vipCount = enriched.filter((r) => r.tier === 'VIP' || r.tier === 'مميز').length;

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_CUSTOMER);
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone || '',
      platform: c.platform || 'واتساب',
      governorate: c.governorate || '',
      customerType: c.customerType || 'retail',
      notes: c.notes || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    saveCustomer({
      id: editingId || newUuid(),
      ...form,
      name: form.name.trim(),
    });
    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[#6E6C66]">إجمالي العملاء</div>
            <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums mt-1.5">
              {state.customers.length} عميل
            </div>
            <div className="text-xs text-[#6E6C66] mt-0.5">
              {vipCount} عميل مميز و VIP
            </div>
          </div>
          <span className="w-10 h-10 rounded-xl bg-[#F6EFE7] text-[#A67C52] flex items-center justify-center">
            <Users className="w-5 h-5" />
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[#6E6C66]">إجمالي مشتريات العملاء</div>
            <div className="text-2xl font-bold text-[#8E6742] tabular-nums mt-1.5">
              {formatMoney(
                enriched.reduce((s, r) => s + r.totalSpent, 0),
                state.currency
              )}
            </div>
            <div className="text-xs text-[#6E6C66] mt-0.5">
              المحصّل: {formatMoney(enriched.reduce((s, r) => s + r.totalPaid, 0), state.currency)}
            </div>
          </div>
          <span className="w-10 h-10 rounded-xl bg-[#F3F2EE] text-[#1A1A1E] flex items-center justify-center">
            <Crown className="w-5 h-5 text-[#A67C52]" />
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[#6E6C66]">الديون المستحقة على العملاء</div>
            <div
              className={`text-2xl font-bold tabular-nums mt-1.5 ${
                totalDebt > 0 ? 'text-red-600' : 'text-emerald-700'
              }`}
            >
              {formatMoney(totalDebt, state.currency)}
            </div>
            <div className="text-xs text-[#6E6C66] mt-0.5">
              {enriched.filter((r) => r.remainingDebt > 0).length} عميل عليه رصيد متبقي
            </div>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold px-3.5 py-2.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>عميل جديد</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-[#E5E3DD] flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-[#9C9990] absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم العميل، الهاتف، أو المحافظة..."
            className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {['all', 'مميز', 'VIP', 'عادي', 'جديد'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTierFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                tierFilter === t
                  ? 'bg-[#1A1A1E] text-white'
                  : 'bg-[#F3F2EE] text-[#6E6C66] hover:text-[#1A1A1E]'
              }`}
            >
              {t === 'all' ? 'كل التصنيفات' : t}
            </button>
          ))}
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1A1A1E] mr-2 cursor-pointer">
            <input
              type="checkbox"
              checked={debtOnly}
              onChange={(e) => setDebtOnly(e.target.checked)}
              className="accent-[#A67C52]"
            />
            <span>لديهم رصيد متبقي فقط</span>
          </label>
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3.5 px-4">العميل / المنصة</th>
                <th className="py-3.5 px-4">المحافظة</th>
                <th className="py-3.5 px-4">الطلبات</th>
                <th className="py-3.5 px-4">إجمالي المشتريات</th>
                <th className="py-3.5 px-4">المدفوع</th>
                <th className="py-3.5 px-4">المتبقي (دين)</th>
                <th className="py-3.5 px-4">آخر طلب</th>
                <th className="py-3.5 px-4">التصنيف</th>
                <th className="py-3.5 px-4">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {filtered.map((row) => (
                <tr key={row.customer.id} className="hover:bg-[#FAF9F7]">
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#1A1A1E]">{row.customer.name}</div>
                    <div className="text-xs text-[#6E6C66] flex items-center gap-1.5">
                      <span>{row.customer.platform}</span>
                      {row.customer.phone && (
                        <>
                          <span>•</span>
                          <span dir="ltr">{row.customer.phone}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs text-[#4B4A46]">
                    {row.customer.governorate ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-[#A67C52]" />
                        {row.customer.governorate}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-4 tabular-nums font-semibold">{row.ordersCount}</td>
                  <td className="py-3 px-4 tabular-nums font-bold">
                    {formatMoney(row.totalSpent, state.currency)}
                  </td>
                  <td className="py-3 px-4 tabular-nums text-emerald-700">
                    {formatMoney(row.totalPaid, state.currency)}
                  </td>
                  <td
                    className={`py-3 px-4 tabular-nums font-bold ${
                      row.remainingDebt > 0 ? 'text-red-600' : 'text-[#6E6C66]'
                    }`}
                  >
                    {formatMoney(row.remainingDebt, state.currency)}
                  </td>
                  <td className="py-3 px-4 text-xs text-[#6E6C66] tabular-nums">
                    {row.lastOrderDate}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        row.tier === 'مميز'
                          ? 'bg-[#1A1A1E] text-[#BD956D]'
                          : row.tier === 'VIP'
                          ? 'bg-[#F6EFE7] text-[#8E6742]'
                          : row.tier === 'جديد'
                          ? 'bg-sky-50 text-sky-700'
                          : 'bg-[#F3F2EE] text-[#4B4A46]'
                      }`}
                    >
                      {row.tier}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row.customer)}
                        className="p-1.5 rounded-lg text-[#4B4A46] hover:bg-[#F3F2EE] cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCustomer(row.customer.id)}
                        className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-xs text-[#6E6C66]">
                    لا يوجد عملاء مطابقون للبحث.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Customer Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
        subtitle="التصنيف (جديد / عادي / VIP / مميز) والديون تُحسب تلقائياً من الطلبات"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">اسم العميل *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">رقم الهاتف / واتساب</label>
              <input
                type="text"
                dir="ltr"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm text-left"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المنصة</label>
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المحافظة / المدينة</label>
              <input
                type="text"
                value={form.governorate}
                onChange={(e) => setForm({ ...form, governorate: e.target.value })}
                placeholder="مثال: العريش / القاهرة / السويس"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">ملاحظات</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer"
            >
              حفظ العميل
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
