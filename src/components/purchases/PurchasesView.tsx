import React, { useState } from 'react';
import { CheckCircle2, PackagePlus, Plus, ShoppingBag, Trash2, XCircle } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import {
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  PURCHASE_UNIT_LABELS,
} from '../../utils/calculations';
import { Modal } from '../common/Modal';

interface DraftLine {
  itemType: 'fabric' | 'trim';
  refId: string;
  quantity: number;
  unitPrice: number;
}

export const PurchasesView: React.FC = () => {
  const { state, createAndReceivePO, receivePO, cancelPO } = useERP();
  const [modalOpen, setModalOpen] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [receiveImmediately, setReceiveImmediately] = useState(true);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [busyPoId, setBusyPoId] = useState<string | null>(null);

  const runPoAction = async (poId: string, action: () => Promise<void>) => {
    setBusyPoId(poId);
    try {
      await action();
    } finally {
      setBusyPoId(null);
    }
  };

  const openModal = () => {
    const firstSup = state.suppliers[0];
    setSupplierId(firstSup?.id || '');
    setSupplierName(firstSup?.name || 'مورد عام');
    setReceiveImmediately(true);
    setNotes('');
    setLines(
      state.fabrics[0]
        ? [
            {
              itemType: 'fabric',
              refId: state.fabrics[0].id,
              quantity: 50,
              unitPrice: state.fabrics[0].pricePerUnit,
            },
          ]
        : []
    );
    setModalOpen(true);
  };

  const addLine = (itemType: 'fabric' | 'trim') => {
    if (itemType === 'fabric' && state.fabrics[0]) {
      setLines((prev) => [
        ...prev,
        {
          itemType: 'fabric',
          refId: state.fabrics[0].id,
          quantity: 50,
          unitPrice: state.fabrics[0].pricePerUnit,
        },
      ]);
    } else if (itemType === 'trim' && state.trims[0]) {
      setLines((prev) => [
        ...prev,
        {
          itemType: 'trim',
          refId: state.trims[0].id,
          quantity: 10,
          unitPrice: state.trims[0].packPrice,
        },
      ]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) return;
    setSubmitting(true);
    try {
      const poNumber = `PO-${new Date().getFullYear()}-${String(
        state.purchaseOrders.length + 1
      ).padStart(3, '0')}`;
      const items = lines.map((line) => {
        if (line.itemType === 'fabric') {
          const fab = state.fabrics.find((f) => f.id === line.refId);
          return {
            itemType: 'fabric' as const,
            fabricId: line.refId,
            trimId: null,
            description: fab?.name || 'قماش',
            quantity: line.quantity,
            unitsPerPack: 1,
            unitPrice: line.unitPrice,
          };
        }
        const trim = state.trims.find((t) => t.id === line.refId);
        return {
          itemType: 'trim' as const,
          fabricId: null,
          trimId: line.refId,
          description: trim?.name || 'كلفة',
          quantity: line.quantity,
          unitsPerPack: trim?.unitsPerPack || 1,
          unitPrice: line.unitPrice,
        };
      });

      await createAndReceivePO({
        poNumber,
        supplierId: supplierId || null,
        supplierName: supplierName.trim() || 'مورد عام',
        receiveImmediately,
        notes,
        items,
      });
      setModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const totalPurchases = state.purchaseOrders
    .filter((p) => p.status === 'received')
    .reduce((s, p) => s + p.totalAmount, 0);

  const activePoCount = state.purchaseOrders.filter((p) => p.status !== 'cancelled').length;
  const cancelledPoCount = state.purchaseOrders.filter((p) => p.status === 'cancelled').length;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="text-xs font-semibold text-[#6E6C66]">إجمالي المشتريات المستلمة</div>
          <div className="text-2xl font-bold text-[#1A1A1E] tabular-nums mt-2">
            {formatMoney(totalPurchases, state.currency)}
          </div>
          <div className="text-xs text-[#6E6C66] mt-1">
            {activePoCount} أمر شراء نشط
            {cancelledPoCount > 0 ? ` • ${cancelledPoCount} ملغي` : ''}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5">
          <div className="text-xs font-semibold text-[#6E6C66]">رصيد الأقمشة بالمخزن</div>
          <div className="text-2xl font-bold text-[#8E6742] tabular-nums mt-2">
            {formatNumber(
              state.fabrics.reduce((s, f) => s + (f.stockQty || 0), 0),
              1
            )}{' '}
            متر/كيلو
          </div>
          <div className="text-xs text-[#6E6C66] mt-1">
            يُحدّث تلقائياً مع متوسط التكلفة المرجح (WAC)
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-semibold text-[#6E6C66]">إجراء سريع</div>
            <p className="text-xs text-[#6E6C66] mt-1">
              استلام فاتورة خامات يحدّث المخزون وتكلفة الموديلات تلقائياً
            </p>
          </div>
          <button
            type="button"
            onClick={openModal}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold py-2.5 px-4 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>أمر شراء جديد (PO)</span>
          </button>
        </div>
      </div>

      {/* Live Raw Material Stock Strip */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <PackagePlus className="w-4 h-4 text-[#A67C52]" />
          <h2 className="text-sm font-bold text-[#1A1A1E]">
            رصيد مخزن الخامات الحالي (أقمشة وكلف)
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {state.fabrics.map((f) => (
            <div
              key={f.id}
              className="rounded-xl border border-[#EAE8E2] bg-[#FAF9F7] p-3 flex items-center justify-between"
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#1A1A1E] truncate">{f.name}</div>
                <div className="text-[11px] text-[#6E6C66] tabular-nums">
                  متوسط السعر: {formatMoney(f.pricePerUnit, state.currency)}
                </div>
              </div>
              <span
                className={`text-xs font-extrabold tabular-nums px-2 py-1 rounded-lg shrink-0 ${
                  f.stockQty <= f.reorderLevel
                    ? 'bg-red-100 text-red-700'
                    : 'bg-[#F6EFE7] text-[#8E6742]'
                }`}
              >
                {formatNumber(f.stockQty, 1)} {FABRIC_UNIT_LABELS[f.unit]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Purchase Orders List (Mobile Cards + Desktop Table) */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E3DD] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-[#A67C52]" />
            <h2 className="text-sm font-bold text-[#1A1A1E]">سجل أوامر الشراء والفواتير</h2>
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {state.purchaseOrders.map((po) => {
            const isCancelled = po.status === 'cancelled';
            const isReceived = po.status === 'received';
            const isBusy = busyPoId === po.id;
            return (
              <div
                key={po.id}
                className={`p-3.5 space-y-2.5 ${isCancelled ? 'opacity-65 bg-[#FAF9F7]/60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div
                      className={`font-bold text-sm text-[#1A1A1E] ${
                        isCancelled ? 'line-through text-[#6E6C66]' : ''
                      }`}
                    >
                      {po.supplierName}
                    </div>
                    <div className="text-[11px] text-[#6E6C66]">
                      <span className="font-mono">{po.poNumber}</span> • {po.orderDate}
                    </div>
                  </div>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
                      isReceived
                        ? 'bg-emerald-50 text-emerald-700'
                        : isCancelled
                        ? 'bg-red-50 text-red-700'
                        : 'bg-[#F6EFE7] text-[#8E6742]'
                    }`}
                  >
                    {isReceived ? 'مستلم' : isCancelled ? 'ملغي' : 'قيد التوريد'}
                  </span>
                </div>
                <div className="text-xs text-[#4B4A46] bg-[#FAF9F7] rounded-xl p-2.5">
                  {po.items.map((it) => `${it.description} (${it.quantity})`).join('، ')}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`text-sm font-extrabold tabular-nums ${
                      isCancelled ? 'line-through text-[#6E6C66]' : 'text-[#1A1A1E]'
                    }`}
                  >
                    {formatMoney(po.totalAmount, state.currency)}
                  </span>
                  {!isCancelled && (
                    <div className="flex items-center gap-1.5">
                      {!isReceived && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runPoAction(po.id, () => receivePO(po.id))}
                          className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#BD956D]" />
                          استلام بالمخزن
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runPoAction(po.id, () => cancelPO(po.id))}
                        className="inline-flex items-center gap-1 text-xs font-bold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        إلغاء الأمر
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {state.purchaseOrders.length === 0 && (
            <div className="p-8 text-center text-xs text-[#6E6C66]">
              لا توجد أوامر شراء مسجلة بعد.
            </div>
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">رقم الأمر</th>
                <th className="py-3 px-4">المورد</th>
                <th className="py-3 px-4">التاريخ</th>
                <th className="py-3 px-4">الأصناف</th>
                <th className="py-3 px-4">الإجمالي</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {state.purchaseOrders.map((po) => {
                const isCancelled = po.status === 'cancelled';
                const isReceived = po.status === 'received';
                const isBusy = busyPoId === po.id;
                return (
                  <tr
                    key={po.id}
                    className={`hover:bg-[#FAF9F7] ${
                      isCancelled ? 'opacity-65 bg-[#FAF9F7]/50' : ''
                    }`}
                  >
                    <td
                      className={`py-3 px-4 font-mono font-bold text-xs ${
                        isCancelled ? 'line-through text-[#6E6C66]' : ''
                      }`}
                    >
                      {po.poNumber}
                    </td>
                    <td
                      className={`py-3 px-4 font-semibold ${
                        isCancelled ? 'line-through text-[#6E6C66]' : 'text-[#1A1A1E]'
                      }`}
                    >
                      {po.supplierName}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#6E6C66]">{po.orderDate}</td>
                    <td className="py-3 px-4 text-xs text-[#4B4A46]">
                      {po.items.map((it) => `${it.description} (${it.quantity})`).join('، ')}
                    </td>
                    <td
                      className={`py-3 px-4 font-bold tabular-nums ${
                        isCancelled ? 'line-through text-[#6E6C66]' : ''
                      }`}
                    >
                      {formatMoney(po.totalAmount, state.currency)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isReceived
                            ? 'bg-emerald-50 text-emerald-700'
                            : isCancelled
                            ? 'bg-red-50 text-red-700'
                            : 'bg-[#F6EFE7] text-[#8E6742]'
                        }`}
                      >
                        {isReceived
                          ? 'تم الاستلام بالمخزن'
                          : isCancelled
                          ? 'ملغي'
                          : 'قيد التوريد'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {!isCancelled ? (
                        <div className="flex items-center gap-1.5">
                          {!isReceived && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void runPoAction(po.id, () => receivePO(po.id))}
                              className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-lg hover:bg-[#2E2E35] cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#BD956D]" />
                              استلام بالمخزن
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runPoAction(po.id, () => cancelPO(po.id))}
                            className="inline-flex items-center gap-1 text-xs font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-[#9C9990]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {state.purchaseOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-[#6E6C66]">
                    لا توجد أوامر شراء مسجلة بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create PO Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="إنشاء أمر شراء خامات / كلف"
        subtitle="عند الاستلام يتم زيادة رصيد المخزون وإعادة حساب متوسط التكلفة المرجّح تلقائياً في PostgreSQL"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">المورد</label>
              <select
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  const found = state.suppliers.find((s) => s.id === e.target.value);
                  if (found) setSupplierName(found.name);
                }}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
              >
                <option value="">-- مورد عام --</option>
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم المورد بالفاتورة</label>
              <input
                type="text"
                required
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">بنود الفاتورة:</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addLine('fabric')}
                  className="text-xs bg-[#F6EFE7] text-[#8E6742] font-bold px-2.5 py-1 rounded-lg cursor-pointer"
                >
                  + قماش
                </button>
                <button
                  type="button"
                  onClick={() => addLine('trim')}
                  className="text-xs bg-[#F3F2EE] text-[#1A1A1E] font-bold px-2.5 py-1 rounded-lg cursor-pointer"
                >
                  + كلفة / عبوة
                </button>
              </div>
            </div>

            {lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#FAF9F7] p-2.5 rounded-xl border border-[#EAE8E2]"
              >
                <select
                  value={line.refId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const price =
                      line.itemType === 'fabric'
                        ? state.fabrics.find((f) => f.id === id)?.pricePerUnit || 0
                        : state.trims.find((t) => t.id === id)?.packPrice || 0;
                    setLines((prev) =>
                      prev.map((l, i) => (i === idx ? { ...l, refId: id, unitPrice: price } : l))
                    );
                  }}
                  className="sm:col-span-5 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs"
                >
                  {line.itemType === 'fabric'
                    ? state.fabrics.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} ({FABRIC_UNIT_LABELS[f.unit]})
                        </option>
                      ))
                    : state.trims.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({PURCHASE_UNIT_LABELS[t.purchaseUnit]})
                        </option>
                      ))}
                </select>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === idx ? { ...l, quantity: Number(e.target.value) } : l
                      )
                    )
                  }
                  placeholder="الكمية"
                  className="sm:col-span-3 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs tabular-nums"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === idx ? { ...l, unitPrice: Number(e.target.value) } : l
                      )
                    )
                  }
                  placeholder="سعر الوحدة"
                  className="sm:col-span-3 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  className="sm:col-span-1 text-[#9C9990] hover:text-red-600 flex justify-center cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-[#1A1A1E] cursor-pointer">
            <input
              type="checkbox"
              checked={receiveImmediately}
              onChange={(e) => setReceiveImmediately(e.target.checked)}
              className="accent-[#A67C52]"
            />
            <span>استلام البضاعة بالمخزن فوراً وتحديث متوسط التكلفة</span>
          </label>

          <div className="flex items-center justify-between pt-3 border-t border-[#E5E3DD]">
            <div className="text-xs font-bold">
              الإجمالي:{' '}
              <span className="text-[#8E6742] tabular-nums">
                {formatMoney(
                  lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
                  state.currency
                )}
              </span>
            </div>
            <button
              type="submit"
              disabled={submitting || lines.length === 0}
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'جاري الحفظ...' : 'حفظ أمر الشراء'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
