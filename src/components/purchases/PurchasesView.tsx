import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  PackagePlus,
  Plus,
  ShoppingBag,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { CURRENCIES } from '../../types/erp';
import type { PurchaseOrder } from '../../types/erp';
import {
  blockInvalidDecimalKey,
  blockNonIntegerKey,
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  PURCHASE_UNIT_LABELS,
  toDecimalQty,
  toWholeQty,
} from '../../utils/calculations';
import { Modal } from '../common/Modal';

interface DraftLine {
  itemType: 'fabric' | 'trim';
  refId: string;
  quantity: number;
  qtyText?: string;
  unitPrice: number;
}

export const PurchasesView: React.FC = () => {
  const {
    state,
    userRole,
    pendingPoDraft,
    clearPendingPoDraft,
    createAndReceivePO,
    receivePO,
    recordSupplierPayment,
    cancelPO,
    deletePO,
  } = useERP();

  const [modalOpen, setModalOpen] = useState<boolean>(() => Boolean(pendingPoDraft));
  const [draftSourceLabel, setDraftSourceLabel] = useState<string>(
    () => pendingPoDraft?.sourceLabel || ''
  );
  const [supplierName, setSupplierName] = useState<string>(
    () => pendingPoDraft?.supplierName || ''
  );
  const [supplierId, setSupplierId] = useState<string>(() => pendingPoDraft?.supplierId || '');
  const [receiveImmediately, setReceiveImmediately] = useState<boolean>(
    () => (pendingPoDraft ? false : true)
  );
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [shippingAllocationMode, setShippingAllocationMode] = useState<
    'fabric_qty' | 'all_value'
  >('fabric_qty');
  const [notes, setNotes] = useState<string>(() => pendingPoDraft?.notes || '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    pendingPoDraft?.lines?.length
      ? pendingPoDraft.lines.map((l) => ({ ...l, qtyText: String(l.quantity) }))
      : []
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<'all' | 'fabrics' | 'trims'>('all');
  const [busyPoId, setBusyPoId] = useState<string | null>(null);

  // Supplier Payment Modal state
  const [payPo, setPayPo] = useState<PurchaseOrder | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<string>('كاش');
  const [payNotes, setPayNotes] = useState<string>('');
  const [paying, setPaying] = useState(false);

  const paymentMethods = useMemo(
    () => getLookupLabels(state.lookups, 'payment_methods'),
    [state.lookups]
  );

  // Detect duplicate items in the same PO
  const duplicateLineKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) {
      const k = `${l.itemType}:${l.refId}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const dups = new Set<string>();
    for (const [k, c] of counts.entries()) {
      if (c > 1) dups.add(k);
    }
    return dups;
  }, [lines]);

  const mergeDuplicateLines = () => {
    const merged: DraftLine[] = [];
    const indexByKey = new Map<string, number>();
    for (const l of lines) {
      const k = `${l.itemType}:${l.refId}`;
      const existingIdx = indexByKey.get(k);
      const safeQty =
        l.itemType === 'fabric' ? toDecimalQty(l.quantity, 0, 3) : toWholeQty(l.quantity, 0);
      if (existingIdx !== undefined) {
        const prevQty = merged[existingIdx].quantity;
        const summed =
          l.itemType === 'fabric'
            ? Math.round((prevQty + safeQty) * 1000) / 1000
            : toWholeQty(prevQty + safeQty, 1);
        merged[existingIdx] = {
          ...merged[existingIdx],
          quantity: summed,
          qtyText: String(summed),
        };
      } else {
        const initQty =
          l.itemType === 'fabric'
            ? toDecimalQty(l.quantity, 0.01, 3)
            : toWholeQty(l.quantity, 1);
        indexByKey.set(k, merged.length);
        merged.push({ ...l, quantity: initQty, qtyText: String(initQty) });
      }
    }
    setLines(merged);
  };

  const openPayModal = (po: PurchaseOrder) => {
    const rem = Math.max(0, Math.round(((po.totalAmount || 0) - (po.paidAmount || 0)) * 100) / 100);
    setPayPo(po);
    setPayAmount(rem);
    setPayMethod(paymentMethods[0] || 'كاش');
    setPayNotes('');
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payPo || paying) return;
    const rem = Math.max(
      0,
      Math.round(((payPo.totalAmount || 0) - (payPo.paidAmount || 0)) * 100) / 100
    );
    const safeAmt = Math.min(rem, Math.max(0, Math.round((Number(payAmount) || 0) * 100) / 100));
    if (safeAmt <= 0) return;
    setPaying(true);
    try {
      await recordSupplierPayment(payPo.id, safeAmt, payMethod, payNotes);
      setPayPo(null);
    } finally {
      setPaying(false);
    }
  };

  const runPoAction = async (poId: string, action: () => Promise<void>, successMessage?: string) => {
    setBusyPoId(poId);
    try {
      await action();
      if (successMessage) {
        setToastMsg(successMessage);
        setTimeout(() => setToastMsg(null), 4000);
      }
    } finally {
      setBusyPoId(null);
    }
  };

  const closeCreateModal = () => {
    setModalOpen(false);
    setFormError(null);
    setDraftSourceLabel('');
    if (pendingPoDraft) clearPendingPoDraft();
  };

  const openModal = () => {
    if (pendingPoDraft) clearPendingPoDraft();
    setDraftSourceLabel('');
    setFormError(null);
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
              qtyText: '50',
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
          qtyText: '50',
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
          qtyText: '10',
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
    setFormError(null);
    setSubmitting(true);
    try {
      const year = new Date().getFullYear();
      const prefix = `PO-${year}-`;
      let maxSeq = 0;
      for (const existing of state.purchaseOrders) {
        if (existing.poNumber?.startsWith(prefix)) {
          const parsed = Number.parseInt(existing.poNumber.slice(prefix.length), 10);
          if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed;
        }
      }
      const poNumber = `${prefix}${String(Math.max(maxSeq, state.purchaseOrders.length) + 1).padStart(3, '0')}`;

      const items = lines.map((line, idx) => {
        const shippingAllocated = poCalc.allocations[idx]?.shippingAllocated || 0;
        if (line.itemType === 'fabric') {
          const fabQty = toDecimalQty(line.quantity, 0.01, 3);
          const fab = state.fabrics.find((f) => f.id === line.refId);
          return {
            itemType: 'fabric' as const,
            fabricId: line.refId,
            trimId: null,
            description: fab?.name || 'قماش',
            quantity: fabQty,
            unitsPerPack: 1,
            unitPrice: line.unitPrice,
            shippingAllocated,
          };
        }
        const trim = state.trims.find((t) => t.id === line.refId);
        const isMeterTrim = trim?.purchaseUnit === 'meter' || trim?.unitLabel === 'متر';
        const trimQty = isMeterTrim
          ? toDecimalQty(line.quantity, 0.01, 3)
          : toWholeQty(line.quantity, 1);
        return {
          itemType: 'trim' as const,
          fabricId: null,
          trimId: line.refId,
          description: trim?.name || 'كلفة',
          quantity: trimQty,
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
      closeCreateModal();
      setToastMsg(
        receiveImmediately
          ? `تم حفظ واستلام أمر الشراء (${poNumber}) وتحديث رصيد المخزون تلقائياً ✓`
          : `تم حفظ أمر الشراء (${poNumber}) كـ «قيد التوريد» — اضغط «استلام بالمخزن» لإضافة الكمية للمخزون.`
      );
      setTimeout(() => setToastMsg(null), 5000);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'تعذر حفظ أو استلام أمر الشراء — يرجى المحاولة مرة أخرى.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const sortedFabrics = useMemo(
    () =>
      [...state.fabrics].sort((a, b) => {
        const diff = (b.stockQty || 0) - (a.stockQty || 0);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, 'ar');
      }),
    [state.fabrics]
  );

  const sortedTrims = useMemo(
    () =>
      [...state.trims].sort((a, b) => {
        const diff = (b.stockQty || 0) - (a.stockQty || 0);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, 'ar');
      }),
    [state.trims]
  );

  const totalPurchases = state.purchaseOrders
    .filter((p) => p.status === 'received')
    .reduce((s, p) => s + p.totalAmount, 0);

  const activePoCount = state.purchaseOrders.filter((p) => p.status !== 'cancelled').length;
  const cancelledPoCount = state.purchaseOrders.filter((p) => p.status === 'cancelled').length;
  const totalTrimsStockUnits = state.trims.reduce((s, t) => s + (t.stockQty || 0), 0);

  return (
    <div className="space-y-6">
      {toastMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs font-bold text-emerald-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-emerald-700 underline text-[11px] cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

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
          <div className="text-xs font-semibold text-[#6E6C66]">رصيد المخزن الحالي (أقمشة وكلف)</div>
          <div className="text-2xl font-bold text-[#8E6742] tabular-nums mt-2">
            {formatNumber(
              state.fabrics.reduce((s, f) => s + (f.stockQty || 0), 0),
              2
            )}{' '}
            متر/كيلو
          </div>
          <div className="text-xs text-[#6E6C66] mt-1 tabular-nums">
            + {formatNumber(totalTrimsStockUnits, 0)} وحدة كلف ومستلزمات • WAC تلقائي
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

      {/* Live Raw Material Stock Strip (Fabrics + Trims/Supplies) */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <PackagePlus className="w-4 h-4 text-[#A67C52]" />
            <h2 className="text-sm font-bold text-[#1A1A1E]">
              رصيد مخزن الخامات الحالي (أقمشة وكلف)
            </h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FAF6F0] text-[#8E6742] border border-[#E8DAC6]">
              مرتّب بالكمية (الأكبر أولاً)
            </span>
          </div>
          <div className="inline-flex rounded-lg bg-[#F3F2EE] p-0.5 text-[11px] font-bold">
            {(
              [
                ['all', `الكل (${state.fabrics.length + state.trims.length})`],
                ['fabrics', `الأقمشة (${state.fabrics.length})`],
                ['trims', `الكلف والمستلزمات (${state.trims.length})`],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setStockFilter(val)}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  stockFilter === val
                    ? 'bg-[#1A1A1E] text-white'
                    : 'text-[#6E6C66] hover:text-[#1A1A1E]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {(stockFilter === 'all' || stockFilter === 'fabrics') && sortedFabrics.length > 0 && (
          <div className="space-y-2">
            {stockFilter === 'all' && (
              <div className="text-[11px] font-bold text-[#6E6C66]">الأقمشة:</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {sortedFabrics.map((f) => (
                <div
                  key={f.id}
                  className={`rounded-xl border border-[#EAE8E2] bg-[#FAF9F7] p-3 flex items-center justify-between gap-2 ${
                    (f.stockQty || 0) <= 0 ? 'opacity-65' : ''
                  }`}
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
                    {formatNumber(f.stockQty, 2)} {FABRIC_UNIT_LABELS[f.unit]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(stockFilter === 'all' || stockFilter === 'trims') && sortedTrims.length > 0 && (
          <div className="space-y-2">
            {stockFilter === 'all' && (
              <div className="text-[11px] font-bold text-[#6E6C66]">الكلف ومستلزمات التصنيع والبراند:</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {sortedTrims.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-xl border border-[#EAE8E2] bg-[#FAF9F7] p-3 flex items-center justify-between gap-2 ${
                    (t.stockQty || 0) <= 0 ? 'opacity-65' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#1A1A1E] truncate">{t.name}</div>
                    <div className="text-[11px] text-[#6E6C66] tabular-nums">
                      العبوة: {formatMoney(t.packPrice, state.currency)} ({t.unitsPerPack} {t.unitLabel})
                    </div>
                  </div>
                  <span
                    className={`text-xs font-extrabold tabular-nums px-2 py-1 rounded-lg shrink-0 ${
                      t.stockQty <= t.reorderLevel
                        ? 'bg-red-100 text-red-700'
                        : 'bg-emerald-50 text-emerald-800'
                    }`}
                  >
                    {formatNumber(
                      t.stockQty,
                      t.purchaseUnit === 'meter' || t.unitLabel === 'متر' ? 2 : 0
                    )}{' '}
                    {t.unitLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
                  {po.items
                    .map((it) => `${it.description} (${formatNumber(it.quantity, 2)})`)
                    .join('، ')}
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
                    {!isCancelled && (po.paidAmount || 0) > 0 && (
                      <div className="text-[10px] font-semibold text-emerald-700 tabular-nums">
                        مدفوع: {formatMoney(po.paidAmount || 0, state.currency)} • متبقي:{' '}
                        {formatMoney(
                          Math.max(0, (po.totalAmount || 0) - (po.paidAmount || 0)),
                          state.currency
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isCancelled && !isReceived && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void runPoAction(
                            po.id,
                            () => receivePO(po.id),
                            `تم استلام أمر الشراء (${po.poNumber}) وتحديث رصيد المخزون بنجاح ✓`
                          )
                        }
                        className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#BD956D]" />
                        استلام بالمخزن
                      </button>
                    )}
                    {!isCancelled && (po.totalAmount || 0) - (po.paidAmount || 0) > 0.01 && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openPayModal(po)}
                        className="inline-flex items-center gap-1 text-xs font-bold border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        سداد للمورد
                      </button>
                    )}
                    {!isCancelled && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runPoAction(po.id, () => cancelPO(po.id))}
                        className="inline-flex items-center gap-1 text-xs font-bold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        إلغاء
                      </button>
                    )}
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runPoAction(po.id, () => deletePO(po.id))}
                        className="inline-flex items-center gap-1 text-xs font-bold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
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
                <th className="py-3 px-4">الإجمالي / السداد</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {state.purchaseOrders.map((po) => {
                const isCancelled = po.status === 'cancelled';
                const isReceived = po.status === 'received';
                const isBusy = busyPoId === po.id;
                const remaining = Math.max(0, (po.totalAmount || 0) - (po.paidAmount || 0));
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
                      {po.items
                        .map((it) => `${it.description} (${formatNumber(it.quantity, 2)})`)
                        .join('، ')}
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
                      {!isCancelled && (
                        <div className="text-[10px] font-semibold mt-0.5">
                          {remaining <= 0.01 ? (
                            <span className="text-emerald-700">مسدد بالكامل ✓</span>
                          ) : (po.paidAmount || 0) > 0 ? (
                            <span className="text-[#4B4A46]">
                              مدفوع {formatMoney(po.paidAmount, state.currency)} • متبقي{' '}
                              <span className="text-red-700">
                                {formatMoney(remaining, state.currency)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[#6E6C66]">غير مسدد بعد</span>
                          )}
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
                          : 'قيد التوريد (لم يُضف للمخزن)'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!isCancelled && !isReceived && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void runPoAction(
                                po.id,
                                () => receivePO(po.id),
                                `تم استلام أمر الشراء (${po.poNumber}) وتحديث رصيد المخزون بنجاح ✓`
                              )
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-lg hover:bg-[#2E2E35] cursor-pointer disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#BD956D]" />
                            استلام بالمخزن
                          </button>
                        )}
                        {!isCancelled && remaining > 0.01 && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => openPayModal(po)}
                            title="سداد دفعة للمورد وخصمها من الخزنة ورصيد المورد تلقائياً"
                            className="inline-flex items-center gap-1 text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            سداد
                          </button>
                        )}
                        {!isCancelled && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runPoAction(po.id, () => cancelPO(po.id))}
                            className="inline-flex items-center gap-1 text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            إلغاء
                          </button>
                        )}
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runPoAction(po.id, () => deletePO(po.id))}
                            title="حذف أمر الشراء نهائياً"
                            className="inline-flex items-center gap-1 text-xs font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            حذف
                          </button>
                        )}
                      </div>
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
        onClose={closeCreateModal}
        title="إنشاء أمر شراء خامات / كلف"
        subtitle="عند الاستلام يتم زيادة رصيد المخزون وإعادة حساب متوسط التكلفة المرجّح تلقائياً في PostgreSQL"
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-bold text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {draftSourceLabel && (
            <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] px-3.5 py-2.5 text-xs text-[#7B5836] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-[#A67C52] shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">مسودة شراء اختيارية: {draftSourceLabel}</div>
                <div className="text-[11px] text-[#6E6C66] mt-0.5">
                  يمكنك تعديل الكميات والأسعار أو حذف أي صنف غير متوفر أو إغلاق النافذة لتجاهل
                  المسودة بالكامل.
                </div>
              </div>
            </div>
          )}

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

            {duplicateLineKeys.size > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>تنبيه: يوجد صنف مكرر أكثر من مرة في نفس الفاتورة!</span>
                </div>
                <button
                  type="button"
                  onClick={mergeDuplicateLines}
                  className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-bold cursor-pointer"
                >
                  دمج السطور المكررة تلقائياً
                </button>
              </div>
            )}

            {lines.map((line, idx) => {
              const currencySymbol = CURRENCIES[state.currency]?.symbol || 'ج.م';
              const isFabric = line.itemType === 'fabric';
              const selectedTrim = !isFabric
                ? state.trims.find((t) => t.id === line.refId)
                : undefined;
              const allowDecimal =
                isFabric ||
                selectedTrim?.purchaseUnit === 'meter' ||
                selectedTrim?.unitLabel === 'متر';
              const unitLabel = isFabric
                ? FABRIC_UNIT_LABELS[
                    state.fabrics.find((f) => f.id === line.refId)?.unit || 'meter'
                  ]
                : PURCHASE_UNIT_LABELS[selectedTrim?.purchaseUnit || 'piece'];
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
                        {isFabric ? 'الصنف (قماش)' : 'الصنف (كلفة / عبوة)'}
                      </label>
                      <select
                        value={line.refId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const price = isFabric
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
                        {isFabric
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
                        {allowDecimal && (
                          <span className="text-[10px] font-normal text-[#6E6C66] mr-1">
                            (يقبل كسور)
                          </span>
                        )}
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min={allowDecimal ? '0.01' : '1'}
                          step={allowDecimal ? 'any' : '1'}
                          inputMode={allowDecimal ? 'decimal' : 'numeric'}
                          pattern={allowDecimal ? undefined : '[0-9]*'}
                          value={line.qtyText !== undefined ? line.qtyText : line.quantity || ''}
                          onKeyDown={allowDecimal ? blockInvalidDecimalKey : blockNonIntegerKey}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const parsed = allowDecimal
                              ? toDecimalQty(raw, 0, 3)
                              : toWholeQty(raw, 0);
                            setLines((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, quantity: parsed, qtyText: raw } : l
                              )
                            );
                          }}
                          onBlur={() =>
                            setLines((prev) =>
                              prev.map((l, i) => {
                                if (i !== idx) return l;
                                const finalized = allowDecimal
                                  ? toDecimalQty(l.quantity, 0.01, 3)
                                  : toWholeQty(l.quantity, 1);
                                return { ...l, quantity: finalized, qtyText: String(finalized) };
                              })
                            )
                          }
                          placeholder={allowDecimal ? 'مثال: 4.5' : 'عدد صحيح'}
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

      {/* Supplier Payment Modal (سداد دفعة للمورد المرتبط بالخزنة) */}
      <Modal
        open={Boolean(payPo)}
        onClose={() => setPayPo(null)}
        title={`سداد دفعة للمورد — ${payPo?.supplierName || ''}`}
        subtitle={`أمر الشراء ${payPo?.poNumber || ''} • يتم خصم المبلغ من الخزنة ورصيد المورد تلقائياً`}
        maxWidthClass="max-w-md"
      >
        {payPo && (
          <form onSubmit={handlePaySubmit} className="space-y-4">
            {(() => {
              const rem = Math.max(
                0,
                Math.round(((payPo.totalAmount || 0) - (payPo.paidAmount || 0)) * 100) / 100
              );
              const isOver = payAmount > rem + 0.01;
              return (
                <>
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#FAF9F7] border border-[#EAE8E2] p-3 text-center text-xs">
                    <div>
                      <div className="text-[10px] text-[#6E6C66]">إجمالي الفاتورة</div>
                      <div className="font-bold text-[#1A1A1E] tabular-nums mt-0.5">
                        {formatMoney(payPo.totalAmount, state.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#6E6C66]">المدفوع سابقاً</div>
                      <div className="font-bold text-emerald-700 tabular-nums mt-0.5">
                        {formatMoney(payPo.paidAmount || 0, state.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#6E6C66]">المتبقي</div>
                      <div className="font-extrabold text-red-700 tabular-nums mt-0.5">
                        {formatMoney(rem, state.currency)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">قيمة الدفعة *</label>
                      <input
                        type="number"
                        min="0.01"
                        max={rem}
                        step="0.01"
                        required
                        value={payAmount || ''}
                        onChange={(e) => setPayAmount(Math.max(0, Number(e.target.value) || 0))}
                        className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-sm font-bold tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">طريقة الدفع</label>
                      <select
                        value={payMethod}
                        onChange={(e) => setPayMethod(e.target.value)}
                        className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs font-semibold"
                      >
                        {paymentMethods.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {isOver && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-bold text-red-700">
                      تنبيه: لا يمكن سداد مبلغ أكبر من المتبقي المستحق ({formatMoney(rem, state.currency)}).
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold mb-1">ملاحظات (اختياري)</label>
                    <input
                      type="text"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="مثال: تحويل إنستاباي / دفعة نقدية..."
                      className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
                    <button
                      type="button"
                      onClick={() => setPayPo(null)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={paying || payAmount <= 0 || isOver}
                      className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {paying ? 'جاري التسجيل...' : 'تأكيد السداد وتحديث الخزنة'}
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
