import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  Layers,
  PackageOpen,
  Plus,
  Scissors,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { getLookupLabels } from '../../data/defaultLookups';
import { newUuid } from '../../lib/supabase';
import type {
  Fabric,
  FabricUnit,
  TrimAccessory,
  TrimPurchaseUnit,
  TrimSupplyGroup,
} from '../../types/erp';
import {
  blockInvalidDecimalKey,
  blockNonIntegerKey,
  FABRIC_UNIT_LABELS,
  formatMoney,
  formatNumber,
  getTrimUnitCost,
  PURCHASE_UNIT_LABELS,
  toDecimalQty,
  toWholeQty,
} from '../../utils/calculations';
import { Modal } from '../common/Modal';

type SubTab = 'fabrics' | TrimSupplyGroup;

const BRAND_KEYWORDS = [
  'براند',
  'تيكت',
  'تغليف',
  'هوية',
  'شنط',
  'شنطة',
  'كيس',
  'أكياس',
  'اكياس',
  'كرت',
  'كروت',
  'ستيكر',
  'ليبل',
  'شكر',
];

const MANUFACTURING_KEYWORDS = [
  'تصنيع',
  'باترون',
  'مقص',
  'خيوط',
  'خيط',
  'بكر',
  'بكرة',
  'إبر',
  'ابر',
  'دبوس',
  'دبابيس',
  'طباشير',
  'ماركر',
  'مازورة',
  'مسطرة',
  'شريط قياس',
  'أدوات',
  'ادوات',
];

function getTrimSupplyGroup(trim: TrimAccessory): TrimSupplyGroup {
  if (
    trim.supplyGroup === 'trims' ||
    trim.supplyGroup === 'manufacturing' ||
    trim.supplyGroup === 'brand'
  ) {
    return trim.supplyGroup;
  }
  const haystack = `${trim.category || ''} ${trim.name || ''}`.toLowerCase();
  if (BRAND_KEYWORDS.some((kw) => haystack.includes(kw))) {
    return 'brand';
  }
  if (MANUFACTURING_KEYWORDS.some((kw) => haystack.includes(kw))) {
    return 'manufacturing';
  }
  return 'trims';
}

const SUPPLY_TAB_META: Record<
  TrimSupplyGroup,
  {
    label: string;
    addButtonLabel: string;
    modalAddTitle: string;
    modalEditTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    searchPlaceholder: string;
    emptyText: string;
    defaultCategory: string;
    defaultPurchaseUnit: TrimPurchaseUnit;
    defaultUnitsPerPack: number;
    defaultUnitLabel: string;
    defaultAutoBom: boolean;
    extraCategories: string[];
    presets: {
      name: string;
      category: string;
      purchaseUnit: TrimPurchaseUnit;
      unitsPerPack: number;
      unitLabel: string;
    }[];
  }
> = {
  trims: {
    label: 'الكلف',
    addButtonLabel: 'إضافة كلفة / إكسسوار',
    modalAddTitle: 'إضافة كلفة / إكسسوار جديد',
    modalEditTitle: 'تعديل الكلفة / الإكسسوار',
    nameLabel: 'اسم الكلفة / الإكسسوار *',
    namePlaceholder: 'مثال: سحاب مخفي / أزرار لؤلؤ / أستيك / دانتيل',
    searchPlaceholder: 'ابحث باسم الكلفة أو التصنيف...',
    emptyText: 'لا توجد كلف أو إكسسوارات مطابقة للبحث.',
    defaultCategory: 'إكسسوارات',
    defaultPurchaseUnit: 'dozen',
    defaultUnitsPerPack: 12,
    defaultUnitLabel: 'قطعة',
    defaultAutoBom: false,
    extraCategories: ['أزرار', 'سحابات', 'إكسسوارات'],
    presets: [
      { name: 'أزرار', category: 'أزرار', purchaseUnit: 'dozen', unitsPerPack: 12, unitLabel: 'زر' },
      { name: 'زراير كبس', category: 'أزرار', purchaseUnit: 'pack', unitsPerPack: 100, unitLabel: 'زر' },
      { name: 'سحاب مخفي', category: 'سحابات', purchaseUnit: 'dozen', unitsPerPack: 12, unitLabel: 'سحاب' },
      { name: 'أستيك / كلف إضافية', category: 'إكسسوارات', purchaseUnit: 'roll', unitsPerPack: 25, unitLabel: 'متر' },
      { name: 'فازلين / حشو', category: 'إكسسوارات', purchaseUnit: 'roll', unitsPerPack: 50, unitLabel: 'متر' },
    ],
  },
  manufacturing: {
    label: 'مستلزمات التصنيع',
    addButtonLabel: 'إضافة مستلزم تصنيع',
    modalAddTitle: 'إضافة مستلزم تصنيع جديد',
    modalEditTitle: 'تعديل مستلزم التصنيع',
    nameLabel: 'اسم مستلزم التصنيع *',
    namePlaceholder: 'مثال: ورق باترون كرافت / مقص قماش / خيوط أوفرلوك / إبر ماكينة',
    searchPlaceholder: 'ابحث في مستلزمات التصنيع (باترون، مقص، خيوط...)',
    emptyText: 'لا توجد مستلزمات تصنيع مسجلة بعد — اضغط «إضافة مستلزم تصنيع» للبدء.',
    defaultCategory: 'مستلزمات التصنيع',
    defaultPurchaseUnit: 'piece',
    defaultUnitsPerPack: 1,
    defaultUnitLabel: 'قطعة',
    defaultAutoBom: false,
    extraCategories: ['مستلزمات التصنيع', 'ورق باترون وأدوات قص', 'خيوط'],
    presets: [
      { name: 'ورق باترون كرافت', category: 'ورق باترون وأدوات قص', purchaseUnit: 'roll', unitsPerPack: 50, unitLabel: 'متر' },
      { name: 'مقص قماش احترافي', category: 'ورق باترون وأدوات قص', purchaseUnit: 'piece', unitsPerPack: 1, unitLabel: 'مقص' },
      { name: 'خيوط خياطة / أوفرلوك', category: 'خيوط', purchaseUnit: 'cone', unitsPerPack: 1, unitLabel: 'بكرة' },
      { name: 'إبر ماكينة خياطة', category: 'مستلزمات التصنيع', purchaseUnit: 'pack', unitsPerPack: 10, unitLabel: 'إبرة' },
      { name: 'دبابيس وطباشير قص', category: 'ورق باترون وأدوات قص', purchaseUnit: 'box', unitsPerPack: 1, unitLabel: 'علبة' },
      { name: 'مازورة / مسطرة باترون', category: 'ورق باترون وأدوات قص', purchaseUnit: 'piece', unitsPerPack: 1, unitLabel: 'قطعة' },
    ],
  },
  brand: {
    label: 'مستلزمات البراند',
    addButtonLabel: 'إضافة مستلزم براند',
    modalAddTitle: 'إضافة مستلزم براند وتغليف جديد',
    modalEditTitle: 'تعديل مستلزم البراند والتغليف',
    nameLabel: 'اسم مستلزم البراند / التغليف *',
    namePlaceholder: 'مثال: شنط البراند / كيس تغليف / تيكت منسوج / كروت شكر',
    searchPlaceholder: 'ابحث في مستلزمات البراند (شنط، تغليف، تيكت، كروت...)',
    emptyText: 'لا توجد مستلزمات براند وتغليف مسجلة بعد — اضغط «إضافة مستلزم براند» للبدء.',
    defaultCategory: 'التغليف والهوية',
    defaultPurchaseUnit: 'pack',
    defaultUnitsPerPack: 100,
    defaultUnitLabel: 'قطعة',
    defaultAutoBom: true,
    extraCategories: ['تيكت وهوية البراند', 'التغليف والهوية', 'شنط وكروت البراند'],
    presets: [
      { name: 'شنط البراند', category: 'شنط وكروت البراند', purchaseUnit: 'pack', unitsPerPack: 100, unitLabel: 'شنطة' },
      { name: 'شنطة سوستة / كيس تغليف', category: 'التغليف والهوية', purchaseUnit: 'pack', unitsPerPack: 100, unitLabel: 'كيس' },
      { name: 'تيكت منسوج (لوجو البراند)', category: 'تيكت وهوية البراند', purchaseUnit: 'pack', unitsPerPack: 500, unitLabel: 'تيكت' },
      { name: 'تيكت مقاس وعناية', category: 'تيكت وهوية البراند', purchaseUnit: 'pack', unitsPerPack: 500, unitLabel: 'تيكت' },
      { name: 'كروت البراند', category: 'شنط وكروت البراند', purchaseUnit: 'pack', unitsPerPack: 250, unitLabel: 'كرت' },
      { name: 'كروت شكر / ستيكر إغلاق', category: 'التغليف والهوية', purchaseUnit: 'pack', unitsPerPack: 250, unitLabel: 'كرت' },
      { name: 'خيط التيكت', category: 'تيكت وهوية البراند', purchaseUnit: 'pack', unitsPerPack: 500, unitLabel: 'قطعة' },
    ],
  },
};

const EMPTY_FABRIC: Omit<Fabric, 'id'> = {
  name: '',
  supplier: '',
  unit: 'meter',
  pricePerUnit: 0,
  widthCm: 150,
  defaultWastePct: 6,
  stockQty: 0,
  reorderLevel: 20,
  colorOrCode: '',
  notes: '',
};

const buildEmptyTrimForGroup = (group: TrimSupplyGroup): Omit<TrimAccessory, 'id'> => {
  const meta = SUPPLY_TAB_META[group];
  return {
    name: '',
    category: meta.defaultCategory,
    supplyGroup: group,
    supplier: '',
    purchaseUnit: meta.defaultPurchaseUnit,
    packPrice: 0,
    unitsPerPack: meta.defaultUnitsPerPack,
    unitLabel: meta.defaultUnitLabel,
    stockQty: 0,
    reorderLevel: group === 'manufacturing' ? 5 : 50,
    autoIncludeInBom: meta.defaultAutoBom,
    defaultQtyPerPiece: 1,
    notes: '',
  };
};

export const MaterialsView: React.FC = () => {
  const { state, saveFabric, deleteFabric, saveTrim, deleteTrim } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('fabrics');
  const [query, setQuery] = useState('');

  // Fabric modal state
  const [fabricModalOpen, setFabricModalOpen] = useState(false);
  const [editingFabricId, setEditingFabricId] = useState<string | null>(null);
  const [fabricForm, setFabricForm] = useState<Omit<Fabric, 'id'>>(EMPTY_FABRIC);

  // Trim / Supplies modal state
  const [trimModalOpen, setTrimModalOpen] = useState(false);
  const [editingTrimId, setEditingTrimId] = useState<string | null>(null);
  const [trimForm, setTrimForm] = useState<Omit<TrimAccessory, 'id'>>(() =>
    buildEmptyTrimForGroup('trims')
  );

  const groupedTrims = useMemo(() => {
    const groups: Record<TrimSupplyGroup, TrimAccessory[]> = {
      trims: [],
      manufacturing: [],
      brand: [],
    };
    for (const t of state.trims) {
      groups[getTrimSupplyGroup(t)].push(t);
    }
    return groups;
  }, [state.trims]);

  const filteredFabrics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.fabrics;
    return state.fabrics.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.supplier.toLowerCase().includes(q) ||
        (f.colorOrCode || '').toLowerCase().includes(q)
    );
  }, [state.fabrics, query]);

  const activeSupplyGroup: TrimSupplyGroup = subTab === 'fabrics' ? 'trims' : subTab;

  const filteredSupplyItems = useMemo(() => {
    const source = groupedTrims[activeSupplyGroup];
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.supplier.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q)
    );
  }, [groupedTrims, activeSupplyGroup, query]);

  const autoBomTrimsSummary = useMemo(() => {
    const autoList = state.trims.filter((t) => Boolean(t.autoIncludeInBom));
    const totalPerPiece = autoList.reduce(
      (sum, t) => sum + getTrimUnitCost(t) * (t.defaultQtyPerPiece ?? 1),
      0
    );
    return { count: autoList.length, totalPerPiece };
  }, [state.trims]);

  const modalSupplyGroup: TrimSupplyGroup = trimForm.supplyGroup || activeSupplyGroup;
  const modalMeta = SUPPLY_TAB_META[modalSupplyGroup];
  const activeTabMeta = SUPPLY_TAB_META[activeSupplyGroup];

  const availableTrimCategories = useMemo(() => {
    const base = getLookupLabels(state.lookups, 'trim_categories');
    const extras = [
      ...SUPPLY_TAB_META.trims.extraCategories,
      ...SUPPLY_TAB_META.manufacturing.extraCategories,
      ...SUPPLY_TAB_META.brand.extraCategories,
    ];
    const merged = Array.from(new Set([...modalMeta.extraCategories, ...base, ...extras]));
    if (trimForm.category && !merged.includes(trimForm.category)) {
      merged.unshift(trimForm.category);
    }
    return merged;
  }, [state.lookups, modalMeta.extraCategories, trimForm.category]);

  const openNewFabric = () => {
    setEditingFabricId(null);
    setFabricForm(EMPTY_FABRIC);
    setFabricModalOpen(true);
  };

  const openEditFabric = (fabric: Fabric) => {
    setEditingFabricId(fabric.id);
    setFabricForm({
      name: fabric.name,
      supplierId: fabric.supplierId,
      supplier: fabric.supplier,
      unit: fabric.unit,
      pricePerUnit: fabric.pricePerUnit,
      widthCm: fabric.widthCm,
      defaultWastePct: fabric.defaultWastePct,
      stockQty: fabric.stockQty ?? 0,
      reorderLevel: fabric.reorderLevel ?? 20,
      colorOrCode: fabric.colorOrCode || '',
      notes: fabric.notes || '',
    });
    setFabricModalOpen(true);
  };

  const handleFabricSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fabricForm.name.trim()) return;
    saveFabric({
      id: editingFabricId || newUuid(),
      ...fabricForm,
      pricePerUnit: Number(fabricForm.pricePerUnit) || 0,
      widthCm: Number(fabricForm.widthCm) || 150,
      defaultWastePct: Number(fabricForm.defaultWastePct) || 0,
    });
    setFabricModalOpen(false);
  };

  const openNewSupplyItem = (group: TrimSupplyGroup) => {
    setEditingTrimId(null);
    setTrimForm(buildEmptyTrimForGroup(group));
    setTrimModalOpen(true);
  };

  const openEditTrim = (trim: TrimAccessory) => {
    setEditingTrimId(trim.id);
    setTrimForm({
      name: trim.name,
      category: trim.category,
      supplyGroup: getTrimSupplyGroup(trim),
      supplierId: trim.supplierId,
      supplier: trim.supplier,
      purchaseUnit: trim.purchaseUnit,
      packPrice: trim.packPrice,
      unitsPerPack: trim.unitsPerPack,
      unitLabel: trim.unitLabel,
      stockQty: trim.stockQty ?? 0,
      reorderLevel: trim.reorderLevel ?? 50,
      autoIncludeInBom: Boolean(trim.autoIncludeInBom),
      defaultQtyPerPiece: trim.defaultQtyPerPiece ?? 1,
      notes: trim.notes || '',
    });
    setTrimModalOpen(true);
  };

  const toggleTrimAutoBom = (trim: TrimAccessory) => {
    saveTrim({
      ...trim,
      supplyGroup: getTrimSupplyGroup(trim),
      autoIncludeInBom: !trim.autoIncludeInBom,
      defaultQtyPerPiece: trim.defaultQtyPerPiece ?? 1,
    });
  };

  const handleTrimUnitPreset = (unit: TrimPurchaseUnit) => {
    const defaultQty =
      unit === 'dozen'
        ? 12
        : unit === 'piece'
        ? 1
        : unit === 'weight'
        ? 1000
        : trimForm.unitsPerPack || 100;
    setTrimForm((prev) => ({
      ...prev,
      purchaseUnit: unit,
      unitsPerPack: defaultQty,
      unitLabel: unit === 'weight' ? 'جرام' : prev.unitLabel === 'جرام' ? 'قطعة' : prev.unitLabel,
    }));
  };

  const handleTrimSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimForm.name.trim()) return;
    const resolvedGroup = trimForm.supplyGroup || activeSupplyGroup;
    saveTrim({
      id: editingTrimId || newUuid(),
      ...trimForm,
      supplyGroup: resolvedGroup,
      packPrice: Number(trimForm.packPrice) || 0,
      unitsPerPack: Math.max(1, Number(trimForm.unitsPerPack) || 1),
      autoIncludeInBom: Boolean(trimForm.autoIncludeInBom),
      defaultQtyPerPiece: Math.max(0, Number(trimForm.defaultQtyPerPiece ?? 1) || 0),
    });
    setTrimModalOpen(false);
  };

  const previewTrimUnitCost =
    (Number(trimForm.packPrice) || 0) / Math.max(1, Number(trimForm.unitsPerPack) || 1);

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 sm:gap-4 bg-white p-3.5 sm:p-4 rounded-2xl border border-[#E5E3DD]">
        <div className="grid grid-cols-2 sm:inline-flex sm:flex-wrap rounded-xl bg-[#F3F2EE] p-1 gap-1 w-full xl:w-auto">
          <button
            id="tab-fabrics"
            type="button"
            onClick={() => setSubTab('fabrics')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              subTab === 'fabrics'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <Layers className="w-4 h-4 text-[#BD956D] shrink-0" />
            <span>الأقمشة ({state.fabrics.length})</span>
          </button>

          <button
            id="tab-trims"
            type="button"
            onClick={() => setSubTab('trims')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              subTab === 'trims'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <PackageOpen className="w-4 h-4 text-[#BD956D] shrink-0" />
            <span>الكلف ({groupedTrims.trims.length})</span>
          </button>

          <button
            id="tab-manufacturing-supplies"
            type="button"
            onClick={() => setSubTab('manufacturing')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              subTab === 'manufacturing'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <Scissors className="w-4 h-4 text-[#BD956D] shrink-0" />
            <span>مستلزمات التصنيع ({groupedTrims.manufacturing.length})</span>
          </button>

          <button
            id="tab-brand-supplies"
            type="button"
            onClick={() => setSubTab('brand')}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              subTab === 'brand'
                ? 'bg-[#1A1A1E] text-white shadow-sm'
                : 'text-[#6E6C66] hover:text-[#1A1A1E]'
            }`}
          >
            <ShoppingBag className="w-4 h-4 text-[#BD956D] shrink-0" />
            <span>مستلزمات البراند ({groupedTrims.brand.length})</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9C9990] absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                subTab === 'fabrics'
                  ? 'ابحث باسم القماش أو المورد...'
                  : activeTabMeta.searchPlaceholder
              }
              className="w-full sm:w-64 rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] pr-9 pl-3 py-2 text-sm text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
            />
          </div>

          <button
            id={subTab === 'fabrics' ? 'btn-add-fabric' : `btn-add-${subTab}`}
            type="button"
            onClick={() =>
              subTab === 'fabrics' ? openNewFabric() : openNewSupplyItem(subTab)
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-sm font-semibold px-4 py-2.5 sm:py-2 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>
              {subTab === 'fabrics' ? 'إضافة قماش جديد' : activeTabMeta.addButtonLabel}
            </span>
          </button>
        </div>
      </div>

      {/* Fabrics List (Mobile Cards + Desktop Table) */}
      {subTab === 'fabrics' && (
        <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
          <div className="md:hidden divide-y divide-[#F0EFEA]">
            {filteredFabrics.map((fabric) => {
              const effectivePrice =
                fabric.pricePerUnit * (1 + fabric.defaultWastePct / 100);
              return (
                <div key={fabric.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-[#1A1A1E]">{fabric.name}</div>
                      <div className="text-xs text-[#6E6C66] mt-0.5">{fabric.supplier}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditFabric(fabric)}
                        className="p-2 rounded-lg bg-[#FAF9F7] text-[#4B4A46] cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteFabric(fabric.id)}
                        className="p-2 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-[#FAF9F7] rounded-xl p-2.5">
                    <div>
                      <div className="text-[#6E6C66]">الرصيد بالمخزن</div>
                      <div
                        className={`font-extrabold tabular-nums ${
                          fabric.stockQty <= fabric.reorderLevel
                            ? 'text-red-600'
                            : 'text-emerald-700'
                        }`}
                      >
                        {formatNumber(fabric.stockQty, 2)} {FABRIC_UNIT_LABELS[fabric.unit]}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6E6C66]">السعر</div>
                      <div className="font-bold tabular-nums">
                        {formatMoney(fabric.pricePerUnit, state.currency)}/{FABRIC_UNIT_LABELS[fabric.unit]}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6E6C66]">العرض / هالك</div>
                      <div className="font-semibold tabular-nums">
                        {fabric.widthCm}سم • {fabric.defaultWastePct}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[#6E6C66]">بالهالك</div>
                      <div className="font-bold text-[#8E6742] tabular-nums">
                        {formatMoney(effectivePrice, state.currency)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredFabrics.length === 0 && (
              <div className="p-8 text-center text-xs text-[#6E6C66]">
                لا توجد أقمشة مطابقة للبحث.
              </div>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">اسم القماش</th>
                  <th className="py-3.5 px-4 font-semibold">المورد</th>
                  <th className="py-3.5 px-4 font-semibold">الرصيد بالمخزن</th>
                  <th className="py-3.5 px-4 font-semibold">السعر / الوحدة</th>
                  <th className="py-3.5 px-4 font-semibold">العرض</th>
                  <th className="py-3.5 px-4 font-semibold">الهالك الافتراضي</th>
                  <th className="py-3.5 px-4 font-semibold">التكلفة الفعلية بالهالك</th>
                  <th className="py-3.5 px-4 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EFEA]">
                {filteredFabrics.map((fabric) => {
                  const effectivePrice =
                    fabric.pricePerUnit * (1 + fabric.defaultWastePct / 100);
                  return (
                    <tr key={fabric.id} className="hover:bg-[#FAF9F7]/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[#1A1A1E]">{fabric.name}</div>
                        {(fabric.colorOrCode || fabric.notes) && (
                          <div className="text-xs text-[#6E6C66] mt-0.5 truncate max-w-xs">
                            {fabric.colorOrCode && (
                              <span className="font-mono text-[#8E6742] ml-2">
                                [{fabric.colorOrCode}]
                              </span>
                            )}
                            {fabric.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-[#4B4A46]">{fabric.supplier}</td>
                      <td className="py-3.5 px-4 tabular-nums">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                            fabric.stockQty <= fabric.reorderLevel
                              ? 'bg-red-100 text-red-700'
                              : 'bg-[#F6EFE7] text-[#8E6742]'
                          }`}
                        >
                          {formatNumber(fabric.stockQty, 2)} {FABRIC_UNIT_LABELS[fabric.unit]}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums font-semibold text-[#1A1A1E]">
                        {formatMoney(fabric.pricePerUnit, state.currency)}{' '}
                        <span className="text-xs font-normal text-[#6E6C66]">
                          / {FABRIC_UNIT_LABELS[fabric.unit]}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums text-[#4B4A46]">
                        {fabric.widthCm} سم
                      </td>
                      <td className="py-3.5 px-4 tabular-nums">
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-[#F3F2EE] text-[#1A1A1E] text-xs font-semibold">
                          {fabric.defaultWastePct}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 tabular-nums font-bold text-[#8E6742]">
                        {formatMoney(effectivePrice, state.currency)}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditFabric(fabric)}
                            aria-label="تعديل القماش"
                            className="p-1.5 rounded-lg text-[#4B4A46] hover:text-[#1A1A1E] hover:bg-[#F3F2EE] cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteFabric(fabric.id)}
                            aria-label="حذف القماش"
                            className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredFabrics.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-[#6E6C66]">
                      لا توجد أقمشة مطابقة للبحث.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trims / Manufacturing Supplies / Brand Supplies List */}
      {subTab !== 'fabrics' && (
        <div className="space-y-3">
          {/* Contextual Info & Auto-BOM Summary Bar */}
          <div className="rounded-2xl border border-[#E6D5C3] bg-[#FBF8F4] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-[#7B5836]">
              {subTab === 'manufacturing' ? (
                <>
                  <Scissors className="w-4 h-4 text-[#A67C52] shrink-0" />
                  <span>
                    سجّل هنا <strong>مستلزمات وأدوات التصنيع</strong> (ورق الباترون، المقصات، الخيوط، الإبر، الدبابيس...) لمتابعة رصيدها وشرائها في أوامر الشراء، ويمكنك تفعيل «تلقائي في التكلفة» لأي خامة مستهلكة بالقطعة.
                  </span>
                </>
              ) : subTab === 'brand' ? (
                <>
                  <ShoppingBag className="w-4 h-4 text-[#A67C52] shrink-0" />
                  <span>
                    سجّل هنا <strong>مستلزمات البراند والتغليف</strong> (الشنط، أكياس التغليف، التيكت، الكروت، خيط التيكت) وفعّل <strong>«تلقائي في التكلفة»</strong> ليُحتسب كل بند تلقائياً في تكلفة كل موديل.
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#A67C52] shrink-0" />
                  <span>
                    سجّل هنا <strong>الكلف والإكسسوارات</strong> (الأزرار، السحابات، الأستيك، الدانتيل...) لإضافتها في بطاقات الموديلات (BOM) أو تفعيل الاحتساب التلقائي عند الحاجة.
                  </span>
                </>
              )}
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl bg-white border border-[#E6D5C3] px-3 py-1.5 text-xs shrink-0">
              <span className="text-[#6E6C66]">التلقائي بالنظام:</span>
              <span className="font-bold text-[#1A1A1E]">
                {autoBomTrimsSummary.count} {autoBomTrimsSummary.count === 1 ? 'بند' : 'بنود'}
              </span>
              <span className="text-[#E5E3DD]">|</span>
              <span className="font-bold text-[#8E6742] tabular-nums">
                {formatMoney(autoBomTrimsSummary.totalPerPiece, state.currency)} / قطعة
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E5E3DD] overflow-hidden">
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-[#F0EFEA]">
              {filteredSupplyItems.map((trim) => {
                const unitCost = getTrimUnitCost(trim);
                const isAuto = Boolean(trim.autoIncludeInBom);
                const autoQty = trim.defaultQtyPerPiece ?? 1;
                return (
                  <div key={trim.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-[#1A1A1E]">{trim.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="inline-flex px-2 py-0.5 rounded-full bg-[#F6EFE7] text-[#8E6742] text-[11px] font-medium">
                            {trim.category}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleTrimAutoBom(trim)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                              isAuto
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-[#F3F2EE] text-[#6E6C66] border border-[#E5E3DD]'
                            }`}
                          >
                            {isAuto && <Check className="w-3 h-3" />}
                            <span>
                              {isAuto
                                ? `تلقائي في التكلفة (×${formatNumber(autoQty, 2)})`
                                : 'يدوي بالبطاقة'}
                            </span>
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditTrim(trim)}
                          className="p-2 rounded-lg bg-[#FAF9F7] text-[#4B4A46] cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTrim(trim.id)}
                          className="p-2 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] bg-[#FAF9F7] rounded-xl p-2.5">
                      <div>
                        <div className="text-[#6E6C66]">الرصيد بالمخزن</div>
                        <div
                          className={`font-extrabold tabular-nums ${
                            trim.stockQty <= trim.reorderLevel
                              ? 'text-red-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatNumber(trim.stockQty, 0)} {trim.unitLabel}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#6E6C66]">
                          العبوة ({formatNumber(trim.unitsPerPack, 0)} {trim.unitLabel})
                        </div>
                        <div className="font-semibold tabular-nums">
                          {formatMoney(trim.packPrice, state.currency)} / {PURCHASE_UNIT_LABELS[trim.purchaseUnit]}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#6E6C66]">تكلفة الوحدة</div>
                        <div className="font-bold text-[#8E6742] tabular-nums">
                          {formatMoney(unitCost, state.currency)} / {trim.unitLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredSupplyItems.length === 0 && (
                <div className="p-8 text-center text-xs text-[#6E6C66]">
                  {activeTabMeta.emptyText}
                </div>
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-[#FAF9F7] text-[#6E6C66] text-xs border-b border-[#E5E3DD]">
                  <tr>
                    <th className="py-3.5 px-4 font-semibold">
                      {subTab === 'manufacturing'
                        ? 'مستلزم التصنيع'
                        : subTab === 'brand'
                        ? 'مستلزم البراند / التغليف'
                        : 'اسم الكلفة / الإكسسوار'}
                    </th>
                    <th className="py-3.5 px-4 font-semibold">التصنيف</th>
                    <th className="py-3.5 px-4 font-semibold">المورد</th>
                    <th className="py-3.5 px-4 font-semibold">الرصيد بالمخزن</th>
                    <th className="py-3.5 px-4 font-semibold">شراء بالعبوة</th>
                    <th className="py-3.5 px-4 font-semibold">تحويل الوحدة</th>
                    <th className="py-3.5 px-4 font-semibold">تكلفة الوحدة الواحدة</th>
                    <th className="py-3.5 px-4 font-semibold">الاحتساب في التكلفة (BOM)</th>
                    <th className="py-3.5 px-4 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EFEA]">
                  {filteredSupplyItems.map((trim) => {
                    const unitCost = getTrimUnitCost(trim);
                    const isAuto = Boolean(trim.autoIncludeInBom);
                    const autoQty = trim.defaultQtyPerPiece ?? 1;
                    return (
                      <tr key={trim.id} className="hover:bg-[#FAF9F7]/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#1A1A1E]">{trim.name}</div>
                          {trim.notes && (
                            <div className="text-xs text-[#6E6C66] mt-0.5 truncate max-w-xs">
                              {trim.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#F6EFE7] text-[#8E6742] text-xs font-medium">
                            {trim.category}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-[#4B4A46]">{trim.supplier}</td>
                        <td className="py-3.5 px-4 tabular-nums">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-extrabold ${
                              trim.stockQty <= trim.reorderLevel
                                ? 'bg-red-100 text-red-700'
                                : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {formatNumber(trim.stockQty, 0)} {trim.unitLabel}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 tabular-nums text-[#1A1A1E]">
                          {formatMoney(trim.packPrice, state.currency)}{' '}
                          <span className="text-xs text-[#6E6C66]">
                            / {PURCHASE_UNIT_LABELS[trim.purchaseUnit]}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 tabular-nums text-xs text-[#6E6C66]">
                          {formatNumber(trim.unitsPerPack, 0)} {trim.unitLabel}
                        </td>
                        <td className="py-3.5 px-4 tabular-nums font-bold text-[#8E6742]">
                          {formatMoney(unitCost, state.currency)}{' '}
                          <span className="text-xs font-normal text-[#6E6C66]">
                            / {trim.unitLabel}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <button
                            type="button"
                            onClick={() => toggleTrimAutoBom(trim)}
                            title={
                              isAuto
                                ? 'اضغط لتحويله إلى إضافة يدوية'
                                : 'اضغط لتفعيل الاحتساب التلقائي في كل الموديلات'
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                              isAuto
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                : 'bg-[#F3F2EE] text-[#6E6C66] border border-[#E5E3DD] hover:bg-[#EAE8E2] hover:text-[#1A1A1E]'
                            }`}
                          >
                            {isAuto && <Check className="w-3.5 h-3.5" />}
                            <span>
                              {isAuto
                                ? `تلقائي (×${formatNumber(autoQty, 2)})`
                                : 'يدوي'}
                            </span>
                          </button>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditTrim(trim)}
                              aria-label="تعديل البند"
                              className="p-1.5 rounded-lg text-[#4B4A46] hover:text-[#1A1A1E] hover:bg-[#F3F2EE] cursor-pointer"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteTrim(trim.id)}
                              aria-label="حذف البند"
                              className="p-1.5 rounded-lg text-[#9C9990] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredSupplyItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-[#6E6C66]">
                        {activeTabMeta.emptyText}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Fabric Modal */}
      <Modal
        open={fabricModalOpen}
        onClose={() => setFabricModalOpen(false)}
        title={editingFabricId ? 'تعديل بيانات القماش' : 'إضافة قماش جديد'}
        subtitle="أدخل سعر المتر أو الكيلو ونسبة الهالك الافتراضية لاستخدامها تلقائياً في بطاقة الموديل"
      >
        <form onSubmit={handleFabricSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                اسم القماش *
              </label>
              <input
                type="text"
                required
                value={fabricForm.name}
                onChange={(e) => setFabricForm({ ...fabricForm, name: e.target.value })}
                placeholder="مثال: كريب ندى كوري أصلي"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                المورد
              </label>
              <select
                value={fabricForm.supplierId || ''}
                onChange={(e) => {
                  const sup = state.suppliers.find((s) => s.id === e.target.value);
                  setFabricForm({
                    ...fabricForm,
                    supplierId: sup ? sup.id : null,
                    supplier: sup ? sup.name : fabricForm.supplier || 'مورد عام',
                  });
                }}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              >
                <option value="">-- اختر المورد من البيانات الأساسية --</option>
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                كود / لون القماش
              </label>
              <input
                type="text"
                value={fabricForm.colorOrCode}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, colorOrCode: e.target.value })
                }
                placeholder="مثال: CR-ND-01"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                وحدة التسعير
              </label>
              <select
                value={fabricForm.unit}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, unit: e.target.value as FabricUnit })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                <option value="meter">بالمتر</option>
                <option value="kg">بالكيلو</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                السعر لكل {FABRIC_UNIT_LABELS[fabricForm.unit]} *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={fabricForm.pricePerUnit}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, pricePerUnit: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                العرض (سم)
              </label>
              <input
                type="number"
                min="10"
                value={fabricForm.widthCm}
                onChange={(e) =>
                  setFabricForm({ ...fabricForm, widthCm: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                نسبة الهالك الافتراضية (%)
              </label>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={fabricForm.defaultWastePct}
                onChange={(e) =>
                  setFabricForm({
                    ...fabricForm,
                    defaultWastePct: Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                الرصيد المتاح حالياً بالمخزن ({FABRIC_UNIT_LABELS[fabricForm.unit]})
                <span className="text-[11px] font-normal text-[#6E6C66] mr-1">(يقبل كسور مثل 4.5)</span>
              </label>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={fabricForm.stockQty ?? 0}
                onKeyDown={blockInvalidDecimalKey}
                onChange={(e) =>
                  setFabricForm({
                    ...fabricForm,
                    stockQty: toDecimalQty(e.target.value, 0, 3),
                  })
                }
                className="w-full rounded-xl border border-[#E5E3DD] bg-[#FBF8F4] px-3.5 py-2.5 text-sm font-bold text-[#8E6742] tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                ملاحظات
              </label>
              <textarea
                rows={2}
                value={fabricForm.notes}
                onChange={(e) => setFabricForm({ ...fabricForm, notes: e.target.value })}
                placeholder="ملاحظات عن الانكماش أو طبيعة القماش..."
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setFabricModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-[#1A1A1E] hover:bg-[#2E2E35] text-white cursor-pointer"
            >
              {editingFabricId ? 'حفظ التعديلات' : 'إضافة القماش'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Trim / Manufacturing Supply / Brand Supply Modal */}
      <Modal
        open={trimModalOpen}
        onClose={() => setTrimModalOpen(false)}
        title={editingTrimId ? modalMeta.modalEditTitle : modalMeta.modalAddTitle}
        subtitle="أدخل سعر العبوة أو القطعة أو الدستة أو اللّفة وسيتم احتساب تكلفة الوحدة تلقائياً"
      >
        <form onSubmit={handleTrimSubmit} className="space-y-4">
          {/* Quick Presets */}
          {!editingTrimId && (
            <div>
              <span className="block text-[11px] font-semibold text-[#6E6C66] mb-1.5">
                اختيار سريع لبنود {modalMeta.label}:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {modalMeta.presets.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() =>
                      setTrimForm((prev) => ({
                        ...prev,
                        name: preset.name,
                        category: preset.category,
                        purchaseUnit: preset.purchaseUnit,
                        unitsPerPack: preset.unitsPerPack,
                        unitLabel: preset.unitLabel,
                      }))
                    }
                    className="text-xs px-2.5 py-1 rounded-lg bg-[#F3F2EE] hover:bg-[#F6EFE7] hover:text-[#8E6742] text-[#1A1A1E] transition-colors cursor-pointer"
                  >
                    + {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                {modalMeta.nameLabel}
              </label>
              <input
                type="text"
                required
                value={trimForm.name}
                onChange={(e) => setTrimForm({ ...trimForm, name: e.target.value })}
                placeholder={modalMeta.namePlaceholder}
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                القسم (التبويب)
              </label>
              <select
                value={modalSupplyGroup}
                onChange={(e) => {
                  const nextGroup = e.target.value as TrimSupplyGroup;
                  const nextMeta = SUPPLY_TAB_META[nextGroup];
                  setTrimForm((prev) => ({
                    ...prev,
                    supplyGroup: nextGroup,
                    category: nextMeta.defaultCategory,
                  }));
                }}
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                <option value="trims">الكلف والإكسسوارات</option>
                <option value="manufacturing">مستلزمات التصنيع (باترون، مقص، خيوط...)</option>
                <option value="brand">مستلزمات البراند (شنط، تغليف، تيكت...)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                التصنيف
              </label>
              <select
                value={trimForm.category}
                onChange={(e) => setTrimForm({ ...trimForm, category: e.target.value })}
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                {availableTrimCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                المورد
              </label>
              <select
                value={trimForm.supplierId || ''}
                onChange={(e) => {
                  const sup = state.suppliers.find((s) => s.id === e.target.value);
                  setTrimForm({
                    ...trimForm,
                    supplierId: sup ? sup.id : null,
                    supplier: sup ? sup.name : trimForm.supplier || 'مورد عام',
                  });
                }}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              >
                <option value="">-- اختر المورد من البيانات الأساسية --</option>
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                وحدة الشراء
              </label>
              <select
                value={trimForm.purchaseUnit}
                onChange={(e) =>
                  handleTrimUnitPreset(e.target.value as TrimPurchaseUnit)
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:border-[#A67C52]"
              >
                {Object.entries(PURCHASE_UNIT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                سعر الشراء للعبوة / الدستة *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={trimForm.packPrice}
                onChange={(e) =>
                  setTrimForm({ ...trimForm, packPrice: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                عدد الوحدات داخل العبوة *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                value={trimForm.unitsPerPack || ''}
                onKeyDown={blockNonIntegerKey}
                onChange={(e) =>
                  setTrimForm({ ...trimForm, unitsPerPack: toWholeQty(e.target.value, 0) })
                }
                onBlur={() =>
                  setTrimForm({ ...trimForm, unitsPerPack: toWholeQty(trimForm.unitsPerPack, 1) })
                }
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                مسمى الوحدة الواحدة
              </label>
              <input
                type="text"
                value={trimForm.unitLabel}
                onChange={(e) => setTrimForm({ ...trimForm, unitLabel: e.target.value })}
                placeholder="مثال: قطعة / متر / بكرة / شنطة / تيكت"
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                الرصيد المتاح بالمخزن ({trimForm.unitLabel || 'قطعة'})
              </label>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                pattern="[0-9]*"
                value={trimForm.stockQty ?? 0}
                onKeyDown={blockNonIntegerKey}
                onChange={(e) =>
                  setTrimForm({
                    ...trimForm,
                    stockQty: toWholeQty(e.target.value, 0),
                  })
                }
                className="w-full rounded-xl border border-[#E5E3DD] bg-[#FBF8F4] px-3.5 py-2.5 text-sm font-bold text-[#8E6742] tabular-nums focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1A1A1E] mb-1.5">
                ملاحظات
              </label>
              <input
                type="text"
                value={trimForm.notes || ''}
                onChange={(e) => setTrimForm({ ...trimForm, notes: e.target.value })}
                placeholder="ملاحظات إضافية عن المقاس أو المواصفات..."
                className="w-full rounded-xl border border-[#E5E3DD] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#A67C52]"
              />
            </div>
          </div>

          {/* Auto-Include in BOM Flag */}
          <div className="rounded-xl border border-[#E5E3DD] bg-[#FAF9F7] p-3.5 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(trimForm.autoIncludeInBom)}
                onChange={(e) =>
                  setTrimForm({
                    ...trimForm,
                    autoIncludeInBom: e.target.checked,
                    defaultQtyPerPiece: trimForm.defaultQtyPerPiece ?? 1,
                  })
                }
                className="mt-0.5 h-4 w-4 rounded border-[#D4CFC7] accent-[#A67C52] cursor-pointer"
              />
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#1A1A1E] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#A67C52]" />
                  <span>احتساب تلقائي في تكلفة كل الموديلات (BOM)</span>
                </div>
                <p className="text-[11px] text-[#6E6C66] mt-0.5">
                  عند التفعيل، يُحتسب هذا البند تلقائياً ضمن تكلفة كل موديل (مثل الشنط والكروت والتيكت) دون الحاجة لإضافته يدوياً في كل بطاقة.
                </p>
              </div>
            </label>

            {trimForm.autoIncludeInBom && (
              <div className="pt-2.5 border-t border-[#E5E3DD] flex flex-wrap items-center justify-between gap-2.5">
                <label className="text-xs font-semibold text-[#1A1A1E]">
                  الكمية التلقائية لكل قطعة ({trimForm.unitLabel || 'قطعة'}):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={trimForm.defaultQtyPerPiece || ''}
                    onKeyDown={blockNonIntegerKey}
                    onChange={(e) =>
                      setTrimForm({
                        ...trimForm,
                        defaultQtyPerPiece: toWholeQty(e.target.value, 0),
                      })
                    }
                    onBlur={() =>
                      setTrimForm({
                        ...trimForm,
                        defaultQtyPerPiece: toWholeQty(trimForm.defaultQtyPerPiece ?? 1, 1),
                      })
                    }
                    className="w-24 rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-1.5 text-xs font-bold text-center tabular-nums focus:outline-none focus:border-[#A67C52]"
                  />
                  <span className="text-xs font-bold text-emerald-700 tabular-nums">
                    = {formatMoney(previewTrimUnitCost * (Number(trimForm.defaultQtyPerPiece) || 0), state.currency)} / قطعة
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Live Unit Conversion Banner */}
          <div className="rounded-xl bg-[#FBF8F4] border border-[#E6D5C3] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#7B5836]">
              التكلفة المحسوبة لكل ({trimForm.unitLabel || 'قطعة'}):
            </span>
            <span className="text-base font-bold text-[#8E6742] tabular-nums">
              {formatMoney(previewTrimUnitCost, state.currency)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E5E3DD]">
            <button
              type="button"
              onClick={() => setTrimModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-[#1A1A1E] hover:bg-[#2E2E35] text-white cursor-pointer"
            >
              {editingTrimId ? 'حفظ التعديلات' : 'حفظ البند'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
