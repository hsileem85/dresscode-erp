export type NavTab =
  | 'dashboard'
  | 'materials'
  | 'models'
  | 'labor'
  | 'calculator'
  | 'purchases'
  | 'production'
  | 'sales'
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

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  specialty?: string;
  balancePayable: number;
}

export interface Workshop {
  id: string;
  name: string;
  phone?: string;
  specialty?: string;
  balancePayable: number;
}

export type FabricUnit = 'meter' | 'kg';

export interface Fabric {
  id: string;
  name: string;
  supplierId?: string | null;
  supplier: string;
  unit: FabricUnit;
  pricePerUnit: number;
  widthCm: number;
  defaultWastePct: number;
  stockQty: number;
  reorderLevel: number;
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
  category: string;
  supplierId?: string | null;
  supplier: string;
  purchaseUnit: TrimPurchaseUnit;
  packPrice: number;
  unitsPerPack: number;
  unitLabel: string;
  stockQty: number;
  reorderLevel: number;
  notes?: string;
}

export type LaborBillingType = 'per_piece' | 'per_batch';

export interface OutsourcedOperation {
  id: string;
  name: string;
  workshopId?: string | null;
  workshopName: string;
  billingType: LaborBillingType;
  cost: number;
  batchSize: number;
  leadTimeDays?: number;
  notes?: string;
}

export interface ModelFabricItem {
  id: string;
  fabricId: string;
  consumption: number;
  wastePct: number;
}

export interface ModelTrimItem {
  id: string;
  trimId: string;
  quantity: number;
}

export interface ModelLaborItem {
  id: string;
  operationId?: string | null;
  workshopId?: string | null;
  name: string;
  workshopName: string;
  billingType: LaborBillingType;
  cost: number;
  batchSize: number;
}

export interface ModelVariant {
  id: string;
  modelId: string;
  variantSku: string;
  color: string;
  size: string;
  finishedGoodsQty: number;
  avgUnitCogs: number;
  retailPrice: number;
  reorderLevel: number;
}

export type ModelStatus = 'active' | 'sampling' | 'archived';

export interface ProductModel {
  id: string;
  name: string;
  sku: string;
  category: string;
  season: string;
  status: ModelStatus;
  targetMarginPct: number;
  fabrics: ModelFabricItem[];
  trims: ModelTrimItem[];
  laborSteps: ModelLaborItem[];
  variants: ModelVariant[];
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

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
  id: string;
  itemType: 'fabric' | 'trim';
  fabricId?: string | null;
  trimId?: string | null;
  description: string;
  quantity: number;
  unitsPerPack: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId?: string | null;
  supplierName: string;
  orderDate: string;
  receivedAt?: string | null;
  status: PurchaseOrderStatus;
  totalAmount: number;
  paidAmount: number;
  notes?: string;
  items: PurchaseOrderItem[];
}

export type ProductionOrderStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface ProductionOrderVariant {
  id: string;
  variantId: string;
  plannedQty: number;
  completedQty: number;
}

export interface ProductionOrder {
  id: string;
  batchNumber: string;
  modelId: string;
  status: ProductionOrderStatus;
  plannedQty: number;
  completedQty: number;
  actualMaterialCost: number;
  actualLaborCost: number;
  allocatedOverheadCost: number;
  actualUnitCogs: number;
  notes?: string;
  createdAt: string;
  variants: ProductionOrderVariant[];
}

export type SalesChannel = 'online_store' | 'retail' | 'wholesale' | 'social_media';
export type SalesOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'returned'
  | 'cancelled';

export interface SalesOrderItem {
  id: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
  unitCogsSnapshot: number;
  lineTotal: number;
  lineCogs: number;
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  channel: SalesChannel;
  orderDate: string;
  status: SalesOrderStatus;
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  totalAmount: number;
  totalCogs: number;
  grossProfit: number;
  notes?: string;
  items: SalesOrderItem[];
}

export interface InventoryMovement {
  id: string;
  itemType: 'fabric' | 'trim' | 'finished_good';
  fabricId?: string | null;
  trimId?: string | null;
  variantId?: string | null;
  movementType: string;
  qtyDelta: number;
  unitCost: number;
  referenceType?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ERPState {
  currency: CurrencyCode;
  suppliers: Supplier[];
  workshops: Workshop[];
  fabrics: Fabric[];
  trims: TrimAccessory[];
  operations: OutsourcedOperation[];
  models: ProductModel[];
  overhead: OverheadConfig;
  purchaseOrders: PurchaseOrder[];
  productionOrders: ProductionOrder[];
  salesOrders: SalesOrder[];
  inventoryMovements: InventoryMovement[];
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
