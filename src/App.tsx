import React, { useState } from 'react';
import { CostCalculatorView } from './components/calculator/CostCalculatorView';
import { DashboardView } from './components/dashboard/DashboardView';
import { ExcelImportExportView } from './components/excel/ExcelImportExportView';
import { OutsourcedLaborView } from './components/labor/OutsourcedLaborView';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { MaterialsView } from './components/materials/MaterialsView';
import { ModelsBOMView } from './components/models/ModelsBOMView';
import { ERPProvider, useERP } from './context/ERPContext';

const ERPShell: React.FC = () => {
  const { activeTab } = useERP();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-[#F7F6F3] text-[#1A1A1E]">
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onOpenMobile={() => setMobileMenuOpen(true)} />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'materials' && <MaterialsView />}
          {activeTab === 'models' && <ModelsBOMView />}
          {activeTab === 'labor' && <OutsourcedLaborView />}
          {activeTab === 'calculator' && <CostCalculatorView />}
          {activeTab === 'excel' && <ExcelImportExportView />}
        </main>
      </div>
    </div>
  );
};

export function App() {
  return (
    <ERPProvider>
      <ERPShell />
    </ERPProvider>
  );
}

export default App;
