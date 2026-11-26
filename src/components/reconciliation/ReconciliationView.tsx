import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CopyCheck,
  Database,
  Download,
  Eraser,
  History,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Shirt,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { erpDb, formatDisplayIdentifier } from '../../lib/supabase';
import { loadLocalReconciliationHistory } from '../../utils/reconciliationStorage';
import type {
  CashChannelCount,
  ReconciliationSession,
  StockReconciliationItemType,
  StockReconciliationLine,
  StockReconciliationScope,
} from '../../types/erp';
import {
  blockInvalidDecimalKey,
  blockNonIntegerKey,
  calculateModelCost,
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  getTrimUnitCost,
  toDecimalQty,
  toWholeQty,
} from '../../utils/calculations';
import { matchesSmartQuery } from '../../utils/search';
import { useConfirm } from '../common/ConfirmDialog';

type SubTab = 'cash' | 'stock' | 'history';

interface StockCatalogRow {
  key: string;
  itemType: StockReconciliationItemType;
  itemId: string;
  itemName: string;
  subtitle: string;
  unitLabel: string;
  systemQty: number;
  unitCost: number;
}

const DEFAULT_CASH_CHANNELS: CashChannelCount[] = [
  { id: 'drawer', label: 'درج الكاش النقدي', amount: 0 },
  { id: 'wallet', label: 'محفظة إلكترونية / إنستاباي', amount: 0 },
  { id: 'bank', label: 'حساب بنكي / تحويلات', amount: 0 },
  { id: 'petty', label: 'عهدة أخرى / مع الشركاء', amount: 0 },
];

const CASH_REASON_CHIPS = [
  'جرد دوري للخزنة',
  'مصروفات نثرية غير مسجلة',
  'فروق فكة وعمولات تحويل',
  'تحصيل عميل لم يُسجّل بعد',
  'عجز / زيادة درج الكاش',
];

const STOCK_REASON_CHIPS = [
  'جرد مخزني دوري',
  'فروق قص وهالك فعلي',
  'قطع تالفة / عينات عرض',
  'مرتجعات أو مبيعات لم تُسجّل',
  'إعادة تقييم وترتيب المخزن',
];

function makeRecNumber(prefix: 'CASH-REC' | 'STK-REC'): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${prefix}-${y}${m}${day}-${hh}${mm}`;
}

function formatDateTimeAr(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

const ITEM_TYPE_LABEL: Record<StockReconciliationItemType, string> = {
  fabric: 'قماش',
  trim: 'كلفة / إكسسوار',
  finished_good: 'منتج تام',
};

const SCOPE_LABEL: Record<string, string> = {
  all: 'جرد شامل (الكل)',
  fabric: 'الأقمشة فقط',
  trim: 'الكلف والإكسسوارات فقط',
  finished_good: 'المنتج التام فقط',
};

export const ReconciliationView: React.FC = () => {
  const {
    state,
    userRole,
    cloudConnected,
    reconcileCash,
    reconcileStock,
  } = useERP();
  const confirmAction = useConfirm();
  const isAdmin = userRole === 'admin';

  const {
    currency,
    fabrics,
    trims,
    models,
    overhead,
    expenses,
    partnerContributions,
    salesOrders,
    lookups,
  } = state;

  const [subTab, setSubTab] = useState<SubTab>('cash');
  const [banner, setBanner] = useState<{
    tone: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  // =========================================================================
  // 1) CASH RECONCILIATION STATE
  // =========================================================================
  const [cashRecNumber, setCashRecNumber] = useState(() => makeRecNumber('CASH-REC'));
  const [channels, setChannels] = useState<CashChannelCount[]>(DEFAULT_CASH_CHANNELS);
  const [newChannelLabel, setNewChannelLabel] = useState('');
  const [cashPostAdjustment, setCashPostAdjustment] = useState(isAdmin);
  const [cashAffectPnl, setCashAffectPnl] = useState(true);
  const [cashPaymentMethod, setCashPaymentMethod] = useState('كاش');
  const [cashNotes, setCashNotes] = useState('');
  const [submittingCash, setSubmittingCash] = useState(false);

  const paymentMethods = useMemo(
    () => getLookupLabels(lookups, 'payment_methods'),
    [lookups]
  );

  const cashBookSummary = useMemo(() => {
    const totalPartnerCapital = partnerContributions.reduce((s, p) => s + (p.amount || 0), 0);
    const totalCollections = salesOrders
      .filter((o) => o.status !== 'cancelled')
      .reduce((s, o) => s + (o.paidAmount || 0), 0);
    const totalExpensesOutflow = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const availableCash =
      Math.round((totalPartnerCapital + totalCollections - totalExpensesOutflow) * 100) / 100;
    return {
      totalPartnerCapital,
      totalCollections,
      totalExpensesOutflow,
      availableCash,
    };
  }, [partnerContributions, salesOrders, expenses]);

  const actualCashTotal = useMemo(
    () =>
      Math.round(channels.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) * 100) / 100,
    [channels]
  );

  const cashVariance = Math.round((actualCashTotal - cashBookSummary.availableCash) * 100) / 100;
  const cashIsMatched = Math.abs(cashVariance) < 0.01;

  // =========================================================================
  // 2) STOCK RECONCILIATION STATE
  // =========================================================================
  const [stockRecNumber, setStockRecNumber] = useState(() => makeRecNumber('STK-REC'));
  const [stockScope, setStockScope] = useState<StockReconciliationScope>('all');
  const [stockSearch, setStockSearch] = useState('');
  const [onlyVariances, setOnlyVariances] = useState(false);
  const [onlyCounted, setOnlyCounted] = useState(false);
  const [actualInputs, setActualInputs] = useState<Record<string, string>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [stockNotes, setStockNotes] = useState('');
  const [stockPostAdjustments, setStockPostAdjustments] = useState(isAdmin);
  const [submittingStock, setSubmittingStock] = useState(false);

  const stockCatalog = useMemo<StockCatalogRow[]>(() => {
    const rows: StockCatalogRow[] = [];

    for (const f of fabrics) {
      rows.push({
        key: `fabric:${f.id}`,
        itemType: 'fabric',
        itemId: f.id,
        itemName: f.name,
        subtitle: f.supplier ? `مورد: ${f.supplier}` : 'قماش خام',
        unitLabel: FABRIC_UNIT_LABELS[f.unit] || 'متر',
        systemQty: Math.round((Number(f.stockQty) || 0) * 1000) / 1000,
        unitCost: Number(f.pricePerUnit) || 0,
      });
    }

    for (const t of trims) {
      rows.push({
        key: `trim:${t.id}`,
        itemType: 'trim',
        itemId: t.id,
        itemName: t.name,
        subtitle: [t.category, t.supplier].filter(Boolean).join(' • ') || 'كلفة / إكسسوار',
        unitLabel: 'قطعة',
        systemQty: Math.round((Number(t.stockQty) || 0) * 1000) / 1000,
        unitCost: getTrimUnitCost(t),
      });
    }

    for (const m of models) {
      const fallbackCost = calculateModelCost(m, fabrics, trims, overhead).totalUnitCost;
      for (const v of m.variants) {
        const unitCost = v.avgUnitCogs > 0 ? v.avgUnitCogs : fallbackCost;
        rows.push({
          key: `finished_good:${v.id}`,
          itemType: 'finished_good',
          itemId: v.id,
          itemName: `${m.name} — ${v.color} / ${v.size}`,
          subtitle: [m.sku, v.variantSku].filter(Boolean).join(' • ') || 'منتج تام',
          unitLabel: 'قطعة',
          systemQty: Math.trunc(Number(v.finishedGoodsQty) || 0),
          unitCost,
        });
      }
    }

    return rows;
  }, [fabrics, trims, models, overhead]);

  const stockEvaluatedRows = useMemo(() => {
    return stockCatalog.map((row) => {
      const raw = actualInputs[row.key];
      const hasInput = raw !== undefined && raw.trim() !== '';
      const actualQty = hasInput
        ? row.itemType === 'fabric'
          ? toDecimalQty(raw, 0, 3)
          : toWholeQty(raw, 0)
        : null;
      const qtyDelta =
        actualQty !== null ? Math.round((actualQty - row.systemQty) * 1000) / 1000 : 0;
      const hasDiff =
        actualQty !== null &&
        (row.itemType === 'finished_good'
          ? Math.abs(qtyDelta) >= 1
          : Math.abs(qtyDelta) >= 0.001);
      const valueDelta = hasInput ? Math.round(qtyDelta * row.unitCost * 100) / 100 : 0;
      return {
        ...row,
        rawInput: raw ?? '',
        hasInput,
        actualQty,
        qtyDelta,
        hasDiff,
        valueDelta,
      };
    });
  }, [stockCatalog, actualInputs]);

  const filteredStockRows = useMemo(() => {
    return stockEvaluatedRows.filter((row) => {
      if (stockScope !== 'all' && row.itemType !== stockScope) return false;
      if (onlyCounted && !row.hasInput) return false;
      if (onlyVariances && !row.hasDiff) return false;
      if (
        stockSearch.trim() &&
        !matchesSmartQuery(stockSearch, [
          row.itemName,
          row.subtitle,
          ITEM_TYPE_LABEL[row.itemType],
          row.unitLabel,
        ])
      ) {
        return false;
      }
      return true;
    });
  }, [stockEvaluatedRows, stockScope, onlyCounted, onlyVariances, stockSearch]);

  const stockStats = useMemo(() => {
    const scoped = stockEvaluatedRows.filter(
      (r) => stockScope === 'all' || r.itemType === stockScope
    );
    const counted = scoped.filter((r) => r.hasInput);
    const matched = counted.filter((r) => !r.hasDiff);
    const shortages = counted.filter((r) => r.hasDiff && r.qtyDelta < 0);
    const surpluses = counted.filter((r) => r.hasDiff && r.qtyDelta > 0);
    const shortageValue = shortages.reduce((s, r) => s + r.valueDelta, 0);
    const surplusValue = surpluses.reduce((s, r) => s + r.valueDelta, 0);
    const netValue = Math.round((shortageValue + surplusValue) * 100) / 100;
    return {
      totalItems: scoped.length,
      countedCount: counted.length,
      matchedCount: matched.length,
      shortageCount: shortages.length,
      surplusCount: surpluses.length,
      shortageValue: Math.round(shortageValue * 100) / 100,
      surplusValue: Math.round(surplusValue * 100) / 100,
      netValue,
      countedRows: counted,
      adjustedRows: counted.filter((r) => r.hasDiff),
    };
  }, [stockEvaluatedRows, stockScope]);

  // =========================================================================
  // 3) HISTORY STATE
  // =========================================================================
  const [historyRows, setHistoryRows] = useState<ReconciliationSession[]>(() =>
    loadLocalReconciliationHistory()
  );
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [missingCloudTable, setMissingCloudTable] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'cash' | 'stock'>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const localRows = loadLocalReconciliationHistory();
    if (!cloudConnected) {
      setHistoryRows(localRows);
      setMissingCloudTable(false);
      return;
    }
    setLoadingHistory(true);
    try {
      const { rows: cloudRows, missingTable } = await erpDb.fetchReconciliationSessions();
      setMissingCloudTable(missingTable);
      const seen = new Set(cloudRows.map((r) => r.id));
      const merged = [
        ...cloudRows,
        ...localRows.filter((r) => !seen.has(r.id)),
      ].sort((a, b) => (b.reconciledAt || '').localeCompare(a.reconciledAt || ''));
      setHistoryRows(merged);
    } catch {
      setHistoryRows(localRows);
    } finally {
      setLoadingHistory(false);
    }
  }, [cloudConnected]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await loadHistory();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadHistory]);

  const filteredHistory = useMemo(() => {
    return historyRows.filter((h) => {
      if (historyFilter !== 'all' && h.recType !== historyFilter) return false;
      if (
        historySearch.trim() &&
        !matchesSmartQuery(historySearch, [
          h.reconciliationNumber,
          h.notes,
          h.actorName,
          h.actorEmail,
          h.recType === 'cash' ? 'خزنة كاش نقدي' : 'مخزون جرد أصناف',
          h.stockScope ? SCOPE_LABEL[h.stockScope] : '',
        ])
      ) {
        return false;
      }
      return true;
    });
  }, [historyRows, historyFilter, historySearch]);

  // =========================================================================
  // HANDLERS: CASH
  // =========================================================================
  const handleChannelAmountChange = (id: string, rawVal: string) => {
    const val = rawVal.trim() === '' ? 0 : toDecimalQty(rawVal, 0, 2);
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, amount: val } : c)));
  };

  const handleAddChannel = () => {
    const label = newChannelLabel.trim();
    if (!label) return;
    setChannels((prev) => [
      ...prev,
      { id: `ch-${Date.now()}`, label, amount: 0 },
    ]);
    setNewChannelLabel('');
  };

  const handleRemoveChannel = (id: string) => {
    setChannels((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  };

  const handleCopyBookCash = () => {
    const target = Math.max(0, cashBookSummary.availableCash);
    setChannels((prev) =>
      prev.map((c, idx) => (idx === 0 ? { ...c, amount: target } : { ...c, amount: 0 }))
    );
  };

  const handleSubmitCashReconciliation = async () => {
    const postAdj = isAdmin && cashPostAdjustment && !cashIsMatched;
    const ok = await confirmAction({
      title: postAdj ? 'تأكيد اعتماد وتسوية رصيد الخزنة' : 'تأكيد حفظ محضر جرد الخزنة',
      message: cashIsMatched
        ? `الخزنة متطابقة تماماً (${formatMoney(actualCashTotal, currency)}). هل تريد حفظ محضر الجرد «${cashRecNumber}»؟`
        : postAdj
          ? `سيتم تسجيل ${
              cashVariance < 0
                ? `مصروف تسوية عجز بقيمة ${formatMoney(Math.abs(cashVariance), currency)}`
                : `قيد تسوية فائض بقيمة ${formatMoney(cashVariance, currency)}`
            } لضبط الرصيد الدفتري ليطابق الجرد الفعلي (${formatMoney(actualCashTotal, currency)}).`
          : `سيتم حفظ محضر الجرد فقط بفرق ${formatMoney(cashVariance, currency)} بدون تعديل رصيد الخزنة حالياً.`,
      detail: postAdj
        ? cashVariance < 0
          ? cashAffectPnl
            ? 'سيُحتسب العجز ضمن المصروفات التشغيلية بقائمة الدخل (P&L) ويُخصم من رصيد الخزنة.'
            : 'سيُخصم العجز من رصيد الخزنة فقط دون التأثير على مصروفات قائمة الدخل (P&L).'
          : 'سيُضاف الفائض لرصيد الخزنة كقيد تسوية فائض جرد دون تضخيم إيرادات المبيعات.'
        : undefined,
      confirmLabel: postAdj ? 'نعم، اعتمد ورحّل التسوية' : 'نعم، حفظ المحضر',
      tone: postAdj && cashVariance < 0 ? 'danger' : 'warning',
    });
    if (!ok) return;

    setSubmittingCash(true);
    setBanner(null);
    try {
      const { savedToCloudHistory } = await reconcileCash({
        reconciliationNumber: cashRecNumber.trim() || makeRecNumber('CASH-REC'),
        systemCash: cashBookSummary.availableCash,
        actualCash: actualCashTotal,
        channels,
        postAdjustment: postAdj,
        affectPnl: cashAffectPnl,
        paymentMethod: cashPaymentMethod,
        notes: cashNotes.trim() || undefined,
      });
      await loadHistory();
      setCashRecNumber(makeRecNumber('CASH-REC'));
      setCashNotes('');
      setBanner({
        tone: 'success',
        text: postAdj
          ? `تم اعتماد جرد الخزنة وترحيل قيد التسوية بنجاح! الرصيد الدفتري الآن مطابق للجرد الفعلي.${
              !savedToCloudHistory && cloudConnected
                ? ' (تم حفظ سجل الجرد محلياً؛ شغّل ملف 022 لحفظ سجل الجرد على السحابة أيضاً).'
                : ''
            }`
          : 'تم حفظ محضر جرد الخزنة بنجاح في سجل الجرد والتسويات.',
      });
    } catch (err) {
      setBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ جرد الخزنة',
      });
    } finally {
      setSubmittingCash(false);
    }
  };

  // =========================================================================
  // HANDLERS: STOCK
  // =========================================================================
  const handleFillBookForVisible = () => {
    setActualInputs((prev) => {
      const next = { ...prev };
      for (const row of filteredStockRows) {
        next[row.key] = String(row.systemQty);
      }
      return next;
    });
  };

  const handleClearStockInputs = () => {
    setActualInputs({});
    setLineNotes({});
  };

  const handleSubmitStockReconciliation = async () => {
    if (stockStats.countedRows.length === 0) {
      setBanner({
        tone: 'error',
        text: 'يرجى إدخال الكمية الفعلية لصنف واحد على الأقل (أو الضغط على «نسخ الدفتري» ثم تعديل الأصناف المختلفة).',
      });
      return;
    }

    const postAdj = isAdmin && stockPostAdjustments && stockStats.adjustedRows.length > 0;
    const ok = await confirmAction({
      title: postAdj ? 'تأكيد تعديل أرصدة المخزون واعتماد الجرد' : 'تأكيد حفظ محضر جرد المخزون',
      message: postAdj
        ? `تم جرد ${stockStats.countedCount} صنفاً، وسيتم تعديل رصيد ${stockStats.adjustedRows.length} صنفاً بأثر مالي صافي (${formatMoney(stockStats.netValue, currency)}).`
        : `سيتم حفظ محضر جرد لـ ${stockStats.countedCount} صنفاً (${stockStats.adjustedRows.length} صنف بها فروق) بدون تعديل الأرصدة الدفترية حالياً.`,
      detail: postAdj
        ? 'سيتم تحديث الكميات الدفترية فوراً وتسجيل حركة مخزنية من نوع «تسوية جرد» لكل صنف مختلف لضمان الشفافية والتدقيق الكامل.'
        : undefined,
      confirmLabel: postAdj ? 'نعم، عدّل الأرصدة واعتمد الجرد' : 'نعم، حفظ المحضر فقط',
      tone: postAdj && stockStats.netValue < 0 ? 'danger' : 'warning',
    });
    if (!ok) return;

    setSubmittingStock(true);
    setBanner(null);
    try {
      const { savedToCloudHistory } = await reconcileStock({
        reconciliationNumber: stockRecNumber.trim() || makeRecNumber('STK-REC'),
        stockScope,
        postAdjustments: postAdj,
        notes: stockNotes.trim() || undefined,
        lines: stockStats.countedRows.map((row) => ({
          itemType: row.itemType,
          itemId: row.itemId,
          itemName: row.itemName,
          unitLabel: row.unitLabel,
          systemQty: row.systemQty,
          actualQty: row.actualQty ?? row.systemQty,
          unitCost: row.unitCost,
          note: lineNotes[row.key]?.trim() || '',
        })),
      });
      await loadHistory();
      setActualInputs({});
      setLineNotes({});
      setStockNotes('');
      setStockRecNumber(makeRecNumber('STK-REC'));
      setBanner({
        tone: 'success',
        text: postAdj
          ? `تم اعتماد جرد المخزون وتحديث رصيد ${stockStats.adjustedRows.length} صنفاً وتسجيل حركات التسوية بنجاح!${
              !savedToCloudHistory && cloudConnected
                ? ' (تم حفظ سجل الجرد محلياً؛ شغّل ملف 022 لحفظ سجل الجرد على السحابة أيضاً).'
                : ''
            }`
          : `تم حفظ محضر جرد المخزون (${stockStats.countedCount} صنف) بنجاح في سجل الجرد.`,
      });
    } catch (err) {
      setBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'تعذر اعتماد جرد المخزون',
      });
    } finally {
      setSubmittingStock(false);
    }
  };

  // =========================================================================
  // EXCEL EXPORTS
  // =========================================================================
  const exportCurrentCashSheet = () => {
    const wb = XLSX.utils.book_new();
    const summaryRows = [
      { البند: 'رقم الجرد', القيمة: cashRecNumber },
      { البند: 'التاريخ', القيمة: new Date().toLocaleString('ar-EG') },
      { البند: 'رأس مال الشركاء', القيمة: cashBookSummary.totalPartnerCapital },
      { البند: 'تحصيلات المبيعات', القيمة: cashBookSummary.totalCollections },
      { البند: 'إجمالي المصروفات والخامات', القيمة: -cashBookSummary.totalExpensesOutflow },
      { البند: 'الرصيد الدفتري بالخزنة', القيمة: cashBookSummary.availableCash },
      { البند: 'إجمالي الجرد الفعلي', القيمة: actualCashTotal },
      { البند: 'الفرق (الفعلي - الدفتري)', القيمة: cashVariance },
      { البند: 'ملاحظات', القيمة: cashNotes || '' },
    ];
    const channelRows = channels.map((c) => ({
      'قناة السيولة / الدرج': c.label,
      'المبلغ الفعلي': c.amount,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'ملخص جرد الخزنة');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(channelRows), 'تفاصيل القنوات');
    XLSX.writeFile(wb, `${cashRecNumber}.xlsx`);
  };

  const exportCurrentStockSheet = () => {
    const wb = XLSX.utils.book_new();
    const rows = filteredStockRows.map((r) => ({
      'رقم الجرد': stockRecNumber,
      النوع: ITEM_TYPE_LABEL[r.itemType],
      الصنف: r.itemName,
      التفاصيل: r.subtitle,
      الوحدة: r.unitLabel,
      'الرصيد الدفتري': r.systemQty,
      'الجرد الفعلي': r.actualQty !== null ? r.actualQty : '',
      'الفرق (كمية)': r.hasInput ? r.qtyDelta : '',
      'تكلفة الوحدة': Number(r.unitCost.toFixed(2)),
      'فرق القيمة': r.hasInput ? r.valueDelta : '',
      ملاحظة: lineNotes[r.key] || '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'جرد المخزون');
    XLSX.writeFile(wb, `${stockRecNumber}.xlsx`);
  };

  const exportHistorySession = (session: ReconciliationSession) => {
    const wb = XLSX.utils.book_new();
    const meta = [
      { البند: 'رقم الجرد', القيمة: session.reconciliationNumber },
      { البند: 'النوع', القيمة: session.recType === 'cash' ? 'جرد خزنة وسيولة' : 'جرد مخزون' },
      { البند: 'التاريخ', القيمة: formatDateTimeAr(session.reconciledAt) },
      { البند: 'القيمة الدفترية', القيمة: session.systemValue },
      { البند: 'القيمة الفعلية', القيمة: session.actualValue },
      { البند: 'الفرق', القيمة: session.varianceValue },
      { البند: 'تم ترحيل التسوية؟', القيمة: session.adjustmentPosted ? 'نعم' : 'لا (محضر فقط)' },
      { البند: 'المستخدم', القيمة: session.actorName || formatDisplayIdentifier(session.actorEmail) || '' },
      { البند: 'ملاحظات', القيمة: session.notes || '' },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'ملخص الجرد');

    if (session.recType === 'cash') {
      const chRows = (session.details as CashChannelCount[]).map((c) => ({
        'قناة السيولة': c.label,
        'المبلغ الفعلي': c.amount,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chRows), 'تفاصيل القنوات');
    } else {
      const lineRows = (session.details as StockReconciliationLine[]).map((l) => ({
        النوع: ITEM_TYPE_LABEL[l.itemType] || l.itemType,
        الصنف: l.itemName,
        الوحدة: l.unitLabel,
        'الرصيد الدفتري': l.systemQty,
        'الجرد الفعلي': l.actualQty,
        'الفرق (كمية)': l.qtyDelta,
        'تكلفة الوحدة': l.unitCost,
        'فرق القيمة': l.valueDelta,
        ملاحظة: l.note || '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lineRows), 'تفاصيل الأصناف');
    }
    XLSX.writeFile(wb, `${session.reconciliationNumber}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Hero Banner & Sub-Tabs */}
      <div className="rounded-2xl bg-gradient-to-l from-[#1A1A1E] via-[#24242A] to-[#2C241E] text-white p-5 sm:p-6 shadow-sm border border-[#2F2F37]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#A67C52]/25 border border-[#BD956D]/40 flex items-center justify-center shrink-0">
              <Scale className="w-5 h-5 text-[#E5C199]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold">
                  الجرد والتسوية (Cash &amp; Stock Reconciliation)
                </h2>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-white/10 text-[#E5C199]">
                  رقابة مالية ومخزنية
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#C7C4BC] mt-1 leading-relaxed">
                مطابقة الرصيد الدفتري مع الجرد الفعلي للخزنة والمخزون (أقمشة بالكسور • كلف • منتج تام)
                وحساب فروق العجز والزيادة وترحيل قيود التسوية بأمان وتوثيق كامل.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSubTab('cash')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                subTab === 'cash'
                  ? 'bg-[#A67C52] text-white shadow-sm'
                  : 'bg-white/10 text-[#E2DFD9] hover:bg-white/15'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>جرد الخزنة والسيولة</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('stock')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                subTab === 'stock'
                  ? 'bg-[#A67C52] text-white shadow-sm'
                  : 'bg-white/10 text-[#E2DFD9] hover:bg-white/15'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>جرد المخزون</span>
              {stockStats.countedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">
                  {stockStats.countedCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('history')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                subTab === 'history'
                  ? 'bg-[#A67C52] text-white shadow-sm'
                  : 'bg-white/10 text-[#E2DFD9] hover:bg-white/15'
              }`}
            >
              <History className="w-4 h-4" />
              <span>سجل الجرد ({historyRows.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          className={`rounded-xl px-4 py-3 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 border ${
            banner.tone === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : banner.tone === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.tone === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs underline opacity-75 hover:opacity-100 cursor-pointer shrink-0"
          >
            إخفاء
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 1: CASH RECONCILIATION                                        */}
      {/* ================================================================= */}
      {subTab === 'cash' && (
        <div className="space-y-5">
          {/* Book Cash KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-xs text-[#6E6C66] font-medium">رأس مال الشركاء (داخل)</div>
              <div className="text-lg font-extrabold text-[#1A1A1E] mt-1">
                {formatMoney(cashBookSummary.totalPartnerCapital, currency)}
              </div>
              <div className="text-[11px] text-[#8F8D86] mt-0.5">
                {partnerContributions.length} مساهمة / تسوية فائض
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-xs text-[#6E6C66] font-medium">تحصيلات المبيعات (داخل)</div>
              <div className="text-lg font-extrabold text-emerald-700 mt-1">
                {formatMoney(cashBookSummary.totalCollections, currency)}
              </div>
              <div className="text-[11px] text-[#8F8D86] mt-0.5">
                إجمالي المدفوع من الطلبات النشطة
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4">
              <div className="text-xs text-[#6E6C66] font-medium">
                المصروفات والخامات والورش (خارج)
              </div>
              <div className="text-lg font-extrabold text-rose-700 mt-1">
                - {formatMoney(cashBookSummary.totalExpensesOutflow, currency)}
              </div>
              <div className="text-[11px] text-[#8F8D86] mt-0.5">
                {expenses.length} حركة صرف مسجلة
              </div>
            </div>
            <div className="bg-[#FAF6F0] rounded-2xl border-2 border-[#BD956D]/50 p-4">
              <div className="text-xs text-[#7B5A38] font-bold">
                الرصيد الدفتري المتاح بالخزنة
              </div>
              <div
                className={`text-xl font-extrabold mt-1 ${
                  cashBookSummary.availableCash >= 0 ? 'text-[#1A1A1E]' : 'text-rose-700'
                }`}
              >
                {formatMoney(cashBookSummary.availableCash, currency)}
              </div>
              <div className="text-[11px] text-[#7B5A38] mt-0.5">
                = رأس المال + التحصيلات − المصروفات
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left/Main: Physical Channels Count */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#EFECE6]">
                <div>
                  <h3 className="text-base font-bold text-[#1A1A1E]">
                    ١. إدخال الجرد الفعلي لقنوات السيولة
                  </h3>
                  <p className="text-xs text-[#6E6C66] mt-0.5">
                    أدخل المبلغ الفعلي الموجود الآن في الدرج، المحافظ، والبنك ليتم تجميعه ومقارنته
                    بالرصيد الدفتري.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyBookCash}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FAF6F0] text-[#8E6742] border border-[#E5D4BE] hover:bg-[#F3E8D8] cursor-pointer"
                  >
                    <CopyCheck className="w-3.5 h-3.5" />
                    <span>مطابقة الدفتري</span>
                  </button>
                  <button
                    type="button"
                    onClick={exportCurrentCashSheet}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1A1A1E] text-white hover:bg-[#2F2F37] cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#BD956D]" />
                    <span>تصدير إكسل</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-2.5 p-3 rounded-xl bg-[#FAF9F7] border border-[#EAE7E0]"
                  >
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`ch-${ch.id}`}
                        className="block text-xs sm:text-sm font-bold text-[#1A1A1E]"
                      >
                        {ch.label}
                      </label>
                    </div>
                    <div className="flex items-center gap-2 sm:w-56">
                      <input
                        id={`ch-${ch.id}`}
                        type="number"
                        step="0.01"
                        min={0}
                        onKeyDown={blockInvalidDecimalKey}
                        value={ch.amount === 0 ? '' : ch.amount}
                        placeholder="0.00"
                        onChange={(e) => handleChannelAmountChange(ch.id, e.target.value)}
                        className="w-full rounded-xl border border-[#D9D6CE] bg-white px-3 py-2 text-sm font-bold text-[#1A1A1E] text-left focus:outline-none focus:border-[#A67C52]"
                        dir="ltr"
                      />
                      {channels.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveChannel(ch.id)}
                          title="حذف القناة"
                          className="p-2 rounded-lg text-[#8F8D86] hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add custom channel */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="text"
                  value={newChannelLabel}
                  onChange={(e) => setNewChannelLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddChannel();
                    }
                  }}
                  placeholder="إضافة قناة سيولة أخرى (مثلاً: فودافون كاش / خزنة الفرع)..."
                  className="flex-1 rounded-xl border border-[#E5E3DD] bg-white px-3.5 py-2 text-xs sm:text-sm focus:outline-none focus:border-[#A67C52]"
                />
                <button
                  type="button"
                  onClick={handleAddChannel}
                  disabled={!newChannelLabel.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-[#F3F1EC] text-[#1A1A1E] hover:bg-[#E7E3DA] disabled:opacity-40 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة</span>
                </button>
              </div>
            </div>

            {/* Right: Variance & Settlement Panel */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-4">
              <div className="pb-3 border-b border-[#EFECE6]">
                <h3 className="text-base font-bold text-[#1A1A1E]">
                  ٢. نتيجة المطابقة واعتماد التسوية
                </h3>
                <p className="text-xs text-[#6E6C66] mt-0.5">
                  مقارنة فورية بين الدفتري والجرد الفعلي مع خيار ترحيل قيد التسوية تلقائياً.
                </p>
              </div>

              {/* Variance Result Box */}
              <div
                className={`rounded-2xl p-4 border-2 ${
                  cashIsMatched
                    ? 'bg-emerald-50 border-emerald-200'
                    : cashVariance < 0
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-2">
                  <span className="text-[#5C5A55]">حالة مطابقة الخزنة</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                      cashIsMatched
                        ? 'bg-emerald-200/80 text-emerald-900'
                        : cashVariance < 0
                          ? 'bg-rose-200/80 text-rose-900'
                          : 'bg-amber-200/80 text-amber-900'
                    }`}
                  >
                    {cashIsMatched ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" /> متطابق 100%
                      </>
                    ) : cashVariance < 0 ? (
                      <>
                        <ArrowDownRight className="w-3.5 h-3.5" /> عجز بالخزنة
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="w-3.5 h-3.5" /> فائض بالخزنة
                      </>
                    )}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs sm:text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#6E6C66]">الرصيد الدفتري:</span>
                    <span className="font-bold text-[#1A1A1E]">
                      {formatMoney(cashBookSummary.availableCash, currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6E6C66]">إجمالي الجرد الفعلي:</span>
                    <span className="font-bold text-[#1A1A1E]">
                      {formatMoney(actualCashTotal, currency)}
                    </span>
                  </div>
                  <div className="pt-2 mt-2 border-t border-black/10 flex justify-between items-baseline">
                    <span className="font-bold text-[#1A1A1E]">الفرق (الفعلي − الدفتري):</span>
                    <span
                      className={`text-lg font-extrabold ${
                        cashIsMatched
                          ? 'text-emerald-700'
                          : cashVariance < 0
                            ? 'text-rose-700'
                            : 'text-amber-800'
                      }`}
                      dir="ltr"
                    >
                      {cashVariance > 0 ? '+' : ''}
                      {formatMoney(cashVariance, currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reference Number & Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#5C5A55] mb-1">
                    رقم محضر الجرد
                  </label>
                  <input
                    type="text"
                    value={cashRecNumber}
                    onChange={(e) => setCashRecNumber(e.target.value)}
                    dir="ltr"
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs font-mono font-bold text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#5C5A55] mb-1">
                    طريقة الدفع للقيد
                  </label>
                  <select
                    value={cashPaymentMethod}
                    onChange={(e) => setCashPaymentMethod(e.target.value)}
                    className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs font-semibold text-[#1A1A1E] bg-white focus:outline-none focus:border-[#A67C52]"
                  >
                    {paymentMethods.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quick Reason Chips */}
              <div>
                <div className="text-xs font-semibold text-[#5C5A55] mb-1.5">
                  سبب الجرد / الملاحظات
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {CASH_REASON_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() =>
                        setCashNotes((prev) =>
                          prev.includes(chip) ? prev : prev ? `${prev} — ${chip}` : chip
                        )
                      }
                      className="text-[11px] px-2.5 py-1 rounded-full bg-[#FAF6F0] text-[#7B5A38] border border-[#E7D8C5] hover:bg-[#F2E5D3] cursor-pointer"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  value={cashNotes}
                  onChange={(e) => setCashNotes(e.target.value)}
                  placeholder="أضف تفاصيل سبب العجز أو الزيادة أو اسم أمين الخزنة..."
                  className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              {/* Auto-post Adjustment Toggle */}
              <div className="rounded-xl bg-[#FAF9F7] border border-[#EAE7E0] p-3.5 space-y-2.5">
                <label
                  className={`flex items-start gap-2.5 ${
                    isAdmin ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isAdmin && cashPostAdjustment}
                    disabled={!isAdmin || cashIsMatched}
                    onChange={(e) => setCashPostAdjustment(e.target.checked)}
                    className="mt-0.5 rounded border-[#C9C5BC] text-[#A67C52] focus:ring-[#A67C52]"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-[#1A1A1E] flex items-center gap-1.5">
                      <span>ترحيل قيد تسوية تلقائي لضبط رصيد الخزنة</span>
                      {!isAdmin && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          <Lock className="w-2.5 h-2.5" /> للمدير فقط
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#6E6C66] mt-0.5">
                      {cashIsMatched
                        ? 'الرصيد متطابق — لا حاجة لترحيل قيد تسوية.'
                        : cashVariance < 0
                          ? `سيُسجّل قيد عجز في المصروفات بقيمة ${formatMoney(Math.abs(cashVariance), currency)}.`
                          : `سيُسجّل قيد فائض جرد خزنة بقيمة ${formatMoney(cashVariance, currency)} بدون تضخيم المبيعات.`}
                    </p>
                  </div>
                </label>

                {isAdmin && cashPostAdjustment && cashVariance < 0 && (
                  <label className="flex items-start gap-2.5 pt-2 border-t border-[#EAE7E0] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cashAffectPnl}
                      onChange={(e) => setCashAffectPnl(e.target.checked)}
                      className="mt-0.5 rounded border-[#C9C5BC] text-[#A67C52] focus:ring-[#A67C52]"
                    />
                    <div className="text-[11px] text-[#5C5A55]">
                      <span className="font-bold text-[#1A1A1E]">
                        احتساب العجز ضمن مصروفات قائمة الدخل (P&amp;L)
                      </span>
                      <span className="block text-[#7A7872]">
                        إذا أزلته سيُعدّل رصيد الخزنة فقط دون التأثير على صافي الربح التشغيلي.
                      </span>
                    </div>
                  </label>
                )}
              </div>

              <button
                type="button"
                disabled={submittingCash}
                onClick={() => void handleSubmitCashReconciliation()}
                className="w-full py-3 px-4 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {submittingCash
                    ? 'جاري الاعتماد...'
                    : isAdmin && cashPostAdjustment && !cashIsMatched
                      ? 'اعتماد الجرد وترحيل قيد تسوية الخزنة'
                      : 'حفظ محضر جرد الخزنة'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: STOCK RECONCILIATION                                       */}
      {/* ================================================================= */}
      {subTab === 'stock' && (
        <div className="space-y-5">
          {/* Stock Variance KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-3.5">
              <div className="text-[11px] text-[#6E6C66] font-semibold">أصناف تم جردها</div>
              <div className="text-lg font-extrabold text-[#1A1A1E] mt-1">
                {stockStats.countedCount}{' '}
                <span className="text-xs font-normal text-[#8F8D86]">
                  / {stockStats.totalItems}
                </span>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-3.5">
              <div className="text-[11px] text-[#6E6C66] font-semibold">مطابق تماماً</div>
              <div className="text-lg font-extrabold text-emerald-700 mt-1">
                {stockStats.matchedCount}
              </div>
            </div>
            <div className="bg-rose-50/70 rounded-2xl border border-rose-200 p-3.5">
              <div className="text-[11px] text-rose-800 font-semibold">
                عجز مخزني ({stockStats.shortageCount} صنف)
              </div>
              <div className="text-base sm:text-lg font-extrabold text-rose-700 mt-1" dir="ltr">
                {formatMoney(stockStats.shortageValue, currency)}
              </div>
            </div>
            <div className="bg-emerald-50/70 rounded-2xl border border-emerald-200 p-3.5">
              <div className="text-[11px] text-emerald-800 font-semibold">
                زيادة مخزنية ({stockStats.surplusCount} صنف)
              </div>
              <div className="text-base sm:text-lg font-extrabold text-emerald-700 mt-1" dir="ltr">
                +{formatMoney(stockStats.surplusValue, currency)}
              </div>
            </div>
            <div className="col-span-2 lg:col-span-1 bg-[#FAF6F0] rounded-2xl border-2 border-[#BD956D]/50 p-3.5">
              <div className="text-[11px] text-[#7B5A38] font-bold">صافي فرق القيمة</div>
              <div
                className={`text-base sm:text-lg font-extrabold mt-1 ${
                  stockStats.netValue < 0
                    ? 'text-rose-700'
                    : stockStats.netValue > 0
                      ? 'text-emerald-700'
                      : 'text-[#1A1A1E]'
                }`}
                dir="ltr"
              >
                {stockStats.netValue > 0 ? '+' : ''}
                {formatMoney(stockStats.netValue, currency)}
              </div>
            </div>
          </div>

          {/* Scope Filter + Search + Quick Actions */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 space-y-3.5">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              {/* Scope tabs */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'الكل', icon: Boxes },
                    { id: 'fabric', label: 'الأقمشة (كسور)', icon: Layers },
                    { id: 'trim', label: 'الكلف والإكسسوارات', icon: Sparkles },
                    { id: 'finished_good', label: 'المنتج التام', icon: Shirt },
                  ] as const
                ).map((sc) => {
                  const Icon = sc.icon;
                  const active = stockScope === sc.id;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setStockScope(sc.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#1A1A1E] text-white'
                          : 'bg-[#F5F3EE] text-[#4E4C47] hover:bg-[#EAE6DD]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 text-[#BD956D]" />
                      <span>{sc.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleFillBookForVisible}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FAF6F0] text-[#8E6742] border border-[#E5D4BE] hover:bg-[#F3E8D8] cursor-pointer"
                  title="ينسخ الرصيد الدفتري لجميع الأصناف المعروضة لتعديل المختلف منها فقط"
                >
                  <CopyCheck className="w-3.5 h-3.5" />
                  <span>نسخ الدفتري للمعروض</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearStockInputs}
                  disabled={Object.keys(actualInputs).length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#F5F3EE] text-[#5C5A55] hover:bg-[#EAE6DD] disabled:opacity-40 cursor-pointer"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>مسح الإدخالات</span>
                </button>
                <button
                  type="button"
                  onClick={exportCurrentStockSheet}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1A1A1E] text-white hover:bg-[#2F2F37] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#BD956D]" />
                  <span>تصدير إكسل</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#8F8D86] absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="بحث ذكي بالاسم، الكود، اللون، المقاس، أو المورد..."
                  className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-xs sm:text-sm focus:outline-none focus:border-[#A67C52] focus:bg-white"
                />
              </div>
              <div className="flex items-center gap-3 text-xs font-semibold text-[#5C5A55]">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyCounted}
                    onChange={(e) => setOnlyCounted(e.target.checked)}
                    className="rounded border-[#C9C5BC] text-[#A67C52]"
                  />
                  <span>المُجردة فقط</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyVariances}
                    onChange={(e) => setOnlyVariances(e.target.checked)}
                    className="rounded border-[#C9C5BC] text-[#A67C52]"
                  />
                  <span>الفروق فقط</span>
                </label>
              </div>
            </div>
          </div>

          {/* Stock Count Table */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-[#FAF9F7] border-b border-[#E5E3DD] text-[11px] font-bold text-[#6E6C66]">
                    <th className="py-3 px-4">الصنف والنوع</th>
                    <th className="py-3 px-3 text-center">الرصيد الدفتري</th>
                    <th className="py-3 px-3 text-center w-44">الجرد الفعلي</th>
                    <th className="py-3 px-3 text-center">الفرق (كمية)</th>
                    <th className="py-3 px-3 text-center">تكلفة الوحدة</th>
                    <th className="py-3 px-3 text-center">فرق القيمة</th>
                    <th className="py-3 px-3 w-48">ملاحظة الصنف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EEE8] text-xs sm:text-sm">
                  {filteredStockRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#8F8D86] text-sm">
                        لا توجد أصناف مطابقة لخيارات البحث والفلترة الحالية.
                      </td>
                    </tr>
                  ) : (
                    filteredStockRows.map((row) => {
                      const isFabric = row.itemType === 'fabric';
                      return (
                        <tr
                          key={row.key}
                          className={`transition-colors ${
                            row.hasDiff
                              ? row.qtyDelta < 0
                                ? 'bg-rose-50/40'
                                : 'bg-emerald-50/40'
                              : row.hasInput
                                ? 'bg-[#FAF9F7]/70'
                                : 'hover:bg-[#FAF9F7]'
                          }`}
                        >
                          <td className="py-2.5 px-4">
                            <div className="flex items-start gap-2">
                              <span
                                className={`shrink-0 mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  row.itemType === 'fabric'
                                    ? 'bg-amber-100 text-amber-900'
                                    : row.itemType === 'trim'
                                      ? 'bg-sky-100 text-sky-900'
                                      : 'bg-purple-100 text-purple-900'
                                }`}
                              >
                                {ITEM_TYPE_LABEL[row.itemType]}
                              </span>
                              <div className="min-w-0">
                                <div className="font-bold text-[#1A1A1E] leading-snug">
                                  {row.itemName}
                                </div>
                                <div className="text-[11px] text-[#8F8D86] truncate">
                                  {row.subtitle}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <span className="font-bold text-[#1A1A1E]">
                              {formatNumber(row.systemQty, isFabric ? 3 : 0)}
                            </span>{' '}
                            <span className="text-[11px] text-[#8F8D86]">{row.unitLabel}</span>
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="flex items-center justify-center gap-1.5">
                              <input
                                type="number"
                                step={isFabric ? 'any' : '1'}
                                min={0}
                                onKeyDown={isFabric ? blockInvalidDecimalKey : blockNonIntegerKey}
                                value={row.rawInput}
                                placeholder={isFabric ? 'مثال: 4.5' : 'العدد الفعلي'}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setActualInputs((prev) => ({ ...prev, [row.key]: v }));
                                }}
                                dir="ltr"
                                className={`w-28 rounded-lg border px-2.5 py-1.5 text-xs sm:text-sm font-bold text-center focus:outline-none ${
                                  row.hasDiff
                                    ? row.qtyDelta < 0
                                      ? 'border-rose-400 bg-white text-rose-800'
                                      : 'border-emerald-400 bg-white text-emerald-800'
                                    : row.hasInput
                                      ? 'border-[#A67C52] bg-white text-[#1A1A1E]'
                                      : 'border-[#DCD9D0] bg-white text-[#1A1A1E]'
                                }`}
                              />
                              <button
                                type="button"
                                title="نسخ الدفتري"
                                onClick={() =>
                                  setActualInputs((prev) => ({
                                    ...prev,
                                    [row.key]: String(row.systemQty),
                                  }))
                                }
                                className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-[#F3F1EC] text-[#6E6C66] hover:bg-[#E7E3DA] cursor-pointer"
                              >
                                =
                              </button>
                            </div>
                          </td>

                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            {!row.hasInput ? (
                              <span className="text-[#B8B5AD] text-xs">—</span>
                            ) : !row.hasDiff ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                                <CheckCircle2 className="w-3 h-3" /> مطابق
                              </span>
                            ) : (
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                                  row.qtyDelta < 0
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                                dir="ltr"
                              >
                                {row.qtyDelta > 0 ? '+' : ''}
                                {formatNumber(row.qtyDelta, isFabric ? 3 : 0)} {row.unitLabel}
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-3 text-center whitespace-nowrap text-xs text-[#6E6C66]">
                            {formatMoney(row.unitCost, currency)}
                          </td>

                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            {!row.hasInput ? (
                              <span className="text-[#B8B5AD] text-xs">—</span>
                            ) : (
                              <span
                                className={`font-bold text-xs ${
                                  row.valueDelta < 0
                                    ? 'text-rose-700'
                                    : row.valueDelta > 0
                                      ? 'text-emerald-700'
                                      : 'text-[#6E6C66]'
                                }`}
                                dir="ltr"
                              >
                                {row.valueDelta > 0 ? '+' : ''}
                                {formatMoney(row.valueDelta, currency)}
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              value={lineNotes[row.key] || ''}
                              onChange={(e) =>
                                setLineNotes((prev) => ({
                                  ...prev,
                                  [row.key]: e.target.value,
                                }))
                              }
                              placeholder="تالف / هالك / مرتجع..."
                              className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stock Reconciliation Submission Bar */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-[#5C5A55] mb-1">
                  رقم محضر جرد المخزون
                </label>
                <input
                  type="text"
                  value={stockRecNumber}
                  onChange={(e) => setStockRecNumber(e.target.value)}
                  dir="ltr"
                  className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs font-mono font-bold text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="lg:col-span-5">
                <label className="block text-xs font-semibold text-[#5C5A55] mb-1">
                  ملاحظات الجرد العامة
                </label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {STOCK_REASON_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() =>
                        setStockNotes((prev) =>
                          prev.includes(chip) ? prev : prev ? `${prev} — ${chip}` : chip
                        )
                      }
                      className="text-[11px] px-2 py-0.5 rounded-full bg-[#FAF6F0] text-[#7B5A38] border border-[#E7D8C5] hover:bg-[#F2E5D3] cursor-pointer"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={stockNotes}
                  onChange={(e) => setStockNotes(e.target.value)}
                  placeholder="مثال: جرد نهاية الشهر بمشاركة مسؤول المخزن..."
                  className="w-full rounded-xl border border-[#E5E3DD] px-3 py-2 text-xs focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="lg:col-span-4 space-y-3">
                <label
                  className={`flex items-start gap-2.5 p-3 rounded-xl bg-[#FAF9F7] border border-[#EAE7E0] ${
                    isAdmin ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isAdmin && stockPostAdjustments}
                    disabled={!isAdmin}
                    onChange={(e) => setStockPostAdjustments(e.target.checked)}
                    className="mt-0.5 rounded border-[#C9C5BC] text-[#A67C52]"
                  />
                  <div className="text-xs">
                    <div className="font-bold text-[#1A1A1E] flex items-center gap-1.5">
                      <span>تعديل أرصدة المخزون فعلياً</span>
                      {!isAdmin && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          <Lock className="w-2.5 h-2.5" /> للمدير فقط
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#6E6C66] mt-0.5">
                      تحديث الكميات وتسجيل حركات تسوية جرد ({stockStats.adjustedRows.length} صنف
                      مختلف).
                    </p>
                  </div>
                </label>

                <button
                  type="button"
                  disabled={submittingStock || stockStats.countedCount === 0}
                  onClick={() => void handleSubmitStockReconciliation()}
                  className="w-full py-3 px-4 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-45 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Scale className="w-4 h-4" />
                  <span>
                    {submittingStock
                      ? 'جاري الاعتماد...'
                      : isAdmin && stockPostAdjustments && stockStats.adjustedRows.length > 0
                        ? `اعتماد وتعديل (${stockStats.adjustedRows.length}) صنف`
                        : `حفظ محضر الجرد (${stockStats.countedCount} صنف)`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: RECONCILIATION HISTORY                                     */}
      {/* ================================================================= */}
      {subTab === 'history' && (
        <div className="space-y-4">
          {missingCloudTable && cloudConnected && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-900">
              <Database className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold">ملاحظة:</span> تعديلات الخزنة والمخزون تعمل بالفعل
                مباشرةً على السحابة. لحفظ <strong>سجل محاضر الجرد التاريخي</strong> على السحابة
                وتفعيل الـ RPC الذري، نفّذ ملف التحديث{' '}
                <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">
                  022_cash_and_stock_reconciliation.sql
                </code>{' '}
                في Supabase SQL Editor (حالياً يتم عرض السجل المحلي المحفوظ في هذا المتصفح).
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'الكل' },
                  { id: 'cash', label: 'جرد الخزنة' },
                  { id: 'stock', label: 'جرد المخزون' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setHistoryFilter(f.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
                    historyFilter === f.id
                      ? 'bg-[#1A1A1E] text-white'
                      : 'bg-[#F5F3EE] text-[#5C5A55] hover:bg-[#EAE6DD]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#8F8D86] absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="بحث برقم المحضر، الملاحظات، أو اسم القائم بالجرد..."
                className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-xs sm:text-sm focus:outline-none focus:border-[#A67C52] focus:bg-white"
              />
            </div>

            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={loadingHistory}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#FAF6F0] text-[#8E6742] border border-[#E5D4BE] hover:bg-[#F3E8D8] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
          </div>

          {/* Session Cards */}
          {filteredHistory.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E5E3DD] p-12 text-center">
              <Scale className="w-10 h-10 text-[#C5C1B8] mx-auto mb-3" />
              <div className="text-sm font-bold text-[#1A1A1E]">
                لا توجد محاضر جرد مسجلة حتى الآن
              </div>
              <p className="text-xs text-[#8F8D86] mt-1">
                ابدأ بأول جرد للخزنة أو المخزون من التبويبات بالأعلى ليظهر هنا بالتفصيل الكامل.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredHistory.map((session) => {
                const isExpanded = expandedSessionId === session.id;
                const isCash = session.recType === 'cash';
                const isMatched = Math.abs(session.varianceValue) < 0.01;
                return (
                  <div
                    key={session.id}
                    className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden"
                  >
                    <div className="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                              isCash
                                ? 'bg-emerald-100 text-emerald-900'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            {isCash ? (
                              <>
                                <Wallet className="w-3 h-3" /> جرد خزنة
                              </>
                            ) : (
                              <>
                                <Boxes className="w-3 h-3" />{' '}
                                {SCOPE_LABEL[session.stockScope || 'all'] || 'جرد مخزون'}
                              </>
                            )}
                          </span>
                          <span className="font-mono text-xs font-extrabold text-[#1A1A1E]">
                            {session.reconciliationNumber}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              session.adjustmentPosted
                                ? 'bg-[#1A1A1E] text-[#E5C199]'
                                : 'bg-[#F3F1EC] text-[#6E6C66]'
                            }`}
                          >
                            {session.adjustmentPosted ? 'تم ترحيل التسوية' : 'محضر جرد فقط'}
                          </span>
                          {session.source === 'local' && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              محلي
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#6E6C66] flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{formatDateTimeAr(session.reconciledAt)}</span>
                          {(session.actorName || session.actorEmail) && (
                            <span>
                              بواسطة:{' '}
                              <strong className="text-[#1A1A1E]">
                                {session.actorName || formatDisplayIdentifier(session.actorEmail)}
                              </strong>
                            </span>
                          )}
                          <span>
                            {isCash
                              ? `${session.itemsCounted} قنوات`
                              : `${session.itemsCounted} صنف (تعديل ${session.itemsAdjusted})`}
                          </span>
                        </div>
                        {session.notes && (
                          <p className="text-xs text-[#5C5A55] bg-[#FAF9F7] rounded-lg px-2.5 py-1 inline-block mt-1">
                            {session.notes}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="grid grid-cols-3 gap-3 text-center bg-[#FAF9F7] rounded-xl px-3.5 py-2 border border-[#EFECE6]">
                          <div>
                            <div className="text-[10px] text-[#8F8D86]">الدفتري</div>
                            <div className="text-xs font-bold text-[#1A1A1E]">
                              {formatMoney(session.systemValue, currency)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[#8F8D86]">الفعلي</div>
                            <div className="text-xs font-bold text-[#1A1A1E]">
                              {formatMoney(session.actualValue, currency)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[#8F8D86]">الفرق</div>
                            <div
                              className={`text-xs font-extrabold ${
                                isMatched
                                  ? 'text-emerald-700'
                                  : session.varianceValue < 0
                                    ? 'text-rose-700'
                                    : 'text-emerald-700'
                              }`}
                              dir="ltr"
                            >
                              {session.varianceValue > 0 ? '+' : ''}
                              {formatMoney(session.varianceValue, currency)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => exportHistorySession(session)}
                            title="تصدير المحضر إكسل"
                            className="p-2 rounded-xl border border-[#E5E3DD] text-[#1A1A1E] hover:bg-[#FAF6F0] cursor-pointer"
                          >
                            <Download className="w-4 h-4 text-[#A67C52]" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSessionId((cur) =>
                                cur === session.id ? null : session.id
                              )
                            }
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-[#F5F3EE] hover:bg-[#EAE6DD] text-xs font-bold text-[#1A1A1E] cursor-pointer"
                          >
                            <span>التفاصيل</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-[#EFECE6] bg-[#FAF9F7] p-4">
                        {isCash ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                            {(session.details as CashChannelCount[]).map((ch) => (
                              <div
                                key={ch.id || ch.label}
                                className="bg-white rounded-xl border border-[#E5E3DD] p-3 flex items-center justify-between"
                              >
                                <span className="text-xs font-semibold text-[#5C5A55]">
                                  {ch.label}
                                </span>
                                <span className="text-xs font-extrabold text-[#1A1A1E]">
                                  {formatMoney(ch.amount, currency)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="overflow-x-auto bg-white rounded-xl border border-[#E5E3DD]">
                            <table className="w-full text-right text-xs">
                              <thead>
                                <tr className="bg-[#FAF9F7] border-b border-[#E5E3DD] text-[#6E6C66]">
                                  <th className="py-2 px-3">النوع</th>
                                  <th className="py-2 px-3">الصنف</th>
                                  <th className="py-2 px-3 text-center">الدفتري</th>
                                  <th className="py-2 px-3 text-center">الفعلي</th>
                                  <th className="py-2 px-3 text-center">الفرق</th>
                                  <th className="py-2 px-3 text-center">فرق القيمة</th>
                                  <th className="py-2 px-3">ملاحظة</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#F0EEE8]">
                                {(session.details as StockReconciliationLine[]).map((l, idx) => (
                                  <tr key={`${l.itemId}-${idx}`}>
                                    <td className="py-2 px-3">
                                      {ITEM_TYPE_LABEL[l.itemType] || l.itemType}
                                    </td>
                                    <td className="py-2 px-3 font-bold text-[#1A1A1E]">
                                      {l.itemName}
                                    </td>
                                    <td className="py-2 px-3 text-center">
                                      {formatNumber(l.systemQty, l.itemType === 'fabric' ? 3 : 0)}{' '}
                                      {l.unitLabel}
                                    </td>
                                    <td className="py-2 px-3 text-center font-bold">
                                      {formatNumber(l.actualQty, l.itemType === 'fabric' ? 3 : 0)}{' '}
                                      {l.unitLabel}
                                    </td>
                                    <td
                                      className={`py-2 px-3 text-center font-extrabold ${
                                        l.qtyDelta < 0
                                          ? 'text-rose-700'
                                          : l.qtyDelta > 0
                                            ? 'text-emerald-700'
                                            : 'text-[#6E6C66]'
                                      }`}
                                      dir="ltr"
                                    >
                                      {l.qtyDelta > 0 ? '+' : ''}
                                      {formatNumber(l.qtyDelta, l.itemType === 'fabric' ? 3 : 0)}
                                    </td>
                                    <td
                                      className={`py-2 px-3 text-center font-bold ${
                                        l.valueDelta < 0
                                          ? 'text-rose-700'
                                          : l.valueDelta > 0
                                            ? 'text-emerald-700'
                                            : 'text-[#6E6C66]'
                                      }`}
                                      dir="ltr"
                                    >
                                      {l.valueDelta > 0 ? '+' : ''}
                                      {formatMoney(l.valueDelta, currency)}
                                    </td>
                                    <td className="py-2 px-3 text-[#6E6C66]">{l.note || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
