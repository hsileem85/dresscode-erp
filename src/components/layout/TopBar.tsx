import React from 'react';
import { CheckCircle2, Database, Download, Menu, RefreshCw } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { NavTab } from '../../types/erp';
import { exportFullERPToExcel } from '../../utils/excel';

interface TopBarProps {
  onOpenMobile: () => void;
}

const PAGE_META: Record<NavTab, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'لوحة التحكم ومؤشرات التكلفة',
    subtitle: 'متابعة فورية لهيكل تكاليف الموديلات وهوامش الربح لمجموعة DressCode',
  },
  materials: {
    title: 'إدارة الخامات والكلف والإكسسوارات',
    subtitle: 'قاعدة بيانات الأقمشة بنسب الهالك وتحويل وحدات الكلف (دستة / لفة / عبوة ← قطعة)',
  },
  models: {
    title: 'الموديلات وبطاقة التكلفة (BOM)',
    subtitle: 'تصميم بطاقة تكلفة كل موديل باستهلاك الأقمشة والكلف ومراحل التشغيل الخارجي',
  },
  labor: {
    title: 'التشغيل الخارجي والورش',
    subtitle: 'إدارة أسعار القص والخياطة والسرفلة والكي والتطريز بالقطعة أو بالباتش',
  },
  calculator: {
    title: 'حاسبة التكلفة والتسعير والمصاريف غير المباشرة',
    subtitle: 'توزيع المصاريف الشهرية على حجم الإنتاج ومحاكاة سعر البيع وهامش الربح',
  },
  purchases: {
    title: 'المشتريات ومخزن الخامات',
    subtitle: 'إصدار واستلام أوامر شراء الأقمشة والكلف وتحديث متوسط التكلفة المرجّح تلقائياً',
  },
  production: {
    title: 'أوامر التصنيع ومخزون المنتج التام',
    subtitle: 'صرف الخامات للتشغيلات وإتمام الإنتاج واستلام القطع حسب اللون والمقاس',
  },
  sales: {
    title: 'المبيعات والأرباح وسجل حركة المخزون',
    subtitle: 'تسجيل فواتير المتجر والجملة وخصم المخزون وحساب مجمل الربح الفعلي',
  },
  excel: {
    title: 'الاستيراد الذكي والتصدير (Excel & JSON)',
    subtitle: 'ارفع شيت الإكسل الحالي واربط الأعمدة بسهولة أو صدّر تقارير DressCode الكاملة',
  },
};

export const TopBar: React.FC<TopBarProps> = ({ onOpenMobile }) => {
  const { activeTab, state, lastSavedAt, cloudConnected, syncing, refreshFromCloud } =
    useERP();
  const meta = PAGE_META[activeTab];

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-[#E5E3DD] px-4 sm:px-6 lg:px-8 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobile}
            aria-label="فتح القائمة"
            className="lg:hidden p-2 rounded-xl border border-[#E5E3DD] text-[#1A1A1E] hover:bg-[#F3F2EE]"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[#1A1A1E] truncate">
              {meta.title}
            </h1>
            <p className="text-xs text-[#6E6C66] truncate mt-0.5 hidden sm:block">
              {meta.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {cloudConnected ? (
            <button
              type="button"
              onClick={() => void refreshFromCloud()}
              className="hidden md:inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-emerald-100"
              title="مزامنة فورية مع PostgreSQL"
            >
              {syncing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-700" />
              ) : (
                <Database className="w-3.5 h-3.5 text-emerald-700" />
              )}
              <span>{syncing ? 'جاري المزامنة...' : `PostgreSQL • ${lastSavedAt}`}</span>
            </button>
          ) : (
            <div
              className="hidden md:flex items-center gap-1.5 text-xs text-[#6E6C66] bg-[#FAF9F7] border border-[#E5E3DD] rounded-lg px-3 py-1.5"
              title="يتم حفظ التعديلات محلياً في المتصفح"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[#A67C52]" />
              <span>حفظ محلي • {lastSavedAt}</span>
            </div>
          )}

          <button
            id="quick-export-excel"
            type="button"
            onClick={() => exportFullERPToExcel(state)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs sm:text-sm font-medium px-3.5 py-2 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#BD956D]" />
            <span className="hidden sm:inline">تصدير إكسل</span>
          </button>
        </div>
      </div>
    </header>
  );
};
