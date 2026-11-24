import React, { useMemo, useState } from 'react';
import { CheckCircle2, PackagePlus, Plus, ShoppingBag, Trash2, Truck, XCircle } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { CURRENCIES } from '../../types/erp';
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
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [shippingAllocationMode, setShippingAllocationMode] = useState<
    'fabric_qty' | 'all_value'
  >('fabric_qty');
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
    setShippingCost(0);
    setShippingAllocationMode('fabric_qty');
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

  const poCalc = useMemo(() => {
    const safeShipping = Math.max(0, Math.round((Number(shippingCost) || 0) * 100) / 100);
    const hasFabrics = lines.some((l) => l.itemType === 'fabric' && (Number(l.quantity) || 0) > 0);
    const hasTrims = lines.some((l) => l.itemType === 'trim' && (Number(l.quantity) || 0) > 0);
    const totalFabricQty = lines
      .filter((l) => l.itemType === 'fabric')
      .reduce((s, l) => s + Math.max(0, Number(l.quantity) || 0), 0);

    const effectiveMode: 'fabric_qty' | 'all_value' =
      shippingAllocationMode === 'fabric_qty' && totalFabricQty > 0 ? 'fabric_qty' : 'all_value';

    const baseLineTotals = lines.map(
      (l) => Math.max(0, Number(l.quantity) || 0) * Math.max(0, Number(l.unitPrice) || 0)
    );
    const itemsSubtotal =
      Math.round(baseLineTotals.reduce((s, v) => s + v, 0) * 100) / 100;

    // Determine pro-rata weights per line
    const weights = lines.map((l, idx) => {
      const qty = Math.max(0, Number(l.quantity) || 0);
      if (effectiveMode === 'fabric_qty') {
        return l.itemType === 'fabric' ? qty : 0;
      }
      return itemsSubtotal > 0 ? baseLineTotals[idx] : qty;
    });
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    // Penny-exact pro-rata allocation (remainder placed on last weighted line)
    let lastWeightedIdx = -1;
    for (let i = 0; i < weights.length; i += 1) {
      if (weights[i] > 0) lastWeightedIdx = i;
    }

    let allocatedRunning = 0;
    const allocations: {
      baseLineTotal: number;
      shippingAllocated: number;
      shippingPerUnit: number;
      landedUnitPrice: number;
      landedLineTotal: number;
    }[] = [];

    for (let idx = 0; idx < lines.length; idx += 1) {
      const l = lines[idx];
      const qty = Math.max(0, Number(l.quantity) || 0);
      const unitPrice = Math.max(0, Number(l.unitPrice) || 0);
      const baseLineTotal = baseLineTotals[idx];
      let shippingAllocated = 0;

      if (safeShipping > 0 && totalWeight > 0 && weights[idx] > 0) {
        if (idx === lastWeightedIdx) {
          shippingAllocated = Math.max(
            0,
            Math.round((safeShipping - allocatedRunning) * 100) / 100
          );
        } else {
          shippingAllocated = Math.round(((safeShipping * weights[idx]) / totalWeight) * 100) / 100;
          allocatedRunning = Math.round((allocatedRunning + shippingAllocated) * 100) / 100;
        }
      }

      const shippingPerUnit = qty > 0 ? shippingAllocated / qty : 0;
      const landedUnitPrice = unitPrice + shippingPerUnit;
      const landedLineTotal = Math.round((baseLineTotal + shippingAllocated) * 100) / 100;

      allocations.push({
        baseLineTotal,
        shippingAllocated,
        shippingPerUnit,
        landedUnitPrice,
        landedLineTotal,
      });
    }

    const shippingPerMeter = totalFabricQty > 0 ? safeShipping / totalFabricQty : 0;
    const grandTotal = Math.round((itemsSubtotal + safeShipping) * 100) / 100;

    return {
      safeShipping,
      hasFabrics,
      hasTrims,
      totalFabricQty,
      effectiveMode,
      itemsSubtotal,
      shippingPerMeter,
      grandTotal,
      allocations,
    };
  }, [lines, shippingCost, shippingAllocationMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) return;
    setSubmitting(true);
    try {
      const poNumber = `PO-${new Date().getFullYear()}-${String(
        state.purchaseOrders.length + 1
      ).padStart(3, '0')}`;
      const items = lines.map((line, idx) => {
        const shippingAllocated = poCalc.allocations[idx]?.shippingAllocated || 0;
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
            shippingAllocated,
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
          shippingAllocated,
        };
      });

      await createAndReceivePO({
        poNumber,
        supplierId: supplierId || null,
        supplierName: supplierName.trim() || 'مورد عام',
        receiveImmediately,
        shippingCost: poCalc.safeShipping,
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
                  <div>
                    <span
                      className={`text-sm font-extrabold tabular-nums ${
                        isCancelled ? 'line-through text-[#6E6C66]' : 'text-[#1A1A1E]'
                      }`}
                    >
                      {formatMoney(po.totalAmount, state.currency)}
                    </span>
                    {Boolean(po.shippingCost && po.shippingCost > 0) && (
                      <div className="text-[10px] font-semibold text-[#8E6742] tabular-nums">
                        شامل شحن {formatMoney(po.shippingCost || 0, state.currency)}
                      </div>
                    )}
                  </div>
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
                      <div>{formatMoney(po.totalAmount, state.currency)}</div>
                      {Boolean(po.shippingCost && po.shippingCost > 0) && (
                        <div className="text-[10px] font-semibold text-[#8E6742] mt-0.5">
                          شامل شحن {formatMoney(po.shippingCost || 0, state.currency)}
                        </div>
                      )}
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
        maxWidthClass="max-w-3xl"
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

          <div className="space-y-2.5">
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

            {lines.map((line, idx) => {
              const currencySymbol = CURRENCIES[state.currency]?.symbol || 'ج.م';
              const unitLabel =
                line.itemType === 'fabric'
                  ? FABRIC_UNIT_LABELS[
                      state.fabrics.find((f) => f.id === line.refId)?.unit || 'meter'
                    ]
                  : PURCHASE_UNIT_LABELS[
                      state.trims.find((t) => t.id === line.refId)?.purchaseUnit || 'piece'
                    ];
              const alloc = poCalc.allocations[idx] || {
                baseLineTotal: (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
                shippingAllocated: 0,
                shippingPerUnit: 0,
                landedUnitPrice: Number(line.unitPrice) || 0,
                landedLineTotal: (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
              };

              return (
                <div
                  key={idx}
                  className="bg-[#FAF9F7] p-3 rounded-xl border border-[#EAE8E2] space-y-2"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    {/* Item Selector */}
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-bold text-[#4B4A46] mb-1">
                        {line.itemType === 'fabric' ? 'الصنف (قماش)' : 'الصنف (كلفة / عبوة)'}
                      </label>
                      <select
                        value={line.refId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const price =
                            line.itemType === 'fabric'
                              ? state.fabrics.find((f) => f.id === id)?.pricePerUnit || 0
                              : state.trims.find((t) => t.id === id)?.packPrice || 0;
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, refId: id, unitPrice: price } : l
                            )
                          );
                        }}
                        className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-2 text-xs font-medium text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
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
                    </div>

                    {/* Quantity */}
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-[#1A1A1E] mb-1">
                        الكمية ({unitLabel})
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="0.01"
                          step="0.5"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, quantity: Number(e.target.value) } : l
                              )
                            )
                          }
                          placeholder="أدخل الكمية"
                          aria-label={`الكمية (${unitLabel})`}
                          className="w-full rounded-lg border border-[#E5E3DD] bg-white pr-2.5 pl-12 py-2 text-xs font-bold text-[#1A1A1E] tabular-nums focus:outline-none focus:border-[#1A1A1E]"
                        />
                        <span className="pointer-events-none absolute left-2 text-[10px] font-semibold text-[#6E6C66] bg-[#F3F2EE] px-1.5 py-0.5 rounded">
                          {unitLabel}
                        </span>
                      </div>
                    </div>

                    {/* Unit Price */}
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-[#8E6742] mb-1">
                        سعر الوحدة ({currencySymbol})
                      </label>
                      <div className="relative flex items-center">
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
                          placeholder="أدخل سعر الوحدة"
                          aria-label={`سعر الوحدة (${currencySymbol})`}
                          className="w-full rounded-lg border border-[#E6D5C3] bg-white pr-2.5 pl-11 py-2 text-xs font-bold text-[#8E6742] tabular-nums focus:outline-none focus:border-[#A67C52]"
                        />
                        <span className="pointer-events-none absolute left-2 text-[10px] font-bold text-[#8E6742] bg-[#F6EFE7] px-1.5 py-0.5 rounded">
                          {currencySymbol}
                        </span>
                      </div>
                    </div>

                    {/* Line Total + Delete */}
                    <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 pb-1">
                      <div className="text-right sm:text-left">
                        <div className="text-[10px] text-[#6E6C66]">
                          {alloc.shippingAllocated > 0 ? 'إجمالي البند بالشحن' : 'إجمالي البند'}
                        </div>
                        <div className="text-xs font-extrabold text-[#1A1A1E] tabular-nums">
                          {formatMoney(alloc.landedLineTotal, state.currency)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        title="حذف البند"
                        aria-label="حذف البند"
                        className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Per-line Pro-Rata Shipping Allocation Breakdown */}
                  {alloc.shippingAllocated > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-dashed border-[#E6D5C3] text-[11px] tabular-nums">
                      <span className="text-[#7B5836]">
                        + شحن محمّل للـ{unitLabel}:{' '}
                        <strong className="text-[#8E6742]">
                          {formatMoney(alloc.shippingPerUnit, state.currency)}
                        </strong>
                        <span className="text-[#6E6C66] mr-1.5">
                          (نصيب البند: {formatMoney(alloc.shippingAllocated, state.currency)})
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#F2F7F4] border border-[#D4E6DC] px-2 py-0.5 font-bold text-[#2D5546]">
                        التكلفة الفعلية للـ{unitLabel}:{' '}
                        {formatMoney(alloc.landedUnitPrice, state.currency)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Shipping Cost & Pro-Rata Allocation Box */}
          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] p-3.5 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <label
                  htmlFor="po-shipping-cost"
                  className="flex items-center gap-1.5 text-xs font-bold text-[#7B5836] mb-1"
                >
                  <Truck className="w-3.5 h-3.5 text-[#A67C52]" />
                  <span>مصاريف الشحن والتوصيل</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    id="po-shipping-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={shippingCost || ''}
                    onChange={(e) =>
                      setShippingCost(Math.max(0, Number(e.target.value) || 0))
                    }
                    placeholder="0.00"
                    className="w-full rounded-lg border border-[#E6D5C3] bg-white pr-3 pl-12 py-2 text-xs font-bold text-[#1A1A1E] tabular-nums focus:outline-none focus:border-[#A67C52]"
                  />
                  <span className="pointer-events-none absolute left-2 text-[10px] font-bold text-[#8E6742] bg-[#F6EFE7] px-1.5 py-0.5 rounded">
                    {CURRENCIES[state.currency]?.symbol || 'ج.م'}
                  </span>
                </div>
              </div>

              <div className="sm:col-span-7 space-y-1.5">
                {poCalc.hasFabrics && poCalc.hasTrims && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-[#6E6C66]">
                      طريقة التحميل (Pro-Rata):
                    </span>
                    <div className="inline-flex rounded-lg bg-[#EFEAE2] p-0.5">
                      <button
                        type="button"
                        onClick={() => setShippingAllocationMode('fabric_qty')}
                        className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                          shippingAllocationMode === 'fabric_qty'
                            ? 'bg-[#1A1A1E] text-white'
                            : 'text-[#6E6C66]'
                        }`}
                      >
                        على الأقمشة (لكل متر)
                      </button>
                      <button
                        type="button"
                        onClick={() => setShippingAllocationMode('all_value')}
                        className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                          shippingAllocationMode === 'all_value'
                            ? 'bg-[#1A1A1E] text-white'
                            : 'text-[#6E6C66]'
                        }`}
                      >
                        على كل الأصناف (بالقيمة)
                      </button>
                    </div>
                  </div>
                )}

                {poCalc.safeShipping > 0 ? (
                  <div className="text-[11px] text-[#7B5836] bg-white/80 rounded-lg border border-[#E6D5C3]/80 px-2.5 py-1.5 tabular-nums">
                    {poCalc.effectiveMode === 'fabric_qty' ? (
                      <>
                        نصيب كل متر/كجم من الشحن:{' '}
                        <strong className="text-[#8E6742]">
                          +{formatMoney(poCalc.shippingPerMeter, state.currency)}
                        </strong>{' '}
                        <span className="text-[#6E6C66]">
                          (إجمالي الأقمشة: {formatNumber(poCalc.totalFabricQty, 1)} متر/كجم — يُضاف
                          تلقائياً لتكلفة المتر بالمخزن)
                        </span>
                      </>
                    ) : (
                      <>
                        يتم توزيع{' '}
                        <strong className="text-[#8E6742]">
                          {formatMoney(poCalc.safeShipping, state.currency)}
                        </strong>{' '}
                        بالتناسب حسب قيمة كل صنف وإضافتها لمتوسط التكلفة بالمخزن.
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-[#6E6C66]">
                    أدخل مصاريف الشحن ليتم تحميلها بالتناسب (Pro-Rata) على كل متر وإضافتها للإجمالي
                    ومؤشر متوسط التكلفة.
                  </div>
                )}
              </div>
            </div>
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E5E3DD]">
            <div className="space-y-0.5">
              {poCalc.safeShipping > 0 && (
                <div className="text-[11px] text-[#6E6C66] tabular-nums">
                  الأصناف: {formatMoney(poCalc.itemsSubtotal, state.currency)} + الشحن:{' '}
                  <span className="font-bold text-[#8E6742]">
                    {formatMoney(poCalc.safeShipping, state.currency)}
                  </span>
                </div>
              )}
              <div className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
                {poCalc.safeShipping > 0 ? 'الإجمالي النهائي (شامل الشحن): ' : 'الإجمالي: '}
                <span className="text-[#8E6742] font-extrabold tabular-nums">
                  {formatMoney(poCalc.grandTotal, state.currency)}
                </span>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting || lines.length === 0}
              className="px-5 py-2.5 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'جاري الحفظ...' : 'حفظ أمر الشراء'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
