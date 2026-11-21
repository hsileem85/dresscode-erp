import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Receipt, Trash2, TrendingUp } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { SalesChannel } from '../../types/erp';
import { formatMoney, formatNumber } from '../../utils/calculations';
import { Modal } from '../common/Modal';

const CHANNEL_LABELS: Record<SalesChannel, string> = {
  online_store: 'متجر dresscode-clothing.com',
  retail: 'بيع مباشر / أتيليه',
  wholesale: 'مبيعات جملة',
  social_media: 'سوشيال ميديا / واتساب',
};

export const SalesView: React.FC = () => {
  const { state, createSalesOrder, confirmSalesOrder } = useERP();
  const [modalOpen, setModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [channel, setChannel] = useState<SalesChannel>('online_store');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [shippingFee, setShippingFee] = useState(65);
  const [confirmImmediately, setConfirmImmediately] = useState(true);
  const [items, setItems] = useState<{ variantId: string; quantity: number; unitPrice: number }[]>(
    []
  );

  const allVariants = useMemo(
    () =>
      state.models.flatMap((m) =>
        m.variants.map((v) => ({ ...v, modelName: m.name }))
      ),
    [state.models]
  );

  const openModal = () => {
    const first = allVariants.find((v) => v.finishedGoodsQty > 0) || allVariants[0];
    setCustomerName('');
    setChannel('online_store');
    setDiscountAmount(0);
    setShippingFee(65);
    setConfirmImmediately(true);
    setItems(first ? [{ variantId: first.id, quantity: 1, unitPrice: first.retailPrice }] : []);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || items.length === 0) return;
    const orderNumber = `SO-${new Date().getFullYear()}-${String(
      state.salesOrders.length + 1
    ).padStart(3, '0')}`;
    await createSalesOrder({
      orderNumber,
      customerName: customerName.trim(),
      channel,
      discountAmount: Number(discountAmount) || 0,
      shippingFee: Number(shippingFee) || 0,
      confirmImmediately,
      items,
    });
    setModalOpen(false);
  };

  const confirmedOrders = state.salesOrders.filter((s) =>
    ['confirmed', 'shipped', 'delivered'].includes(s.status)
  );
  const netRevenue = confirmedOrders.reduce(
    (s, o) => s + (o.subtotal - o.discountAmount),
    0
  );
  const totalCogs = confirmedOrders.reduce((s, o) => s + o.totalCogs, 0);
  const grossProfit = confirmedOrders.reduce((s, o) => s + o.grossProfit, 0);
  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* P&L KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="text-xs font-semibold text-[#6E6C66]">صافي إيراد المبيعات</div>
          <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums mt-2">
            {formatMoney(netRevenue, state.currency)}
          </div>
          <div className="text-xs text-[#6E6C66] mt-1">
            {confirmedOrders.length} فاتورة مؤكدة
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="text-xs font-semibold text-[#6E6C66]">تكلفة البضاعة المباعة (COGS)</div>
          <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums mt-2">
            {formatMoney(totalCogs, state.currency)}
          </div>
          <div className="text-xs text-[#6E6C66] mt-1">محسوبة بالتكلفة الفعلية من التصنيع</div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="text-xs font-semibold text-[#6E6C66]">مجمل الربح الفعلي</div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums mt-2">
            {formatMoney(grossProfit, state.currency)}
          </div>
          <div className="text-xs text-[#6E6C66] mt-1">
            هامش ربح فعلي: {formatNumber(grossMarginPct, 1)}%
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-semibold text-[#6E6C66]">تسجيل طلب بيع</div>
            <p className="text-xs text-[#6E6C66] mt-1">
              يخصم من مخزون المنتج التام ويحسب الربح تلقائياً
            </p>
          </div>
          <button
            type="button"
            onClick={openModal}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold py-2.5 px-4 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>فاتورة مبيعات جديدة</span>
          </button>
        </div>
      </div>

      {/* Sales Orders Table */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E3DD] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[#A67C52]" />
          <h2 className="text-sm font-bold text-[#1A1A1E]">فواتير المبيعات والأرباح</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">رقم الفاتورة</th>
                <th className="py-3 px-4">العميل / القناة</th>
                <th className="py-3 px-4">صافي البيع</th>
                <th className="py-3 px-4">التكلفة (COGS)</th>
                <th className="py-3 px-4">مجمل الربح</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {state.salesOrders.map((so) => (
                <tr key={so.id} className="hover:bg-[#FAF9F7]">
                  <td className="py-3 px-4 font-mono font-bold text-xs">{so.orderNumber}</td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#1A1A1E]">{so.customerName}</div>
                    <div className="text-xs text-[#6E6C66]">
                      {CHANNEL_LABELS[so.channel]} • {so.orderDate}
                    </div>
                  </td>
                  <td className="py-3 px-4 tabular-nums font-semibold">
                    {formatMoney(so.subtotal - so.discountAmount, state.currency)}
                  </td>
                  <td className="py-3 px-4 tabular-nums text-[#6E6C66]">
                    {formatMoney(so.totalCogs, state.currency)}
                  </td>
                  <td className="py-3 px-4 tabular-nums font-bold text-emerald-700">
                    {formatMoney(so.grossProfit, state.currency)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        so.status === 'confirmed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-[#F6EFE7] text-[#8E6742]'
                      }`}
                    >
                      {so.status === 'confirmed' ? 'مؤكدة ومصروفة' : 'مسودة'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {so.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => void confirmSalesOrder(so.id)}
                        className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-lg cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#BD956D]" />
                        تأكيد وصرف المخزون
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inventory Movements Audit Ledger */}
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
        title="إنشاء فاتورة مبيعات جديدة"
        subtitle="عند التأكيد يتم خصم القطع من مخزون المنتج التام وحساب صافي الربح الفعلي"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">اسم العميل *</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="مثال: ندى محمود"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">قناة البيع</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as SalesChannel)}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
              >
                {Object.entries(CHANNEL_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">القطع المباعة (من مخزون المنتج التام):</span>
              <button
                type="button"
                onClick={() => {
                  const v = allVariants[0];
                  if (v)
                    setItems((prev) => [
                      ...prev,
                      { variantId: v.id, quantity: 1, unitPrice: v.retailPrice },
                    ]);
                }}
                className="text-xs bg-[#F6EFE7] text-[#8E6742] font-bold px-2.5 py-1 rounded-lg cursor-pointer"
              >
                + إضافة صنف
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

          <div className="grid grid-cols-2 gap-3">
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
              <label className="block text-xs font-semibold mb-1">مصاريف الشحن</label>
              <input
                type="number"
                min="0"
                value={shippingFee}
                onChange={(e) => setShippingFee(Number(e.target.value))}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs tabular-nums"
              />
            </div>
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
              حفظ فاتورة المبيعات
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
