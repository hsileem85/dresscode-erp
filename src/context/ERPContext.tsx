import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { useConfirm } from '../components/common/ConfirmDialog';
import { SEED_DATA } from '../data/seedData';
import {
  computePaymentStatus,
  erpDb,
  fetchFullERPState,
  isSupabaseConfigured,
  newUuid,
  supabase,
} from '../lib/supabase';
import { DEFAULT_LOOKUPS } from '../data/defaultLookups';
import { formatMoney } from '../utils/calculations';
import type {
  CurrencyCode,
  Customer,
  ERPState,
  ExpenseRecord,
  Fabric,
  LookupGroupKey,
  LookupItem,
  ModelVariant,
  NavTab,
  OutsourcedOperation,
  OverheadItem,
  PartnerContribution,
  ProductModel,
  SalesChannel,
  Supplier,
  TrimAccessory,
  Workshop,
} from '../types/erp';

const STORAGE_KEY = 'dresscode_erp_state_v3';

interface ERPContextValue {
  state: ERPState;
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  openModelInCalculator: (modelId: string) => void;
  openModelInBOM: (modelId: string) => void;

  // Cloud / Auth state
  user: User | null;
  authChecked: boolean;
  passwordRecoveryMode: boolean;
  clearPasswordRecovery: () => void;
  offlineMode: boolean;
  setOfflineMode: (v: boolean) => void;
  cloudConnected: boolean;
  migration003Missing: boolean;
  syncing: boolean;
  syncError: string | null;
  clearSyncError: () => void;
  refreshFromCloud: () => Promise<void>;
  signOut: () => Promise<void>;

  // Core settings
  setCurrency: (currency: CurrencyCode) => void;

  // Basic Data & Lookups (الموردين، الورش، القوائم المنسدلة)
  saveSupplier: (supplier: Supplier) => void;
  deleteSupplier: (id: string) => void;
  saveWorkshop: (workshop: Workshop) => void;
  deleteWorkshop: (id: string) => void;
  addLookupItem: (groupKey: LookupGroupKey, label: string) => void;
  deleteLookupItem: (id: string) => void;

  // Customers CRM
  saveCustomer: (customer: Customer) => void;
  deleteCustomer: (id: string) => void;

  // Expenses & Partner Capital
  saveExpense: (expense: ExpenseRecord) => void;
  deleteExpense: (id: string) => void;
  savePartnerContribution: (contrib: PartnerContribution) => void;
  deletePartnerContribution: (id: string) => void;

  // Fabrics
  saveFabric: (fabric: Fabric) => void;
  deleteFabric: (id: string) => void;
  importFabrics: (fabrics: Fabric[]) => void;

  // Trims
  saveTrim: (trim: TrimAccessory) => void;
  deleteTrim: (id: string) => void;
  importTrims: (trims: TrimAccessory[]) => void;

  // Outsourced Operations
  saveOperation: (op: OutsourcedOperation) => void;
  deleteOperation: (id: string) => void;
  importOperations: (ops: OutsourcedOperation[]) => void;

  // Models & Variants
  saveModel: (model: ProductModel) => void;
  deleteModel: (id: string) => void;
  duplicateModel: (id: string) => void;
  importModels: (models: ProductModel[]) => void;
  applyTargetMarginToAllModels: (targetMarginPct: number) => Promise<boolean>;
  addModelVariant: (variant: Omit<ModelVariant, 'id'>) => Promise<void>;
  updateModelVariant: (variant: ModelVariant) => Promise<void>;
  deleteModelVariant: (variantId: string) => Promise<void>;

  // Overhead
  setMonthlyVolume: (volume: number) => void;
  saveOverheadItem: (item: OverheadItem) => void;
  deleteOverheadItem: (id: string) => void;

  // Full-cycle: Purchases, Production, Sales
  createAndReceivePO: (payload: {
    poNumber: string;
    supplierId?: string | null;
    supplierName: string;
    receiveImmediately: boolean;
    notes?: string;
    items: {
      itemType: 'fabric' | 'trim';
      fabricId?: string | null;
      trimId?: string | null;
      description: string;
      quantity: number;
      unitsPerPack: number;
      unitPrice: number;
    }[];
  }) => Promise<void>;
  receivePO: (poId: string) => Promise<void>;
  cancelPO: (poId: string) => Promise<void>;

  createProductionBatch: (payload: {
    batchNumber: string;
    modelId: string;
    workshopId?: string | null;
    workshopName?: string;
    agreedLaborTotal?: number;
    advancePayment?: number;
    paymentMethod?: string;
    notes?: string;
    variants: { variantId: string; plannedQty: number }[];
  }) => Promise<void>;
  issueProductionBatch: (prodId: string) => Promise<void>;
  completeProductionBatch: (
    prodId: string,
    finalPaymentAmount?: number,
    paymentMethod?: string
  ) => Promise<void>;
  recordWorkshopPayment: (
    prodId: string,
    amount: number,
    paymentMethod?: string,
    notes?: string
  ) => Promise<void>;
  updateProductionBatch: (payload: {
    id: string;
    modelId: string;
    workshopId?: string | null;
    workshopName?: string;
    agreedLaborTotal: number;
    paidToWorkshop?: number;
    notes?: string;
    variants?: { variantId: string; plannedQty: number }[];
  }) => Promise<void>;
  deleteProductionBatch: (prodId: string) => Promise<void>;

  createSalesOrder: (payload: {
    orderNumber: string;
    customerId?: string | null;
    customerName: string;
    channel: SalesChannel;
    platform: string;
    discountAmount: number;
    shippingFee: number;
    paidAmount: number;
    fulfillmentStatus: string;
    confirmImmediately: boolean;
    notes?: string;
    items: { variantId: string; quantity: number; unitPrice: number }[];
  }) => Promise<void>;
  confirmSalesOrder: (saleId: string) => Promise<void>;
  recordSalesPayment: (saleId: string, amount: number, method?: string) => Promise<void>;
  updateSalesFulfillment: (saleId: string, status: string) => Promise<void>;
  cancelSalesOrder: (saleId: string) => Promise<void>;
  deleteSalesOrder: (saleId: string) => Promise<void>;

  // Data management
  importFullJSON: (data: ERPState) => void;
  resetToSeedData: () => Promise<boolean>;
  lastSavedAt: string;
}

const ERPContext = createContext<ERPContextValue | undefined>(undefined);

function loadLocalState(): ERPState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED_DATA;
    const parsed = JSON.parse(raw) as Partial<ERPState>;
    if (!parsed || !Array.isArray(parsed.fabrics) || !Array.isArray(parsed.models)) {
      return SEED_DATA;
    }
    return {
      currency: parsed.currency || 'EGP',
      suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : SEED_DATA.suppliers,
      workshops: Array.isArray(parsed.workshops) ? parsed.workshops : SEED_DATA.workshops,
      customers: Array.isArray(parsed.customers) ? parsed.customers : SEED_DATA.customers,
      lookups:
        Array.isArray(parsed.lookups) && parsed.lookups.length > 0
          ? parsed.lookups
          : DEFAULT_LOOKUPS,
      fabrics: parsed.fabrics.map((f) => ({
        ...f,
        stockQty: f.stockQty ?? 0,
        reorderLevel: f.reorderLevel ?? 20,
      })),
      trims: (Array.isArray(parsed.trims) ? parsed.trims : SEED_DATA.trims).map((t) => ({
        ...t,
        stockQty: t.stockQty ?? 0,
        reorderLevel: t.reorderLevel ?? 50,
        autoIncludeInBom: Boolean(t.autoIncludeInBom),
        defaultQtyPerPiece: t.defaultQtyPerPiece ?? 1,
      })),
      operations: Array.isArray(parsed.operations)
        ? parsed.operations
        : SEED_DATA.operations,
      models: parsed.models.map((m) => ({
        ...m,
        variants: Array.isArray(m.variants) ? m.variants : [],
      })),
      overhead:
        parsed.overhead && Array.isArray(parsed.overhead.items)
          ? parsed.overhead
          : SEED_DATA.overhead,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : SEED_DATA.expenses,
      partnerContributions: Array.isArray(parsed.partnerContributions)
        ? parsed.partnerContributions
        : SEED_DATA.partnerContributions,
      purchaseOrders: Array.isArray(parsed.purchaseOrders)
        ? parsed.purchaseOrders
        : SEED_DATA.purchaseOrders,
      productionOrders: Array.isArray(parsed.productionOrders)
        ? parsed.productionOrders
        : SEED_DATA.productionOrders,
      salesOrders: Array.isArray(parsed.salesOrders)
        ? parsed.salesOrders.map((s) => {
            const total = s.totalAmount ?? 0;
            const paid = s.paidAmount ?? total;
            return {
              ...s,
              platform: s.platform || 'واتساب',
              fulfillmentStatus: s.fulfillmentStatus || 'مكتمل',
              paidAmount: paid,
              remainingDebt: s.remainingDebt ?? Math.max(total - paid, 0),
              paymentStatus: s.paymentStatus || computePaymentStatus(total, paid),
            };
          })
        : SEED_DATA.salesOrders,
      inventoryMovements: Array.isArray(parsed.inventoryMovements)
        ? parsed.inventoryMovements
        : [],
    };
  } catch {
    return SEED_DATA;
  }
}

export const ERPProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const confirmAction = useConfirm();
  const [state, setState] = useState<ERPState>(loadLocalState);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    () => loadLocalState().models[0]?.id ?? null
  );
  const [lastSavedAt, setLastSavedAt] = useState<string>(() =>
    new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  );

  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(!isSupabaseConfigured);
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery')
  );
  const [offlineMode, setOfflineMode] = useState<boolean>(!isSupabaseConfigured);
  const [migration003Missing, setMigration003Missing] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecoveryMode(false);
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const cloudConnected = Boolean(isSupabaseConfigured && user && !offlineMode);

  const stampSaved = () =>
    setLastSavedAt(
      new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    );

  const extractErrorMessage = (err: unknown, fallback: string): string => {
    if (err instanceof Error && err.message.trim()) return err.message.trim();
    if (err && typeof err === 'object') {
      const e = err as { message?: unknown; details?: unknown; hint?: unknown };
      if (typeof e.message === 'string' && e.message.trim()) {
        return e.message.trim();
      }
      if (typeof e.details === 'string' && e.details.trim()) {
        return e.details.trim();
      }
    }
    if (typeof err === 'string' && err.trim()) return err.trim();
    return fallback;
  };

  const refreshFromCloud = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const { state: fresh, migration003Missing: missing } = await fetchFullERPState();
      setState(fresh);
      setMigration003Missing(missing);
      setSelectedModelId((prev) =>
        fresh.models.some((m) => m.id === prev) ? prev : fresh.models[0]?.id ?? null
      );
      stampSaved();
    } catch (err) {
      setSyncError(extractErrorMessage(err, 'تعذر المزامنة مع PostgreSQL'));
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setAuthChecked(true);
      if (data.session?.user) {
        setOfflineMode(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryMode(true);
      }
      setUser(session?.user ?? null);
      setAuthChecked(true);
      if (session?.user) {
        setOfflineMode(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (cloudConnected) {
      void refreshFromCloud();
    }
  }, [cloudConnected, refreshFromCloud]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      stampSaved();
    } catch {
      // ignore storage errors
    }
  }, [state]);

  const runCloud = async (fn: () => Promise<void>, shouldRefresh = true) => {
    if (!cloudConnected) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await fn();
      if (shouldRefresh) {
        const { state: fresh, migration003Missing: missing } = await fetchFullERPState();
        setState(fresh);
        setMigration003Missing(missing);
      }
      stampSaved();
    } catch (err) {
      const msg = extractErrorMessage(err, 'حدث خطأ أثناء الحفظ في قاعدة البيانات');
      setSyncError(msg);
      throw err;
    } finally {
      setSyncing(false);
    }
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setOfflineMode(false);
  };

  const setCurrency = (currency: CurrencyCode) => {
    setState((prev) => ({ ...prev, currency }));
    void runCloud(() => erpDb.updateSettings({ currency }), false);
  };

  const openModelInCalculator = (modelId: string) => {
    setSelectedModelId(modelId);
    setActiveTab('calculator');
  };

  const openModelInBOM = (modelId: string) => {
    setSelectedModelId(modelId);
    setActiveTab('models');
  };

  // Basic Data & Lookups (الموردين، الورش، القوائم المنسدلة)
  const saveSupplier = (supplier: Supplier) => {
    setState((prev) => {
      const exists = prev.suppliers.some((s) => s.id === supplier.id);
      return {
        ...prev,
        suppliers: exists
          ? prev.suppliers.map((s) => (s.id === supplier.id ? supplier : s))
          : [supplier, ...prev.suppliers],
      };
    });
    void runCloud(() => erpDb.upsertSupplier(supplier));
  };

  const deleteSupplier = (id: string) => {
    const target = state.suppliers.find((s) => s.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف المورد',
        message: `هل أنت متأكد من حذف المورد «${target?.name || 'هذا المورد'}»؟`,
        detail: 'لا يمكن التراجع عن الحذف بعد التنفيذ.',
        confirmLabel: 'نعم، احذف المورد',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        suppliers: prev.suppliers.filter((s) => s.id !== id),
      }));
      void runCloud(() => erpDb.deleteSupplier(id));
    })();
  };

  const saveWorkshop = (workshop: Workshop) => {
    setState((prev) => {
      const exists = prev.workshops.some((w) => w.id === workshop.id);
      return {
        ...prev,
        workshops: exists
          ? prev.workshops.map((w) => (w.id === workshop.id ? workshop : w))
          : [workshop, ...prev.workshops],
      };
    });
    void runCloud(() => erpDb.upsertWorkshop(workshop));
  };

  const deleteWorkshop = (id: string) => {
    const target = state.workshops.find((w) => w.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف الورشة',
        message: `هل أنت متأكد من حذف الورشة «${target?.name || 'هذه الورشة'}»؟`,
        detail: 'لا يمكن التراجع عن الحذف بعد التنفيذ.',
        confirmLabel: 'نعم، احذف الورشة',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        workshops: prev.workshops.filter((w) => w.id !== id),
      }));
      void runCloud(() => erpDb.deleteWorkshop(id));
    })();
  };

  const addLookupItem = (groupKey: LookupGroupKey, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const exists = state.lookups.some(
      (l) => l.groupKey === groupKey && l.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) return;
    const item: LookupItem = {
      id: newUuid(),
      groupKey,
      label: trimmed,
      sortOrder: state.lookups.filter((l) => l.groupKey === groupKey).length + 1,
    };
    setState((prev) => ({ ...prev, lookups: [...prev.lookups, item] }));
    // Persist silently to lookup_values if migration 004 has been applied
    if (cloudConnected) {
      void erpDb.upsertLookup(item).catch(() => {
        // Table not created yet; stays persisted in LocalStorage until Migration 004 is run
      });
    }
  };

  const deleteLookupItem = (id: string) => {
    const target = state.lookups.find((l) => l.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف القيمة',
        message: `هل أنت متأكد من حذف «${target?.label || 'هذه القيمة'}» من القائمة المنسدلة؟`,
        confirmLabel: 'نعم، احذف',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        lookups: prev.lookups.filter((l) => l.id !== id),
      }));
      if (cloudConnected) {
        void erpDb.deleteLookup(id).catch(() => {});
      }
    })();
  };

  // Customers CRM
  const saveCustomer = (customer: Customer) => {
    setState((prev) => {
      const exists = prev.customers.some((c) => c.id === customer.id);
      return {
        ...prev,
        customers: exists
          ? prev.customers.map((c) => (c.id === customer.id ? customer : c))
          : [customer, ...prev.customers],
      };
    });
    void runCloud(() => erpDb.upsertCustomer(customer));
  };

  const deleteCustomer = (id: string) => {
    const target = state.customers.find((c) => c.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف العميل',
        message: `هل أنت متأكد من حذف العميل «${target?.name || 'هذا العميل'}»؟`,
        detail: 'لا يمكن التراجع عن الحذف بعد التنفيذ.',
        confirmLabel: 'نعم، احذف العميل',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        customers: prev.customers.filter((c) => c.id !== id),
      }));
      void runCloud(() => erpDb.deleteCustomer(id));
    })();
  };

  // Expenses & Partner Capital
  const saveExpense = (expense: ExpenseRecord) => {
    setState((prev) => {
      const exists = prev.expenses.some((e) => e.id === expense.id);
      return {
        ...prev,
        expenses: exists
          ? prev.expenses.map((e) => (e.id === expense.id ? expense : e))
          : [expense, ...prev.expenses],
      };
    });
    void runCloud(() => erpDb.upsertExpense(expense));
  };

  const deleteExpense = (id: string) => {
    const target = state.expenses.find((e) => e.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف المصروف',
        message: target
          ? `هل أنت متأكد من حذف المصروف «${target.title}» بقيمة ${formatMoney(
              target.amount,
              state.currency
            )}؟`
          : 'هل أنت متأكد من حذف هذا المصروف؟',
        detail: 'سيؤثر الحذف مباشرة على رصيد الخزنة وتقرير الأرباح والخسائر.',
        confirmLabel: 'نعم، احذف المصروف',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        expenses: prev.expenses.filter((e) => e.id !== id),
      }));
      void runCloud(() => erpDb.deleteExpense(id));
    })();
  };

  const savePartnerContribution = (contrib: PartnerContribution) => {
    setState((prev) => {
      const exists = prev.partnerContributions.some((p) => p.id === contrib.id);
      return {
        ...prev,
        partnerContributions: exists
          ? prev.partnerContributions.map((p) => (p.id === contrib.id ? contrib : p))
          : [contrib, ...prev.partnerContributions],
      };
    });
    void runCloud(() => erpDb.upsertPartnerContribution(contrib));
  };

  const deletePartnerContribution = (id: string) => {
    const target = state.partnerContributions.find((p) => p.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف مساهمة رأس المال',
        message: target
          ? `هل أنت متأكد من حذف مساهمة «${target.partnerName}» بقيمة ${formatMoney(
              target.amount,
              state.currency
            )}؟`
          : 'هل أنت متأكد من حذف هذه المساهمة؟',
        detail: 'سيتم خصم هذا المبلغ من إجمالي رأس مال الشركاء ورصيد الخزنة.',
        confirmLabel: 'نعم، احذف المساهمة',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        partnerContributions: prev.partnerContributions.filter((p) => p.id !== id),
      }));
      void runCloud(() => erpDb.deletePartnerContribution(id));
    })();
  };

  // Fabrics
  const saveFabric = (fabric: Fabric) => {
    setState((prev) => {
      const exists = prev.fabrics.some((f) => f.id === fabric.id);
      return {
        ...prev,
        fabrics: exists
          ? prev.fabrics.map((f) => (f.id === fabric.id ? fabric : f))
          : [fabric, ...prev.fabrics],
      };
    });
    void runCloud(() => erpDb.upsertFabric(fabric));
  };

  const deleteFabric = (id: string) => {
    const target = state.fabrics.find((f) => f.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف القماش',
        message: `هل أنت متأكد من حذف القماش «${target?.name || 'هذا القماش'}»؟`,
        detail: 'لا يمكن التراجع عن الحذف بعد التنفيذ (وقد يمنع الحذف إذا كان مرتبطاً بموديل أو أمر شراء).',
        confirmLabel: 'نعم، احذف القماش',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        fabrics: prev.fabrics.filter((f) => f.id !== id),
      }));
      void runCloud(() => erpDb.deleteFabric(id));
    })();
  };

  const importFabrics = (fabrics: Fabric[]) => {
    setState((prev) => ({ ...prev, fabrics: [...fabrics, ...prev.fabrics] }));
    void runCloud(async () => {
      for (const f of fabrics) await erpDb.upsertFabric(f);
    });
  };

  // Trims
  const saveTrim = (trim: TrimAccessory) => {
    setState((prev) => {
      const exists = prev.trims.some((t) => t.id === trim.id);
      return {
        ...prev,
        trims: exists
          ? prev.trims.map((t) => (t.id === trim.id ? trim : t))
          : [trim, ...prev.trims],
      };
    });
    void runCloud(() => erpDb.upsertTrim(trim));
  };

  const deleteTrim = (id: string) => {
    const target = state.trims.find((t) => t.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف الكلفة / الإكسسوار',
        message: `هل أنت متأكد من حذف «${target?.name || 'هذه الكلفة'}»؟`,
        detail: 'لا يمكن التراجع عن الحذف بعد التنفيذ.',
        confirmLabel: 'نعم، احذف الكلفة',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        trims: prev.trims.filter((t) => t.id !== id),
      }));
      void runCloud(() => erpDb.deleteTrim(id));
    })();
  };

  const importTrims = (trims: TrimAccessory[]) => {
    setState((prev) => ({ ...prev, trims: [...trims, ...prev.trims] }));
    void runCloud(async () => {
      for (const t of trims) await erpDb.upsertTrim(t);
    });
  };

  // Operations
  const saveOperation = (op: OutsourcedOperation) => {
    setState((prev) => {
      const exists = prev.operations.some((o) => o.id === op.id);
      return {
        ...prev,
        operations: exists
          ? prev.operations.map((o) => (o.id === op.id ? op : o))
          : [op, ...prev.operations],
      };
    });
    void runCloud(() => erpDb.upsertOperation(op));
  };

  const deleteOperation = (id: string) => {
    const target = state.operations.find((o) => o.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف مرحلة التشغيل',
        message: `هل أنت متأكد من حذف مرحلة «${target?.name || 'هذه المرحلة'}» من دليل الورش؟`,
        detail: 'لا يمكن التراجع عن الحذف بعد التنفيذ.',
        confirmLabel: 'نعم، احذف المرحلة',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        operations: prev.operations.filter((o) => o.id !== id),
      }));
      void runCloud(() => erpDb.deleteOperation(id));
    })();
  };

  const importOperations = (ops: OutsourcedOperation[]) => {
    setState((prev) => ({ ...prev, operations: [...ops, ...prev.operations] }));
    void runCloud(async () => {
      for (const op of ops) await erpDb.upsertOperation(op);
    });
  };

  // Models & Variants
  const saveModel = (model: ProductModel) => {
    const stamped = { ...model, updatedAt: new Date().toISOString().slice(0, 10) };
    setState((prev) => {
      const exists = prev.models.some((m) => m.id === stamped.id);
      return {
        ...prev,
        models: exists
          ? prev.models.map((m) => (m.id === stamped.id ? stamped : m))
          : [stamped, ...prev.models],
      };
    });
    setSelectedModelId(stamped.id);
    void runCloud(() => erpDb.upsertModel(stamped));
  };

  const deleteModel = (id: string) => {
    const target = state.models.find((m) => m.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف الموديل',
        message: `هل أنت متأكد من حذف الموديل «${target?.name || 'هذا الموديل'}» (${
          target?.sku || ''
        }) بالكامل؟`,
        detail: 'سيتم حذف بطاقة التكلفة (BOM) وجميع بنودها ولا يمكن التراجع عن هذا الإجراء.',
        confirmLabel: 'نعم، احذف الموديل',
      });
      if (!ok) return;
      setState((prev) => {
        const remaining = prev.models.filter((m) => m.id !== id);
        if (selectedModelId === id) {
          setSelectedModelId(remaining[0]?.id ?? null);
        }
        return { ...prev, models: remaining };
      });
      void runCloud(() => erpDb.deleteModel(id));
    })();
  };

  const duplicateModel = (id: string) => {
    const source = state.models.find((m) => m.id === id);
    if (!source) return;
    const copyId = newUuid();
    const copy: ProductModel = {
      ...source,
      id: copyId,
      name: `${source.name} (نسخة)`,
      sku: `${source.sku}-${Math.floor(Math.random() * 90 + 10)}`,
      fabrics: source.fabrics.map((f) => ({ ...f, id: newUuid() })),
      trims: source.trims.map((t) => ({ ...t, id: newUuid() })),
      laborSteps: source.laborSteps.map((l) => ({ ...l, id: newUuid() })),
      variants: [],
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    saveModel(copy);
  };

  const importModels = (models: ProductModel[]) => {
    setState((prev) => ({ ...prev, models: [...models, ...prev.models] }));
    void runCloud(async () => {
      for (const m of models) await erpDb.upsertModel(m);
    });
  };

  const applyTargetMarginToAllModels = async (targetMarginPct: number): Promise<boolean> => {
    if (state.models.length === 0) return false;
    const safe = Math.max(0, Math.round((Number(targetMarginPct) || 0) * 100) / 100);
    const ok = await confirmAction({
      title: 'تأكيد تطبيق نسبة الإضافة على كافة الموديلات',
      message: `هل أنت متأكد من تطبيق نسبة الإضافة على التكلفة (${safe}%) على جميع الموديلات (${state.models.length} موديل)؟`,
      detail:
        'سيتم تحديث نسبة الربح المستهدفة (Markup %) وسعر البيع المقترح لجميع الموديلات دفعة واحدة.',
      confirmLabel: `نعم، طبّق (${safe}%) على الكل`,
      tone: 'warning',
    });
    if (!ok) return false;

    const today = new Date().toISOString().slice(0, 10);
    setState((prev) => ({
      ...prev,
      models: prev.models.map((m) => ({
        ...m,
        targetMarginPct: safe,
        updatedAt: today,
      })),
    }));

    if (cloudConnected) {
      await runCloud(() => erpDb.updateAllModelsTargetMargin(safe));
    }
    return true;
  };

  const addModelVariant = async (variant: Omit<ModelVariant, 'id'>) => {
    if (cloudConnected) {
      await runCloud(() => erpDb.createVariant(variant));
      return;
    }
    const created: ModelVariant = { ...variant, id: newUuid() };
    setState((prev) => ({
      ...prev,
      models: prev.models.map((m) =>
        m.id === variant.modelId ? { ...m, variants: [...m.variants, created] } : m
      ),
    }));
  };

  const updateModelVariant = async (variant: ModelVariant) => {
    const existing = state.models
      .flatMap((m) => m.variants)
      .find((v) => v.id === variant.id);
    const qtyDelta = existing ? variant.finishedGoodsQty - existing.finishedGoodsQty : 0;

    if (cloudConnected) {
      await runCloud(() => erpDb.updateVariant(variant, qtyDelta));
      return;
    }
    setState((prev) => ({
      ...prev,
      models: prev.models.map((m) =>
        m.id === variant.modelId
          ? {
              ...m,
              variants: m.variants.map((v) => (v.id === variant.id ? variant : v)),
            }
          : m
      ),
    }));
  };

  const deleteModelVariant = async (variantId: string) => {
    const parentModel = state.models.find((m) => m.variants.some((v) => v.id === variantId));
    const target = parentModel?.variants.find((v) => v.id === variantId);
    if (!target) return;

    const linkedSalesCount = state.salesOrders.filter((s) =>
      s.items.some((it) => it.variantId === variantId)
    ).length;
    const linkedProdCount = state.productionOrders.filter((p) =>
      p.variants.some((pv) => pv.variantId === variantId)
    ).length;

    if (linkedSalesCount > 0 || linkedProdCount > 0) {
      const reasons: string[] = [];
      if (linkedSalesCount > 0) reasons.push(`${linkedSalesCount} طلب مبيعات`);
      if (linkedProdCount > 0) reasons.push(`${linkedProdCount} أمر تصنيع`);
      setSyncError(
        `لا يمكن حذف الصنف «${parentModel?.name || 'موديل'} — ${target.color} / ${
          target.size
        }» (${target.variantSku}) لأنه مرتبط بـ ${reasons.join(
          ' و '
        )}. احذف السجلات المرتبطة أولاً.`
      );
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const ok = await confirmAction({
      title: 'تأكيد حذف صنف من مخزون المنتج التام',
      message: `هل أنت متأكد من حذف الصنف «${parentModel?.name || 'موديل'} — ${target.color} / ${
        target.size
      }» (${target.variantSku})؟`,
      detail:
        target.finishedGoodsQty > 0
          ? `تنبيه: يوجد رصيد متاح حالياً (${target.finishedGoodsQty} قطعة) على هذا الصنف. عند التأكيد سيُحذف الصنف ورصيده نهائياً من مخزون المنتج التام.`
          : 'سيتم حذف الصنف نهائياً من قائمة المقاسات والألوان ولا يمكن التراجع عن هذا الإجراء.',
      confirmLabel: 'نعم، احذف الصنف',
    });
    if (!ok) return;

    if (cloudConnected) {
      await runCloud(() => erpDb.deleteVariant(variantId));
      return;
    }

    setState((prev) => ({
      ...prev,
      models: prev.models.map((m) =>
        m.id === target.modelId
          ? { ...m, variants: m.variants.filter((v) => v.id !== variantId) }
          : m
      ),
    }));
  };

  // Overhead
  const setMonthlyVolume = (volume: number) => {
    const safe = Math.max(1, volume);
    setState((prev) => ({
      ...prev,
      overhead: { ...prev.overhead, estimatedMonthlyVolume: safe },
    }));
    void runCloud(() => erpDb.updateSettings({ estimatedMonthlyVolume: safe }), false);
  };

  const saveOverheadItem = (item: OverheadItem) => {
    setState((prev) => {
      const exists = prev.overhead.items.some((i) => i.id === item.id);
      return {
        ...prev,
        overhead: {
          ...prev.overhead,
          items: exists
            ? prev.overhead.items.map((i) => (i.id === item.id ? item : i))
            : [...prev.overhead.items, item],
        },
      };
    });
    void runCloud(() => erpDb.upsertOverheadItem(item));
  };

  const deleteOverheadItem = (id: string) => {
    const target = state.overhead.items.find((i) => i.id === id);
    void (async () => {
      const ok = await confirmAction({
        title: 'تأكيد حذف بند المصاريف غير المباشرة',
        message: `هل أنت متأكد من حذف بند «${target?.name || 'هذا البند'}»؟`,
        detail: 'سيؤثر الحذف على نصيب القطعة من المصاريف غير المباشرة في كل الموديلات.',
        confirmLabel: 'نعم، احذف البند',
      });
      if (!ok) return;
      setState((prev) => ({
        ...prev,
        overhead: {
          ...prev.overhead,
          items: prev.overhead.items.filter((i) => i.id !== id),
        },
      }));
      void runCloud(() => erpDb.deleteOverheadItem(id));
    })();
  };

  // Purchases
  const createAndReceivePO: ERPContextValue['createAndReceivePO'] = async (payload) => {
    if (cloudConnected) {
      await runCloud(async () => {
        const poId = await erpDb.createPurchaseOrder(payload);
        if (payload.receiveImmediately) {
          await erpDb.receivePurchaseOrder(poId);
        }
      });
      return;
    }

    const poId = newUuid();
    const total = payload.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    setState((prev) => {
      let nextFabrics = prev.fabrics;
      let nextTrims = prev.trims;
      if (payload.receiveImmediately) {
        for (const item of payload.items) {
          if (item.itemType === 'fabric' && item.fabricId) {
            nextFabrics = nextFabrics.map((f) => {
              if (f.id !== item.fabricId) return f;
              const newQty = f.stockQty + item.quantity;
              const newWac =
                newQty > 0
                  ? (f.stockQty * f.pricePerUnit + item.quantity * item.unitPrice) / newQty
                  : item.unitPrice;
              return { ...f, stockQty: newQty, pricePerUnit: Number(newWac.toFixed(2)) };
            });
          } else if (item.itemType === 'trim' && item.trimId) {
            nextTrims = nextTrims.map((t) => {
              if (t.id !== item.trimId) return t;
              return { ...t, stockQty: t.stockQty + item.quantity * item.unitsPerPack };
            });
          }
        }
      }
      return {
        ...prev,
        fabrics: nextFabrics,
        trims: nextTrims,
        purchaseOrders: [
          {
            id: poId,
            poNumber: payload.poNumber,
            supplierId: payload.supplierId,
            supplierName: payload.supplierName,
            orderDate: new Date().toISOString().slice(0, 10),
            receivedAt: payload.receiveImmediately ? new Date().toISOString() : null,
            status: payload.receiveImmediately ? 'received' : 'ordered',
            totalAmount: total,
            paidAmount: 0,
            notes: payload.notes,
            items: payload.items.map((it) => ({
              ...it,
              id: newUuid(),
              lineTotal: it.quantity * it.unitPrice,
            })),
          },
          ...prev.purchaseOrders,
        ],
      };
    });
  };

  const receivePO = async (poId: string) => {
    if (cloudConnected) {
      await runCloud(() => erpDb.receivePurchaseOrder(poId));
      return;
    }
    setState((prev) => {
      const po = prev.purchaseOrders.find((p) => p.id === poId);
      if (!po || po.status === 'received' || po.status === 'cancelled') return prev;
      let nextFabrics = prev.fabrics;
      let nextTrims = prev.trims;
      for (const item of po.items) {
        if (item.itemType === 'fabric' && item.fabricId) {
          nextFabrics = nextFabrics.map((f) =>
            f.id === item.fabricId ? { ...f, stockQty: f.stockQty + item.quantity } : f
          );
        } else if (item.itemType === 'trim' && item.trimId) {
          nextTrims = nextTrims.map((t) =>
            t.id === item.trimId
              ? { ...t, stockQty: t.stockQty + item.quantity * item.unitsPerPack }
              : t
          );
        }
      }
      return {
        ...prev,
        fabrics: nextFabrics,
        trims: nextTrims,
        purchaseOrders: prev.purchaseOrders.map((p) =>
          p.id === poId ? { ...p, status: 'received', receivedAt: new Date().toISOString() } : p
        ),
      };
    });
  };

  const cancelPO = async (poId: string) => {
    const po = state.purchaseOrders.find((p) => p.id === poId);
    if (!po || po.status === 'cancelled') return;

    const isReceived = po.status === 'received';
    const ok = await confirmAction({
      title: 'تأكيد إلغاء أمر الشراء',
      message: `هل أنت متأكد من إلغاء أمر الشراء «${po.poNumber}» (${
        po.supplierName
      }) بقيمة ${formatMoney(po.totalAmount, state.currency)}؟`,
      detail: isReceived
        ? 'هذا الأمر تم استلامه بالفعل بالمخزن — عند التأكيد سيتم خصم الكميات المستلمة من المخزون وتعديل رصيد المورد تلقائياً. لن يُسمح بالإلغاء إذا كان جزء من الخامات قد استُهلك.'
        : 'سيتم تحويل حالة أمر الشراء إلى «ملغي» ولن يتم استلامه بالمخزن.',
      confirmLabel: 'نعم، إلغاء أمر الشراء',
    });
    if (!ok) return;

    if (cloudConnected) {
      await runCloud(() => erpDb.cancelPurchaseOrder(poId, po.status));
      return;
    }

    setState((prev) => {
      const target = prev.purchaseOrders.find((p) => p.id === poId);
      if (!target || target.status === 'cancelled') return prev;

      let nextFabrics = prev.fabrics;
      let nextTrims = prev.trims;
      let nextSuppliers = prev.suppliers;

      if (target.status === 'received') {
        for (const item of target.items) {
          if (item.itemType === 'fabric' && item.fabricId) {
            nextFabrics = nextFabrics.map((f) =>
              f.id === item.fabricId
                ? { ...f, stockQty: Math.max(0, f.stockQty - item.quantity) }
                : f
            );
          } else if (item.itemType === 'trim' && item.trimId) {
            nextTrims = nextTrims.map((t) =>
              t.id === item.trimId
                ? {
                    ...t,
                    stockQty: Math.max(0, t.stockQty - item.quantity * item.unitsPerPack),
                  }
                : t
            );
          }
        }
        if (target.supplierId) {
          nextSuppliers = nextSuppliers.map((s) =>
            s.id === target.supplierId
              ? { ...s, balancePayable: Math.max(0, s.balancePayable - target.totalAmount) }
              : s
          );
        }
      }

      return {
        ...prev,
        fabrics: nextFabrics,
        trims: nextTrims,
        suppliers: nextSuppliers,
        purchaseOrders: prev.purchaseOrders.map((p) =>
          p.id === poId ? { ...p, status: 'cancelled' } : p
        ),
      };
    });
  };

  // Production
  const createProductionBatch: ERPContextValue['createProductionBatch'] = async (payload) => {
    if (cloudConnected) {
      await runCloud(async () => {
        await erpDb.createProductionOrder(payload);
      });
      return;
    }
    const plannedQty = payload.variants.reduce((s, v) => s + v.plannedQty, 0);
    const advance = Math.max(0, Number(payload.advancePayment) || 0);
    const today = new Date().toISOString().slice(0, 10);
    setState((prev) => ({
      ...prev,
      productionOrders: [
        {
          id: newUuid(),
          batchNumber: payload.batchNumber,
          modelId: payload.modelId,
          workshopId: payload.workshopId || null,
          workshopName: payload.workshopName || '',
          agreedLaborTotal: Math.max(0, Number(payload.agreedLaborTotal) || 0),
          paidToWorkshop: advance,
          status: 'planned',
          plannedQty,
          completedQty: 0,
          actualMaterialCost: 0,
          actualLaborCost: 0,
          allocatedOverheadCost: 0,
          actualUnitCogs: 0,
          notes: payload.notes,
          createdAt: today,
          variants: payload.variants.map((v) => ({
            id: newUuid(),
            variantId: v.variantId,
            plannedQty: v.plannedQty,
            completedQty: 0,
          })),
        },
        ...prev.productionOrders,
      ],
      expenses:
        advance > 0
          ? [
              {
                id: newUuid(),
                expenseDate: today,
                title: `دفعة تحت الحساب للورشة — ${payload.workshopName || 'ورشة خارجية'} (${payload.batchNumber})`,
                category: 'خامات',
                isRawMaterialPurchase: true,
                amount: advance,
                paymentMethod: payload.paymentMethod || 'كاش',
                notes: `تشغيلة ${payload.batchNumber}`,
              },
              ...prev.expenses,
            ]
          : prev.expenses,
    }));
  };

  const issueProductionBatch = async (prodId: string) => {
    const po = state.productionOrders.find((p) => p.id === prodId);
    const model = po ? state.models.find((m) => m.id === po.modelId) : undefined;
    let allowShortage = false;

    if (po && model) {
      const shortages: string[] = [];

      // Check required fabrics
      for (const mf of model.fabrics) {
        const fab = state.fabrics.find((f) => f.id === mf.fabricId);
        if (!fab) continue;
        const reqQty =
          Math.round(mf.consumption * (1 + mf.wastePct / 100) * po.plannedQty * 1000) / 1000;
        if (reqQty > 0 && (fab.stockQty || 0) < reqQty) {
          const unitLbl = fab.unit === 'kg' ? 'كجم' : 'متر';
          shortages.push(
            `• قماش «${fab.name}»: المطلوب ${reqQty} ${unitLbl} (المتاح بالمخزن: ${fab.stockQty || 0})`
          );
        }
      }

      // Check required effective trims (explicit + auto-included)
      const explicitTrimIds = new Set(model.trims.map((t) => t.trimId));
      const effectiveTrims: { trimId: string; quantity: number }[] = [
        ...model.trims.map((t) => ({ trimId: t.trimId, quantity: t.quantity })),
        ...state.trims
          .filter((t) => Boolean(t.autoIncludeInBom) && !explicitTrimIds.has(t.id))
          .map((t) => ({ trimId: t.id, quantity: t.defaultQtyPerPiece ?? 1 })),
      ].filter((t) => t.quantity > 0);

      for (const et of effectiveTrims) {
        const tr = state.trims.find((t) => t.id === et.trimId);
        if (!tr) continue;
        const reqQty = Math.round(et.quantity * po.plannedQty * 1000) / 1000;
        if (reqQty > 0 && (tr.stockQty || 0) < reqQty) {
          shortages.push(
            `• «${tr.name}»: المطلوب ${reqQty} ${tr.unitLabel} (المتاح بالمخزن: ${tr.stockQty || 0})`
          );
        }
      }

      if (shortages.length > 0) {
        const ok = await confirmAction({
          title: 'تنبيه: رصيد بعض الخامات أو الكلف غير كافٍ بالمخزن',
          message: `تشغيلة «${po.batchNumber}» (${model.name} — ${po.plannedQty} قطعة) تحتاج خامات/كلف رصيدها الحالي غير كافٍ في المخزن. يمكنك التراجع لإضافة الرصيد من شاشة «الخامات والكلف» أو «المشتريات»، أو المتابعة بالصرف الآن.`,
          detail: shortages.join('  |  '),
          confirmLabel: 'تأكيد الصرف والمتابعة رغم العجز',
          cancelLabel: 'تراجع (لإضافة الرصيد أولاً)',
          tone: 'warning',
        });
        if (!ok) return;
        allowShortage = true;
      }
    }

    if (cloudConnected) {
      await runCloud(() => erpDb.issueProductionOrder(prodId, allowShortage));
      return;
    }

    setState((prev) => ({
      ...prev,
      productionOrders: prev.productionOrders.map((p) =>
        p.id === prodId ? { ...p, status: 'in_progress' } : p
      ),
    }));
  };

  const recordWorkshopPayment: ERPContextValue['recordWorkshopPayment'] = async (
    prodId,
    amount,
    paymentMethod = 'كاش',
    notes
  ) => {
    if (amount <= 0) return;
    if (cloudConnected) {
      await runCloud(() => erpDb.recordWorkshopPayment(prodId, amount, paymentMethod, notes));
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    setState((prev) => {
      const prod = prev.productionOrders.find((p) => p.id === prodId);
      if (!prod) return prev;
      const label =
        notes?.trim() ||
        `${prod.status === 'completed' ? 'سداد مستحقات الورشة' : 'دفعة تحت الحساب للورشة'} — ${
          prod.workshopName || 'ورشة خارجية'
        } (${prod.batchNumber})`;
      return {
        ...prev,
        productionOrders: prev.productionOrders.map((p) =>
          p.id === prodId ? { ...p, paidToWorkshop: (p.paidToWorkshop || 0) + amount } : p
        ),
        workshops:
          prod.status === 'completed' && prod.workshopId
            ? prev.workshops.map((w) =>
                w.id === prod.workshopId
                  ? { ...w, balancePayable: Math.max(0, w.balancePayable - amount) }
                  : w
              )
            : prev.workshops,
        expenses: [
          {
            id: newUuid(),
            expenseDate: today,
            title: label,
            category: 'خامات',
            isRawMaterialPurchase: true,
            amount,
            paymentMethod,
            notes: `تشغيلة ${prod.batchNumber}`,
          },
          ...prev.expenses,
        ],
      };
    });
  };

  const completeProductionBatch: ERPContextValue['completeProductionBatch'] = async (
    prodId,
    finalPaymentAmount = 0,
    paymentMethod = 'كاش'
  ) => {
    if (cloudConnected) {
      await runCloud(async () => {
        await erpDb.completeProductionOrder(prodId);
        if (finalPaymentAmount && finalPaymentAmount > 0) {
          const prod = state.productionOrders.find((p) => p.id === prodId);
          await erpDb.recordWorkshopPayment(
            prodId,
            finalPaymentAmount,
            paymentMethod,
            `سداد باقي أجر الورشة عند الاستلام — ${prod?.workshopName || 'ورشة خارجية'} (${
              prod?.batchNumber || ''
            })`
          );
        }
      });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    setState((prev) => {
      const prod = prev.productionOrders.find((p) => p.id === prodId);
      if (!prod) return prev;
      const payNow = Math.max(0, Number(finalPaymentAmount) || 0);
      const totalLabor = prod.agreedLaborTotal || prod.actualLaborCost || 0;
      const nextPaid = (prod.paidToWorkshop || 0) + payNow;
      const unpaidRemainder = Math.max(0, totalLabor - nextPaid);
      return {
        ...prev,
        models: prev.models.map((m) =>
          m.id !== prod.modelId
            ? m
            : {
                ...m,
                variants: m.variants.map((v) => {
                  const pv = prod.variants.find((x) => x.variantId === v.id);
                  return pv
                    ? { ...v, finishedGoodsQty: v.finishedGoodsQty + pv.plannedQty }
                    : v;
                }),
              }
        ),
        productionOrders: prev.productionOrders.map((p) =>
          p.id === prodId
            ? {
                ...p,
                status: 'completed',
                completedQty: p.plannedQty,
                actualLaborCost: totalLabor,
                paidToWorkshop: nextPaid,
              }
            : p
        ),
        workshops:
          prod.workshopId && unpaidRemainder > 0
            ? prev.workshops.map((w) =>
                w.id === prod.workshopId
                  ? { ...w, balancePayable: w.balancePayable + unpaidRemainder }
                  : w
              )
            : prev.workshops,
        expenses:
          payNow > 0
            ? [
                {
                  id: newUuid(),
                  expenseDate: today,
                  title: `سداد باقي أجر الورشة عند الاستلام — ${
                    prod.workshopName || 'ورشة خارجية'
                  } (${prod.batchNumber})`,
                  category: 'خامات',
                  isRawMaterialPurchase: true,
                  amount: payNow,
                  paymentMethod,
                  notes: `تشغيلة ${prod.batchNumber}`,
                },
                ...prev.expenses,
              ]
            : prev.expenses,
      };
    });
  };

  const updateProductionBatch: ERPContextValue['updateProductionBatch'] = async (payload) => {
    const existing = state.productionOrders.find((p) => p.id === payload.id);
    if (!existing) return;

    if (cloudConnected) {
      await runCloud(() =>
        erpDb.updateProductionOrder(payload, {
          batchNumber: existing.batchNumber,
          status: existing.status,
          workshopId: existing.workshopId,
          agreedLaborTotal: existing.agreedLaborTotal,
          actualLaborCost: existing.actualLaborCost,
          paidToWorkshop: existing.paidToWorkshop,
          completedQty: existing.completedQty,
          actualMaterialCost: existing.actualMaterialCost,
          allocatedOverheadCost: existing.allocatedOverheadCost,
          actualUnitCogs: existing.actualUnitCogs,
        })
      );
      return;
    }

    const newLabor = Math.max(0, Number(payload.agreedLaborTotal) || 0);
    const today = new Date().toISOString().slice(0, 10);
    setState((prev) => {
      const target = prev.productionOrders.find((p) => p.id === payload.id);
      if (!target) return prev;

      const oldPaid = Math.max(0, target.paidToWorkshop || 0);
      const newPaid =
        payload.paidToWorkshop !== undefined
          ? Math.max(0, Math.round((Number(payload.paidToWorkshop) || 0) * 100) / 100)
          : oldPaid;

      const cleanVariants =
        payload.variants && target.status !== 'completed'
          ? payload.variants.filter((v) => v.plannedQty > 0)
          : null;
      const newPlannedQty =
        cleanVariants && cleanVariants.length > 0
          ? cleanVariants.reduce((s, v) => s + v.plannedQty, 0)
          : target.plannedQty;

      let nextWorkshops = prev.workshops;
      if (target.status === 'completed') {
        const oldLabor = target.actualLaborCost || target.agreedLaborTotal || 0;
        const oldUnpaid = Math.max(0, oldLabor - oldPaid);
        const newUnpaid = Math.max(0, newLabor - newPaid);
        const oldWsId = target.workshopId || null;
        const newWsId = payload.workshopId || null;

        if (oldWsId === newWsId) {
          if (newWsId && newUnpaid !== oldUnpaid) {
            nextWorkshops = nextWorkshops.map((w) =>
              w.id === newWsId
                ? { ...w, balancePayable: Math.max(0, w.balancePayable + (newUnpaid - oldUnpaid)) }
                : w
            );
          }
        } else {
          nextWorkshops = nextWorkshops.map((w) => {
            if (oldWsId && w.id === oldWsId && oldUnpaid > 0) {
              return { ...w, balancePayable: Math.max(0, w.balancePayable - oldUnpaid) };
            }
            if (newWsId && w.id === newWsId && newUnpaid > 0) {
              return { ...w, balancePayable: w.balancePayable + newUnpaid };
            }
            return w;
          });
        }
      }

      let nextExpenses = prev.expenses;
      if (Math.round(oldPaid * 100) !== Math.round(newPaid * 100)) {
        const existingBatchExp = prev.expenses.find(
          (e) => e.isRawMaterialPurchase && e.notes === `تشغيلة ${target.batchNumber}`
        );
        const payMethod = existingBatchExp?.paymentMethod || 'كاش';
        const filtered = prev.expenses.filter(
          (e) => !(e.isRawMaterialPurchase && e.notes === `تشغيلة ${target.batchNumber}`)
        );
        nextExpenses =
          newPaid > 0
            ? [
                {
                  id: newUuid(),
                  expenseDate: existingBatchExp?.expenseDate || today,
                  title: `${
                    target.status === 'completed' ? 'مدفوعات الورشة' : 'دفعة تحت الحساب للورشة'
                  } — ${payload.workshopName || target.workshopName || 'ورشة خارجية'} (${
                    target.batchNumber
                  })`,
                  category: 'خامات',
                  isRawMaterialPurchase: true,
                  amount: newPaid,
                  paymentMethod: payMethod,
                  notes: `تشغيلة ${target.batchNumber}`,
                },
                ...filtered,
              ]
            : filtered;
      }

      const nextActualCogs =
        target.status === 'completed' && target.completedQty > 0
          ? Math.round(
              ((target.actualMaterialCost + newLabor + target.allocatedOverheadCost) /
                target.completedQty) *
                100
            ) / 100
          : target.actualUnitCogs;

      return {
        ...prev,
        workshops: nextWorkshops,
        expenses: nextExpenses,
        productionOrders: prev.productionOrders.map((p) => {
          if (p.id !== payload.id) return p;
          return {
            ...p,
            modelId: p.status === 'planned' ? payload.modelId : p.modelId,
            workshopId: payload.workshopId || null,
            workshopName: payload.workshopName || '',
            agreedLaborTotal: newLabor,
            actualLaborCost: p.status === 'completed' ? newLabor : p.actualLaborCost,
            paidToWorkshop: newPaid,
            actualUnitCogs: nextActualCogs,
            plannedQty: p.status === 'completed' ? p.plannedQty : newPlannedQty,
            notes: payload.notes || '',
            variants:
              p.status !== 'completed' && cleanVariants && cleanVariants.length > 0
                ? cleanVariants.map((v) => ({
                    id: newUuid(),
                    variantId: v.variantId,
                    plannedQty: v.plannedQty,
                    completedQty: 0,
                  }))
                : p.variants,
          };
        }),
      };
    });
  };

  const deleteProductionBatch = async (prodId: string) => {
    const po = state.productionOrders.find((p) => p.id === prodId);
    if (!po) return;
    const model = state.models.find((m) => m.id === po.modelId);
    const paid = po.paidToWorkshop || 0;
    const totalLabor = po.actualLaborCost || po.agreedLaborTotal || 0;
    const unpaidLabor = po.status === 'completed' ? Math.max(0, totalLabor - paid) : 0;

    const detailParts: string[] = [];
    if (po.status === 'planned') {
      detailParts.push('لم يتم صرف خامات لهذه التشغيلة بعد — سيتم حذف أمر التصنيع نهائياً.');
    } else if (po.status === 'in_progress') {
      detailParts.push(
        'سيتم إرجاع كافة الأقمشة والكلف المصروفة لهذه التشغيلة إلى مخزن الخامات تلقائياً.'
      );
    } else if (po.status === 'completed') {
      detailParts.push(
        'سيتم خصم القطع المستلمة من مخزون المنتج التام وإرجاع الخامات المصروفة لمخزن الخامات تلقائياً (ولن يُسمح بالحذف إذا كان جزء من القطع قد تم بيعه بالفعل).'
      );
      if (unpaidLabor > 0) {
        detailParts.push(
          `كما سيتم خصم المستحق المتبقي (${formatMoney(
            unpaidLabor,
            state.currency
          )}) من رصيد الورشة.`
        );
      }
    } else {
      detailParts.push('سيتم حذف سجل أمر التصنيع نهائياً.');
    }

    if (paid > 0) {
      detailParts.push(
        `سيتم أيضاً عكس دفعات الورشة المسجلة على هذه التشغيلة (${formatMoney(
          paid,
          state.currency
        )}) من الخزنة وسجل المدفوعات.`
      );
    }

    const ok = await confirmAction({
      title: 'تأكيد حذف أمر التصنيع',
      message: `هل أنت متأكد من حذف أمر التصنيع «${po.batchNumber}» (${
        model?.name || 'موديل'
      } — ${po.plannedQty} قطعة)؟`,
      detail: detailParts.join(' '),
      confirmLabel: 'نعم، احذف أمر التصنيع',
    });
    if (!ok) return;

    if (cloudConnected) {
      await runCloud(() => erpDb.deleteProductionOrder(prodId, po.status, paid));
      return;
    }

    // Offline mode: validate finished-goods availability before reversing
    if (po.status === 'completed') {
      const targetModel = state.models.find((m) => m.id === po.modelId);
      for (const pv of po.variants) {
        const qtyToReverse = pv.completedQty > 0 ? pv.completedQty : pv.plannedQty;
        if (qtyToReverse <= 0) continue;
        const variant = targetModel?.variants.find((v) => v.id === pv.variantId);
        if (variant && variant.finishedGoodsQty < qtyToReverse) {
          setSyncError(
            `لا يمكن حذف أمر التصنيع (${po.batchNumber}) لأن جزءاً من المنتج التام (${variant.variantSku} — ${variant.color} / ${variant.size}) تم بيعه أو سحبه بالفعل — الرصيد المتاح ${variant.finishedGoodsQty} أقل من الكمية المستلمة ${qtyToReverse}.`
          );
          if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }
      }
    }

    setState((prev) => {
      const target = prev.productionOrders.find((p) => p.id === prodId);
      if (!target) return prev;
      const targetPaid = target.paidToWorkshop || 0;
      const targetTotalLabor = target.actualLaborCost || target.agreedLaborTotal || 0;
      const targetUnpaid =
        target.status === 'completed' ? Math.max(0, targetTotalLabor - targetPaid) : 0;

      return {
        ...prev,
        models:
          target.status === 'completed'
            ? prev.models.map((m) =>
                m.id !== target.modelId
                  ? m
                  : {
                      ...m,
                      variants: m.variants.map((v) => {
                        const pv = target.variants.find((x) => x.variantId === v.id);
                        if (!pv) return v;
                        const qtyToReverse =
                          pv.completedQty > 0 ? pv.completedQty : pv.plannedQty;
                        return {
                          ...v,
                          finishedGoodsQty: Math.max(0, v.finishedGoodsQty - qtyToReverse),
                        };
                      }),
                    }
              )
            : prev.models,
        workshops:
          target.status === 'completed' && target.workshopId && targetUnpaid > 0
            ? prev.workshops.map((w) =>
                w.id === target.workshopId
                  ? { ...w, balancePayable: Math.max(0, w.balancePayable - targetUnpaid) }
                  : w
              )
            : prev.workshops,
        expenses: prev.expenses.filter(
          (e) => !(e.isRawMaterialPurchase && e.notes === `تشغيلة ${target.batchNumber}`)
        ),
        productionOrders: prev.productionOrders.filter((p) => p.id !== prodId),
      };
    });
  };

  // Sales Orders, Payments & Fulfillment
  const createSalesOrder: ERPContextValue['createSalesOrder'] = async (payload) => {
    if (cloudConnected) {
      await runCloud(async () => {
        const saleId = await erpDb.createSalesOrder(payload);
        if (payload.confirmImmediately) {
          await erpDb.confirmSalesOrder(saleId);
        }
      });
      return;
    }
    const subtotal = payload.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const totalAmount = subtotal - payload.discountAmount + payload.shippingFee;
    const paid = payload.paidAmount;
    const remainingDebt = Math.max(totalAmount - paid, 0);
    setState((prev) => ({
      ...prev,
      salesOrders: [
        {
          id: newUuid(),
          orderNumber: payload.orderNumber,
          customerId: payload.customerId,
          customerName: payload.customerName,
          channel: payload.channel,
          platform: payload.platform,
          orderDate: new Date().toISOString().slice(0, 10),
          status: payload.confirmImmediately ? 'confirmed' : 'draft',
          fulfillmentStatus: payload.fulfillmentStatus,
          subtotal,
          discountAmount: payload.discountAmount,
          shippingFee: payload.shippingFee,
          totalAmount,
          paidAmount: paid,
          remainingDebt,
          paymentStatus: computePaymentStatus(totalAmount, paid),
          totalCogs: 0,
          grossProfit: subtotal - payload.discountAmount,
          notes: payload.notes,
          items: payload.items.map((it) => ({
            id: newUuid(),
            variantId: it.variantId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            unitCogsSnapshot: 0,
            lineTotal: it.quantity * it.unitPrice,
            lineCogs: 0,
          })),
        },
        ...prev.salesOrders,
      ],
    }));
  };

  const confirmSalesOrder = async (saleId: string) => {
    if (cloudConnected) {
      await runCloud(() => erpDb.confirmSalesOrder(saleId));
      return;
    }
    setState((prev) => ({
      ...prev,
      salesOrders: prev.salesOrders.map((s) =>
        s.id === saleId ? { ...s, status: 'confirmed' } : s
      ),
    }));
  };

  const recordSalesPayment = async (saleId: string, amount: number, method = 'تحويل') => {
    if (cloudConnected) {
      await runCloud(() => erpDb.recordSalesPayment(saleId, amount, method));
      return;
    }
    setState((prev) => ({
      ...prev,
      salesOrders: prev.salesOrders.map((s) => {
        if (s.id !== saleId) return s;
        const paidAmount = s.paidAmount + amount;
        const remainingDebt = Math.max(s.totalAmount - paidAmount, 0);
        return {
          ...s,
          paidAmount,
          remainingDebt,
          paymentStatus: computePaymentStatus(s.totalAmount, paidAmount),
        };
      }),
    }));
  };

  const updateSalesFulfillment = async (saleId: string, fulfillmentStatus: string) => {
    setState((prev) => ({
      ...prev,
      salesOrders: prev.salesOrders.map((s) =>
        s.id === saleId ? { ...s, fulfillmentStatus } : s
      ),
    }));
    if (cloudConnected) {
      await runCloud(() => erpDb.updateSalesFulfillment(saleId, fulfillmentStatus), false);
    }
  };

  const cancelSalesOrder = async (saleId: string) => {
    const so = state.salesOrders.find((s) => s.id === saleId);
    if (!so || so.status === 'cancelled') return;

    const wasDeducted =
      so.status === 'confirmed' || so.status === 'shipped' || so.status === 'delivered';
    const detailParts: string[] = [];
    if (wasDeducted) {
      detailParts.push('سيتم إرجاع القطع المصروفة لهذا الطلب إلى مخزون المنتج التام تلقائياً.');
    }
    if ((so.paidAmount || 0) > 0) {
      detailParts.push(
        `سيتم استبعاد المبلغ المحصّل (${formatMoney(
          so.paidAmount,
          state.currency
        )}) من إجمالي المبيعات ورصيد الخزنة وحساب العميل.`
      );
    }
    if (detailParts.length === 0) {
      detailParts.push('سيتم تحويل حالة الطلب إلى «ملغي» مع الاحتفاظ به في السجل.');
    }

    const ok = await confirmAction({
      title: 'تأكيد إلغاء طلب العميل',
      message: `هل أنت متأكد من إلغاء الطلب «${so.orderNumber}» للعميل «${
        so.customerName
      }» بقيمة ${formatMoney(so.totalAmount, state.currency)}؟`,
      detail: detailParts.join(' '),
      confirmLabel: 'نعم، إلغاء الطلب',
      tone: 'warning',
    });
    if (!ok) return;

    if (cloudConnected) {
      await runCloud(() =>
        erpDb.cancelSalesOrder(saleId, {
          orderNumber: so.orderNumber,
          status: so.status,
          paidAmount: so.paidAmount,
          customerId: so.customerId,
          items: so.items,
        })
      );
      return;
    }

    setState((prev) => {
      const target = prev.salesOrders.find((s) => s.id === saleId);
      if (!target || target.status === 'cancelled') return prev;
      const restoreStock =
        target.status === 'confirmed' ||
        target.status === 'shipped' ||
        target.status === 'delivered';

      return {
        ...prev,
        models: restoreStock
          ? prev.models.map((m) => ({
              ...m,
              variants: m.variants.map((v) => {
                const qtyBack = target.items
                  .filter((it) => it.variantId === v.id)
                  .reduce((sum, it) => sum + it.quantity, 0);
                return qtyBack > 0
                  ? { ...v, finishedGoodsQty: v.finishedGoodsQty + qtyBack }
                  : v;
              }),
            }))
          : prev.models,
        salesOrders: prev.salesOrders.map((s) =>
          s.id === saleId ? { ...s, status: 'cancelled', fulfillmentStatus: 'ملغي' } : s
        ),
      };
    });
  };

  const deleteSalesOrder = async (saleId: string) => {
    const so = state.salesOrders.find((s) => s.id === saleId);
    if (!so) return;

    const wasDeducted =
      so.status === 'confirmed' || so.status === 'shipped' || so.status === 'delivered';
    const detailParts: string[] = [];
    if (wasDeducted) {
      detailParts.push('سيتم إرجاع القطع المباعة في هذا الطلب إلى مخزون المنتج التام تلقائياً.');
    }
    if ((so.paidAmount || 0) > 0 && so.status !== 'cancelled') {
      detailParts.push(
        `سيتم حذف المدفوعات المرتبطة بالطلب (${formatMoney(
          so.paidAmount,
          state.currency
        )}) من المبيعات ورصيد الخزنة.`
      );
    }
    detailParts.push('سيُحذف الطلب نهائياً ولا يمكن التراجع عن هذا الإجراء.');

    const ok = await confirmAction({
      title: 'تأكيد حذف طلب العميل نهائياً',
      message: `هل أنت متأكد من حذف الطلب «${so.orderNumber}» للعميل «${
        so.customerName
      }» بقيمة ${formatMoney(so.totalAmount, state.currency)}؟`,
      detail: detailParts.join(' '),
      confirmLabel: 'نعم، احذف الطلب نهائياً',
    });
    if (!ok) return;

    if (cloudConnected) {
      await runCloud(() =>
        erpDb.deleteSalesOrder(saleId, {
          orderNumber: so.orderNumber,
          status: so.status,
          items: so.items,
        })
      );
      return;
    }

    setState((prev) => {
      const target = prev.salesOrders.find((s) => s.id === saleId);
      if (!target) return prev;
      const restoreStock =
        target.status === 'confirmed' ||
        target.status === 'shipped' ||
        target.status === 'delivered';

      return {
        ...prev,
        models: restoreStock
          ? prev.models.map((m) => ({
              ...m,
              variants: m.variants.map((v) => {
                const qtyBack = target.items
                  .filter((it) => it.variantId === v.id)
                  .reduce((sum, it) => sum + it.quantity, 0);
                return qtyBack > 0
                  ? { ...v, finishedGoodsQty: v.finishedGoodsQty + qtyBack }
                  : v;
              }),
            }))
          : prev.models,
        salesOrders: prev.salesOrders.filter((s) => s.id !== saleId),
      };
    });
  };

  const importFullJSON = (data: ERPState) => {
    setState(data);
    setSelectedModelId(data.models[0]?.id ?? null);
  };

  const resetToSeedData = async (): Promise<boolean> => {
    const ok = await confirmAction({
      title: 'تأكيد استعادة البيانات الافتراضية',
      message: 'هل أنت متأكد من مسح البيانات المحلية الحالية واستعادة البيانات الافتراضية؟',
      detail: 'سيتم استبدال كافة البيانات المعروضة محلياً بالبيانات التجريبية الافتراضية.',
      confirmLabel: 'نعم، استعد البيانات الافتراضية',
    });
    if (!ok) return false;
    setState(SEED_DATA);
    setSelectedModelId(SEED_DATA.models[0]?.id ?? null);
    return true;
  };

  return (
    <ERPContext.Provider
      value={{
        state,
        activeTab,
        setActiveTab,
        selectedModelId,
        setSelectedModelId,
        openModelInCalculator,
        openModelInBOM,
        user,
        authChecked,
        passwordRecoveryMode,
        clearPasswordRecovery,
        offlineMode,
        setOfflineMode,
        cloudConnected,
        migration003Missing,
        syncing,
        syncError,
        clearSyncError: () => setSyncError(null),
        refreshFromCloud,
        signOut,
        setCurrency,
        saveSupplier,
        deleteSupplier,
        saveWorkshop,
        deleteWorkshop,
        addLookupItem,
        deleteLookupItem,
        saveCustomer,
        deleteCustomer,
        saveExpense,
        deleteExpense,
        savePartnerContribution,
        deletePartnerContribution,
        saveFabric,
        deleteFabric,
        importFabrics,
        saveTrim,
        deleteTrim,
        importTrims,
        saveOperation,
        deleteOperation,
        importOperations,
        saveModel,
        deleteModel,
        duplicateModel,
        importModels,
        applyTargetMarginToAllModels,
        addModelVariant,
        updateModelVariant,
        deleteModelVariant,
        setMonthlyVolume,
        saveOverheadItem,
        deleteOverheadItem,
        createAndReceivePO,
        receivePO,
        cancelPO,
        createProductionBatch,
        issueProductionBatch,
        completeProductionBatch,
        recordWorkshopPayment,
        updateProductionBatch,
        deleteProductionBatch,
        createSalesOrder,
        confirmSalesOrder,
        recordSalesPayment,
        updateSalesFulfillment,
        cancelSalesOrder,
        deleteSalesOrder,
        importFullJSON,
        resetToSeedData,
        lastSavedAt,
      }}
    >
      {children}
    </ERPContext.Provider>
  );
};

export function useERP(): ERPContextValue {
  const ctx = useContext(ERPContext);
  if (!ctx) throw new Error('useERP must be used within ERPProvider');
  return ctx;
}
