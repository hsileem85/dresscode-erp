import React, { createContext, useContext, useEffect, useState } from 'react';
import { SEED_DATA } from '../data/seedData';
import type {
  CurrencyCode,
  ERPState,
  Fabric,
  NavTab,
  OutsourcedOperation,
  OverheadItem,
  ProductModel,
  TrimAccessory,
} from '../types/erp';

const STORAGE_KEY = 'dresscode_erp_state_v1';

interface ERPContextValue {
  state: ERPState;
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  openModelInCalculator: (modelId: string) => void;
  openModelInBOM: (modelId: string) => void;
  setCurrency: (currency: CurrencyCode) => void;

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

  // Models
  saveModel: (model: ProductModel) => void;
  deleteModel: (id: string) => void;
  duplicateModel: (id: string) => void;
  importModels: (models: ProductModel[]) => void;

  // Overhead
  setMonthlyVolume: (volume: number) => void;
  saveOverheadItem: (item: OverheadItem) => void;
  deleteOverheadItem: (id: string) => void;

  // Data management
  importFullJSON: (data: ERPState) => void;
  resetToSeedData: () => void;
  lastSavedAt: string;
}

const ERPContext = createContext<ERPContextValue | undefined>(undefined);

function loadInitialState(): ERPState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED_DATA;
    const parsed = JSON.parse(raw) as Partial<ERPState>;
    if (!parsed || !Array.isArray(parsed.fabrics) || !Array.isArray(parsed.models)) {
      return SEED_DATA;
    }
    return {
      currency: parsed.currency || 'EGP',
      fabrics: parsed.fabrics,
      trims: Array.isArray(parsed.trims) ? parsed.trims : SEED_DATA.trims,
      operations: Array.isArray(parsed.operations)
        ? parsed.operations
        : SEED_DATA.operations,
      models: parsed.models,
      overhead:
        parsed.overhead && Array.isArray(parsed.overhead.items)
          ? parsed.overhead
          : SEED_DATA.overhead,
    };
  } catch {
    return SEED_DATA;
  }
}

export const ERPProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ERPState>(loadInitialState);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    () => loadInitialState().models[0]?.id ?? null
  );
  const [lastSavedAt, setLastSavedAt] = useState<string>(() =>
    new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setLastSavedAt(
        new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      );
    } catch {
      // ignore quota errors
    }
  }, [state]);

  const setCurrency = (currency: CurrencyCode) => {
    setState((prev) => ({ ...prev, currency }));
  };

  const openModelInCalculator = (modelId: string) => {
    setSelectedModelId(modelId);
    setActiveTab('calculator');
  };

  const openModelInBOM = (modelId: string) => {
    setSelectedModelId(modelId);
    setActiveTab('models');
  };

  // Fabrics CRUD
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
  };

  const deleteFabric = (id: string) => {
    setState((prev) => ({
      ...prev,
      fabrics: prev.fabrics.filter((f) => f.id !== id),
    }));
  };

  const importFabrics = (fabrics: Fabric[]) => {
    setState((prev) => ({ ...prev, fabrics: [...fabrics, ...prev.fabrics] }));
  };

  // Trims CRUD
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
  };

  const deleteTrim = (id: string) => {
    setState((prev) => ({
      ...prev,
      trims: prev.trims.filter((t) => t.id !== id),
    }));
  };

  const importTrims = (trims: TrimAccessory[]) => {
    setState((prev) => ({ ...prev, trims: [...trims, ...prev.trims] }));
  };

  // Operations CRUD
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
  };

  const deleteOperation = (id: string) => {
    setState((prev) => ({
      ...prev,
      operations: prev.operations.filter((o) => o.id !== id),
    }));
  };

  const importOperations = (ops: OutsourcedOperation[]) => {
    setState((prev) => ({ ...prev, operations: [...ops, ...prev.operations] }));
  };

  // Models CRUD
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
  };

  const deleteModel = (id: string) => {
    setState((prev) => {
      const remaining = prev.models.filter((m) => m.id !== id);
      if (selectedModelId === id) {
        setSelectedModelId(remaining[0]?.id ?? null);
      }
      return { ...prev, models: remaining };
    });
  };

  const duplicateModel = (id: string) => {
    const source = state.models.find((m) => m.id === id);
    if (!source) return;
    const copyId = `mod-${Date.now()}`;
    const copy: ProductModel = {
      ...source,
      id: copyId,
      name: `${source.name} (نسخة)`,
      sku: `${source.sku}-COPY`,
      fabrics: source.fabrics.map((f, i) => ({ ...f, id: `mf-${Date.now()}-${i}` })),
      trims: source.trims.map((t, i) => ({ ...t, id: `mt-${Date.now()}-${i}` })),
      laborSteps: source.laborSteps.map((l, i) => ({ ...l, id: `ml-${Date.now()}-${i}` })),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    saveModel(copy);
  };

  const importModels = (models: ProductModel[]) => {
    setState((prev) => ({ ...prev, models: [...models, ...prev.models] }));
  };

  // Overhead
  const setMonthlyVolume = (volume: number) => {
    setState((prev) => ({
      ...prev,
      overhead: {
        ...prev.overhead,
        estimatedMonthlyVolume: Math.max(1, volume),
      },
    }));
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
  };

  const deleteOverheadItem = (id: string) => {
    setState((prev) => ({
      ...prev,
      overhead: {
        ...prev.overhead,
        items: prev.overhead.items.filter((i) => i.id !== id),
      },
    }));
  };

  const importFullJSON = (data: ERPState) => {
    setState(data);
    setSelectedModelId(data.models[0]?.id ?? null);
  };

  const resetToSeedData = () => {
    setState(SEED_DATA);
    setSelectedModelId(SEED_DATA.models[0]?.id ?? null);
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
        setCurrency,
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
        setMonthlyVolume,
        saveOverheadItem,
        deleteOverheadItem,
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
