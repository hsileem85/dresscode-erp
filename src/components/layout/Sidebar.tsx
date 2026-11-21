import React from 'react';
import {
  Calculator,
  FileSpreadsheet,
  Hammer,
  Layers,
  LayoutDashboard,
  Scissors,
  X,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { CURRENCIES } from '../../types/erp';
import type { CurrencyCode, NavTab } from '../../types/erp';

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: {
  id: NavTab;
  label: string;
  sublabel: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  {
    id: 'dashboard',
    label: 'لوحة التحكم',
    sublabel: 'نظرة عامة ومؤشرات التكلفة',
    icon: LayoutDashboard,
  },
  {
    id: 'materials',
    label: 'الخامات والكلف',
    sublabel: 'الأقمشة والإكسسوارات والوحدات',
    icon: Layers,
  },
  {
    id: 'models',
    label: 'الموديلات والباترون',
    sublabel: 'بطاقة تكلفة الموديل (BOM)',
    icon: Scissors,
  },
  {
    id: 'labor',
    label: 'التشغيل الخارجي',
    sublabel: 'الورش ومراحل التصنيع',
    icon: Hammer,
  },
  {
    id: 'calculator',
    label: 'حاسبة التكلفة والتسعير',
    sublabel: 'المصاريف غير المباشرة والربح',
    icon: Calculator,
  },
  {
    id: 'excel',
    label: 'استيراد وتصدير إكسل',
    sublabel: 'ملفات .xlsx ونسخ احتياطي',
    icon: FileSpreadsheet,
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const { activeTab, setActiveTab, state, setCurrency } = useERP();

  const handleSelect = (tab: NavTab) => {
    setActiveTab(tab);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#121215]/50 backdrop-blur-[2px] lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 right-0 z-50 w-72 bg-[#1A1A1E] text-white flex flex-col border-l border-[#2B2B32] transition-transform duration-200 ease-out shrink-0 ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="px-6 py-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#BD956D] to-[#8E6742] flex items-center justify-center shadow-sm shrink-0">
              <span
                className="text-white text-lg font-semibold tracking-wider"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                DC
              </span>
            </div>
            <div>
              <div
                className="text-lg font-semibold tracking-[0.14em] text-white leading-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                DRESSCODE
              </div>
              <p className="text-[11px] text-[#B4B2AA] mt-0.5">
                نظام التصنيع وحساب التكاليف
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="إغلاق القائمة"
            className="lg:hidden p-1.5 rounded-lg text-[#B4B2AA] hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3.5 py-5 space-y-1.5 overflow-y-auto" aria-label="التنقل الرئيسي">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-right transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#A67C52] text-white shadow-sm'
                    : 'text-[#D6D4CE] hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 ${
                    isActive ? 'text-white' : 'text-[#A67C52]'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug truncate">
                    {item.label}
                  </div>
                  <div
                    className={`text-[11px] truncate mt-0.5 ${
                      isActive ? 'text-white/85' : 'text-[#8F8D86]'
                    }`}
                  >
                    {item.sublabel}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Currency & Brand Footer */}
        <div className="p-4 border-t border-white/10 space-y-3 bg-[#151518]">
          <div>
            <label
              htmlFor="currency-selector"
              className="block text-[11px] text-[#9C9990] mb-1.5 font-medium"
            >
              عملة النظام والتسعير
            </label>
            <select
              id="currency-selector"
              value={state.currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full rounded-lg bg-[#232329] border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:border-[#A67C52] cursor-pointer"
            >
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#8F8D86] pt-1">
            <span>dresscode-clothing.com</span>
            <span className="text-[#BD956D] font-medium">ERP v1.0</span>
          </div>
        </div>
      </aside>
    </>
  );
};
