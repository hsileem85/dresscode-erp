import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CheckCircle2,
  Edit3,
  Factory,
  Play,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { newUuid } from '../../lib/supabase';
import type { ModelVariant, ProductionOrder } from '../../types/erp';
import {
  blockInvalidDecimalKey,
  blockNonIntegerKey,
  calculateModelCost,
  FABRIC_UNIT_LABELS,
  formatMoney,
  toDecimalQty,
  toWholeQty,
} from '../../utils/calculations';
import {
  openAndPrintDispatchSlip,
  type DispatchMaterialLine,
} from '../../utils/printDispatchSlip';
import { Modal } from '../common/Modal';
import { ModelSmartSelect } from '../common/ModelSmartSelect';

export const ProductionView: React.FC = () => {
  const {
    state,
    userRole,
    pendingProductionModelId,
    clearPendingProductionModel,
    addModelVariant,
    updateModelVariant,
    deleteModelVariant,
    createProductionBatch,
    issueProductionBatch,
    completeProductionBatch,
    recordWorkshopPayment,
    updateProductionBatch,
    deleteProductionBatch,
  } = useERP();

  const initialModelId =
    pendingProductionModelId && state.models.some((m) => m.id === pendingProductionModelId)
      ? pendingProductionModelId
      : state.models[0]?.id || '';
  const initialModel = state.models.find((m) => m.id === initialModelId);
  const initialWorkshopId =
    initialModel?.laborSteps.find((l) => l.workshopId)?.workshopId ||
    state.workshops[0]?.id ||
    '';

  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(() =>
    Boolean(pendingProductionModelId)
  );
  const [editingBatch, setEditingBatch] = useState<ProductionOrder | null>(null);
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string>(() => initialModelId);
  const [variantQtyMap, setVariantQtyMap] = useState<Record<string, number>>({});
  const [batchWorkshopId, setBatchWorkshopId] = useState<string>(() => initialWorkshopId);
  const [batchAgreedLabor, setBatchAgreedLabor] = useState<number>(0);
  const [laborManuallyEdited, setLaborManuallyEdited] = useState(false);
  const [batchAdvance, setBatchAdvance] = useState<number>(0);
  const [batchPayMethod, setBatchPayMethod] = useState('كاش');
  const [batchNotes, setBatchNotes] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Workshop Advance / Settlement Modal
  const [payoutOrder, setPayoutOrder] = useState<ProductionOrder | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payoutMethod, setPayoutMethod] = useState('كاش');
  const [payoutNotes, setPayoutNotes] = useState('');

  // Complete & Settle on Delivery Modal
  const [completeOrder, setCompleteOrder] = useState<ProductionOrder | null>(null);
  const [deliveryPayAmount, setDeliveryPayAmount] = useState<number>(0);
  const [deliveryPayMethod, setDeliveryPayMethod] = useState('كاش');

  // Material Dispatch Voucher (إذن تسليم خامات للتصنيع) Modal
  const [dispatchOrder, setDispatchOrder] = useState<ProductionOrder | null>(null);
  const [dispatchDate, setDispatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dispatchReturnDate, setDispatchReturnDate] = useState('');
  const [dispatchDeliveredBy, setDispatchDeliveredBy] = useState('');
  const [dispatchMaterials, setDispatchMaterials] = useState<DispatchMaterialLine[]>([]);
  const [dispatchShowFinancials, setDispatchShowFinancials] = useState(true);
  const [dispatchInstructions, setDispatchInstructions] = useState('');

  // Add / Edit variant form (supports opening finished-goods stock & COGS)
  const [editingVariant, setEditingVariant] = useState<ModelVariant | null>(null);
  const [varModelId, setVarModelId] = useState<string>(state.models[0]?.id || '');
  const [varColor, setVarColor] = useState('أسود فحمي');
  const [varSize, setVarSize] = useState('M');
  const [varOpeningQty, setVarOpeningQty] = useState<number>(0);
  const [varUnitCogs, setVarUnitCogs] = useState<number>(0);
  const [varRetailPrice, setVarRetailPrice] = useState<number>(0);

  const allVariants = useMemo(
    () =>
      state.models
        .flatMap((m) =>
          m.variants.map((v) => ({ ...v, modelName: m.name, modelSku: m.sku }))
        )
        .sort((a, b) => {
          const diff = (b.finishedGoodsQty || 0) - (a.finishedGoodsQty || 0);
          if (diff !== 0) return diff;
          const nameCmp = a.modelName.localeCompare(b.modelName, 'ar');
          if (nameCmp !== 0) return nameCmp;
          return (a.variantSku || '').localeCompare(b.variantSku || '');
        }),
    [state.models]
  );

  const linkedVariantCounts = useMemo(() => {
    const map = new Map<string, { salesCount: number; prodCount: number }>();
    for (const s of state.salesOrders) {
      const seen = new Set<string>();
      for (const it of s.items) {
        if (seen.has(it.variantId)) continue;
        seen.add(it.variantId);
        const cur = map.get(it.variantId) || { salesCount: 0, prodCount: 0 };
        cur.salesCount += 1;
        map.set(it.variantId, cur);
      }
    }
    for (const p of state.productionOrders) {
      const seen = new Set<string>();
      for (const pv of p.variants) {
        if (seen.has(pv.variantId)) continue;
        seen.add(pv.variantId);
        const cur = map.get(pv.variantId) || { salesCount: 0, prodCount: 0 };
        cur.prodCount += 1;
        map.set(pv.variantId, cur);
      }
    }
    return map;
  }, [state.salesOrders, state.productionOrders]);

  const selectedModel = state.models.find((m) => m.id === selectedModelId);

  const getModelLaborPerPiece = (modelId: string) => {
    const m = state.models.find((x) => x.id === modelId);
    if (!m) return 0;
    return calculateModelCost(m, state.fabrics, state.trims, state.overhead).directLaborCost;
  };

  const getOrderTotalLabor = (po: ProductionOrder) => {
    if (po.agreedLaborTotal > 0) return po.agreedLaborTotal;
    if (po.actualLaborCost > 0) return po.actualLaborCost;
    return Math.round(getModelLaborPerPiece(po.modelId) * po.plannedQty * 100) / 100;
  };

  const getOrderRemainingWorkshop = (po: ProductionOrder) =>
    Math.max(0, getOrderTotalLabor(po) - (po.paidToWorkshop || 0));

  const getOrderWorkshopLabel = (po: ProductionOrder) => {
    if (po.workshopName) return po.workshopName;
    if (po.workshopId) {
      const ws = state.workshops.find((w) => w.id === po.workshopId);
      if (ws) return ws.name;
    }
    const model = state.models.find((m) => m.id === po.modelId);
    return model?.laborSteps[0]?.workshopName || 'ورشة خارجية';
  };

  const totalDraftBatchQty = useMemo(
    () => Object.values(variantQtyMap).reduce((s, q) => s + (Number(q) || 0), 0),
    [variantQtyMap]
  );

  const openNewBatchModal = () => {
    setEditingBatch(null);
    const firstModel = state.models[0];
    const defaultModelId = firstModel?.id || '';
    setSelectedModelId(defaultModelId);
    setVariantQtyMap({});
    const defaultWsId =
      firstModel?.laborSteps.find((l) => l.workshopId)?.workshopId ||
      state.workshops[0]?.id ||
      '';
    setBatchWorkshopId(defaultWsId);
    setBatchAgreedLabor(0);
    setLaborManuallyEdited(false);
    setBatchAdvance(0);
    setBatchPayMethod('كاش');
    setBatchNotes('');
    setBatchModalOpen(true);
  };

  const openEditBatchModal = (po: ProductionOrder) => {
    setEditingBatch(po);
    setSelectedModelId(po.modelId);
    const qtyMap: Record<string, number> = {};
    for (const pv of po.variants) {
      qtyMap[pv.variantId] = pv.plannedQty;
    }
    setVariantQtyMap(qtyMap);
    const matchedWs =
      po.workshopId ||
      state.workshops.find((w) => po.workshopName && w.name === po.workshopName)?.id ||
      '';
    setBatchWorkshopId(matchedWs);
    setBatchAgreedLabor(getOrderTotalLabor(po));
    setLaborManuallyEdited(false);
    setBatchAdvance(po.paidToWorkshop || 0);
    setBatchPayMethod('كاش');
    setBatchNotes(po.notes || '');
    setBatchModalOpen(true);
  };

  const handleBatchModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    setVariantQtyMap({});
    setLaborManuallyEdited(false);
    setBatchAgreedLabor(0);
    const m = state.models.find((x) => x.id === modelId);
    const wsId =
      m?.laborSteps.find((l) => l.workshopId)?.workshopId || state.workshops[0]?.id || '';
    setBatchWorkshopId(wsId);
  };

  const handleBatchQtyChange = (variantId: string, qty: number) => {
    const nextMap = { ...variantQtyMap, [variantId]: Math.max(0, qty) };
    setVariantQtyMap(nextMap);
    if (!laborManuallyEdited) {
      const totalPieces = Object.values(nextMap).reduce((s, q) => s + (Number(q) || 0), 0);
      const useBatchRate =
        editingBatch &&
        editingBatch.modelId === selectedModelId &&
        editingBatch.plannedQty > 0 &&
        getOrderTotalLabor(editingBatch) > 0;
      const unitLabor = useBatchRate
        ? getOrderTotalLabor(editingBatch) / editingBatch.plannedQty
        : getModelLaborPerPiece(selectedModelId);
      setBatchAgreedLabor(Math.round(totalPieces * unitLabor * 100) / 100);
    }
  };

  const applyModelDefaults = (modelId: string) => {
    setVarModelId(modelId);
    const model = state.models.find((m) => m.id === modelId);
    if (!model) return;
    const calc = calculateModelCost(model, state.fabrics, state.trims, state.overhead);
    setVarUnitCogs(Math.round(calc.totalUnitCost * 100) / 100);
    setVarRetailPrice(
      model.actualRetailPrice && model.actualRetailPrice > 0
        ? model.actualRetailPrice
        : Math.round(calc.suggestedRetailPrice)
    );
  };

  const openNewVariantModal = () => {
    setEditingVariant(null);
    const defaultModelId = state.models[0]?.id || '';
    setVarColor('أسود فحمي');
    setVarSize('M');
    setVarOpeningQty(0);
    if (defaultModelId) {
      applyModelDefaults(defaultModelId);
    } else {
      setVarModelId('');
      setVarUnitCogs(0);
      setVarRetailPrice(0);
    }
    setVariantModalOpen(true);
  };

  const openEditVariantModal = (v: ModelVariant) => {
    setEditingVariant(v);
    setVarModelId(v.modelId);
    setVarColor(v.color);
    setVarSize(v.size);
    setVarOpeningQty(v.finishedGoodsQty);
    setVarUnitCogs(v.avgUnitCogs);
    setVarRetailPrice(v.retailPrice);
    setVariantModalOpen(true);
  };

  const handleSaveVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingVariant) {
      await updateModelVariant({
        ...editingVariant,
        color: varColor.trim(),
        size: varSize.trim(),
        finishedGoodsQty: Math.max(0, Math.round(Number(varOpeningQty) || 0)),
        avgUnitCogs: Math.max(0, Number(varUnitCogs) || 0),
        retailPrice: Math.max(0, Number(varRetailPrice) || 0),
      });
      setVariantModalOpen(false);
      return;
    }

    const model = state.models.find((m) => m.id === varModelId);
    if (!model) return;
    const skuSuffix = `${varColor.slice(0, 3)}-${varSize}`.replace(/\s+/g, '');
    await addModelVariant({
      modelId: model.id,
      variantSku: `${model.sku}-${skuSuffix}-${Math.floor(Math.random() * 90 + 10)}`,
      color: varColor.trim(),
      size: varSize.trim(),
      finishedGoodsQty: Math.max(0, Math.round(Number(varOpeningQty) || 0)),
      avgUnitCogs: Math.max(0, Number(varUnitCogs) || 0),
      retailPrice: Math.max(0, Number(varRetailPrice) || 0),
      reorderLevel: 5,
    });
    setVariantModalOpen(false);
  };

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const ws = state.workshops.find((w) => w.id === batchWorkshopId);

    if (editingBatch) {
      const targetModel =
        state.models.find((m) => m.id === selectedModelId) ||
        state.models.find((m) => m.id === editingBatch.modelId);
      const isCompleted = editingBatch.status === 'completed';

      let variants: { variantId: string; plannedQty: number }[] | undefined;
      if (!isCompleted && targetModel) {
        variants = targetModel.variants
          .map((v) => ({ variantId: v.id, plannedQty: Number(variantQtyMap[v.id]) || 0 }))
          .filter((v) => v.plannedQty > 0);
        if (variants.length === 0) return;
      }

      const resolvedWorkshopName =
        ws?.name ||
        (!batchWorkshopId ? editingBatch.workshopName : '') ||
        targetModel?.laborSteps[0]?.workshopName ||
        'ورشة خارجية';

      await runAction(editingBatch.id, async () => {
        await updateProductionBatch({
          id: editingBatch.id,
          modelId:
            editingBatch.status === 'planned' && targetModel
              ? targetModel.id
              : editingBatch.modelId,
          workshopId: ws?.id || null,
          workshopName: resolvedWorkshopName,
          agreedLaborTotal: Math.max(0, Number(batchAgreedLabor) || 0),
          paidToWorkshop: Math.max(0, Number(batchAdvance) || 0),
          notes: batchNotes,
          variants,
        });
        setBatchModalOpen(false);
        setEditingBatch(null);
      });
      return;
    }

    if (!selectedModel) return;
    const variants = selectedModel.variants
      .map((v) => ({ variantId: v.id, plannedQty: Number(variantQtyMap[v.id]) || 0 }))
      .filter((v) => v.plannedQty > 0);
    if (variants.length === 0) return;

    const batchNumber = `PRD-${new Date().getFullYear()}-${String(
      state.productionOrders.length + 1
    ).padStart(3, '0')}`;

    await createProductionBatch({
      batchNumber,
      modelId: selectedModel.id,
      workshopId: ws?.id || null,
      workshopName: ws?.name || selectedModel.laborSteps[0]?.workshopName || 'ورشة خارجية',
      agreedLaborTotal: Math.max(0, Number(batchAgreedLabor) || 0),
      advancePayment: Math.max(0, Number(batchAdvance) || 0),
      paymentMethod: batchPayMethod,
      notes: batchNotes,
      variants,
    });
    clearPendingProductionModel();
    setBatchModalOpen(false);
    setVariantQtyMap({});
    setBatchNotes('');
  };

  const openPayoutModal = (po: ProductionOrder) => {
    const remaining = getOrderRemainingWorkshop(po);
    setPayoutOrder(po);
    setPayoutAmount(remaining > 0 ? remaining : 0);
    setPayoutMethod('كاش');
    setPayoutNotes(
      po.status === 'completed'
        ? `سداد باقي أجر الورشة — ${getOrderWorkshopLabel(po)} (${po.batchNumber})`
        : `دفعة تحت الحساب للورشة — ${getOrderWorkshopLabel(po)} (${po.batchNumber})`
    );
  };

  const handleRecordWorkshopPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutOrder || payoutAmount <= 0) return;
    const remaining = getOrderRemainingWorkshop(payoutOrder);
    if (remaining > 0 && payoutAmount > remaining + 0.009) return;
    const targetId = payoutOrder.id;
    await runAction(targetId, async () => {
      await recordWorkshopPayment(targetId, payoutAmount, payoutMethod, payoutNotes);
    });
    setPayoutOrder(null);
  };

  const openCompleteModal = (po: ProductionOrder) => {
    const remaining = getOrderRemainingWorkshop(po);
    setCompleteOrder(po);
    setDeliveryPayAmount(remaining);
    setDeliveryPayMethod('كاش');
  };

  const handleConfirmComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeOrder) return;
    const remaining = getOrderRemainingWorkshop(completeOrder);
    const safePay = Math.max(0, Number(deliveryPayAmount) || 0);
    if (remaining > 0 && safePay > remaining + 0.009) return;
    const targetId = completeOrder.id;
    await runAction(targetId, async () => {
      await completeProductionBatch(
        targetId,
        safePay,
        deliveryPayMethod
      );
    });
    setCompleteOrder(null);
  };

  const openDispatchSlipModal = (po: ProductionOrder) => {
    const model = state.models.find((m) => m.id === po.modelId);
    const lines: DispatchMaterialLine[] = [];

    if (model) {
      model.fabrics.forEach((mf) => {
        const fab = state.fabrics.find((f) => f.id === mf.fabricId);
        if (!fab) return;
        const qtyWithWaste =
          Math.round(mf.consumption * (1 + mf.wastePct / 100) * po.plannedQty * 100) / 100;
        lines.push({
          id: newUuid(),
          kind: 'قماش',
          name: fab.name,
          quantity: qtyWithWaste,
          unit: FABRIC_UNIT_LABELS[fab.unit] || 'متر',
          notes: `مقصوص لعدد ${po.plannedQty} قطعة (شامل هالك ${mf.wastePct}%)`,
        });
      });

      model.trims.forEach((mt) => {
        const trim = state.trims.find((t) => t.id === mt.trimId);
        if (!trim) return;
        const totalQty = Math.round(mt.quantity * po.plannedQty * 100) / 100;
        lines.push({
          id: newUuid(),
          kind: 'كلفة / إكسسوار',
          name: trim.name,
          quantity: totalQty,
          unit: trim.unitLabel || 'قطعة',
          notes: trim.category || '',
        });
      });
    }

    setDispatchOrder(po);
    setDispatchDate(new Date().toISOString().slice(0, 10));
    setDispatchReturnDate('');
    setDispatchDeliveredBy('');
    setDispatchMaterials(lines);
    setDispatchShowFinancials(true);
    setDispatchInstructions(po.notes || '');
  };

  const handlePrintDispatchSlip = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchOrder) return;
    const model = state.models.find((m) => m.id === dispatchOrder.modelId);
    const ws = state.workshops.find(
      (w) =>
        w.id === dispatchOrder.workshopId ||
        (dispatchOrder.workshopName && w.name === dispatchOrder.workshopName)
    );

    const variantLines = dispatchOrder.variants.map((pv) => {
      const v = model?.variants.find((x) => x.id === pv.variantId);
      return {
        color: v?.color || '—',
        size: v?.size || '—',
        variantSku: v?.variantSku || '—',
        qty: pv.plannedQty,
      };
    });

    const totalLabor = getOrderTotalLabor(dispatchOrder);
    const paid = dispatchOrder.paidToWorkshop || 0;

    openAndPrintDispatchSlip({
      voucherNumber: `ISS-${dispatchOrder.batchNumber}`,
      dispatchDate,
      expectedReturnDate: dispatchReturnDate || undefined,
      batchNumber: dispatchOrder.batchNumber,
      modelName: model?.name || 'موديل',
      modelSku: model?.sku || '—',
      workshopName: getOrderWorkshopLabel(dispatchOrder),
      workshopPhone: ws?.phone || undefined,
      workshopContact: ws?.contactName || undefined,
      deliveredBy: dispatchDeliveredBy.trim() || undefined,
      totalPieces: dispatchOrder.plannedQty,
      variants: variantLines,
      materials: dispatchMaterials.filter((m) => m.name.trim() !== ''),
      showFinancials: dispatchShowFinancials,
      agreedLaborTotal: totalLabor,
      paidToWorkshop: paid,
      remainingWorkshop: Math.max(0, totalLabor - paid),
      currency: state.currency,
      instructions: dispatchInstructions,
    });
  };

  const runAction = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } catch {
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } finally {
      setBusyId(null);
    }
  };

  const totalFinishedPieces = allVariants.reduce((s, v) => s + v.finishedGoodsQty, 0);
  const totalUnpaidWorkshops = state.productionOrders
    .filter((p) => p.status !== 'cancelled')
    .reduce((s, p) => s + getOrderRemainingWorkshop(p), 0);

  return (
    <div className="space-y-6">
      {/* Top Actions & KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">
            مخزون المنتج التام
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#1A1A1E] tabular-nums mt-1.5 sm:mt-2">
            {totalFinishedPieces} قطعة
          </div>
          <div className="text-[11px] sm:text-xs text-[#6E6C66] mt-1">
            موزّعة على {allVariants.length} مقاس ولون
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5">
          <div className="text-[11px] sm:text-xs font-semibold text-[#6E6C66]">
            تشغيلات الورش الخارجية
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#8E6742] tabular-nums mt-1.5 sm:mt-2">
            {state.productionOrders.length} تشغيلة
          </div>
          <div className="text-[11px] sm:text-xs text-[#6E6C66] mt-1">
            {state.productionOrders.filter((p) => p.status === 'in_progress').length} قيد التقفيل
            {totalUnpaidWorkshops > 0 && (
              <span className="text-red-600 font-bold mr-1">
                • متبقي للورش: {formatMoney(totalUnpaidWorkshops, state.currency)}
              </span>
            )}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 flex flex-col justify-center gap-2">
          <button
            type="button"
            onClick={openNewBatchModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold py-2.5 px-4 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>فتح أمر تصنيع (تقفيل بورشة)</span>
          </button>
          <button
            type="button"
            onClick={openNewVariantModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F3F2EE] hover:bg-[#E5E3DD] text-[#1A1A1E] text-xs font-bold py-2 px-4 cursor-pointer"
          >
            <Boxes className="w-3.5 h-3.5 text-[#A67C52]" />
            <span>إضافة مقاس / لون أو رصيد افتتاحي</span>
          </button>
        </div>
      </div>

      {/* Production Orders */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E3DD] flex items-center gap-2">
          <Factory className="w-4 h-4 text-[#A67C52] shrink-0" />
          <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
            أوامر التصنيع الخارجي (تسليم القماش المقصوص ← دفعة تحت الحساب ← استلام وسداد الباقي)
          </h2>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {state.productionOrders.map((po) => {
            const model = state.models.find((m) => m.id === po.modelId);
            const totalLabor = getOrderTotalLabor(po);
            const paid = po.paidToWorkshop || 0;
            const remaining = Math.max(0, totalLabor - paid);
            return (
              <div key={po.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-xs text-[#6E6C66]">
                      {po.batchNumber}
                    </div>
                    <div className="font-bold text-sm text-[#1A1A1E] mt-0.5 truncate">
                      {model?.name || 'موديل'}
                    </div>
                    <div className="text-[11px] text-[#6E6C66] mt-0.5">
                      الورشة: <span className="font-semibold text-[#1A1A1E]">{getOrderWorkshopLabel(po)}</span> • {po.plannedQty} قطعة
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      po.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : po.status === 'in_progress'
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-[#F3F2EE] text-[#4B4A46]'
                    }`}
                  >
                    {po.status === 'completed'
                      ? 'مكتملة'
                      : po.status === 'in_progress'
                      ? 'قيد التقفيل'
                      : 'تجهيز القص'}
                  </span>
                </div>

                {/* Workshop Financials */}
                <div className="grid grid-cols-3 gap-2 text-xs bg-[#FAF9F7] rounded-xl p-2.5 border border-[#F0EFEA]">
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">أجر الورشة</div>
                    <div className="font-bold tabular-nums mt-0.5">
                      {formatMoney(totalLabor, state.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">تحت الحساب</div>
                    <div className="font-bold text-emerald-700 tabular-nums mt-0.5">
                      {formatMoney(paid, state.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">المتبقي</div>
                    <div
                      className={`font-bold tabular-nums mt-0.5 ${
                        remaining > 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {remaining > 0 ? formatMoney(remaining, state.currency) : 'خالص ✓'}
                    </div>
                  </div>
                </div>

                {po.actualUnitCogs > 0 && (
                  <div className="text-[11px] text-[#6E6C66] flex items-center justify-between px-1">
                    <span>التكلفة الفعلية للقطعة (COGS):</span>
                    <span className="font-bold text-[#8E6742] tabular-nums">
                      {formatMoney(po.actualUnitCogs, state.currency)}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {po.status === 'planned' && (
                    <button
                      type="button"
                      disabled={busyId === po.id}
                      onClick={() => void runAction(po.id, () => issueProductionBatch(po.id))}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 text-[#BD956D]" />
                      صرف القماش المقصوص للورشة
                    </button>
                  )}

                  {po.status === 'in_progress' && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === po.id}
                        onClick={() => openPayoutModal(po)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-[#F6EFE7] text-[#8E6742] px-3 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        دفعة تحت الحساب
                      </button>
                      <button
                        type="button"
                        disabled={busyId === po.id}
                        onClick={() => openCompleteModal(po)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-[#A67C52] text-white px-3 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        استلام المنتج التام
                      </button>
                    </>
                  )}

                  {po.status === 'completed' && remaining > 0 && (
                    <button
                      type="button"
                      disabled={busyId === po.id}
                      onClick={() => openPayoutModal(po)}
                      className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold bg-[#F6EFE7] text-[#8E6742] px-3 py-2 rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      <Banknote className="w-3.5 h-3.5" />
                      سداد باقي الورشة ({formatMoney(remaining, state.currency)})
                    </button>
                  )}

                  <div className="w-full flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openDispatchSlipModal(po)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-[#E5E3DD] bg-white hover:bg-[#FAF9F7] text-[#1A1A1E] px-3 py-2 rounded-xl cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#A67C52]" />
                      إذن تسليم
                    </button>
                    {po.status !== 'cancelled' && (
                      <button
                        type="button"
                        disabled={busyId === po.id}
                        onClick={() => openEditBatchModal(po)}
                        aria-label="تعديل أمر التصنيع"
                        className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-[#E5E3DD] bg-white hover:bg-[#F6EFE7] hover:text-[#8E6742] text-[#4B4A46] px-3 py-2 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        تعديل
                      </button>
                    )}
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        disabled={busyId === po.id}
                        onClick={() => void runAction(po.id, () => deleteProductionBatch(po.id))}
                        aria-label="حذف أمر التصنيع"
                        className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 px-3 py-2 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
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
          {state.productionOrders.length === 0 && (
            <div className="py-8 text-center text-xs text-[#6E6C66]">
              لا توجد تشغيلات تصنيع مسجلة بعد.
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">التشغيلة / الموديل</th>
                <th className="py-3 px-4">الورشة / الكمية</th>
                <th className="py-3 px-4">حساب الورشة (الإجمالي / المدفوع / المتبقي)</th>
                <th className="py-3 px-4">تكلفة القطعة (COGS)</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">إجراء المرحلة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {state.productionOrders.map((po) => {
                const model = state.models.find((m) => m.id === po.modelId);
                const totalLabor = getOrderTotalLabor(po);
                const paid = po.paidToWorkshop || 0;
                const remaining = Math.max(0, totalLabor - paid);
                return (
                  <tr key={po.id} className="hover:bg-[#FAF9F7]">
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-xs text-[#6E6C66]">
                        {po.batchNumber}
                      </div>
                      <div className="font-semibold text-[#1A1A1E]">{model?.name || 'موديل'}</div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-semibold text-[#1A1A1E]">{getOrderWorkshopLabel(po)}</div>
                      <div className="text-[#6E6C66] tabular-nums">{po.plannedQty} قطعة</div>
                    </td>
                    <td className="py-3 px-4 text-xs tabular-nums">
                      <div className="font-bold text-[#1A1A1E]">
                        الإجمالي: {formatMoney(totalLabor, state.currency)}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-emerald-700 font-semibold">
                          مدفوع: {formatMoney(paid, state.currency)}
                        </span>
                        <span>•</span>
                        {remaining > 0 ? (
                          <span className="text-red-600 font-bold">
                            متبقي: {formatMoney(remaining, state.currency)}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-bold">خالص ✓</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 tabular-nums font-bold text-[#8E6742] text-xs">
                      {po.actualUnitCogs > 0
                        ? formatMoney(po.actualUnitCogs, state.currency)
                        : 'يُحسب عند الاستلام'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          po.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700'
                            : po.status === 'in_progress'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-[#F3F2EE] text-[#4B4A46]'
                        }`}
                      >
                        {po.status === 'completed'
                          ? 'مكتملة (بالمخزن)'
                          : po.status === 'in_progress'
                          ? 'قيد التقفيل بالورشة'
                          : 'تجهيز القص'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {po.status === 'planned' && (
                          <button
                            type="button"
                            disabled={busyId === po.id}
                            onClick={() =>
                              void runAction(po.id, () => issueProductionBatch(po.id))
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold bg-[#1A1A1E] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5 text-[#BD956D]" />
                            صرف القماش المقصوص
                          </button>
                        )}
                        {po.status === 'in_progress' && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              onClick={() => openPayoutModal(po)}
                              className="inline-flex items-center gap-1 text-xs font-bold bg-[#F6EFE7] hover:bg-[#EDE0D1] text-[#8E6742] px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                            >
                              <Banknote className="w-3.5 h-3.5" />
                              تحت الحساب
                            </button>
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              onClick={() => openCompleteModal(po)}
                              className="inline-flex items-center gap-1 text-xs font-bold bg-[#A67C52] hover:bg-[#8E6742] text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              استلام وتسوية
                            </button>
                          </>
                        )}
                        {po.status === 'completed' && remaining > 0 && (
                          <button
                            type="button"
                            disabled={busyId === po.id}
                            onClick={() => openPayoutModal(po)}
                            className="inline-flex items-center gap-1 text-xs font-bold bg-[#F6EFE7] hover:bg-[#EDE0D1] text-[#8E6742] px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            سداد الباقي
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openDispatchSlipModal(po)}
                          title="طباعة إذن تسليم خامات للتصنيع"
                          className="inline-flex items-center gap-1 text-xs font-semibold border border-[#E5E3DD] bg-white hover:bg-[#FAF9F7] text-[#1A1A1E] px-2.5 py-1.5 rounded-lg cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5 text-[#A67C52]" />
                          إذن تسليم
                        </button>
                        {po.status !== 'cancelled' && (
                          <button
                            type="button"
                            disabled={busyId === po.id}
                            onClick={() => openEditBatchModal(po)}
                            title="تعديل بيانات أمر التصنيع"
                            className="inline-flex items-center gap-1 text-xs font-semibold border border-[#E5E3DD] bg-white hover:bg-[#F6EFE7] hover:text-[#8E6742] text-[#4B4A46] px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            تعديل
                          </button>
                        )}
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            disabled={busyId === po.id}
                            onClick={() => void runAction(po.id, () => deleteProductionBatch(po.id))}
                            title="حذف أمر التصنيع وعكس الخامات المصروفة والمنتج التام ورصيد الورشة"
                            className="inline-flex items-center gap-1 text-xs font-semibold border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
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
              {state.productionOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-[#6E6C66]">
                    لا توجد تشغيلات تصنيع مسجلة بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Finished Goods Inventory Matrix */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E5E3DD] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Boxes className="w-4 h-4 text-[#A67C52] shrink-0" />
            <h2 className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
              مخزون المنتج التام حسب اللون والمقاس (Finished Goods)
            </h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FAF6F0] text-[#8E6742] border border-[#E8DAC6]">
              مرتّب بالكمية (الأكبر أولاً)
            </span>
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-[#F0EFEA]">
          {allVariants.map((v) => {
            const links = linkedVariantCounts.get(v.id);
            const isLinked = Boolean(links && (links.salesCount > 0 || links.prodCount > 0));
            return (
              <div
                key={v.id}
                className={`p-4 space-y-2.5 ${(v.finishedGoodsQty || 0) <= 0 ? 'opacity-65' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1A1A1E] truncate">{v.modelName}</div>
                    <div className="text-[11px] text-[#6E6C66] mt-0.5">
                      {v.color} — <span className="font-bold text-[#1A1A1E]">{v.size}</span>
                      <span className="font-mono mr-1.5 text-[10px]">({v.variantSku})</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-lg text-xs font-extrabold tabular-nums ${
                        v.finishedGoodsQty <= v.reorderLevel
                          ? 'bg-red-100 text-red-700'
                          : 'bg-[#F6EFE7] text-[#8E6742]'
                      }`}
                    >
                      {v.finishedGoodsQty} قطعة
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditVariantModal(v)}
                      aria-label="تعديل الصنف والرصيد"
                      className="p-1.5 rounded-lg text-[#4B4A46] hover:bg-[#F3F2EE] cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        disabled={busyId === v.id}
                        onClick={() => void runAction(v.id, () => deleteModelVariant(v.id))}
                        aria-label="حذف الصنف"
                        title={
                          isLinked
                            ? 'لا يمكن الحذف — الصنف مرتبط بمبيعات أو أوامر تصنيع'
                            : 'حذف الصنف من مخزون المنتج التام'
                        }
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                          isLinked
                            ? 'text-[#B8B4AA] hover:text-amber-700 hover:bg-amber-50'
                            : 'text-[#6E6C66] hover:text-red-600 hover:bg-red-50'
                        }`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs bg-[#FAF9F7] rounded-xl p-2.5 border border-[#F0EFEA]">
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">متوسط التكلفة (COGS)</div>
                    <div className="font-semibold tabular-nums mt-0.5">
                      {formatMoney(v.avgUnitCogs, state.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#6E6C66]">سعر البيع</div>
                    <div className="font-bold text-[#1A1A1E] tabular-nums mt-0.5">
                      {formatMoney(v.retailPrice, state.currency)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {allVariants.length === 0 && (
            <div className="py-8 text-center text-xs text-[#6E6C66]">
              لا توجد أصناف منتج تام بعد. اضغط «إضافة مقاس / لون أو رصيد افتتاحي» للبدء.
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
              <tr>
                <th className="py-3 px-4">SKU</th>
                <th className="py-3 px-4">الموديل</th>
                <th className="py-3 px-4">اللون / المقاس</th>
                <th className="py-3 px-4">الرصيد المتاح</th>
                <th className="py-3 px-4">متوسط تكلفة القطعة</th>
                <th className="py-3 px-4">سعر البيع</th>
                <th className="py-3 px-4">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EFEA]">
              {allVariants.map((v) => {
                const links = linkedVariantCounts.get(v.id);
                const isLinked = Boolean(links && (links.salesCount > 0 || links.prodCount > 0));
                return (
                  <tr
                    key={v.id}
                    className={`hover:bg-[#FAF9F7] ${(v.finishedGoodsQty || 0) <= 0 ? 'opacity-65' : ''}`}
                  >
                    <td className="py-3 px-4 font-mono text-xs">{v.variantSku}</td>
                    <td className="py-3 px-4 font-semibold">{v.modelName}</td>
                    <td className="py-3 px-4 text-xs">
                      {v.color} — <span className="font-bold">{v.size}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-lg text-xs font-extrabold tabular-nums ${
                          v.finishedGoodsQty <= v.reorderLevel
                            ? 'bg-red-100 text-red-700'
                            : 'bg-[#F6EFE7] text-[#8E6742]'
                        }`}
                      >
                        {v.finishedGoodsQty} قطعة
                      </span>
                    </td>
                    <td className="py-3 px-4 tabular-nums text-xs">
                      {formatMoney(v.avgUnitCogs, state.currency)}
                    </td>
                    <td className="py-3 px-4 tabular-nums font-bold">
                      {formatMoney(v.retailPrice, state.currency)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditVariantModal(v)}
                          title="تعديل الرصيد الافتتاحي أو التكلفة أو السعر"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#4B4A46] hover:text-[#8E6742] hover:bg-[#F6EFE7] px-2.5 py-1 rounded-lg cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>تعديل</span>
                        </button>
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            disabled={busyId === v.id}
                            onClick={() => void runAction(v.id, () => deleteModelVariant(v.id))}
                            title={
                              isLinked
                                ? 'لا يمكن الحذف — الصنف مرتبط بمبيعات أو أوامر تصنيع'
                                : 'حذف الصنف من مخزون المنتج التام'
                            }
                            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                              isLinked
                                ? 'text-[#9C9990] hover:text-amber-700 hover:bg-amber-50'
                                : 'text-red-700 hover:bg-red-50'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>حذف</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {allVariants.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-[#6E6C66]">
                    لا توجد أصناف منتج تام بعد. اضغط «إضافة مقاس / لون أو رصيد افتتاحي» للبدء.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Batch Modal (with Workshop Selection + Optional Advance Payment) */}
      <Modal
        open={batchModalOpen}
        onClose={() => {
          setBatchModalOpen(false);
          setEditingBatch(null);
          clearPendingProductionModel();
        }}
        title={
          editingBatch
            ? `تعديل أمر التصنيع (${editingBatch.batchNumber})`
            : 'فتح أمر تصنيع وتقفيل بورشة خارجية'
        }
        subtitle={
          editingBatch
            ? editingBatch.status === 'completed'
              ? 'التشغيلة مكتملة — يمكنك تعديل الورشة أو إجمالي أجر الورشة (مع تسوية رصيد الورشة تلقائياً) والملاحظات'
              : editingBatch.status === 'in_progress'
              ? 'التشغيلة قيد التقفيل — يمكنك تعديل الورشة وأجر الورشة والملاحظات وتوزيع المقاسات (بدون إعادة صرف خامات)'
              : 'يمكنك تعديل الموديل والورشة والكميات وأجر الورشة والملاحظات قبل صرف الخامات'
            : 'اختر الموديل والكميات المقصوصة، وحدد الورشة والدفعة تحت الحساب (اختياري — الباقي يُسدد مع الاستلام)'
        }
      >
        <form onSubmit={handleSaveBatch} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">
                الموديل
                {editingBatch && editingBatch.status !== 'planned' && (
                  <span className="text-[10px] font-normal text-[#9C9990] mr-1">
                    (ثابت بعد صرف الخامات)
                  </span>
                )}
              </label>
              <ModelSmartSelect
                models={state.models}
                value={selectedModelId}
                disabled={Boolean(editingBatch && editingBatch.status !== 'planned')}
                onChange={handleBatchModelChange}
                showVariantCount
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الورشة المسؤولة عن التقفيل</label>
              <select
                value={batchWorkshopId}
                onChange={(e) => setBatchWorkshopId(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs"
              >
                <option value="">-- ورشة خارجية (من بطاقة الموديل) --</option>
                {state.workshops.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.specialty ? `(${w.specialty})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>توزيع القطع المقصوصة على الألوان والمقاسات:</span>
              <span className="text-[#8E6742] tabular-nums">
                الإجمالي:{' '}
                {editingBatch?.status === 'completed'
                  ? editingBatch.completedQty || editingBatch.plannedQty
                  : totalDraftBatchQty}{' '}
                قطعة
              </span>
            </div>

            {editingBatch?.status === 'completed' ? (
              <div className="space-y-1.5">
                {editingBatch.variants.map((pv) => {
                  const v = selectedModel?.variants.find((x) => x.id === pv.variantId);
                  return (
                    <div
                      key={pv.id}
                      className="flex items-center justify-between bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-bold">{v?.color || '—'}</span> — مقاس{' '}
                        <span className="font-bold">{v?.size || '—'}</span>{' '}
                        {v?.variantSku && (
                          <span className="text-[#6E6C66] font-mono">({v.variantSku})</span>
                        )}
                      </div>
                      <span className="font-bold tabular-nums text-[#4B4A46]">
                        {pv.completedQty || pv.plannedQty} قطعة
                      </span>
                    </div>
                  );
                })}
                <p className="text-[11px] text-[#6E6C66] bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl px-3 py-2">
                  الكميات المستلمة للمخزن التام غير قابلة للتعديل بعد الاكتمال. لتعديل الرصيد استخدم
                  جدول «مخزون المنتج التام» أو احذف التشغيلة وأعد تسجيلها.
                </p>
              </div>
            ) : selectedModel && selectedModel.variants.length > 0 ? (
              <>
                {editingBatch?.status === 'in_progress' && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    تنبيه: تم صرف الخامات مسبقاً لهذه التشغيلة — تعديل الكميات هنا يُحدّث التوزيع
                    المتوقع استلامه عند التقفيل بدون إعادة صرف خامات تلقائياً.
                  </p>
                )}
                {selectedModel.variants.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl px-3 py-2"
                  >
                    <div className="text-xs">
                      <span className="font-bold">{v.color}</span> — مقاس{' '}
                      <span className="font-bold">{v.size}</span>{' '}
                      <span className="text-[#6E6C66] font-mono">({v.variantSku})</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={variantQtyMap[v.id] ?? 0}
                      onKeyDown={blockNonIntegerKey}
                      onChange={(e) => handleBatchQtyChange(v.id, toWholeQty(e.target.value, 0))}
                      className="w-20 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1 text-xs text-center tabular-nums"
                    />
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl">
                لا توجد مقاسات/ألوان مسجلة لهذا الموديل بعد. أضف مقاساً أولاً من زر «إضافة مقاس /
                لون أو رصيد افتتاحي».
              </p>
            )}
          </div>

          {/* Workshop Fee & Optional Advance Payment */}
          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#7B5836]">
                {editingBatch
                  ? 'حساب الورشة (يمكنك تعديل إجمالي الأجر أو الدفعة تحت الحساب المدفوعة للورشة)'
                  : 'حساب الورشة (دفعة تحت الحساب اختيارية + الباقي مع الاستلام)'}
              </span>
              {editingBatch && editingBatch.status !== 'completed' && totalDraftBatchQty > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const unitLabor = getModelLaborPerPiece(selectedModelId);
                    setLaborManuallyEdited(false);
                    setBatchAgreedLabor(Math.round(totalDraftBatchQty * unitLabor * 100) / 100);
                  }}
                  className="text-[11px] font-semibold text-[#8E6742] hover:underline cursor-pointer"
                >
                  حساب تلقائي من بطاقة الموديل
                </button>
              )}
            </div>

            {editingBatch ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      إجمالي أجر الورشة
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={batchAgreedLabor}
                      onChange={(e) => {
                        setLaborManuallyEdited(true);
                        setBatchAgreedLabor(Number(e.target.value));
                      }}
                      className="w-full rounded-xl border border-[#E5E3DD] bg-white px-2.5 py-2 text-xs font-bold tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1 text-emerald-800">
                      المدفوع للورشة حتى الآن (تحت الحساب)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={batchAdvance}
                      onChange={(e) => setBatchAdvance(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded-xl border border-emerald-200 bg-white px-2.5 py-2 text-xs font-bold text-emerald-700 tabular-nums focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1 text-[#6E6C66]">
                      المتبقي بعد التعديل
                    </label>
                    <div className="w-full rounded-xl border border-[#EAE8E2] bg-[#FAF9F7] px-2.5 py-2 text-xs font-bold text-[#1A1A1E] tabular-nums">
                      {formatMoney(
                        Math.max(0, batchAgreedLabor - (Number(batchAdvance) || 0)),
                        state.currency
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-[#6E6C66] pt-1.5 border-t border-[#E6D5C3]">
                  تعديل الدفعة تحت الحساب يُحدّث رصيد الخزنة وحساب الورشة تلقائياً.
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      إجمالي أجر الورشة
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={batchAgreedLabor}
                      onChange={(e) => {
                        setLaborManuallyEdited(true);
                        setBatchAgreedLabor(Number(e.target.value));
                      }}
                      className="w-full rounded-xl border border-[#E5E3DD] bg-white px-2.5 py-2 text-xs font-bold tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      دفعة تحت الحساب الآن (اختياري)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={batchAdvance}
                      onChange={(e) => setBatchAdvance(Number(e.target.value))}
                      placeholder="0"
                      className="w-full rounded-xl border border-[#E5E3DD] bg-white px-2.5 py-2 text-xs font-bold text-emerald-700 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">طريقة الدفع</label>
                    <select
                      value={batchPayMethod}
                      onChange={(e) => setBatchPayMethod(e.target.value)}
                      className="w-full rounded-xl border border-[#E5E3DD] bg-white px-2.5 py-2 text-xs"
                    >
                      {getLookupLabels(state.lookups, 'payment_methods').map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-2 border-t border-[#E6D5C3]">
                  <span className="text-[#6E6C66]">
                    المتبقي للورشة عند الاستلام:{' '}
                    <strong className="text-[#1A1A1E] tabular-nums">
                      {formatMoney(Math.max(0, batchAgreedLabor - batchAdvance), state.currency)}
                    </strong>
                  </span>
                  {batchAdvance > 0 && (
                    <span className="text-emerald-700 font-semibold">
                      ✓ تُخصم الدفعة من الخزنة تلقائياً (لا تُكرر في P&amp;L)
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">ملاحظات التشغيلة</label>
            <input
              type="text"
              value={batchNotes}
              onChange={(e) => setBatchNotes(e.target.value)}
              placeholder="مثال: قماش مقصوص مسلّم للورشة — استلام الخميس"
              className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => {
                setBatchModalOpen(false);
                setEditingBatch(null);
                clearPendingProductionModel();
              }}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={Boolean(editingBatch && busyId === editingBatch.id)}
              className="px-5 py-2 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {editingBatch ? 'حفظ التعديلات' : 'إنشاء أمر التصنيع'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Workshop Advance / Balance Payment Modal */}
      <Modal
        open={Boolean(payoutOrder)}
        onClose={() => setPayoutOrder(null)}
        title={`دفع للورشة — تشغيلة ${payoutOrder?.batchNumber || ''}`}
        subtitle={
          payoutOrder
            ? `${getOrderWorkshopLabel(payoutOrder)} • إجمالي الأجر: ${formatMoney(
                getOrderTotalLabor(payoutOrder),
                state.currency
              )} • المدفوع: ${formatMoney(
                payoutOrder.paidToWorkshop || 0,
                state.currency
              )} • المتبقي: ${formatMoney(getOrderRemainingWorkshop(payoutOrder), state.currency)}`
            : ''
        }
      >
        {payoutOrder && (() => {
          const payoutRemaining = getOrderRemainingWorkshop(payoutOrder);
          const payoutOverLimit = payoutRemaining > 0 && payoutAmount > payoutRemaining + 0.009;
          return (
            <form onSubmit={handleRecordWorkshopPayout} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">قيمة الدفعة *</label>
                  <input
                    type="number"
                    min="0.01"
                    max={payoutRemaining > 0 ? payoutRemaining : undefined}
                    step="0.01"
                    required
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(Number(e.target.value))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm font-bold tabular-nums ${
                      payoutOverLimit
                        ? 'border-red-400 bg-red-50 text-red-700'
                        : 'border-[#E5E3DD]'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">طريقة الدفع</label>
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
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

              {payoutOverLimit && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    المبلغ المدخل ({formatMoney(payoutAmount, state.currency)}) يتجاوز المتبقي
                    المستحق للورشة ({formatMoney(payoutRemaining, state.currency)}). يرجى تعديل
                    المبلغ لمنع السداد بالزيادة.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold mb-1">البيان</label>
                <input
                  type="text"
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
                />
              </div>

              <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 font-semibold">
                ✓ تُخصم الدفعة تلقائياً من رصيد الخزنة (المتاح) وتُسجّل كـ «خامات / تشغيل» بدون
                تكرارها كمصروف في الأرباح والخسائر (P&amp;L).
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
                <button
                  type="button"
                  onClick={() => setPayoutOrder(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={payoutOverLimit || payoutAmount <= 0}
                  className="px-5 py-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  تأكيد الدفع للورشة
                </button>
              </div>
            </form>
          );
        })()}
      </Modal>

      {/* Complete Production & Final Workshop Settlement Modal */}
      <Modal
        open={Boolean(completeOrder)}
        onClose={() => setCompleteOrder(null)}
        title={`استلام المنتج التام وتسوية الورشة (${completeOrder?.batchNumber || ''})`}
        subtitle="سيتم إضافة القطع الجاهزة لمخزون المنتج التام وحساب التكلفة الفعلية للقطعة (COGS)"
      >
        {completeOrder && (() => {
          const deliveryRemaining = getOrderRemainingWorkshop(completeOrder);
          const deliveryOverLimit =
            deliveryRemaining > 0 && deliveryPayAmount > deliveryRemaining + 0.009;
          return (
            <form onSubmit={handleConfirmComplete} className="space-y-4">
              <div className="rounded-xl bg-[#FAF9F7] border border-[#E5E3DD] p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#6E6C66]">الورشة:</span>
                  <span className="font-bold text-[#1A1A1E]">
                    {getOrderWorkshopLabel(completeOrder)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#6E6C66]">الكمية المستلمة للمخزن التام:</span>
                  <span className="font-bold text-[#1A1A1E] tabular-nums">
                    {completeOrder.plannedQty} قطعة
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[#EAE8E2]">
                  <span className="text-[#6E6C66]">إجمالي أجر الورشة:</span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(getOrderTotalLabor(completeOrder), state.currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#6E6C66]">المدفوع مسبقاً (تحت الحساب):</span>
                  <span className="font-bold text-emerald-700 tabular-nums">
                    {formatMoney(completeOrder.paidToWorkshop || 0, state.currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#1A1A1E]">الباقي المستحق للورشة:</span>
                  <span className="font-extrabold text-red-600 tabular-nums">
                    {formatMoney(deliveryRemaining, state.currency)}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] p-3.5 space-y-3">
                <div className="text-xs font-bold text-[#7B5836]">
                  السداد للورشة مع الاستلام الآن (اتركه 0 إذا ستسدد لاحقاً)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      المبلغ المدفوع الآن
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={deliveryRemaining > 0 ? deliveryRemaining : undefined}
                      step="0.01"
                      value={deliveryPayAmount}
                      onChange={(e) => setDeliveryPayAmount(Number(e.target.value))}
                      className={`w-full rounded-xl border bg-white px-3 py-2 text-sm font-bold tabular-nums ${
                        deliveryOverLimit
                          ? 'border-red-400 text-red-700'
                          : 'border-[#E5E3DD] text-emerald-700'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">طريقة الدفع</label>
                    <select
                      value={deliveryPayMethod}
                      onChange={(e) => setDeliveryPayMethod(e.target.value)}
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
                {deliveryOverLimit && (
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      مبلغ السداد يتجاوز المتبقي للورشة ({formatMoney(deliveryRemaining, state.currency)}).
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
                <button
                  type="button"
                  onClick={() => setCompleteOrder(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={deliveryOverLimit}
                  className="px-5 py-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  تأكيد الاستلام والتسوية
                </button>
              </div>
            </form>
          );
        })()}
      </Modal>

      {/* Add / Edit Variant Modal (with Opening Finished-Goods Stock & COGS) */}
      <Modal
        open={variantModalOpen}
        onClose={() => setVariantModalOpen(false)}
        title={
          editingVariant
            ? `تعديل الصنف والرصيد (${editingVariant.variantSku})`
            : 'إضافة مقاس ولون (أو رصيد افتتاحي جاهز)'
        }
        subtitle="لإدخال قطع مصنّعة مسبقاً قبل السيستم: اكتب الكمية الجاهزة ومتوسط تكلفة القطعة — لا يخصم أي قماش من المخزن"
      >
        <form onSubmit={handleSaveVariant} className="space-y-3.5">
          {!editingVariant && (
            <div>
              <label className="block text-xs font-semibold mb-1">الموديل</label>
              <ModelSmartSelect
                models={state.models}
                value={varModelId}
                onChange={applyModelDefaults}
                showVariantCount
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">اللون *</label>
              <input
                type="text"
                required
                list="dresscode-colors-list"
                value={varColor}
                onChange={(e) => setVarColor(e.target.value)}
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
              <datalist id="dresscode-colors-list">
                {getLookupLabels(state.lookups, 'colors').map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المقاس *</label>
              <input
                type="text"
                required
                list="dresscode-sizes-list"
                value={varSize}
                onChange={(e) => setVarSize(e.target.value)}
                placeholder="S / M / L / XL / Free Size"
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
              <datalist id="dresscode-sizes-list">
                {getLookupLabels(state.lookups, 'sizes').map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] p-3 space-y-2.5">
            <div className="text-[11px] font-bold text-[#7B5836]">
              {editingVariant
                ? 'تعديل الرصيد المتاح وتكلفة القطعة (يُسجّل تلقائياً في سجل الحركة)'
                : 'الرصيد الافتتاحي للقطع الجاهزة بالفعل (اختياري — اتركه 0 إذا ستصنّعها لاحقاً)'}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">
                  {editingVariant ? 'الرصيد المتاح (قطعة)' : 'الرصيد الافتتاحي (قطعة)'}
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={varOpeningQty}
                  onKeyDown={blockNonIntegerKey}
                  onChange={(e) => setVarOpeningQty(toWholeQty(e.target.value, 0))}
                  className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs font-bold tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  متوسط تكلفة القطعة (COGS)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={varUnitCogs}
                  onChange={(e) => setVarUnitCogs(Number(e.target.value))}
                  className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs tabular-nums"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">سعر البيع للمتجر</label>
            <input
              type="number"
              min="0"
              step="1"
              value={varRetailPrice}
              onChange={(e) => setVarRetailPrice(Number(e.target.value))}
              className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs font-bold text-[#8E6742] tabular-nums"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setVariantModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold cursor-pointer"
            >
              {editingVariant ? 'حفظ التعديلات' : 'حفظ الصنف'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Material Dispatch Voucher (إذن تسليم خامات للتصنيع) Modal */}
      <Modal
        open={Boolean(dispatchOrder)}
        onClose={() => setDispatchOrder(null)}
        title={`إذن تسليم خامات للتصنيع (ISS-${dispatchOrder?.batchNumber || ''})`}
        subtitle="راجع الأقمشة والكلف المسلّمة للورشة وأضف أي أزرار أو سحابات أو خيوط إضافية قبل الطباعة"
        maxWidthClass="max-w-2xl"
      >
        {dispatchOrder && (
          <form onSubmit={handlePrintDispatchSlip} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">تاريخ التسليم</label>
                <input
                  type="date"
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                  className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  موعد الاستلام المتوقع (اختياري)
                </label>
                <input
                  type="date"
                  value={dispatchReturnDate}
                  onChange={(e) => setDispatchReturnDate(e.target.value)}
                  className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  المُسلِّم من DressCode (اختياري)
                </label>
                <input
                  type="text"
                  value={dispatchDeliveredBy}
                  onChange={(e) => setDispatchDeliveredBy(e.target.value)}
                  placeholder="اسم المسؤول"
                  className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
                />
              </div>
            </div>

            {/* Materials & Trims list to hand over */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#1A1A1E]">
                  الخامات والأقمشة والكلف المسلّمة للورشة ({dispatchMaterials.length}):
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {state.trims.length > 0 && (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const trim = state.trims.find((t) => t.id === e.target.value);
                        if (trim) {
                          setDispatchMaterials((prev) => [
                            ...prev,
                            {
                              id: newUuid(),
                              kind: 'كلفة / إكسسوار',
                              name: trim.name,
                              quantity: dispatchOrder.plannedQty,
                              unit: trim.unitLabel || 'قطعة',
                              notes: trim.category || '',
                            },
                          ]);
                          e.target.value = '';
                        }
                      }}
                      className="rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2 py-1 text-[11px] font-semibold"
                    >
                      <option value="">+ إضافة كلفة من المخزن...</option>
                      {state.trims.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.unitLabel})
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setDispatchMaterials((prev) => [
                        ...prev,
                        {
                          id: newUuid(),
                          kind: 'خامة إضافية',
                          name: '',
                          quantity: 1,
                          unit: 'قطعة',
                          notes: '',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#F6EFE7] hover:bg-[#EDE0D1] text-[#8E6742] px-2.5 py-1 rounded-lg cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    صنف يدوي (أزرار / خيوط...)
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pl-0.5">
                {dispatchMaterials.map((item, idx) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-12 gap-2 items-center bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl p-2"
                  >
                    <select
                      value={item.kind}
                      onChange={(e) =>
                        setDispatchMaterials((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  kind: e.target.value as DispatchMaterialLine['kind'],
                                }
                              : row
                          )
                        )
                      }
                      className="col-span-4 sm:col-span-3 rounded-lg border border-[#E5E3DD] bg-white px-1.5 py-1.5 text-[11px]"
                    >
                      <option value="قماش">قماش</option>
                      <option value="كلفة / إكسسوار">كلفة / إكسسوار</option>
                      <option value="خامة إضافية">خامة إضافية</option>
                    </select>
                    <input
                      type="text"
                      required
                      value={item.name}
                      onChange={(e) =>
                        setDispatchMaterials((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, name: e.target.value } : row
                          )
                        )
                      }
                      placeholder="مثال: أزرار لؤلؤ / بكرة خيط أسود"
                      className="col-span-8 sm:col-span-4 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      min="0"
                      step={item.kind === 'قماش' ? 'any' : '1'}
                      inputMode={item.kind === 'قماش' ? 'decimal' : 'numeric'}
                      pattern={item.kind === 'قماش' ? undefined : '[0-9]*'}
                      value={item.quantity}
                      onKeyDown={item.kind === 'قماش' ? blockInvalidDecimalKey : blockNonIntegerKey}
                      onChange={(e) =>
                        setDispatchMaterials((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  quantity:
                                    row.kind === 'قماش'
                                      ? toDecimalQty(e.target.value, 0, 3)
                                      : toWholeQty(e.target.value, 0),
                                }
                              : row
                          )
                        )
                      }
                      className="col-span-5 sm:col-span-2 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs tabular-nums text-center"
                    />
                    <input
                      type="text"
                      value={item.unit}
                      onChange={(e) =>
                        setDispatchMaterials((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, unit: e.target.value } : row
                          )
                        )
                      }
                      placeholder="متر / قطعة"
                      className="col-span-5 sm:col-span-2 rounded-lg border border-[#E5E3DD] bg-white px-2 py-1.5 text-xs text-center"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDispatchMaterials((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label="حذف السطر"
                      className="col-span-2 sm:col-span-1 flex justify-center p-1 text-[#9C9990] hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {dispatchMaterials.length === 0 && (
                  <div className="text-xs text-[#6E6C66] bg-[#FAF9F7] rounded-xl p-3 text-center">
                    لا توجد خامات مضافة بعد — اضغط «+ صنف يدوي» أو اختر كلفة من المخزن لإدراجها في الإذن.
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                تعليمات وملاحظات التشغيل للورشة
              </label>
              <textarea
                rows={2}
                value={dispatchInstructions}
                onChange={(e) => setDispatchInstructions(e.target.value)}
                placeholder="مثال: الالتزام بعينة التقفيل المعتمدة، تركيب تيكت DressCode والمقاس في منتصف الياقة..."
                className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer bg-[#FAF9F7] px-3 py-2 rounded-xl border border-[#E5E3DD]">
              <input
                type="checkbox"
                checked={dispatchShowFinancials}
                onChange={(e) => setDispatchShowFinancials(e.target.checked)}
                className="accent-[#A67C52]"
              />
              <span>إظهار ملخص أجر الورشة والمدفوع تحت الحساب والمتبقي في الإذن المطبوع</span>
            </label>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#E5E3DD]">
              <button
                type="button"
                onClick={() => setDispatchOrder(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
              >
                إغلاق
              </button>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4 text-[#BD956D]" />
                <span>طباعة إذن التسليم / حفظ PDF</span>
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
