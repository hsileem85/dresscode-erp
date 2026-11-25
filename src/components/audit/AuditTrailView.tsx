import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useConfirm } from '../common/ConfirmDialog';
import { useERP } from '../../context/ERPContext';
import { erpDb } from '../../lib/supabase';
import type { AuditAction, AuditLogEntry, AuditLogStats } from '../../types/erp';
import { formatNumber } from '../../utils/calculations';

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'كل الأقسام والجداول' },
  { value: 'sales_orders', label: 'أوامر البيع' },
  { value: 'purchase_orders', label: 'أوامر الشراء' },
  { value: 'production_orders', label: 'أوامر التصنيع' },
  { value: 'production_workshop_logs', label: 'حركات ودفعات الورش' },
  { value: 'expenses', label: 'المصروفات' },
  { value: 'partner_contributions', label: 'مساهمات الشركاء' },
  { value: 'financial_transactions', label: 'الحركات المالية' },
  { value: 'fabrics', label: 'الأقمشة' },
  { value: 'trims', label: 'الكلف والمستلزمات' },
  { value: 'models', label: 'الموديلات (BOM)' },
  { value: 'model_variants', label: 'المقاسات والمنتج التام' },
  { value: 'outsourced_operations', label: 'التشغيل الخارجي' },
  { value: 'customers', label: 'العملاء' },
  { value: 'suppliers', label: 'الموردين' },
  { value: 'workshops', label: 'الورش' },
  { value: 'overhead_items', label: 'المصاريف غير المباشرة' },
  { value: 'app_settings', label: 'إعدادات النظام' },
];

const FIELD_LABELS: Record<string, string> = {
  status: 'الحالة',
  fulfillment_status: 'حالة التسليم',
  payment_status: 'حالة الدفع',
  total_amount: 'الإجمالي',
  paid_amount: 'المبلغ المدفوع',
  remaining_debt: 'المتبقي',
  discount_amount: 'الخصم',
  shipping_fee: 'الشحن',
  shipping_cost: 'مصاريف الشحن',
  stock_qty: 'الرصيد بالمخزن',
  finished_goods_qty: 'مخزون المنتج التام',
  price_per_unit: 'سعر الوحدة (WAC)',
  pack_price: 'سعر العبوة',
  units_per_pack: 'عدد الوحدات بالعبوة',
  target_margin_pct: 'نسبة الإضافة (Markup %)',
  actual_retail_price: 'سعر البيع الفعلي',
  retail_price: 'سعر البيع',
  unit_cogs: 'تكلفة القطعة (COGS)',
  planned_qty: 'الكمية المخططة',
  completed_qty: 'الكمية المكتملة',
  agreed_labor_total: 'إجمالي أجر الورشة',
  paid_to_workshop: 'المدفوع للورشة',
  balance_payable: 'الرصيد المستحق',
  amount: 'المبلغ',
  name: 'الاسم',
  supplier_name: 'المورد',
  customer_name: 'العميل',
  workshop_name: 'الورشة',
  po_number: 'رقم أمر الشراء',
  order_number: 'رقم الطلب',
  batch_number: 'رقم التشغيلة',
  sku: 'كود الموديل',
  variant_sku: 'كود الصنف',
  category: 'التصنيف',
  supply_group: 'قسم المستلزمات',
  notes: 'ملاحظات',
  received_at: 'تاريخ الاستلام',
  labor_cost: 'تكلفة التشغيل',
  currency: 'العملة',
};

const ACTION_META: Record<AuditAction, { label: string; badgeClass: string }> = {
  INSERT: { label: 'إضافة', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  UPDATE: { label: 'تعديل', badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200' },
  DELETE: { label: 'حذف', badgeClass: 'bg-red-50 text-red-700 border border-red-200' },
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function isDiffEntry(val: unknown): val is { old: unknown; new: unknown } {
  return (
    typeof val === 'object' &&
    val !== null &&
    'old' in (val as Record<string, unknown>) &&
    'new' in (val as Record<string, unknown>)
  );
}

const PAGE_SIZE = 50;

export const AuditTrailView: React.FC = () => {
  const { cloudConnected } = useERP();
  const confirmAction = useConfirm();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [missingMigration, setMissingMigration] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Filters
  const [monthFilter, setMonthFilter] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditAction | ''>('');
  const [searchFilter, setSearchFilter] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyMonth, setBusyMonth] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!cloudConnected) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [logsRes, statsRes] = await Promise.all([
        erpDb.fetchAuditLogs({
          month: monthFilter || undefined,
          tableName: tableFilter || undefined,
          action: actionFilter || undefined,
          search: searchFilter || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        erpDb.getAuditLogStats(),
      ]);

      if (logsRes.missingMigration || statsRes.missingMigration) {
        setMissingMigration(true);
        setLogs([]);
        setStats(null);
        setTotalCount(0);
      } else {
        setMissingMigration(false);
        setLogs(logsRes.rows);
        setTotalCount(logsRes.totalCount);
        setStats(statsRes.stats);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذّر تحميل سجل التدقيق');
    } finally {
      setLoading(false);
    }
  }, [cloudConnected, monthFilter, tableFilter, actionFilter, searchFilter, page]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await loadData();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadData]);

  const handleExportMonthExcel = async (month: string) => {
    setBusyMonth(month);
    setErrorMsg(null);
    try {
      const rows = await erpDb.fetchAllAuditLogsForMonth(month);
      if (rows.length === 0) {
        setFeedbackMsg(`لا توجد سجلات لتصديرها لشهر ${month}.`);
        return;
      }
      const ws = XLSX.utils.json_to_sheet(
        rows.map((r) => ({
          'رقم السجل': r.id,
          'التوقيت': formatDateTime(r.occurredAt),
          'الشهر': r.logMonth,
          'المستخدم': r.actorName,
          'البريد الإلكتروني': r.actorEmail,
          'العملية': ACTION_META[r.action]?.label || r.action,
          'القسم': r.entityLabel,
          'الجدول': r.tableName,
          'الملخص': r.recordSummary,
          'التغييرات (JSON)': r.changedFields ? JSON.stringify(r.changedFields) : '',
        }))
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Audit_${month}`);
      XLSX.writeFile(wb, `DressCode_Audit_Archive_${month}.xlsx`);
      setFeedbackMsg(`تم تصدير ${rows.length} سجل لشهر ${month} إلى ملف Excel بنجاح.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل تصدير ملف Excel');
    } finally {
      setBusyMonth(null);
    }
  };

  const handleExportMonthJson = async (month: string) => {
    setBusyMonth(month);
    setErrorMsg(null);
    try {
      const rows = await erpDb.fetchAllAuditLogsForMonth(month);
      if (rows.length === 0) {
        setFeedbackMsg(`لا توجد سجلات لتصديرها لشهر ${month}.`);
        return;
      }
      const payload = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          month,
          rowCount: rows.length,
          rows,
        },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DressCode_Audit_Archive_${month}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedbackMsg(`تم تحميل أرشيف JSON لشهر ${month} (${rows.length} سجل).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل تصدير ملف JSON');
    } finally {
      setBusyMonth(null);
    }
  };

  const handlePurgeMonth = async (month: string, rowCount: number) => {
    const ok = await confirmAction({
      title: `تأكيد تفريغ سجل شهر ${month}`,
      message: `هل قمت بتصدير أرشيف شهر ${month} (${rowCount} سجل) وترغب في حذفه من قاعدة البيانات لتوفير المساحة؟`,
      detail:
        'يُفضّل الضغط على «تصدير Excel» أو «تصدير JSON» أولاً قبل التفريغ. هذه العملية تحذف سجلات التدقيق لهذا الشهر فقط ولا تؤثر على الفواتير أو المخزون أو الحسابات.',
      confirmLabel: `نعم، تفريغ شهر ${month}`,
      tone: 'warning',
    });
    if (!ok) return;

    setBusyMonth(month);
    setErrorMsg(null);
    try {
      const deleted = await erpDb.purgeAuditLogsForMonth(month);
      setFeedbackMsg(`تم تفريغ ${deleted} سجل من شهر ${month} وتوفير المساحة بقاعدة البيانات.`);
      if (monthFilter === month) setMonthFilter('');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل تفريغ سجلات الشهر');
    } finally {
      setBusyMonth(null);
    }
  };

  const dbUsagePct = stats ? Math.min(100, (stats.dbTotalMb / Math.max(stats.dbLimitMb, 1)) * 100) : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (!cloudConnected) {
    return (
      <div className="bg-white rounded-2xl border border-[#E5E3DD] p-8 text-center space-y-3">
        <ShieldCheck className="w-10 h-10 text-[#A67C52] mx-auto" />
        <h2 className="text-base font-bold text-[#1A1A1E]">
          سجل التدقيق متاح عند الاتصال بالسحابة (PostgreSQL / Supabase)
        </h2>
        <p className="text-xs text-[#6E6C66] max-w-md mx-auto leading-relaxed">
          يعمل سجل التدقيق تلقائياً عبر مشغّلات قاعدة البيانات (PostgreSQL Triggers) لتسجيل اسم
          المستخدم المسجل والتوقيت الدقيق لكل عملية إضافة أو تعديل أو حذف. سجّل الدخول بحساب
          DressCode ERP لتفعيل المتابعة والأرشفة الشهرية.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Missing Migration 018 Banner */}
      {missingMigration && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 sm:p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <Database className="w-4 h-4 text-amber-700 shrink-0" />
            <span>مطلوب تشغيل ملف تفعيل سجل التدقيق والأرشفة في Supabase</span>
          </div>
          <p className="text-xs text-amber-900/90 leading-relaxed">
            لتفعيل التسجيل التلقائي لجميع العمليات (من قام بالإضافة/التعديل/الحذف ومتى وما الذي
            تغيّر) ومراقبة مساحة الـ 500 MB والأرشفة الشهرية، نفّذ ملف التحديث{' '}
            <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded font-bold">
              supabase/migrations/018_audit_trail_and_archiving.sql
            </code>{' '}
            مرة واحدة في <strong>Supabase SQL Editor</strong> ثم اضغط «تحديث».
          </p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#1A1A1E] text-white text-xs font-bold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة الفحص الآن</span>
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-xs font-semibold text-red-800">
          {errorMsg}
        </div>
      )}

      {feedbackMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-semibold text-emerald-800 flex items-center justify-between gap-2">
          <span>{feedbackMsg}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-emerald-700 underline text-[11px] cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Storage Monitor (500 MB Limit) + Monthly Archive Controls */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* DB Storage Gauge */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#A67C52]" />
                <h2 className="text-sm font-bold text-[#1A1A1E]">
                  مساحة قاعدة البيانات (حد 500 MB)
                </h2>
              </div>
              <span
                className={`text-xs font-extrabold tabular-nums px-2 py-0.5 rounded-full ${
                  dbUsagePct >= 80
                    ? 'bg-red-100 text-red-700'
                    : dbUsagePct >= 60
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {formatNumber(dbUsagePct, 1)}% مستخدم
              </span>
            </div>

            <div className="w-full h-3 rounded-full bg-[#F0EFEA] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  dbUsagePct >= 80
                    ? 'bg-red-600'
                    : dbUsagePct >= 60
                      ? 'bg-amber-500'
                      : 'bg-[#3D6B59]'
                }`}
                style={{ width: `${Math.max(2, dbUsagePct)}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="rounded-xl bg-[#FAF9F7] border border-[#EAE8E2] p-2.5">
                <div className="text-[10px] text-[#6E6C66]">حجم القاعدة الكلي</div>
                <div className="text-sm font-extrabold text-[#1A1A1E] tabular-nums mt-0.5">
                  {stats.dbTotalMb} MB
                </div>
              </div>
              <div className="rounded-xl bg-[#FAF9F7] border border-[#EAE8E2] p-2.5">
                <div className="text-[10px] text-[#6E6C66]">حجم سجل التدقيق</div>
                <div className="text-sm font-extrabold text-[#8E6742] tabular-nums mt-0.5">
                  {stats.auditTableMb} MB
                </div>
              </div>
              <div className="rounded-xl bg-[#FAF9F7] border border-[#EAE8E2] p-2.5">
                <div className="text-[10px] text-[#6E6C66]">إجمالي السجلات</div>
                <div className="text-sm font-extrabold text-[#1A1A1E] tabular-nums mt-0.5">
                  {formatNumber(stats.totalRows, 0)}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#6E6C66] leading-relaxed">
              يتم حفظ الفروقات المتغيرة فقط (Diff-Only) لتقليل المساحة، مع أرشفة شهرية آلية في
              مستودع <code className="font-mono text-[#1A1A1E]">dresscode-erp-backups</code> أول
              كل شهر وتفريغ السجل المؤرشف للحفاظ على المساحة أقل من 500 MB.
            </p>
          </div>

          {/* Monthly Archive Table */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-[#A67C52]" />
                <h2 className="text-sm font-bold text-[#1A1A1E]">
                  الأرشفة الشهرية وتفريغ السجلات القديمة
                </h2>
              </div>
              <span className="text-[11px] text-[#6E6C66]">
                {stats.months.length} شهر متاح بالقاعدة
              </span>
            </div>

            {stats.months.length > 0 ? (
              <div className="overflow-x-auto max-h-52 overflow-y-auto rounded-xl border border-[#EAE8E2]">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD] sticky top-0">
                    <tr>
                      <th className="py-2 px-3">الشهر</th>
                      <th className="py-2 px-3 text-center">عدد الحركات</th>
                      <th className="py-2 px-3">إجراءات الأرشفة والتفريغ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {stats.months.map((m) => {
                      const isBusy = busyMonth === m.month;
                      return (
                        <tr key={m.month} className="hover:bg-[#FAF9F7]">
                          <td className="py-2 px-3 font-mono font-bold text-[#1A1A1E]">
                            {m.month}
                          </td>
                          <td className="py-2 px-3 text-center font-bold tabular-nums">
                            {formatNumber(m.rowCount, 0)}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleExportMonthExcel(m.month)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F6EFE7] hover:bg-[#EDE0D1] text-[#8E6742] text-[11px] font-bold cursor-pointer disabled:opacity-50"
                              >
                                <FileSpreadsheet className="w-3 h-3" />
                                <span>Excel</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleExportMonthJson(m.month)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F3F2EE] hover:bg-[#E5E3DD] text-[#1A1A1E] text-[11px] font-bold cursor-pointer disabled:opacity-50"
                              >
                                <FileJson className="w-3 h-3" />
                                <span>JSON</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handlePurgeMonth(m.month, m.rowCount)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>تفريغ الشهر</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl bg-[#FAF9F7] border border-[#EAE8E2] p-6 text-center text-xs text-[#6E6C66]">
                لا توجد سجلات تدقيق مسجلة بعد — ستظهر هنا تلقائياً مع أول عملية إضافة أو تعديل أو
                حذف.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters & Search Bar */}
      {!missingMigration && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#A67C52]" />
              <h2 className="text-sm font-bold text-[#1A1A1E]">
                سجل حركات النظام ({formatNumber(totalCount, 0)} سجل)
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {monthFilter && (
                <button
                  type="button"
                  onClick={() => void handleExportMonthExcel(monthFilter)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير {monthFilter}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadData()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3F2EE] hover:bg-[#E5E3DD] text-[#1A1A1E] text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#9C9990] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => {
                  setSearchFilter(e.target.value);
                  setPage(0);
                }}
                placeholder="بحث بالملخص أو البريد الإلكتروني..."
                className="w-full rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-xs focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <select
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setPage(0);
              }}
              className="rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] px-3 py-2 text-xs font-semibold focus:outline-none focus:border-[#A67C52]"
            >
              <option value="">كل الأشهر</option>
              {(stats?.months || []).map((m) => (
                <option key={m.month} value={m.month}>
                  {m.month} ({m.rowCount} حركة)
                </option>
              ))}
            </select>

            <select
              value={tableFilter}
              onChange={(e) => {
                setTableFilter(e.target.value);
                setPage(0);
              }}
              className="rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] px-3 py-2 text-xs font-semibold focus:outline-none focus:border-[#A67C52]"
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value as AuditAction | '');
                setPage(0);
              }}
              className="rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] px-3 py-2 text-xs font-semibold focus:outline-none focus:border-[#A67C52]"
            >
              <option value="">كل العمليات (إضافة / تعديل / حذف)</option>
              <option value="INSERT">إضافة فقط</option>
              <option value="UPDATE">تعديل فقط</option>
              <option value="DELETE">حذف فقط</option>
            </select>
          </div>

          {/* Audit Log Entries List */}
          <div className="divide-y divide-[#F0EFEA] border border-[#E5E3DD] rounded-xl overflow-hidden">
            {logs.map((entry) => {
              const meta = ACTION_META[entry.action] || ACTION_META.UPDATE;
              const isExpanded = expandedId === entry.id;
              const fieldEntries = entry.changedFields ? Object.entries(entry.changedFields) : [];

              return (
                <div key={entry.id} className="bg-white hover:bg-[#FAF9F7]/70 transition-colors">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="w-full text-right p-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-[#1A1A1E]">
                            {entry.entityLabel}
                          </span>
                          <span className="text-xs text-[#4B4A46] truncate">
                            — {entry.recordSummary || entry.recordId || '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-[#6E6C66]">
                          <span className="inline-flex items-center gap-1 font-semibold text-[#8E6742]">
                            <UserIcon className="w-3 h-3" />
                            <span>{entry.actorName}</span>
                            {entry.actorEmail && entry.actorEmail !== entry.actorName && (
                              <span className="text-[#6E6C66] font-normal">
                                ({entry.actorEmail})
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums">{formatDateTime(entry.occurredAt)}</span>
                          {fieldEntries.length > 0 && (
                            <span className="text-[10px] bg-[#F3F2EE] text-[#4B4A46] px-1.5 py-0.5 rounded">
                              {fieldEntries.length} حقل
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <span className="text-[#9C9990] shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </span>
                  </button>

                  {isExpanded && fieldEntries.length > 0 && (
                    <div className="px-4 pb-3.5 pt-1 bg-[#FAF9F7] border-t border-[#EFECE6]">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {fieldEntries.map(([key, val]) => {
                          const label = FIELD_LABELS[key] || key;
                          return (
                            <div
                              key={key}
                              className="rounded-lg bg-white border border-[#EAE8E2] px-2.5 py-2 text-[11px]"
                            >
                              <div className="font-bold text-[#6E6C66] mb-0.5">{label}</div>
                              {isDiffEntry(val) ? (
                                <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                                  <span className="line-through text-red-600/90">
                                    {formatCellValue(val.old)}
                                  </span>
                                  <span className="text-[#9C9990]">←</span>
                                  <span className="font-bold text-emerald-700">
                                    {formatCellValue(val.new)}
                                  </span>
                                </div>
                              ) : (
                                <div className="font-semibold text-[#1A1A1E] break-all tabular-nums">
                                  {formatCellValue(val)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && logs.length === 0 && (
              <div className="p-10 text-center text-xs text-[#6E6C66]">
                لا توجد سجلات تدقيق مطابقة لمعايير البحث الحالية.
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2 text-xs">
              <span className="text-[#6E6C66] tabular-nums">
                صفحة {page + 1} من {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page === 0 || loading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-[#E5E3DD] bg-white hover:bg-[#FAF9F7] font-semibold cursor-pointer disabled:opacity-40"
                >
                  السابق
                </button>
                <button
                  type="button"
                  disabled={page + 1 >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-[#E5E3DD] bg-white hover:bg-[#FAF9F7] font-semibold cursor-pointer disabled:opacity-40"
                >
                  التالي
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
