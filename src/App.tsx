import React, { useState } from 'react';
import { AlertCircle, Database, X } from 'lucide-react';
import { AuditTrailView } from './components/audit/AuditTrailView';
import { LoginScreen } from './components/auth/LoginScreen';
import { ConfirmProvider } from './components/common/ConfirmDialog';
import { BasicDataView } from './components/basicdata/BasicDataView';
import { CostCalculatorView } from './components/calculator/CostCalculatorView';
import { CustomersView } from './components/customers/CustomersView';
import { DashboardView } from './components/dashboard/DashboardView';
import { ExcelImportExportView } from './components/excel/ExcelImportExportView';
import { ExpensesCashboxView } from './components/expenses/ExpensesCashboxView';
import { OutsourcedLaborView } from './components/labor/OutsourcedLaborView';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { MaterialsView } from './components/materials/MaterialsView';
import { ModelsBOMView } from './components/models/ModelsBOMView';
import { ProductionView } from './components/production/ProductionView';
import { PurchasesView } from './components/purchases/PurchasesView';
import { ReportsView } from './components/reports/ReportsView';
import { SalesView } from './components/sales/SalesView';
import { ERPProvider, useERP } from './context/ERPContext';
import { isSupabaseConfigured } from './lib/supabase';

const ERPShell: React.FC = () => {
  const {
    activeTab,
    user,
    authChecked,
    passwordRecoveryMode,
    clearPasswordRecovery,
    migration003Missing,
    syncError,
    clearSyncError,
  } = useERP();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (isSupabaseConfigured && !authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3] text-sm text-[#6E6C66]">
        جاري التحقق من جلسة DressCode ERP...
      </div>
    );
  }

  if (isSupabaseConfigured && (passwordRecoveryMode || !user)) {
    return (
      <LoginScreen
        recoveryMode={passwordRecoveryMode}
        onRecoveryDone={clearPasswordRecovery}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F7F6F3] text-[#1A1A1E] overflow-x-hidden">
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onOpenMobile={() => setMobileMenuOpen(true)} />

        {migration003Missing && (
          <div className="mx-3.5 sm:mx-6 lg:mx-8 mt-3 sm:mt-4 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 flex items-start sm:items-center gap-2.5 text-xs font-semibold text-amber-900">
            <Database className="w-4 h-4 shrink-0 text-amber-700 mt-0.5 sm:mt-0" />
            <span className="leading-relaxed">
              لتفعيل سجل المصروفات والخزنة ورأس مال الشركاء على السحابة، نفّذ ملف التحديث{' '}
              <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded break-all">
                003_excel_parity_crm_expenses_pnl.sql
              </code>{' '}
              في Supabase SQL Editor.
            </span>
          </div>
        )}

        {syncError && (
          <div className="mx-3.5 sm:mx-6 lg:mx-8 mt-3 sm:mt-4 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-red-800">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="break-words">{syncError}</span>
            </div>
            <button
              type="button"
              onClick={clearSyncError}
              className="p-1 hover:bg-red-100 rounded-lg cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-[1600px] w-full mx-auto">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'basicdata' && <BasicDataView />}
          {activeTab === 'materials' && <MaterialsView />}
          {activeTab === 'models' && <ModelsBOMView />}
          {activeTab === 'labor' && <OutsourcedLaborView />}
          {activeTab === 'calculator' && <CostCalculatorView />}
          {activeTab === 'purchases' && <PurchasesView />}
          {activeTab === 'production' && <ProductionView />}
          {activeTab === 'sales' && <SalesView />}
          {activeTab === 'customers' && <CustomersView />}
          {activeTab === 'expenses' && <ExpensesCashboxView />}
          {activeTab === 'reports' && <ReportsView />}
          {activeTab === 'audit' && <AuditTrailView />}
          {activeTab === 'excel' && <ExcelImportExportView />}
        </main>
      </div>

      <MobileBottomNav onOpenDrawer={() => setMobileMenuOpen(true)} />
    </div>
  );
};

export function App() {
  return (
    <ConfirmProvider>
      <ERPProvider>
        <ERPShell />
      </ERPProvider>
    </ConfirmProvider>
  );
}

export default App;
