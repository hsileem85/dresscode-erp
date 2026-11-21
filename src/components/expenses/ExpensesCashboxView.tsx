import React, { useMemo, useState } from 'react';
import { Banknote, Landmark, Plus, Trash2, Wallet } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { newUuid } from '../../lib/supabase';
import { formatMoney } from '../../utils/calculations';
import { Modal } from '../common/Modal';

export const ExpensesCashboxView: React.FC = () => {
  const {
    state,
    saveExpense,
    deleteExpense,
    savePartnerContribution,
    deletePartnerContribution,
  } = useERP();

  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [expModalOpen, setExpModalOpen] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);

  // Expense form
  const [expTitle, setExpTitle] = useState('');
  const [expCategory, setExpCategory] = useState('متغير');
  const [expIsRaw, setExpIsRaw] = useState(false);
  const [expAmount, setExpAmount] = useState<number>(0);
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expMethod, setExpMethod] = useState('كاش');
  const [expNotes, setExpNotes] = useState('');

  // Partner capital form
  const [partnerName, setPartnerName] = useState('رنا');
  const [partnerAmount, setPartnerAmount] = useState<number>(0);
  const [partnerDate, setPartnerDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [partnerNotes, setPartnerNotes] = useState('');

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    state.expenses.forEach((e) => {
      if (e.expenseDate && e.expenseDate.length >= 7) set.add(e.expenseDate.slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }, [state.expenses]);

  const filteredExpenses = useMemo(() => {
    return state.expenses.filter((e) => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (monthFilter !== 'all' && !e.expenseDate.startsWith(monthFilter)) return false;
      return true;
    });
  }, [state.expenses, categoryFilter, monthFilter]);

  // Cashbox math (المتاح بالخزنة)
  const totalPartnerCapital = state.partnerContributions.reduce((s, p) => s + p.amount, 0);
  const totalCollections = state.salesOrders
    .filter((o) => o.status !== 'cancelled')
    .reduce((s, o) => s + o.paidAmount, 0);
  const totalExpensesOutflow = state.expenses.reduce((s, e) => s + e.amount, 0);
  const operatingExpensesOnly = state.expenses
    .filter((e) => !e.isRawMaterialPurchase)
    .reduce((s, e) => s + e.amount, 0);
  const rawMaterialOutflow = totalExpensesOutflow - operatingExpensesOnly;
  const availableCash = totalPartnerCapital + totalCollections - totalExpensesOutflow;

  // Group partner totals
  const partnerTotals = useMemo(() => {
    const map = new Map<string, number>();
    state.partnerContributions.forEach((p) => {
      map.set(p.partnerName, (map.get(p.partnerName) || 0) + p.amount);
    });
    return Array.from(map.entries());
  }, [state.partnerContributions]);

  const handleSaveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle.trim() || expAmount <= 0) return;
    saveExpense({
      id: newUuid(),
      expenseDate: expDate,
      title: expTitle.trim(),
      category: expCategory,
      isRawMaterialPurchase: expIsRaw || expCategory === 'خامات',
      amount: Number(expAmount),
      paymentMethod: expMethod,
      notes: expNotes.trim(),
    });
    setExpModalOpen(false);
    setExpTitle('');
    setExpAmount(0);
    setExpNotes('');
  };

  const handleSavePartner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerName.trim() || partnerAmount === 0) return;
    savePartnerContribution({
      id: newUuid(),
      partnerName: partnerName.trim(),
      contributionDate: partnerDate,
      amount: Number(partnerAmount),
      notes: partnerNotes.trim(),
    });
    setPartnerModalOpen(false);
    setPartnerAmount(0);
    setPartnerNotes('');
  };

  return (
    <div className="space-y-6">
      {/* Live Cashbox Banner */}
      <div className="bg-[#1A1A1E] text-white rounded-2xl p-4 sm:p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#A67C52] flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5 text-white" />
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-bold">الخزنة والسيولة المتاحة (المتاح)</h2>
              <p className="text-[11px] sm:text-xs text-[#B4B2AA]">
                رأس مال الشركاء + تحصيلات العملاء − كافة المصروفات النقدية والتحويلات
              </p>
            </div>
          </div>
          <div className="sm:text-left bg-white/5 sm:bg-transparent rounded-xl px-3.5 py-2.5 sm:p-0">
            <div className="text-[11px] sm:text-xs text-[#D4B896]">الرصيد المتاح حالياً</div>
            <div className="text-2xl sm:text-3xl font-extrabold tabular-nums text-[#BD956D]">
              {formatMoney(availableCash, state.currency)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 pt-4 text-xs">
          <div>
            <div className="text-[11px] text-[#B4B2AA]">رأس مال الشركاء</div>
            <div className="text-sm sm:text-base font-bold tabular-nums mt-0.5">
              +{formatMoney(totalPartnerCapital, state.currency)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#B4B2AA]">تحصيلات المبيعات</div>
            <div className="text-sm sm:text-base font-bold text-emerald-400 tabular-nums mt-0.5">
              +{formatMoney(totalCollections, state.currency)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#B4B2AA]">مصروفات تشغيلية</div>
            <div className="text-sm sm:text-base font-bold text-amber-300 tabular-nums mt-0.5">
              -{formatMoney(operatingExpensesOnly, state.currency)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#B4B2AA]">مشتريات خامات وتشغيل</div>
            <div className="text-sm sm:text-base font-bold text-[#D6D4CE] tabular-nums mt-0.5">
              -{formatMoney(rawMaterialOutflow, state.currency)}
            </div>
          </div>
        </div>
      </div>

      {/* Partner Capital Section */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-[#A67C52] shrink-0" />
            <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
              رأس مال الشركاء والمساهمات ({formatMoney(totalPartnerCapital, state.currency)})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setPartnerModalOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-[#F6EFE7] hover:bg-[#EDE0D1] text-[#8E6742] px-3 py-2 sm:py-1.5 rounded-xl cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>تسجيل مساهمة / سحب شريك</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {partnerTotals.map(([name, total]) => (
            <div
              key={name}
              className="rounded-xl border border-[#EAE8E2] bg-[#FAF9F7] p-3.5 sm:p-4 flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-bold text-[#1A1A1E]">{name}</div>
                <div className="text-[11px] text-[#6E6C66]">
                  نسبة المساهمة:{' '}
                  {totalPartnerCapital > 0
                    ? ((total / totalPartnerCapital) * 100).toFixed(1)
                    : 0}
                  %
                </div>
              </div>
              <div className="text-base font-extrabold text-[#8E6742] tabular-nums">
                {formatMoney(total, state.currency)}
              </div>
            </div>
          ))}
        </div>

        {state.partnerContributions.length > 0 && (
          <>
            {/* Mobile Partner Contributions Cards */}
            <div className="md:hidden divide-y divide-[#F0EFEA] border-t border-[#F0EFEA] pt-1">
              {state.partnerContributions.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#1A1A1E]">{p.partnerName}</span>
                      <span className="text-[11px] text-[#6E6C66] tabular-nums">
                        {p.contributionDate}
                      </span>
                    </div>
                    {p.notes && (
                      <div className="text-[11px] text-[#6E6C66] truncate mt-0.5">{p.notes}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold tabular-nums text-[#8E6742]">
                      {formatMoney(p.amount, state.currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => deletePartnerContribution(p.id)}
                      aria-label="حذف"
                      className="p-1 text-[#9C9990] hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Partner Contributions Table */}
            <div className="hidden md:block overflow-x-auto pt-2">
              <table className="w-full text-xs text-right">
                <thead className="text-[#6E6C66] border-b border-[#E5E3DD]">
                  <tr>
                    <th className="py-2 px-3">الشريك</th>
                    <th className="py-2 px-3">التاريخ</th>
                    <th className="py-2 px-3">المبلغ</th>
                    <th className="py-2 px-3">ملاحظات</th>
                    <th className="py-2 px-3">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EFEA]">
                  {state.partnerContributions.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 px-3 font-bold">{p.partnerName}</td>
                      <td className="py-2 px-3 text-[#6E6C66] tabular-nums">
                        {p.contributionDate}
                      </td>
                      <td className="py-2 px-3 font-bold tabular-nums">
                        {formatMoney(p.amount, state.currency)}
                      </td>
                      <td className="py-2 px-3 text-[#6E6C66]">{p.notes || '—'}</td>
                      <td className="py-2 px-3">
                        <button
                          type="button"
                          onClick={() => deletePartnerContribution(p.id)}
                          className="text-[#9C9990] hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Expenses Ledger */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="p-4 border-b border-[#E5E3DD] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-[#A67C52] shrink-0" />
            <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
              سجل المصروفات ({filteredExpenses.length} حركة • الإجمالي{' '}
              {formatMoney(
                filteredExpenses.reduce((s, e) => s + e.amount, 0),
                state.currency
              )}
              )
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2.5 py-2 sm:py-1.5 text-xs"
            >
              <option value="all">كل الشهور</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2.5 py-2 sm:py-1.5 text-xs"
            >
              <option value="all">كل الفئات</option>
              {getLookupLabels(state.lookups, 'expense_categories').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setExpModalOpen(true)}
              className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold px-3.5 py-2 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>تسجيل مصروف جديد</span>
            </button>
          </div>
        </div>

        {/* Mobile Expenses Cards */}
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {filteredExpenses.map((e) => (
            <div key={e.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#1A1A1E]">{e.title}</div>
                  <div className="text-[11px] text-[#6E6C66] flex items-center flex-wrap gap-1.5 mt-0.5">
                    <span className="tabular-nums">{e.expenseDate}</span>
                    <span>•</span>
                    <span className="px-2 py-0.5 rounded-full bg-[#F3F2EE] text-[#1A1A1E] font-semibold">
                      {e.category}
                    </span>
                    <span>•</span>
                    <span>{e.paymentMethod}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-sm font-extrabold tabular-nums text-[#1A1A1E]">
                    {formatMoney(e.amount, state.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteExpense(e.id)}
                    aria-label="حذف"
                    className="p-1 text-[#9C9990] hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="text-[11px]">
                {e.isRawMaterialPurchase ? (
                  <span className="text-[#8E6742] font-semibold">
                    خامات / تصنيع (لا يُكرر في P&L)
                  </span>
                ) : (
                  <span className="text-[#6E6C66]">مصروف تشغيلي (يُخصم في P&L)</span>
                )}
              </div>
            </div>
          ))}
          {filteredExpenses.length === 0 && (
            <div className="py-10 text-center text-xs text-[#6E6C66]">
              لا توجد مصروفات مطابقة للتصفية.
            </div>
          )}
        </div>

        {/* Desktop Expenses Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">التاريخ</th>
                <th className="py-3 px-4">بيان المصروف</th>
                <th className="py-3 px-4">الفئة</th>
                <th className="py-3 px-4">التصنيف المحاسبي</th>
                <th className="py-3 px-4">طريقة الدفع</th>
                <th className="py-3 px-4">المبلغ</th>
                <th className="py-3 px-4">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {filteredExpenses.map((e) => (
                <tr key={e.id} className="hover:bg-[#FAF9F7]">
                  <td className="py-3 px-4 text-xs text-[#6E6C66] tabular-nums">
                    {e.expenseDate}
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#1A1A1E]">{e.title}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-[#F3F2EE] text-[#1A1A1E]">
                      {e.category}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {e.isRawMaterialPurchase ? (
                      <span className="text-[#8E6742] font-semibold">
                        خامات / تصنيع (لا يُكرر في P&L)
                      </span>
                    ) : (
                      <span className="text-[#1A1A1E]">مصروف تشغيلي (يُخصم في P&L)</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-[#6E6C66]">{e.paymentMethod}</td>
                  <td className="py-3 px-4 font-bold tabular-nums">
                    {formatMoney(e.amount, state.currency)}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => deleteExpense(e.id)}
                      className="p-1 text-[#9C9990] hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-[#6E6C66]">
                    لا توجد مصروفات مطابقة للتصفية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      <Modal
        open={expModalOpen}
        onClose={() => setExpModalOpen(false)}
        title="تسجيل مصروف جديد"
        subtitle="فصل مشتريات الخامات عن المصروفات التشغيلية يمنع الازدواج في تقرير الأرباح والخسائر"
      >
        <form onSubmit={handleSaveExpense} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">بيان المصروف *</label>
              <input
                type="text"
                required
                value={expTitle}
                onChange={(e) => setExpTitle(e.target.value)}
                placeholder="مثال: إعلانات انستجرام / شنط البراند / مرتب"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التاريخ</label>
              <input
                type="date"
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المبلغ *</label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={expAmount || ''}
                onChange={(e) => setExpAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الفئة</label>
              <select
                value={expCategory}
                onChange={(e) => {
                  setExpCategory(e.target.value);
                  if (e.target.value === 'خامات') setExpIsRaw(true);
                }}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-sm"
              >
                {getLookupLabels(state.lookups, 'expense_categories').map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">طريقة الدفع</label>
              <select
                value={expMethod}
                onChange={(e) => setExpMethod(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-sm"
              >
                {getLookupLabels(state.lookups, 'payment_methods').map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer bg-[#FAF9F7] p-3 rounded-xl border border-[#E5E3DD]">
            <input
              type="checkbox"
              checked={expIsRaw}
              onChange={(e) => setExpIsRaw(e.target.checked)}
              className="accent-[#A67C52]"
            />
            <span>هذا البند شراء خامات / تشغيل تصنيع (يُخصم من الخزنة فقط ولا يُكرر كمصروف تشغيلي في P&L)</span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer"
            >
              حفظ المصروف
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Partner Contribution Modal */}
      <Modal
        open={partnerModalOpen}
        onClose={() => setPartnerModalOpen(false)}
        title="تسجيل مساهمة رأس مال / سحب شريك"
      >
        <form onSubmit={handleSavePartner} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الشريك *</label>
              <input
                type="text"
                required
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="رنا / ريهام / سلمي"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التاريخ</label>
              <input
                type="date"
                value={partnerDate}
                onChange={(e) => setPartnerDate(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">
                المبلغ (موجب للإيداع، سالب للمسحوبات) *
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={partnerAmount || ''}
                onChange={(e) => setPartnerAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">ملاحظات</label>
              <input
                type="text"
                value={partnerNotes}
                onChange={(e) => setPartnerNotes(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-[#E5E3DD]">
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#A67C52] text-white text-xs font-bold cursor-pointer"
            >
              حفظ الحركة
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
