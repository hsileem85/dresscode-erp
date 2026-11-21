import React, { useMemo, useState } from 'react';
import { Banknote, CheckCircle2, Plus, Receipt, Trash2, TrendingUp } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import type { SalesChannel, SalesOrder } from '../../types/erp';
import { formatMoney, formatNumber } from '../../utils/calculations';
import { Modal } from '../common/Modal';

const FULFILLMENT_STATES = ['قيد التجهيز', 'واصل', 'مكتمل', 'مرتجع'];

export const SalesView: React.FC = () => {
  const {
    state,
    createSalesOrder,
    confirmSalesOrder,
    recordSalesPayment,
    updateSalesFulfillment,
  } = useERP();

  const [modalOpen, setModalOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [platform, setPlatform] = useState('واتساب');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [shippingFee, setShippingFee] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [fulfillmentStatus, setFulfillmentStatus] = useState('مكتمل');
  const [confirmImmediately, setConfirmImmediately] = useState(true);
  const [items, setItems] = useState<{ variantId: string; quantity: number; unitPrice: number }[]>(
    []
  );

  // Payment modal
  const [paymentOrder, setPaymentOrder] = useState<SalesOrder | null>(null);
  const [paymentValue, setPaymentValue] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('تحويل');

  const allVariants = useMemo(
    () =>
      state.models.flatMap((m) =>
        m.variants.map((v) => ({ ...v, modelName: m.name }))
      ),
    [state.models]
  );

  const draftTotal = useMemo(() => {
    const sub = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    return Math.max(0, sub - discountAmount + shippingFee);
  }, [items, discountAmount, shippingFee]);

  const openModal = () => {
    const first = allVariants.find((v) => v.finishedGoodsQty > 0) || allVariants[0];
    setCustomerId('');
    setCustomerName('');
    setPlatform('واتساب');
    setDiscountAmount(0);
    setShippingFee(0);
    setFulfillmentStatus('مكتمل');
    setConfirmImmediately(true);
    const initialItems = first
      ? [{ variantId: first.id, quantity: 1, unitPrice: first.retailPrice }]
      : [];
    setItems(initialItems);
    setPaidAmount(first ? first.retailPrice : 0);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || items.length === 0) return;
    const orderNumber = `DC-ORD-${String(state.salesOrders.length + 1).padStart(3, '0')}`;
    const channel: SalesChannel =
      platform === 'المتجر'
        ? 'online_store'
        : platform === 'مباشر'
        ? 'retail'
        : 'social_media';
    await createSalesOrder({
      orderNumber,
      customerId: customerId || null,
      customerName: customerName.trim(),
      channel,
      platform,
      discountAmount: Number(discountAmount) || 0,
      shippingFee: Number(shippingFee) || 0,
      paidAmount: Number(paidAmount) || 0,
      fulfillmentStatus,
      confirmImmediately,
      items,
    });
    setModalOpen(false);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentOrder || paymentValue <= 0) return;
    await recordSalesPayment(paymentOrder.id, paymentValue, paymentMethod);
    setPaymentOrder(null);
  };

  const confirmedOrders = state.salesOrders.filter((s) => s.status !== 'cancelled');
  const netRevenue = confirmedOrders.reduce(
    (s, o) => s + (o.subtotal - o.discountAmount),
    0
  );
  const totalCollected = confirmedOrders.reduce((s, o) => s + o.paidAmount, 0);
  const totalDebts = confirmedOrders.reduce((s, o) => s + o.remainingDebt, 0);
  const totalCogs = confirmedOrders.reduce((s, o) => s + o.totalCogs, 0);
  const grossProfit = confirmedOrders.reduce((s, o) => s + o.grossProfit, 0);
  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
          <div className="text-xs font-semibold text-[#6E6C66]">إجمالي المبيعات</div>
          <div className="text-xl font-bold text-[#1A1A1E] tabular-nums mt-1.5">
            {formatMoney(netRevenue, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">
            {confirmedOrders.length} طلب
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
          <div className="text-xs font-semibold text-[#6E6C66]">المبالغ المحصّلة</div>
          <div className="text-xl font-bold text-emerald-700 tabular-nums mt-1.5">
            {formatMoney(totalCollected, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">
            ديون متبقية:{' '}
            <span className={totalDebts > 0 ? 'text-red-600 font-bold' : ''}>
              {formatMoney(totalDebts, state.currency)}
            </span>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
          <div className="text-xs font-semibold text-[#6E6C66]">تكلفة البضاعة (COGS)</div>
          <div className="text-xl font-bold text-[#1A1A1E] tabular-nums mt-1.5">
            {formatMoney(totalCogs, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">بالتكلفة الفعلية للقطع</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
          <div className="text-xs font-semibold text-[#6E6C66]">مجمل الربح</div>
          <div className="text-xl font-bold text-[#8E6742] tabular-nums mt-1.5">
            {formatMoney(grossProfit, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">
            هامش ربح: {formatNumber(grossMarginPct, 1)}%
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 flex flex-col justify-center">
          <button
            type="button"
            onClick={openModal}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold py-3 px-4 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل طلب بيع جديد</span>
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E3DD] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#A67C52]" />
            <h2 className="text-sm font-bold text-[#1A1A1E]">
              سجل الطلبات والمدفوعات وحالة التسليم
            </h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-3.5">الطلب / التاريخ</th>
                <th className="py-3 px-3.5">العميل / المنصة</th>
                <th className="py-3 px-3.5">الإجمالي</th>
                <th className="py-3 px-3.5">المدفوع / المتبقي</th>
                <th className="py-3 px-3.5">حالة الدفع</th>
                <th className="py-3 px-3.5">حالة الطلب</th>
                <th className="py-3 px-3.5">الربح</th>
                <th className="py-3 px-3.5">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {state.salesOrders.map((so) => (
                <tr key={so.id} className="hover:bg-[#FAF9F7]">
                  <td className="py-3 px-3.5">
                    <div className="font-mono font-bold text-xs">{so.orderNumber}</div>
                    <div className="text-[11px] text-[#6E6C66] tabular-nums">{so.orderDate}</div>
                  </td>
                  <td className="py-3 px-3.5">
                    <div className="font-semibold text-[#1A1A1E]">{so.customerName}</div>
                    <div className="text-[11px] text-[#6E6C66] truncate max-w-[200px]">
                      {so.platform} {so.notes ? `• ${so.notes}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-3.5 tabular-nums font-bold">
                    {formatMoney(so.totalAmount, state.currency)}
                  </td>
                  <td className="py-3 px-3.5 tabular-nums text-xs">
                    <div className="text-emerald-700 font-semibold">
                      مدفوع: {formatMoney(so.paidAmount, state.currency)}
                    </div>
                    {so.remainingDebt > 0 && (
                      <div className="text-red-600 font-bold">
                        متبقي: {formatMoney(so.remainingDebt, state.currency)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3.5">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        so.paymentStatus === 'مدفوع بالكامل'
                          ? 'bg-emerald-50 text-emerald-700'
                          : so.paymentStatus === 'دفع جزئي'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {so.paymentStatus}
                    </span>
                  </td>
                  <td className="py-3 px-3.5">
                    <select
                      value={so.fulfillmentStatus}
                      onChange={(e) => void updateSalesFulfillment(so.id, e.target.value)}
                      className="rounded-lg border border-[#E5E3DD] bg-white px-2 py-1 text-xs font-semibold"
                    >
                      {FULFILLMENT_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-3.5 tabular-nums font-bold text-[#8E6742]">
                    {formatMoney(so.grossProfit, state.currency)}
                  </td>
                  <td className="py-3 px-3.5">
                    <div className="flex items-center gap-1.5">
                      {so.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => void confirmSalesOrder(so.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#1A1A1E] text-white px-2.5 py-1 rounded-lg cursor-pointer"
                        >
                          <CheckCircle2 className="w-3 h-3 text-[#BD956D]" />
                          تأكيد
                        </button>
                      )}
                      {so.remainingDebt > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentOrder(so);
                            setPaymentValue(so.remainingDebt);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#F6EFE7] text-[#8E6742] hover:bg-[#EDE0D1] px-2.5 py-1 rounded-lg cursor-pointer"
                        >
                          <Banknote className="w-3 h-3" />
                          تحصيل دفعة
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Ledger */}
      {state.inventoryMovements.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E3DD] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#A67C52]" />
            <h2 className="text-sm font-bold text-[#1A1A1E]">
              سجل حركة المخزون الموحّد (Audit Ledger — PostgreSQL)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                <tr>
                  <th className="py-2.5 px-4">النوع</th>
                  <th className="py-2.5 px-4">الحركة</th>
                  <th className="py-2.5 px-4">الكمية</th>
                  <th className="py-2.5 px-4">تكلفة الوحدة</th>
                  <th className="py-2.5 px-4">البيان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EFEA]">
                {state.inventoryMovements.slice(0, 15).map((mv) => (
                  <tr key={mv.id}>
                    <td className="py-2.5 px-4 font-semibold">{mv.itemType}</td>
                    <td className="py-2.5 px-4 font-mono">{mv.movementType}</td>
                    <td
                      className={`py-2.5 px-4 font-bold tabular-nums ${
                        mv.qtyDelta >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {mv.qtyDelta > 0 ? `+${mv.qtyDelta}` : mv.qtyDelta}
                    </td>
                    <td className="py-2.5 px-4 tabular-nums">
                      {formatMoney(mv.unitCost, state.currency)}
                    </td>
                    <td className="py-2.5 px-4 text-[#6E6C66]">{mv.notes || mv.referenceType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Sales Order Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="تسجيل طلب بيع جديد"
        subtitle="اختر العميل والمنتج وسجّل المبلغ المدفوع ليُحسب المتبقي (الدين) وحالة الدفع تلقائياً"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">اختر من العملاء</label>
              <select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  const found = state.customers.find((c) => c.id === e.target.value);
                  if (found) {
                    setCustomerName(found.name);
                    setPlatform(found.platform || 'واتساب');
                  }
                }}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
              >
                <option value="">-- عميل جديد --</option>
                {state.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.governorate || c.platform})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم العميل *</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="مثال: هبةالله ربيع"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المنصة</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
              >
                {getLookupLabels(state.lookups, 'platforms').map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">الأصناف المطلوبة:</span>
              <button
                type="button"
                onClick={() => {
                  const v = allVariants[0];
                  if (v) {
                    const next = [...items, { variantId: v.id, quantity: 1, unitPrice: v.retailPrice }];
                    setItems(next);
                    setPaidAmount(
                      next.reduce((s, r) => s + r.quantity * r.unitPrice, 0) -
                        discountAmount +
                        shippingFee
                    );
                  }
                }}
                className="text-xs bg-[#F6EFE7] text-[#8E6742] font-bold px-2.5 py-1 rounded-lg cursor-pointer"
              >
                + إضافة منتج
              </button>
            </div>

            {items.map((it, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#FAF9F7] p-2.5 rounded-xl border border-[#EAE8E2]"
              >
                <select
                  value={it.variantId}
                  onChange={(e) => {
                    const v = allVariants.find((x) => x.id === e.target.value);
                    setItems((prev) =>
                      prev.map((row, i) =>
                        i === idx
                          ? {
                              ...row,
                              variantId: e.target.value,
                              unitPrice: v?.retailPrice || row.unitPrice,
                            }
                          : row
                      )
                    );
                  }}
                  className="sm:col-span-6 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs"
                >
                  {allVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.modelName} ({v.color} - {v.size}) [متاح: {v.finishedGoodsQty}]
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={it.quantity}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, quantity: Number(e.target.value) } : row
                      )
                    )
                  }
                  className="sm:col-span-2 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs tabular-nums"
                />
                <input
                  type="number"
                  min="0"
                  value={it.unitPrice}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, unitPrice: Number(e.target.value) } : row
                      )
                    )
                  }
                  className="sm:col-span-3 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  className="sm:col-span-1 text-[#9C9990] hover:text-red-600 flex justify-center cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">خصم</label>
              <input
                type="number"
                min="0"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">شحن</label>
              <input
                type="number"
                min="0"
                value={shippingFee}
                onChange={(e) => setShippingFee(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المبلغ المدفوع</label>
              <input
                type="number"
                min="0"
                value={paidAmount}
                onChange={(e) => setPaidAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs tabular-nums font-bold text-emerald-700"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">حالة التسليم</label>
              <select
                value={fulfillmentStatus}
                onChange={(e) => setFulfillmentStatus(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
              >
                {FULFILLMENT_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl bg-[#FAF9F7] border border-[#E5E3DD] px-4 py-2.5 flex items-center justify-between text-xs">
            <span>
              إجمالي الطلب: <b className="tabular-nums">{formatMoney(draftTotal, state.currency)}</b>
            </span>
            <span className={draftTotal - paidAmount > 0 ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
              المتبقي (دين): {formatMoney(Math.max(0, draftTotal - paidAmount), state.currency)}
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={confirmImmediately}
              onChange={(e) => setConfirmImmediately(e.target.checked)}
              className="accent-[#A67C52]"
            />
            <span>تأكيد الطلب وخصم المخزون فوراً</span>
          </label>

          <div className="flex justify-end pt-2 border-t border-[#E5E3DD]">
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer"
            >
              حفظ الطلب
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Partial/Remaining Payment Modal */}
      <Modal
        open={Boolean(paymentOrder)}
        onClose={() => setPaymentOrder(null)}
        title={`تحصيل دفعة للطلب ${paymentOrder?.orderNumber || ''}`}
        subtitle={`العميل: ${paymentOrder?.customerName || ''} — المتبقي: ${formatMoney(
          paymentOrder?.remainingDebt || 0,
          state.currency
        )}`}
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">قيمة الدفعة *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={paymentValue}
                onChange={(e) => setPaymentValue(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm font-bold tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">طريقة التحصيل</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
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
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#A67C52] text-white text-xs font-bold cursor-pointer"
            >
              تأكيد التحصيل
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
