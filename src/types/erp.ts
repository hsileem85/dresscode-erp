export type NavTab =
  | 'dashboard'
  | 'materials'
  | 'models'
  | 'labor'
  | 'calculator'
  | 'excel';

export type CurrencyCode = 'EGP' | 'SAR' | 'AED' | 'USD';

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  label: string;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  EGP: { code: 'EGP', symbol: 'ج.م', label: 'جنيه مصري (ج.م)' },
  SAR: { code: 'SAR', symbol: 'ر.س', label: 'ريال سعودي (ر.س)' },
  AED: { code: 'AED', symbol: 'د.إ', label: 'درهم إماراتي (د.إ)' },
  USD: { code: 'USD', symbol: '$', label: 'دولار أمريكي ($)' },
};

export type FabricUnit = 'meter' | 'kg';

export interface Fabric {
  id: string;
  name: string;
  supplier: string;
  unit: FabricUnit;
  pricePerUnit: number;
  widthCm: number;
  defaultWastePct: number;
  colorOrCode?: string;
  notes?: string;
}

export type TrimPurchaseUnit =
  | 'piece'
  | 'dozen'
  | 'roll'
  | 'pack'
  | 'box'
  | 'cone';

export interface TrimAccessory {
  id: string;
  name: string;
  category: string; // سحابات، أزرار، خيوط، تيكت DressCode، تغليف
  supplier: string;
  purchaseUnit: TrimPurchaseUnit;
  packPrice: number;
  unitsPerPack: number; // e.g., 12 for dozen, 100 for roll/pack, 1 for piece
  unitLabel: string; // e.g., قطعة، متر، زر
  notes?: string;
}

export type LaborBillingType = 'per_piece' | 'per_batch';

export interface OutsourcedOperation {
  id: string;
  name: string; // القص، الخياطة، السرفلة، الكي، التطريز
  workshopName: string;
  billingType: LaborBillingType;
  cost: number; // cost per piece OR cost per batch
  batchSize: number; // used if billingType === 'per_batch', default 1
  leadTimeDays?: number;
  notes?: string;
}

export interface ModelFabricItem {
  id: string;
  fabricId: string;
  consumption: number; // meters or kg per piece
  wastePct: number; // % waste for this specific model
}

export interface ModelTrimItem {
  id: string;
  trimId: string;
  quantity: number; // number of single units per piece
}

export interface ModelLaborItem {
  id: string;
  operationId?: string; // optional link to catalog
  name: string;
  workshopName: string;
  billingType: LaborBillingType;
  cost: number;
  batchSize: number;
}

export type ModelStatus = 'active' | 'sampling' | 'archived';

export interface ProductModel {
  id: string;
  name: string;
  sku: string;
  category: string; // عباية، فستان، كارديجان، طقم، بلوزة، كيمونو
  season: string;
  status: ModelStatus;
  targetMarginPct: number; // target profit margin % on cost (markup) or retail
  fabrics: ModelFabricItem[];
  trims: ModelTrimItem[];
  laborSteps: ModelLaborItem[];
  notes?: string;
  updatedAt: string;
}

export interface OverheadItem {
  id: string;
  name: string;
  category: 'rent' | 'utilities' | 'maintenance' | 'marketing' | 'shipping' | 'other';
  monthlyAmount: number;
  notes?: string;
}

export interface OverheadConfig {
  estimatedMonthlyVolume: number;
  items: OverheadItem[];
}

export interface ERPState {
  currency: CurrencyCode;
  fabrics: Fabric[];
  trims: TrimAccessory[];
  operations: OutsourcedOperation[];
  models: ProductModel[];
  overhead: OverheadConfig;
}

export interface ModelCostBreakdown {
  fabricCost: number;
  trimCost: number;
  directMaterialCost: number;
  directLaborCost: number;
  indirectOverheadCost: number;
  totalUnitCost: number;
  suggestedRetailPrice: number;
  profitPerPiece: number;
  effectiveMarginOnPricePct: number;
}
