import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  Grid2x2Plus,
  Layers,
  MessageCircle,
  PackageCheck,
  Receipt,
  Scissors,
  ShoppingBag,
  Sparkles,
  Truck,
  Workflow,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import type { PendingPoDraftLine } from '../../types/erp';
import {
  blockNonIntegerKey,
  calculateModelCost,
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  getAutoIncludedTrimsForModel,
  toWholeQty,
} from '../../utils/calculations';

type WorkflowTrack = 'launch' | 'production' | 'sales';

function buildWhatsAppOrderMessage(
  orderNumber: string,
  customerName: string,
  itemsSummary: string,
  totalAmount: number,
  paidAmount: number,
  remainingDebt: number,
  currency: 'EGP' | 'SAR' | 'AED' | 'USD'
): string {
  const lines = [
    `مرحباً أ/ ${customerName} 🌿`,
    `تأكيد طلبك من *DressCode*:`,
    `• رقم الطلب: ${orderNumber}`,
    `• الأصناف: ${itemsSummary}`,
    `• الإجمالي: ${formatMoney(totalAmount, currency)}`,
  ];
  if (paidAmount > 0) {
    lines.push(`• المدفوع: ${formatMoney(paidAmount, currency)}`);
  }
  if (remainingDebt > 0.01) {
    lines.push(`• المتبقي عند الاستلام: ${formatMoney(remainingDebt, currency)}`);
  } else {
    lines.push(`• حالة الدفع: مدفوع بالكامل ✓`);
  }
  lines.push(`شكراً لاختيارك DressCode 🤍`);
  return lines.join('\n');
}

function makeVariantSku(modelSku: string, color: string, size: string): string {
  const cleanModel = (modelSku || 'DC').trim().toUpperCase();
  const cleanSize = size.trim().toUpperCase().replace(/\s+/g, '');
  const colorCode = color
    .trim()
    .replace(/\s+/g, '')
    .slice(0, 3)
    .toUpperCase();
  return `${cleanModel}-${colorCode || 'CLR'}-${cleanSize || 'OS'}`;
}

export const WorkflowHubView: React.FC = () => {
  const {
    state,
    setActiveTab,
    openModelInBOM,
    openModelInCalculator,
    openAutoPoDraft,
    openProductionForModel,
    addModelVariantsBatch,
    bulkSettleSalesOrders,
  } = useERP();

  const [activeTrack, setActiveTrack] = useState<WorkflowTrack>('production');

  // Track 1: Variant Matrix Generator state
  const [launchModelId, setLaunchModelId] = useState<string>(state.models[0]?.id || '');
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState('');
  const [generatingMatrix, setGeneratingMatrix] = useState(false);
  const [matrixDoneMsg, setMatrixDoneMsg] = useState<string | null>(null);

  // Track 2: Smart Production Material Pre-Check state
  const [checkModelId, setCheckModelId] = useState<string>(state.models[0]?.id || '');
  const [checkBatchQty, setCheckBatchQty] = useState<number>(30);

  // Track 3: Bulk COD Settlement state
  const [selectedCodIds, setSelectedCodIds] = useState<string[]>([]);
  const [codMethod, setCodMethod] = useState<string>('تحويل');
  const [settlingCod, setSettlingCod] = useState(false);
  const [codFeedback, setCodFeedback] = useState<string | null>(null);

  const colorOptions = useMemo(() => {
    const base = getLookupLabels(state.lookups, 'colors');
    const extras = selectedColors.filter((c) => !base.includes(c));
    return [...base, ...extras];
  }, [state.lookups, selectedColors]);

  const sizeOptions = useMemo(() => getLookupLabels(state.lookups, 'sizes'), [state.lookups]);
  const paymentMethods = useMemo(
    () => getLookupLabels(state.lookups, 'payment_methods'),
    [state.lookups]
  );

  // Live Operational Pulse counts
  const pulse = useMemo(() => {
    const lowFabrics = state.fabrics.filter((f) => (f.stockQty || 0) <= (f.reorderLevel || 0));
    const lowTrims = state.trims.filter((t) => (t.stockQty || 0) <= (t.reorderLevel || 0));
    const plannedBatches = state.productionOrders.filter((p) => p.status === 'planned');
    const inProgressBatches = state.productionOrders.filter((p) => p.status === 'in_progress');
    const unpaidPOs = state.purchaseOrders.filter(
      (p) => p.status === 'received' && (p.totalAmount || 0) - (p.paidAmount || 0) > 0.01
    );
    const openSales = state.salesOrders.filter(
      (s) =>
        s.status !== 'cancelled' &&
        s.status !== 'returned' &&
        ((s.remainingDebt || 0) > 0.01 || s.fulfillmentStatus !== 'مكتمل')
    );

    return {
      lowFabrics,
      lowTrims,
      lowTotal: lowFabrics.length + lowTrims.length,
      plannedBatches,
      inProgressBatches,
      unpaidPOs,
      openSales,
    };
  }, [state.fabrics, state.trims, state.productionOrders, state.purchaseOrders, state.salesOrders]);

  // Track 1: Active launch model + Matrix Preview
  const launchModel = useMemo(
    () => state.models.find((m) => m.id === launchModelId) || state.models[0] || null,
    [state.models, launchModelId]
  );

  const matrixPreview = useMemo(() => {
    if (!launchModel) return { items: [], newCount: 0, unitCost: 0, retailPrice: 0 };
    const calc = calculateModelCost(launchModel, state.fabrics, state.trims, state.overhead);
    const retailPrice =
      launchModel.actualRetailPrice && launchModel.actualRetailPrice > 0
        ? launchModel.actualRetailPrice
        : Math.round(calc.suggestedRetailPrice);
    const existingKeys = new Set(
      (launchModel.variants || []).map(
        (v) => `${v.color.trim().toLowerCase()}|${v.size.trim().toLowerCase()}`
      )
    );

    const items: {
      color: string;
      size: string;
      sku: string;
      exists: boolean;
    }[] = [];
    for (const color of selectedColors) {
      for (const size of selectedSizes) {
        const key = `${color.trim().toLowerCase()}|${size.trim().toLowerCase()}`;
        items.push({
          color,
          size,
          sku: makeVariantSku(launchModel.sku, color, size),
          exists: existingKeys.has(key),
        });
      }
    }
    return {
      items,
      newCount: items.filter((i) => !i.exists).length,
      unitCost: Math.round(calc.totalUnitCost * 100) / 100,
      retailPrice,
    };
  }, [launchModel, selectedColors, selectedSizes, state.fabrics, state.trims, state.overhead]);

  const handleGenerateMatrix = async () => {
    if (!launchModel || matrixPreview.newCount === 0 || generatingMatrix) return;
    setGeneratingMatrix(true);
    setMatrixDoneMsg(null);
    try {
      const toCreate = matrixPreview.items
        .filter((i) => !i.exists)
        .map((i) => ({
          modelId: launchModel.id,
          variantSku: i.sku,
          color: i.color,
          size: i.size,
          finishedGoodsQty: 0,
          avgUnitCogs: matrixPreview.unitCost,
          retailPrice: matrixPreview.retailPrice,
          reorderLevel: 3,
        }));
      const count = await addModelVariantsBatch(toCreate);
      setMatrixDoneMsg(`تم توليد (${count}) مقاس/لون بنجاح لموديل «${launchModel.name}» ✓`);
    } finally {
      setGeneratingMatrix(false);
    }
  };

  // Track 2: Smart Production Material Pre-Check
  const checkModel = useMemo(
    () => state.models.find((m) => m.id === checkModelId) || state.models[0] || null,
    [state.models, checkModelId]
  );

  const { fabrics: allFabrics, trims: allTrims, overhead: allOverhead } = state;

  const materialPreCheck = useMemo(() => {
    if (!checkModel) {
      return {
        fabrics: [],
        trims: [],
        hasShortage: false,
        shortageCount: 0,
        estimatedUnitCost: 0,
        estimatedBatchCost: 0,
      };
    }
    const qty = Math.max(1, toWholeQty(checkBatchQty, 1));
    const calc = calculateModelCost(checkModel, allFabrics, allTrims, allOverhead);

    const fabricRows = (checkModel.fabrics || []).map((mf) => {
      const fab = allFabrics.find((f) => f.id === mf.fabricId);
      const required =
        Math.ceil(mf.consumption * (1 + (mf.wastePct || 0) / 100) * qty * 100) / 100;
      const available = Math.max(0, Number(fab?.stockQty) || 0);
      const shortage = Math.max(0, Math.ceil((required - available) * 100) / 100);
      return {
        fabricId: mf.fabricId,
        name: fab?.name || 'قماش غير معروف',
        supplierId: fab?.supplierId || '',
        supplierName: fab?.supplier || 'مورد عام',
        unit: fab ? FABRIC_UNIT_LABELS[fab.unit] : 'متر',
        unitPrice: fab?.pricePerUnit || 0,
        required,
        available,
        shortage,
      };
    });

    // Combine explicit BOM trims + auto-included trims
    const trimQtyMap = new Map<string, number>();
    for (const mt of checkModel.trims || []) {
      if ((mt.quantity || 0) <= 0) continue;
      trimQtyMap.set(mt.trimId, (trimQtyMap.get(mt.trimId) || 0) + (mt.quantity || 0) * qty);
    }
    const autoTrims = getAutoIncludedTrimsForModel(checkModel, allTrims);
    for (const at of autoTrims) {
      if ((at.quantity || 0) <= 0) continue;
      trimQtyMap.set(
        at.trimId,
        (trimQtyMap.get(at.trimId) || 0) + (at.quantity || 1) * qty
      );
    }

    const trimRows = Array.from(trimQtyMap.entries()).map(([trimId, rawReq]) => {
      const tr = allTrims.find((t) => t.id === trimId);
      const requiredUnits = Math.ceil(rawReq);
      const availableUnits = Math.max(0, Number(tr?.stockQty) || 0);
      const shortageUnits = Math.max(0, Math.ceil(requiredUnits - availableUnits));
      const unitsPerPack = Math.max(1, tr?.unitsPerPack || 1);
      const shortagePacks = shortageUnits > 0 ? Math.max(1, Math.ceil(shortageUnits / unitsPerPack)) : 0;
      return {
        trimId,
        name: tr?.name || 'كلفة غير معروفة',
        supplierId: tr?.supplierId || '',
        supplierName: tr?.supplier || 'مورد عام',
        unit: tr?.unitLabel || 'قطعة',
        packPrice: tr?.packPrice || 0,
        requiredUnits,
        availableUnits,
        shortageUnits,
        shortagePacks,
      };
    });

    const shortageCount =
      fabricRows.filter((f) => f.shortage > 0).length +
      trimRows.filter((t) => t.shortageUnits > 0).length;

    return {
      fabrics: fabricRows,
      trims: trimRows,
      hasShortage: shortageCount > 0,
      shortageCount,
      estimatedUnitCost: calc.totalUnitCost,
      estimatedBatchCost: calc.totalUnitCost * qty,
    };
  }, [checkModel, checkBatchQty, allFabrics, allTrims, allOverhead]);

  const handleOptionalAutoPoFromShortage = () => {
    if (!checkModel || !materialPreCheck.hasShortage) return;
    const lines: PendingPoDraftLine[] = [];
    let primarySupplierId = '';
    let primarySupplierName = '';

    for (const f of materialPreCheck.fabrics) {
      if (f.shortage > 0) {
        if (!primarySupplierName && f.supplierName) {
          primarySupplierId = f.supplierId;
          primarySupplierName = f.supplierName;
        }
        lines.push({
          itemType: 'fabric',
          refId: f.fabricId,
          quantity: f.shortage,
          unitPrice: f.unitPrice,
        });
      }
    }
    for (const t of materialPreCheck.trims) {
      if (t.shortagePacks > 0) {
        if (!primarySupplierName && t.supplierName) {
          primarySupplierId = t.supplierId;
          primarySupplierName = t.supplierName;
        }
        lines.push({
          itemType: 'trim',
          refId: t.trimId,
          quantity: t.shortagePacks,
          unitPrice: t.packPrice,
        });
      }
    }

    if (lines.length === 0) return;
    openAutoPoDraft({
      supplierId: primarySupplierId || undefined,
      supplierName: primarySupplierName || 'مورد عام',
      sourceLabel: `نواقص تصنيع «${checkModel.name}» (${checkBatchQty} قطعة)`,
      notes: `أمر شراء مقترح لتغطية نواقص تصنيع ${checkModel.name} (${checkBatchQty} قطعة)`,
      lines,
    });
  };

  const handleOptionalAutoPoFromLowStock = () => {
    const lines: PendingPoDraftLine[] = [];
    let primarySupplierId = '';
    let primarySupplierName = '';

    for (const f of pulse.lowFabrics) {
      const targetQty = Math.max(10, Math.ceil((f.reorderLevel || 20) * 2 - (f.stockQty || 0)));
      if (!primarySupplierName && f.supplier) {
        primarySupplierId = f.supplierId || '';
        primarySupplierName = f.supplier;
      }
      lines.push({
        itemType: 'fabric',
        refId: f.id,
        quantity: targetQty,
        unitPrice: f.pricePerUnit,
      });
    }
    for (const t of pulse.lowTrims) {
      const unitsNeeded = Math.max(1, Math.ceil((t.reorderLevel || 20) * 2 - (t.stockQty || 0)));
      const packs = Math.max(1, Math.ceil(unitsNeeded / Math.max(1, t.unitsPerPack || 1)));
      if (!primarySupplierName && t.supplier) {
        primarySupplierId = t.supplierId || '';
        primarySupplierName = t.supplier;
      }
      lines.push({
        itemType: 'trim',
        refId: t.id,
        quantity: packs,
        unitPrice: t.packPrice,
      });
    }

    if (lines.length === 0) return;
    openAutoPoDraft({
      supplierId: primarySupplierId || undefined,
      supplierName: primarySupplierName || 'مورد عام',
      sourceLabel: `تغطية نواقص المخزن (${lines.length} صنف تحت حد الطلب)`,
      notes: `أمر شراء مقترح لتغطية أصناف تحت حد إعادة الطلب`,
      lines,
    });
  };

  const handleOpenWhatsApp = (saleId: string) => {
    const order = state.salesOrders.find((s) => s.id === saleId);
    if (!order) return;
    const customer = state.customers.find(
      (c) => (order.customerId && c.id === order.customerId) || c.name === order.customerName
    );
    const itemsText = order.items
      .map((it) => {
        const foundModel = state.models.find((m) => m.variants.some((v) => v.id === it.variantId));
        const foundVar = foundModel?.variants.find((v) => v.id === it.variantId);
        return foundVar
          ? `${foundModel?.name || ''} (${foundVar.color}/${foundVar.size}) × ${it.quantity}`
          : `${it.quantity} قطعة`;
      })
      .join(' + ');

    const msg = buildWhatsAppOrderMessage(
      order.orderNumber,
      order.customerName,
      itemsText,
      order.totalAmount,
      order.paidAmount,
      order.remainingDebt,
      state.currency
    );

    const rawPhone = (customer?.phone || '').replace(/[^\d]/g, '');
    const normalizedPhone =
      rawPhone.startsWith('01') && rawPhone.length === 11 ? `2${rawPhone}` : rawPhone;
    const url = normalizedPhone
      ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleRunBulkCod = async () => {
    if (selectedCodIds.length === 0 || settlingCod) return;
    setSettlingCod(true);
    setCodFeedback(null);
    try {
      const settled = await bulkSettleSalesOrders(selectedCodIds, codMethod);
      if (settled > 0) {
        setSelectedCodIds([]);
        setCodFeedback(`تم تسوية وتحصيل (${settled}) طلب بنجاح وتحديث الخزنة وحالة التسليم ✓`);
      }
    } finally {
      setSettlingCod(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero Command Strip & Operational Pulse */}
      <div className="rounded-2xl bg-[#1A1A1E] text-white p-5 sm:p-6 space-y-5 border border-[#2C2C33]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#BD956D] bg-white/10 px-2.5 py-1 rounded-full">
              <Workflow className="w-3.5 h-3.5" />
              <span>مركز مسارات العمل الموجهة — Guided Business Workflow</span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">
              خطوات تشغيل DressCode بالترتيب الصحيح دون تشتت
            </h2>
            <p className="text-xs text-[#B4B2AA] max-w-2xl leading-relaxed">
              اختر العملية التي تريد تنفيذها الآن وسيرشدك النظام خطوة بخطوة، مع فحص تلقائي للمخزون
              وخيارات ذكية اختيارية لمنع أخطاء الإدخال.
            </p>
          </div>
        </div>

        {/* Live Actionable Pulse Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() =>
              pulse.lowTotal > 0 ? handleOptionalAutoPoFromLowStock() : setActiveTab('materials')
            }
            className="text-right rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-3.5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#D4B896] font-semibold">نواقص تحت حد الطلب</span>
              <AlertTriangle
                className={`w-4 h-4 ${pulse.lowTotal > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
              />
            </div>
            <div className="text-xl font-extrabold tabular-nums mt-1">{pulse.lowTotal} صنف</div>
            <div className="text-[10px] text-[#B4B2AA] mt-0.5">
              {pulse.lowTotal > 0 ? 'اضغط لتجهيز أمر شراء (اختياري) ←' : 'المخزون متوازن ✓'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('production')}
            className="text-right rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-3.5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#D4B896] font-semibold">تشغيلات بالورش الآن</span>
              <Factory className="w-4 h-4 text-[#BD956D]" />
            </div>
            <div className="text-xl font-extrabold tabular-nums mt-1">
              {pulse.plannedBatches.length + pulse.inProgressBatches.length} أمر
            </div>
            <div className="text-[10px] text-[#B4B2AA] mt-0.5">
              {pulse.plannedBatches.length} ينتظر صرف • {pulse.inProgressBatches.length} قيد التنفيذ
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTrack('sales');
            }}
            className="text-right rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-3.5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#D4B896] font-semibold">
                طلبات تنتظر التسليم/التحصيل
              </span>
              <Truck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-extrabold tabular-nums mt-1">
              {pulse.openSales.length} طلب
            </div>
            <div className="text-[10px] text-[#B4B2AA] mt-0.5">تسوية شيت الشحن COD بضغطة زر ←</div>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('purchases')}
            className="text-right rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 p-3.5 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#D4B896] font-semibold">فواتير موردين غير مسددة</span>
              <ShoppingBag className="w-4 h-4 text-[#BD956D]" />
            </div>
            <div className="text-xl font-extrabold tabular-nums mt-1">
              {pulse.unpaidPOs.length} فاتورة
            </div>
            <div className="text-[10px] text-[#B4B2AA] mt-0.5">سداد مباشر مرتبط بالخزنة ←</div>
          </button>
        </div>
      </div>

      {/* 3-Track Workflow Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {(
          [
            {
              id: 'production',
              stepTag: 'المسار ١',
              title: 'التصنيع الذكي والتوريد (اختياري)',
              desc: 'افحص توافر الأقمشة والكلف قبل القص، وأصدر أمر شراء بالنواقص اختيارياً أو عدّل الخطة',
              icon: Factory,
            },
            {
              id: 'launch',
              stepTag: 'المسار ٢',
              title: 'إطلاق موديل ومصفوفة المقاسات',
              desc: 'اربط الباترون وولّد كل الألوان والمقاسات والأسعار بضغطة زر بدون تكرار يدوي',
              icon: Scissors,
            },
            {
              id: 'sales',
              stepTag: 'المسار ٣',
              title: 'البيع، رسائل واتساب وتسوية COD',
              desc: 'أرسل تأكيد الطلب للعميل عبر واتساب وسوِّ شيت شركة الشحن لعدة طلبات معاً',
              icon: Receipt,
            },
          ] as const
        ).map((track) => {
          const Icon = track.icon;
          const active = activeTrack === track.id;
          return (
            <button
              key={track.id}
              type="button"
              onClick={() => setActiveTrack(track.id)}
              className={`text-right rounded-2xl border p-4 transition-all cursor-pointer ${
                active
                  ? 'bg-[#FBF8F4] border-[#A67C52] ring-2 ring-[#A67C52]/20 shadow-sm'
                  : 'bg-white border-[#E5E3DD] hover:border-[#C7B9A7]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    active ? 'bg-[#1A1A1E] text-[#BD956D]' : 'bg-[#F3F2EE] text-[#6E6C66]'
                  }`}
                >
                  {track.stepTag}
                </span>
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    active ? 'bg-[#A67C52] text-white' : 'bg-[#F3F2EE] text-[#6E6C66]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <div className="text-sm font-extrabold text-[#1A1A1E] mt-2.5">{track.title}</div>
              <p className="text-[11px] text-[#6E6C66] mt-1 leading-relaxed">{track.desc}</p>
            </button>
          );
        })}
      </div>

      {/* ==================== TRACK 1 (SHOWN FIRST): SMART PRODUCTION & OPTIONAL AUTO-PO ==================== */}
      {activeTrack === 'production' && (
        <div className="space-y-5">
          {/* Visual Stepper */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                { num: '1', label: 'فحص احتياجات الموديل', sub: 'أقمشة + كلف + هالك', active: true },
                {
                  num: '2',
                  label: 'قرار النواقص (اختياري)',
                  sub: 'أمر شراء أو تعديل الخطة',
                  active: materialPreCheck.hasShortage,
                },
                {
                  num: '3',
                  label: 'صرف للورشة وطباعة إذن',
                  sub: `${pulse.plannedBatches.length} جاهز للصرف`,
                  active: false,
                },
                {
                  num: '4',
                  label: 'استلام التام وتسوية الورشة',
                  sub: `${pulse.inProgressBatches.length} بالورش حالياً`,
                  active: false,
                },
              ].map((st) => (
                <div
                  key={st.num}
                  className={`rounded-xl border p-3 flex items-center gap-2.5 ${
                    st.active
                      ? 'bg-[#FBF8F4] border-[#A67C52]'
                      : 'bg-[#FAF9F7] border-[#EAE8E2]'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0 ${
                      st.active ? 'bg-[#1A1A1E] text-[#BD956D]' : 'bg-[#E5E3DD] text-[#4B4A46]'
                    }`}
                  >
                    {st.num}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#1A1A1E] truncate">{st.label}</div>
                    <div className="text-[10px] text-[#6E6C66] truncate">{st.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Smart Pre-Check Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-[#FAF9F7] border border-[#EAE8E2] rounded-xl p-4">
              <div className="sm:col-span-6">
                <label className="block text-xs font-bold text-[#1A1A1E] mb-1">
                  اختر الموديل المراد تصنيعه
                </label>
                <select
                  value={checkModel?.id || ''}
                  onChange={(e) => setCheckModelId(e.target.value)}
                  className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs font-semibold"
                >
                  {state.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-bold text-[#1A1A1E] mb-1">
                  عدد القطع المخطط تصنيعها
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={checkBatchQty || ''}
                  onKeyDown={blockNonIntegerKey}
                  onChange={(e) => setCheckBatchQty(toWholeQty(e.target.value, 0))}
                  onBlur={() => setCheckBatchQty(toWholeQty(checkBatchQty, 1))}
                  className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs font-bold text-center tabular-nums"
                />
              </div>
              <div className="sm:col-span-3">
                <div className="rounded-xl bg-white border border-[#E5E3DD] px-3 py-2 text-center">
                  <div className="text-[10px] text-[#6E6C66]">التكلفة التقديرية للتشغيلة</div>
                  <div className="text-sm font-extrabold text-[#8E6742] tabular-nums">
                    {formatMoney(materialPreCheck.estimatedBatchCost, state.currency)}
                  </div>
                </div>
              </div>
            </div>

            {/* Traffic-Light Availability Table */}
            {checkModel && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-[#1A1A1E]">
                    نتيجة الفحص الفوري للخامات والكلف المطلوبة لـ ({toWholeQty(checkBatchQty, 1)}{' '}
                    قطعة):
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      materialPreCheck.hasShortage
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {materialPreCheck.hasShortage ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>يوجد عجز في {materialPreCheck.shortageCount} صنف</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>جميع الخامات متوفرة وجاهزة للتصنيع ✓</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#EAE8E2]">
                  <table className="w-full text-xs text-right">
                    <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                      <tr>
                        <th className="py-2 px-3">الخامة / الكلفة</th>
                        <th className="py-2 px-3 text-center">المطلوب (بالهالك)</th>
                        <th className="py-2 px-3 text-center">المتاح بالمخزن</th>
                        <th className="py-2 px-3 text-center">العجز</th>
                        <th className="py-2 px-3 text-center">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0EFEA]">
                      {materialPreCheck.fabrics.map((f) => (
                        <tr key={`fab-${f.fabricId}`}>
                          <td className="py-2 px-3 font-bold text-[#1A1A1E]">
                            قماش: {f.name}
                          </td>
                          <td className="py-2 px-3 text-center font-bold tabular-nums">
                            {f.required} {f.unit}
                          </td>
                          <td className="py-2 px-3 text-center tabular-nums">
                            {formatNumber(f.available, 1)} {f.unit}
                          </td>
                          <td className="py-2 px-3 text-center font-extrabold tabular-nums text-red-700">
                            {f.shortage > 0 ? `${f.shortage} ${f.unit}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                f.shortage > 0
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {f.shortage > 0 ? 'ناقص' : 'متاح ✓'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {materialPreCheck.trims.map((t) => (
                        <tr key={`tr-${t.trimId}`}>
                          <td className="py-2 px-3 font-semibold text-[#1A1A1E]">
                            كلفة/مستلزم: {t.name}
                          </td>
                          <td className="py-2 px-3 text-center font-bold tabular-nums">
                            {t.requiredUnits} {t.unit}
                          </td>
                          <td className="py-2 px-3 text-center tabular-nums">
                            {formatNumber(t.availableUnits, 1)} {t.unit}
                          </td>
                          <td className="py-2 px-3 text-center font-extrabold tabular-nums text-red-700">
                            {t.shortageUnits > 0 ? `${t.shortageUnits} ${t.unit}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                t.shortageUnits > 0
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {t.shortageUnits > 0 ? 'ناقص' : 'متاح ✓'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {materialPreCheck.fabrics.length === 0 &&
                        materialPreCheck.trims.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-[#6E6C66]">
                              لم يتم إضافة أقمشة أو كلف في بطاقة هذا الموديل بعد.
                            </td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>

                {/* Flexible Optional Decision Bar */}
                <div
                  className={`rounded-xl p-4 border flex flex-wrap items-center justify-between gap-3 ${
                    materialPreCheck.hasShortage
                      ? 'bg-amber-50/80 border-amber-200'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="space-y-0.5 max-w-xl">
                    <div className="text-xs font-bold text-[#1A1A1E]">
                      {materialPreCheck.hasShortage
                        ? 'القرار بيدك (الشراء اختياري تماماً):'
                        : 'الخامات جاهزة — يمكنك إصدار أمر التصنيع الآن!'}
                    </div>
                    <p className="text-[11px] text-[#4B4A46]">
                      {materialPreCheck.hasShortage
                        ? 'إذا كان القماش غير متوفر لدى المورد يمكنك تقليل الكمية أو تعديل الباترون بلون/خامة بديلة، أو تجهيز أمر شراء اختياري بالنواقص فقط.'
                        : 'الانتقال مباشرة لأمر التصنيع مع اختيار الموديل تلقائياً.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {materialPreCheck.hasShortage && (
                      <>
                        <button
                          type="button"
                          onClick={handleOptionalAutoPoFromShortage}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold cursor-pointer transition-colors"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          <span>تجهيز أمر شراء بالنواقص (اختياري)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openModelInBOM(checkModel.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E5E3DD] hover:bg-[#FAF9F7] text-[#1A1A1E] text-xs font-bold cursor-pointer"
                        >
                          <Scissors className="w-3.5 h-3.5 text-[#A67C52]" />
                          <span>تعديل القماش/اللون بالباترون</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => openProductionForModel(checkModel.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold cursor-pointer transition-colors"
                    >
                      <Factory className="w-3.5 h-3.5 text-[#BD956D]" />
                      <span>إصدار أمر التصنيع الآن</span>
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TRACK 2: NEW MODEL LAUNCH + COLOR x SIZE MATRIX ==================== */}
      {activeTrack === 'launch' && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              {
                num: '1',
                label: 'الخامات والكلف',
                action: () => setActiveTab('materials'),
                btn: 'فتح الخامات',
              },
              {
                num: '2',
                label: 'بطاقة الموديل (BOM)',
                action: () => (launchModel ? openModelInBOM(launchModel.id) : setActiveTab('models')),
                btn: 'تعديل الباترون',
              },
              {
                num: '3',
                label: 'توليد مصفوفة المقاسات',
                action: undefined,
                btn: 'الخطوة الحالية',
              },
              {
                num: '4',
                label: 'التسعير وأمر التصنيع',
                action: () =>
                  launchModel ? openProductionForModel(launchModel.id) : setActiveTab('production'),
                btn: 'إصدار تصنيع',
              },
            ].map((st) => (
              <div
                key={st.num}
                className={`rounded-xl border p-3 space-y-2 ${
                  st.num === '3'
                    ? 'bg-[#FBF8F4] border-[#A67C52]'
                    : 'bg-[#FAF9F7] border-[#EAE8E2]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center ${
                      st.num === '3' ? 'bg-[#1A1A1E] text-[#BD956D]' : 'bg-[#E5E3DD] text-[#4B4A46]'
                    }`}
                  >
                    {st.num}
                  </span>
                  <span className="text-xs font-bold text-[#1A1A1E]">{st.label}</span>
                </div>
                {st.action ? (
                  <button
                    type="button"
                    onClick={st.action}
                    className="w-full py-1.5 rounded-lg bg-white border border-[#E5E3DD] hover:border-[#A67C52] text-[11px] font-bold text-[#1A1A1E] cursor-pointer"
                  >
                    {st.btn} ←
                  </button>
                ) : (
                  <div className="text-[11px] font-bold text-[#8E6742] text-center py-1">
                    {st.btn}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Embedded 1-Click Color x Size Matrix Generator */}
          <div className="rounded-2xl border border-[#E6D5C3] bg-[#FBF8F4]/70 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Grid2x2Plus className="w-4 h-4 text-[#A67C52]" />
                <div>
                  <h3 className="text-sm font-bold text-[#1A1A1E]">
                    مولّد مصفوفة الألوان والمقاسات التلقائي (Color × Size Matrix)
                  </h3>
                  <p className="text-[11px] text-[#6E6C66]">
                    اختر الموديل والألوان والمقاسات فيُنشئ النظام كل الأصناف والـ SKUs والتكلفة
                    وسعر البيع تلقائياً بدون أخطاء إدخال
                  </p>
                </div>
              </div>
              {launchModel && (
                <button
                  type="button"
                  onClick={() => openModelInCalculator(launchModel.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E5E3DD] text-xs font-bold text-[#1A1A1E] hover:border-[#A67C52] cursor-pointer"
                >
                  <Calculator className="w-3.5 h-3.5 text-[#A67C52]" />
                  <span>مراجعة التسعير</span>
                </button>
              )}
            </div>

            {matrixDoneMsg && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs font-bold text-emerald-800 flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span>{matrixDoneMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-[#1A1A1E] mb-1">اختر الموديل</label>
                  <select
                    value={launchModel?.id || ''}
                    onChange={(e) => {
                      setLaunchModelId(e.target.value);
                      setMatrixDoneMsg(null);
                    }}
                    className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2 text-xs font-semibold"
                  >
                    {state.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.sku}) — {m.variants.length} مقاس مسجل
                      </option>
                    ))}
                  </select>
                </div>

                {launchModel && (
                  <div className="rounded-xl bg-white border border-[#EAE8E2] p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[#6E6C66]">تكلفة القطعة (BOM):</span>
                      <strong className="tabular-nums">
                        {formatMoney(matrixPreview.unitCost, state.currency)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6E6C66]">سعر البيع الافتراضي:</span>
                      <strong className="text-[#8E6742] tabular-nums">
                        {formatMoney(matrixPreview.retailPrice, state.currency)}
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-4 space-y-2">
                <label className="block text-xs font-bold text-[#1A1A1E]">
                  ١. اختر الألوان ({selectedColors.length})
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {colorOptions.map((c) => {
                    const active = selectedColors.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setSelectedColors((prev) =>
                            prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#1A1A1E] text-white border-[#1A1A1E]'
                            : 'bg-white text-[#4B4A46] border-[#E5E3DD] hover:border-[#A67C52]'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="text"
                    value={customColor}
                    onChange={(e) => setCustomColor(e.target.value)}
                    placeholder="إضافة لون آخر..."
                    className="flex-1 rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = customColor.trim();
                      if (!val) return;
                      if (!selectedColors.includes(val)) setSelectedColors((p) => [...p, val]);
                      setCustomColor('');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#A67C52] text-white text-xs font-bold cursor-pointer"
                  >
                    + لون
                  </button>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-2">
                <label className="block text-xs font-bold text-[#1A1A1E]">
                  ٢. اختر المقاسات ({selectedSizes.length})
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {sizeOptions.map((s) => {
                    const active = selectedSizes.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setSelectedSizes((prev) =>
                            prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#A67C52] text-white border-[#A67C52]'
                            : 'bg-white text-[#4B4A46] border-[#E5E3DD] hover:border-[#A67C52]'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {matrixPreview.items.length > 0 && (
              <div className="pt-3 border-t border-[#E6D5C3] flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5 max-w-2xl">
                  {matrixPreview.items.map((item) => (
                    <span
                      key={item.sku}
                      className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        item.exists
                          ? 'bg-[#F0EFEA] text-[#9C9990] line-through'
                          : 'bg-white border border-[#E6D5C3] text-[#1A1A1E]'
                      }`}
                    >
                      {item.color} / {item.size}{' '}
                      <span className="font-mono text-[10px] text-[#8E6742]">({item.sku})</span>
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={generatingMatrix || matrixPreview.newCount === 0}
                  onClick={() => void handleGenerateMatrix()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#BD956D]" />
                  <span>
                    {generatingMatrix
                      ? 'جاري التوليد...'
                      : matrixPreview.newCount > 0
                        ? `توليد (${matrixPreview.newCount}) مقاس/لون جديد الآن`
                        : 'جميع المختارات مسجلة مسبقاً ✓'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TRACK 3: SALES, WHATSAPP & BULK COD SETTLEMENT ==================== */}
      {activeTrack === 'sales' && (
        <div className="space-y-5">
          {/* Quick Actions Bar */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#F6EFE7] text-[#A67C52] flex items-center justify-center">
                <ClipboardCheck className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-[#1A1A1E]">
                  تسوية شيت شركة الشحن (COD) وتأكيدات واتساب السريعة
                </h3>
                <p className="text-[11px] text-[#6E6C66]">
                  حدد الطلبات التي تم تحصيلها من شركة الشحن لتسويتها وإضافتها للخزنة دفعة واحدة،
                  أو أرسل رسالة تأكيد واتساب فورية لأي عميل
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-bold cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5 text-[#BD956D]" />
              <span>إنشاء طلب عميل جديد</span>
            </button>
          </div>

          {codFeedback && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-bold text-emerald-800">
              {codFeedback}
            </div>
          )}

          {/* Open Orders Table with Bulk COD Checkboxes + WhatsApp Button */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-[#E5E3DD] flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-[#A67C52]" />
                <span className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
                  الطلبات النشطة غير المكتملة / غير المسددة ({pulse.openSales.length})
                </span>
              </div>

              {pulse.openSales.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedCodIds((prev) =>
                        prev.length === pulse.openSales.length
                          ? []
                          : pulse.openSales.map((s) => s.id)
                      )
                    }
                    className="text-xs font-semibold text-[#6E6C66] hover:text-[#1A1A1E] px-2.5 py-1.5 rounded-lg border border-[#E5E3DD] cursor-pointer"
                  >
                    {selectedCodIds.length === pulse.openSales.length ? 'إلغاء التحديد' : 'تحديد الكل'}
                  </button>
                  <select
                    value={codMethod}
                    onChange={(e) => setCodMethod(e.target.value)}
                    className="rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2.5 py-1.5 text-xs font-semibold"
                  >
                    {paymentMethods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={selectedCodIds.length === 0 || settlingCod}
                    onClick={() => void handleRunBulkCod()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {settlingCod
                        ? 'جاري التسوية...'
                        : `تسوية وتحصيل (${selectedCodIds.length}) طلب`}
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                  <tr>
                    <th className="py-2.5 px-3 text-center w-10">تحديد</th>
                    <th className="py-2.5 px-3">رقم الطلب / العميل</th>
                    <th className="py-2.5 px-3">الحالة</th>
                    <th className="py-2.5 px-3">الإجمالي</th>
                    <th className="py-2.5 px-3">المتبقي للتحصيل</th>
                    <th className="py-2.5 px-4">واتساب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EFEA]">
                  {pulse.openSales.map((o) => {
                    const checked = selectedCodIds.includes(o.id);
                    return (
                      <tr
                        key={o.id}
                        className={`hover:bg-[#FAF9F7] ${checked ? 'bg-emerald-50/40' : ''}`}
                      >
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedCodIds((prev) =>
                                prev.includes(o.id)
                                  ? prev.filter((x) => x !== o.id)
                                  : [...prev, o.id]
                              )
                            }
                            className="h-4 w-4 accent-[#A67C52] cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-[#1A1A1E]">{o.customerName}</div>
                          <div className="text-[10px] text-[#6E6C66] font-mono">
                            {o.orderNumber} • {o.orderDate} • {o.platform}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F6EFE7] text-[#8E6742]">
                            {o.fulfillmentStatus}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold tabular-nums">
                          {formatMoney(o.totalAmount, state.currency)}
                        </td>
                        <td className="py-2.5 px-3 font-extrabold text-red-700 tabular-nums">
                          {formatMoney(o.remainingDebt, state.currency)}
                        </td>
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            onClick={() => handleOpenWhatsApp(o.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>إرسال تأكيد</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {pulse.openSales.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-emerald-700 font-semibold">
                        جميع الطلبات مكتملة ومسددة بالكامل!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Quick End-to-End Map Footer */}
      <div className="rounded-2xl bg-white border border-[#E5E3DD] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#1A1A1E]">
          <Layers className="w-4 h-4 text-[#A67C52]" />
          <span>انتقال سريع حسب ترتيب العمل:</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {(
            [
              { id: 'materials', label: '١. الخامات' },
              { id: 'purchases', label: '٢. المشتريات' },
              { id: 'models', label: '٣. الباترون' },
              { id: 'production', label: '٤. التصنيع' },
              { id: 'sales', label: '٥. المبيعات' },
              { id: 'expenses', label: '٦. الخزنة' },
              { id: 'reports', label: '٧. التقارير' },
            ] as const
          ).map((item, i) => (
            <React.Fragment key={item.id}>
              <button
                type="button"
                onClick={() => setActiveTab(item.id)}
                className="px-2.5 py-1 rounded-lg bg-[#FAF9F7] hover:bg-[#F6EFE7] border border-[#EAE8E2] hover:border-[#A67C52] font-bold text-[#1A1A1E] cursor-pointer transition-colors"
              >
                {item.label}
              </button>
              {i < 6 && <span className="text-[#C7B9A7]">←</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
