import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  MessageCircle,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { newUuid } from '../../lib/supabase';
import type { SalesChannel, SalesOrder } from '../../types/erp';
import {
  blockNonIntegerKey,
  formatMoney,
  formatNumber,
  toWholeQty,
} from '../../utils/calculations';
import { Modal } from '../common/Modal';

const FULFILLMENT_STATES = ['قيد التجهيز', 'واصل', 'مكتمل', 'مرتجع'];

export const SalesView: React.FC = () => {
  const {
    state,
    userRole,
    saveCustomer,
    createSalesOrder,
    confirmSalesOrder,
    recordSalesPayment,
    updateSalesFulfillment,
    processSalesExchangeReturn,
    cancelSalesOrder,
    deleteSalesOrder,
  } = useERP();

  const [modalOpen, setModalOpen] = useState(false);
  const [busySaleId, setBusySaleId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState('');
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

  // Exchange / Partial Return modal
  const [exchangeOrder, setExchangeOrder] = useState<SalesOrder | null>(null);
  const [exchangeMode, setExchangeMode] = useState<'exchange' | 'return'>('exchange');
  const [returnVariantId, setReturnVariantId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [replacementVariantId, setReplacementVariantId] = useState('');
  const [priceDiff, setPriceDiff] = useState(0);
  const [exchangeNotes, setExchangeNotes] = useState('');
  const [exchanging, setExchanging] = useState(false);

  const runSaleAction = async (saleId: string, fn: () => Promise<void>) => {
    setBusySaleId(saleId);
    try {
      await fn();
    } catch {
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } finally {
      setBusySaleId(null);
    }
  };

  const allVariants = useMemo(
    () =>
      state.models.flatMap((m) =>
        m.variants.map((v) => ({ ...v, modelName: m.name }))
      ),
    [state.models]
  );

  const hasDuplicateVariants = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.variantId)) return true;
      seen.add(it.variantId);
    }
    return false;
  }, [items]);

  const mergeDuplicateVariants = () => {
    const merged: { variantId: string; quantity: number; unitPrice: number }[] = [];
    const idxByVar = new Map<string, number>();
    for (const it of items) {
      const idx = idxByVar.get(it.variantId);
      if (idx !== undefined) {
        merged[idx] = {
          ...merged[idx],
          quantity: toWholeQty(merged[idx].quantity, 0) + toWholeQty(it.quantity, 0),
        };
      } else {
        idxByVar.set(it.variantId, merged.length);
        merged.push({ ...it, quantity: toWholeQty(it.quantity, 1) });
      }
    }
    setItems(merged);
  };

  const handlePhoneLookup = (phoneVal: string) => {
    setCustomerPhone(phoneVal);
    const digits = phoneVal.replace(/[^\d]/g, '');
    if (digits.length >= 7) {
      const match = state.customers.find(
        (c) => (c.phone || '').replace(/[^\d]/g, '') === digits
      );
      if (match) {
        setCustomerId(match.id);
        setCustomerName(match.name);
        if (match.platform) setPlatform(match.platform);
      }
    }
  };

  const handleOpenWhatsApp = (so: SalesOrder) => {
    const customer = state.customers.find(
      (c) => (so.customerId && c.id === so.customerId) || c.name === so.customerName
    );
    const itemsSummary = so.items
      .map((it) => {
        const v = allVariants.find((x) => x.id === it.variantId);
        return v ? `${v.modelName} (${v.color}/${v.size}) × ${it.quantity}` : `${it.quantity} قطعة`;
      })
      .join(' + ');
    const lines = [
      `مرحباً أ/ ${so.customerName} 🌿`,
      `تأكيد طلبك من *DressCode*:`,
      `• رقم الطلب: ${so.orderNumber}`,
      `• الأصناف: ${itemsSummary}`,
      `• الإجمالي: ${formatMoney(so.totalAmount, state.currency)}`,
      so.paidAmount > 0 ? `• المدفوع: ${formatMoney(so.paidAmount, state.currency)}` : '',
      so.remainingDebt > 0.01
        ? `• المتبقي عند الاستلام: ${formatMoney(so.remainingDebt, state.currency)}`
        : `• حالة الدفع: مدفوع بالكامل ✓`,
      `شكراً لاختيارك DressCode 🤍`,
    ].filter(Boolean);

    const rawPhone = (customer?.phone || '').replace(/[^\d]/g, '');
    const normalized = rawPhone.startsWith('01') && rawPhone.length === 11 ? `2${rawPhone}` : rawPhone;
    const url = normalized
      ? `https://wa.me/${normalized}?text=${encodeURIComponent(lines.join('\n'))}`
      : `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openExchangeModal = (so: SalesOrder) => {
    const firstLine = so.items[0];
    if (!firstLine) return;
    setExchangeOrder(so);
    setExchangeMode('exchange');
    setReturnVariantId(firstLine.variantId);
    setReturnQty(1);
    const otherVar =
      allVariants.find((v) => v.id !== firstLine.variantId && v.finishedGoodsQty > 0) ||
      allVariants[0];
    setReplacementVariantId(otherVar?.id || '');
    setPriceDiff(0);
    setExchangeNotes('');
  };

  const handleExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exchangeOrder || !returnVariantId || exchanging) return;
    setExchanging(true);
    try {
      await processSalesExchangeReturn({
        saleId: exchangeOrder.id,
        returnVariantId,
        returnQty: toWholeQty(returnQty, 1),
        replacementVariantId: exchangeMode === 'exchange' ? replacementVariantId || null : null,
        replacementQty: exchangeMode === 'exchange' ? toWholeQty(returnQty, 1) : 0,
        priceDiff: exchangeMode === 'exchange' ? Number(priceDiff) || 0 : 0,
        notes: exchangeNotes,
      });
      setExchangeOrder(null);
    } finally {
      setExchanging(false);
    }
  };

  const draftTotal = useMemo(() => {
    const sub = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    return Math.max(0, sub - discountAmount + shippingFee);
  }, [items, discountAmount, shippingFee]);

  const openModal = () => {
    const first = allVariants.find((v) => v.finishedGoodsQty > 0) || allVariants[0];
    setCustomerId('');
    setCustomerPhone('');
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

    // Auto-create customer if phone/name provided and not linked yet
    let resolvedCustomerId: string | null = customerId || null;
    if (!resolvedCustomerId && customerPhone.trim()) {
      const digits = customerPhone.replace(/[^\d]/g, '');
      const existingByPhone = state.customers.find(
        (c) => (c.phone || '').replace(/[^\d]/g, '') === digits
      );
      if (existingByPhone) {
        resolvedCustomerId = existingByPhone.id;
      } else {
        const newCustId = newUuid();
        saveCustomer({
          id: newCustId,
          name: customerName.trim(),
          phone: customerPhone.trim(),
          platform,
          governorate: '',
          customerType: 'جديد',
          notes: 'أُضيف تلقائياً من شاشة الطلبات',
        });
        resolvedCustomerId = newCustId;
      }
    }

    const orderNumber = `DC-ORD-${String(state.salesOrders.length + 1).padStart(3, '0')}`;
    const channel: SalesChannel =
      platform === 'المتجر'
        ? 'online_store'
        : platform === 'مباشر'
        ? 'retail'
        : 'social_media';
    const safePaid = Math.min(draftTotal, Math.max(0, Number(paidAmount) || 0));
    await createSalesOrder({
      orderNumber,
      customerId: resolvedCustomerId,
      customerName: customerName.trim(),
      channel,
      platform,
      discountAmount: Number(discountAmount) || 0,
      shippingFee: Number(shippingFee) || 0,
      paidAmount: safePaid,
      fulfillmentStatus,
      confirmImmediately,
      items: items.map((it) => ({ ...it, quantity: toWholeQty(it.quantity, 1) })),
    });
    setModalOpen(false);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentOrder || paymentValue <= 0) return;
    if (paymentValue > paymentOrder.remainingDebt + 0.01) return;
    await recordSalesPayment(paymentOrder.id, paymentValue, paymentMethod);
    setPaymentOrder(null);
  };

  const confirmedOrders = state.salesOrders.filter((s) => s.status !== 'cancelled');
  const cancelledOrdersCount = state.salesOrders.filter((s) => s.status === 'cancelled').length;
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
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-3.5 sm:p-4">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">إجمالي المبيعات</div>
          <div className="text-lg sm:text-xl font-bold text-[#1A1A1E] tabular-nums mt-1.5">
            {formatMoney(netRevenue, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">
            {confirmedOrders.length} طلب نشط
            {cancelledOrdersCount > 0 ? ` • ${cancelledOrdersCount} ملغي` : ''}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-3.5 sm:p-4">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">المبالغ المحصّلة</div>
          <div className="text-lg sm:text-xl font-bold text-emerald-700 tabular-nums mt-1.5">
            {formatMoney(totalCollected, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">
            ديون:{' '}
            <span className={totalDebts > 0 ? 'text-red-600 font-bold' : ''}>
              {formatMoney(totalDebts, state.currency)}
            </span>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-3.5 sm:p-4">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">تكلفة البضاعة</div>
          <div className="text-lg sm:text-xl font-bold text-[#1A1A1E] tabular-nums mt-1.5">
            {formatMoney(totalCogs, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">بالتكلفة الفعلية</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-3.5 sm:p-4">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">مجمل الربح</div>
          <div className="text-lg sm:text-xl font-bold text-[#8E6742] tabular-nums mt-1.5">
            {formatMoney(grossProfit, state.currency)}
          </div>
          <div className="text-[11px] text-[#6E6C66] mt-0.5">
            هامش: {formatNumber(grossMarginPct, 1)}%
          </div>
        </div>
        <div className="col-span-2 xl:col-span-1 bg-white rounded-2xl border border-[#E5E3DD] p-3.5 sm:p-4 flex flex-col justify-center">
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

      {/* Orders List / Table */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E3DD] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#A67C52] shrink-0" />
            <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
              سجل الطلبات والمدفوعات وحالة التسليم
            </h2>
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {state.salesOrders.map((so) => {
            const isCancelled = so.status === 'cancelled';
            const isBusy = busySaleId === so.id;
            return (
              <div
                key={so.id}
                className={`p-4 space-y-3 ${isCancelled ? 'opacity-65 bg-[#FAF9F7]/60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`font-mono font-bold text-xs ${
                          isCancelled ? 'line-through text-[#6E6C66]' : 'text-[#1A1A1E]'
                        }`}
                      >
                        {so.orderNumber}
                      </span>
                      <span className="text-[11px] text-[#6E6C66] tabular-nums">{so.orderDate}</span>
                    </div>
                    <div
                      className={`font-bold text-sm mt-0.5 truncate ${
                        isCancelled ? 'line-through text-[#6E6C66]' : 'text-[#1A1A1E]'
                      }`}
                    >
                      {so.customerName}
                    </div>
                    <div className="text-[11px] text-[#6E6C66] truncate">
                      {so.platform} {so.notes ? `• ${so.notes}` : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      isCancelled
                        ? 'bg-red-50 text-red-700'
                        : so.paymentStatus === 'مدفوع بالكامل'
                        ? 'bg-emerald-50 text-emerald-700'
                        : so.paymentStatus === 'دفع جزئي'
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {isCancelled ? 'ملغي' : so.paymentStatus}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs bg-[#FAF9F7] rounded-xl p-2.5 border border-[#F0EFEA]">
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">الإجمالي</div>
                    <div
                      className={`font-bold tabular-nums mt-0.5 ${
                        isCancelled ? 'line-through text-[#6E6C66]' : ''
                      }`}
                    >
                      {formatMoney(so.totalAmount, state.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">المدفوع</div>
                    <div className="font-semibold text-emerald-700 tabular-nums mt-0.5">
                      {formatMoney(so.paidAmount, state.currency)}
                    </div>
                    {!isCancelled && so.remainingDebt > 0 && (
                      <div className="text-[10px] text-red-600 font-bold tabular-nums">
                        متبقي: {formatMoney(so.remainingDebt, state.currency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">الربح</div>
                    <div className="font-bold text-[#8E6742] tabular-nums mt-0.5">
                      {formatMoney(so.grossProfit, state.currency)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isCancelled ? (
                    <span className="inline-flex px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                      طلب ملغي
                    </span>
                  ) : (
                    <select
                      value={so.fulfillmentStatus}
                      onChange={(e) => void updateSalesFulfillment(so.id, e.target.value)}
                      aria-label="حالة التسليم"
                      className="rounded-xl border border-[#E5E3DD] bg-white px-3 py-1.5 text-xs font-semibold"
                    >
                      {FULFILLMENT_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isCancelled && so.status === 'draft' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runSaleAction(so.id, () => confirmSalesOrder(so.id))}
                        className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#BD956D]" />
                        تأكيد
                      </button>
                    )}
                    {!isCancelled && so.remainingDebt > 0 && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setPaymentOrder(so);
                          setPaymentValue(so.remainingDebt);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-bold bg-[#F6EFE7] text-[#8E6742] hover:bg-[#EDE0D1] px-3 py-1.5 rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        تحصيل دفعة
                      </button>
                    )}
                    {!isCancelled && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runSaleAction(so.id, () => cancelSalesOrder(so.id))}
                        className="inline-flex items-center gap-1 text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        إلغاء
                      </button>
                    )}
                    {!isCancelled && (
                      <button
                        type="button"
                        onClick={() => handleOpenWhatsApp(so)}
                        className="inline-flex items-center gap-1 text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        واتساب
                      </button>
                    )}
                    {!isCancelled && so.status !== 'draft' && so.items.length > 0 && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openExchangeModal(so)}
                        className="inline-flex items-center gap-1 text-xs font-semibold border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        استبدال/مرتجع
                      </button>
                    )}
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runSaleAction(so.id, () => deleteSalesOrder(so.id))}
                        aria-label="حذف الطلب"
                        className="inline-flex items-center gap-1 text-xs font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        حذف
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {state.salesOrders.length === 0 && (
            <div className="py-8 text-center text-xs text-[#6E6C66]">
              لا توجد طلبات بيع مسجلة بعد.
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
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
              {state.salesOrders.map((so) => {
                const isCancelled = so.status === 'cancelled';
                const isBusy = busySaleId === so.id;
                return (
                  <tr
                    key={so.id}
                    className={`hover:bg-[#FAF9F7] ${
                      isCancelled ? 'opacity-65 bg-[#FAF9F7]/50' : ''
                    }`}
                  >
                    <td className="py-3 px-3.5">
                      <div
                        className={`font-mono font-bold text-xs ${
                          isCancelled ? 'line-through text-[#6E6C66]' : ''
                        }`}
                      >
                        {so.orderNumber}
                      </div>
                      <div className="text-[11px] text-[#6E6C66] tabular-nums">{so.orderDate}</div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div
                        className={`font-semibold ${
                          isCancelled ? 'line-through text-[#6E6C66]' : 'text-[#1A1A1E]'
                        }`}
                      >
                        {so.customerName}
                      </div>
                      <div className="text-[11px] text-[#6E6C66] truncate max-w-[200px]">
                        {so.platform} {so.notes ? `• ${so.notes}` : ''}
                      </div>
                    </td>
                    <td
                      className={`py-3 px-3.5 tabular-nums font-bold ${
                        isCancelled ? 'line-through text-[#6E6C66]' : ''
                      }`}
                    >
                      {formatMoney(so.totalAmount, state.currency)}
                    </td>
                    <td className="py-3 px-3.5 tabular-nums text-xs">
                      <div className="text-emerald-700 font-semibold">
                        مدفوع: {formatMoney(so.paidAmount, state.currency)}
                      </div>
                      {!isCancelled && so.remainingDebt > 0 && (
                        <div className="text-red-600 font-bold">
                          متبقي: {formatMoney(so.remainingDebt, state.currency)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          isCancelled
                            ? 'bg-red-50 text-red-700'
                            : so.paymentStatus === 'مدفوع بالكامل'
                            ? 'bg-emerald-50 text-emerald-700'
                            : so.paymentStatus === 'دفع جزئي'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {isCancelled ? 'ملغي' : so.paymentStatus}
                      </span>
                    </td>
                    <td className="py-3 px-3.5">
                      {isCancelled ? (
                        <span className="inline-flex px-2 py-0.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                          ملغي
                        </span>
                      ) : (
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
                      )}
                    </td>
                    <td className="py-3 px-3.5 tabular-nums font-bold text-[#8E6742]">
                      {formatMoney(so.grossProfit, state.currency)}
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!isCancelled && so.status === 'draft' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runSaleAction(so.id, () => confirmSalesOrder(so.id))}
                            className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#1A1A1E] text-white px-2.5 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3 h-3 text-[#BD956D]" />
                            تأكيد
                          </button>
                        )}
                        {!isCancelled && so.remainingDebt > 0 && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setPaymentOrder(so);
                              setPaymentValue(so.remainingDebt);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#F6EFE7] text-[#8E6742] hover:bg-[#EDE0D1] px-2.5 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            <Banknote className="w-3 h-3" />
                            تحصيل دفعة
                          </button>
                        )}
                        {!isCancelled && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runSaleAction(so.id, () => cancelSalesOrder(so.id))}
                            title="إلغاء الطلب وإرجاع المخزون"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 px-2 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="w-3 h-3" />
                            إلغاء
                          </button>
                        )}
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => handleOpenWhatsApp(so)}
                            title="إرسال رسالة تأكيد الطلب عبر واتساب"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                          >
                            <MessageCircle className="w-3 h-3" />
                            واتساب
                          </button>
                        )}
                        {!isCancelled && so.status !== 'draft' && so.items.length > 0 && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => openExchangeModal(so)}
                            title="استبدال مقاس/لون أو مرتجع جزئي"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 px-2 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" />
                            استبدال
                          </button>
                        )}
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runSaleAction(so.id, () => deleteSalesOrder(so.id))}
                            title="حذف الطلب نهائياً"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {state.salesOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-[#6E6C66]">
                    لا توجد طلبات بيع مسجلة بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Ledger */}
      {state.inventoryMovements.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E3DD] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#A67C52] shrink-0" />
            <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
              سجل حركة المخزون الموحّد (Audit Ledger — PostgreSQL)
            </h2>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-[#F0EFEA]">
            {state.inventoryMovements.slice(0, 15).map((mv) => (
              <div key={mv.id} className="p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#1A1A1E]">{mv.itemType}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#F3F2EE] text-[#6E6C66]">
                      {mv.movementType}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#6E6C66] truncate mt-0.5">
                    {mv.notes || mv.referenceType}
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <div
                    className={`text-xs font-extrabold tabular-nums ${
                      mv.qtyDelta >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {mv.qtyDelta > 0 ? `+${mv.qtyDelta}` : mv.qtyDelta}
                  </div>
                  <div className="text-[10px] text-[#6E6C66] tabular-nums">
                    {formatMoney(mv.unitCost, state.currency)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">اختر من العملاء</label>
              <select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  const found = state.customers.find((c) => c.id === e.target.value);
                  if (found) {
                    setCustomerName(found.name);
                    setCustomerPhone(found.phone || '');
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
              <label className="block text-xs font-semibold mb-1">
                رقم الموبايل (بحث / تسجيل تلقائي)
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => handlePhoneLookup(e.target.value)}
                placeholder="01xxxxxxxxx"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs tabular-nums"
              />
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

            {hasDuplicateVariants && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>تنبيه: يوجد نفس الصنف (اللون/المقاس) مكرر داخل الطلب!</span>
                </div>
                <button
                  type="button"
                  onClick={mergeDuplicateVariants}
                  className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-bold cursor-pointer"
                >
                  دمج الأصناف المكررة
                </button>
              </div>
            )}

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
                  step="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={it.quantity || ''}
                  onKeyDown={blockNonIntegerKey}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, quantity: toWholeQty(e.target.value, 0) } : row
                      )
                    )
                  }
                  onBlur={() =>
                    setItems((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, quantity: toWholeQty(row.quantity, 1) } : row
                      )
                    )
                  }
                  placeholder="الكمية"
                  aria-label="الكمية"
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
          {(() => {
            const rem = Math.max(0, paymentOrder?.remainingDebt || 0);
            const isOver = paymentValue > rem + 0.01;
            return (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">قيمة الدفعة *</label>
                    <input
                      type="number"
                      min="0.01"
                      max={rem}
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
                {isOver && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-bold text-red-700">
                    لا يمكن تحصيل مبلغ أكبر من المتبقي على الطلب ({formatMoney(rem, state.currency)}).
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
                  <button
                    type="submit"
                    disabled={paymentValue <= 0 || isOver}
                    className="px-5 py-2 rounded-xl bg-[#A67C52] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    تأكيد التحصيل
                  </button>
                </div>
              </>
            );
          })()}
        </form>
      </Modal>

      {/* Size Exchange / Partial Return Modal */}
      <Modal
        open={Boolean(exchangeOrder)}
        onClose={() => setExchangeOrder(null)}
        title={`استبدال مقاس / مرتجع جزئي — ${exchangeOrder?.orderNumber || ''}`}
        subtitle={`العميل: ${exchangeOrder?.customerName || ''} • يتم ضبط المخزون والحساب تلقائياً`}
        maxWidthClass="max-w-lg"
      >
        {exchangeOrder && (
          <form onSubmit={handleExchangeSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#F3F2EE] p-1">
              <button
                type="button"
                onClick={() => setExchangeMode('exchange')}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  exchangeMode === 'exchange' ? 'bg-[#1A1A1E] text-white' : 'text-[#6E6C66]'
                }`}
              >
                استبدال مقاس / لون
              </button>
              <button
                type="button"
                onClick={() => setExchangeMode('return')}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  exchangeMode === 'return' ? 'bg-[#1A1A1E] text-white' : 'text-[#6E6C66]'
                }`}
              >
                مرتجع جزئي بدون بديل
              </button>
            </div>

            {(() => {
              const selectedLine = exchangeOrder.items.find(
                (it) => it.variantId === returnVariantId
              );
              const maxRetQty = selectedLine?.quantity || 1;
              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-8">
                      <label className="block text-xs font-semibold mb-1">
                        الصنف المرتجع من العميل *
                      </label>
                      <select
                        value={returnVariantId}
                        onChange={(e) => {
                          setReturnVariantId(e.target.value);
                          setReturnQty(1);
                        }}
                        className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs font-semibold"
                      >
                        {exchangeOrder.items.map((it) => {
                          const v = allVariants.find((x) => x.id === it.variantId);
                          return (
                            <option key={it.id} value={it.variantId}>
                              {v ? `${v.modelName} (${v.color} - ${v.size})` : it.variantId} — كمية{' '}
                              {it.quantity}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-xs font-semibold mb-1">
                        الكمية المرتجعة (حد أقصى {maxRetQty})
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={maxRetQty}
                        step="1"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={returnQty || ''}
                        onKeyDown={blockNonIntegerKey}
                        onChange={(e) =>
                          setReturnQty(Math.min(maxRetQty, toWholeQty(e.target.value, 0)))
                        }
                        onBlur={() =>
                          setReturnQty(Math.min(maxRetQty, toWholeQty(returnQty, 1)))
                        }
                        className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs font-bold text-center tabular-nums"
                      />
                    </div>
                  </div>

                  {exchangeMode === 'exchange' && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 rounded-xl bg-sky-50/60 border border-sky-200 p-3">
                      <div className="sm:col-span-8">
                        <label className="block text-xs font-bold text-sky-900 mb-1">
                          الصنف البديل الجديد (المقاس / اللون) *
                        </label>
                        <select
                          value={replacementVariantId}
                          onChange={(e) => setReplacementVariantId(e.target.value)}
                          required
                          className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold"
                        >
                          {allVariants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.modelName} ({v.color} - {v.size}) [متاح: {v.finishedGoodsQty}]
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-xs font-bold text-sky-900 mb-1">
                          فرق السعر (إن وجد)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={priceDiff}
                          onChange={(e) => setPriceDiff(Number(e.target.value) || 0)}
                          className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold tabular-nums"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold mb-1">سبب الاستبدال / المرتجع</label>
                    <input
                      type="text"
                      value={exchangeNotes}
                      onChange={(e) => setExchangeNotes(e.target.value)}
                      placeholder="مثال: تبديل من M إلى L بناءً على طلب العميل"
                      className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
                    <button
                      type="button"
                      onClick={() => setExchangeOrder(null)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={exchanging || returnQty <= 0}
                      className="px-5 py-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {exchanging
                        ? 'جاري التنفيذ...'
                        : exchangeMode === 'exchange'
                          ? 'تأكيد الاستبدال وتحديث المخزون'
                          : 'تأكيد المرتجع وإعادة القطع للمخزون'}
                    </button>
                  </div>
                </>
              );
            })()}
          </form>
        )}
      </Modal>
    </div>
  );
};
