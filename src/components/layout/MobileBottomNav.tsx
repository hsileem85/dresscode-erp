import React from 'react';
import {
  LayoutDashboard,
  Menu,
  Receipt,
  Scissors,
  Wallet,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { NavTab } from '../../types/erp';

interface MobileBottomNavProps {
  onOpenDrawer: () => void;
}

const QUICK_TABS: {
  id: NavTab;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'models', label: 'الموديلات', icon: Scissors },
  { id: 'sales', label: 'الطلبات', icon: Receipt },
  { id: 'expenses', label: 'الخزنة', icon: Wallet },
];

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onOpenDrawer }) => {
  const { activeTab, setActiveTab } = useERP();

  return (
    <nav
      aria-label="التنقل السريع للموبايل"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E5E3DD] shadow-[0_-4px_16px_rgba(26,26,30,0.06)] safe-area-bottom no-print"
    >
      <div className="grid grid-cols-5 items-center px-1 pt-1.5 pb-1">
        {QUICK_TABS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
                isActive ? 'text-[#A67C52] font-bold' : 'text-[#6E6C66]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] leading-tight">{item.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenDrawer}
          className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[#1A1A1E] cursor-pointer"
        >
          <Menu className="w-5 h-5 text-[#A67C52]" />
          <span className="text-[10px] font-semibold leading-tight">القائمة</span>
        </button>
      </div>
    </nav>
  );
};
