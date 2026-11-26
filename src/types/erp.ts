export type NavTab =
  | 'dashboard'
  | 'workflow'
  | 'materials'
  | 'models'
  | 'labor'
  | 'calculator'
  | 'purchases'
  | 'production'
  | 'sales'
  | 'customers'
  | 'expenses'
  | 'reconciliation'
  | 'reports'
  | 'audit'
  | 'basicdata'
  | 'excel';

export type LookupGroupKey =
  | 'model_categories'
  | 'trim_categories'
  | 'platforms'
  | 'governorates'
  | 'expense_categories'
  | 'payment_methods'
  | 'sizes'
  | 'colors';

export interface LookupItem {
  id: string;
  groupKey: LookupGroupKey;
  label: string;
  sortOrder: number;
}

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
  contactName?: string;
  phone?: string;
  address?: string;
  specialty?: string;
  balancePayable: number;
  notes?: string;
}

export interface Workshop {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  address?: string;
  specialty?: string;
  balancePayable: number;
  notes?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  platform: string; // واتساب | انستجرام | المتجر | مباشر
  governorate?: string;
  customerType?: string;
  notes?: string;
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
  | 'cone'
  | 'weight';

export type TrimSupplyGroup = 'trims' | 'manufacturing' | 'brand';

export interface TrimAccessory {
  id: string;
  name: string;
  category: string;
  supplyGroup?: TrimSupplyGroup;
  supplierId?: string | null;
  supplier: string;
  purchaseUnit: TrimPurchaseUnit;
  packPrice: number;
  unitsPerPack: number;
  unitLabel: string;
  stockQty: number;
  reorderLevel: number;
  autoIncludeInBom?: boolean;
  defaultQtyPerPiece?: number;
  notes?: string;
}

export type LaborBillingType = 'per_piece' | 'per_batch';

export interface OperationServiceItem {
  id: string;
  name: string;
  cost: number;
}

export interface OperationMaterialItem {
  id: string;
  name: string;
  trimId?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface OutsourcedOperation {
  id: string;
  name: string;
  workshopId?: string | null;
  workshopName: string;
  billingType: LaborBillingType;
  cost: number;
  batchSize: number;
  leadTimeDays?: number;
  services?: OperationServiceItem[];
  suppliedMaterials?: OperationMaterialItem[];
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
  // Actual & Compare-At pricing + Quick Direct Costing (from تكلفة المنتجات)
  actualRetailPrice?: number;
  compareAtPrice?: number;
  quickFabricCost?: number;
  quickShippingCost?: number;
  quickOverlockCost?: number;
  quickPackagingCost?: number;
  quickSewingCost?: number;
  quickAccessoriesCost?: number;
  initialStock?: number;
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

export interface ExpenseRecord {
  id: string;
  expenseDate: string;
  title: string;
  category: string; // ثابت | متغير | تسويق | خامات
  isRawMaterialPurchase: boolean;
  amount: number;
  paymentMethod: string; // كاش | تحويل | إنستاباي
  notes?: string;
}

export interface PartnerContribution {
  id: string;
  partnerName: string;
  contributionDate: string;
  amount: number;
  notes?: string;
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
  shippingAllocated?: number;
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
  shippingCost?: number;
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
  workshopId?: string | null;
  workshopName?: string;
  agreedLaborTotal: number;
  paidToWorkshop: number;
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
  customerId?: string | null;
  customerName: string;
  channel: SalesChannel;
  platform: string; // واتساب | انستجرام | المتجر | مباشر
  orderDate: string;
  status: SalesOrderStatus;
  fulfillmentStatus: string; // قيد التجهيز | واصل | مكتمل | مرتجع
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  totalAmount: number;
  paidAmount: number;
  remainingDebt: number;
  paymentStatus: 'مدفوع بالكامل' | 'دفع جزئي' | 'لم يدفع';
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
  customers: Customer[];
  lookups: LookupItem[];
  fabrics: Fabric[];
  trims: TrimAccessory[];
  operations: OutsourcedOperation[];
  models: ProductModel[];
  overhead: OverheadConfig;
  expenses: ExpenseRecord[];
  partnerContributions: PartnerContribution[];
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

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditLogEntry {
  id: number;
  occurredAt: string;
  logMonth: string;
  tableName: string;
  entityLabel: string;
  action: AuditAction;
  recordId: string | null;
  recordSummary: string;
  actorId: string | null;
  actorEmail: string;
  actorName: string;
  changedFields: Record<string, unknown> | null;
}

export interface AuditMonthSummary {
  month: string;
  rowCount: number;
  oldestAt: string;
  newestAt: string;
}

export interface AuditLogStats {
  totalRows: number;
  auditTableBytes: number;
  auditTableMb: number;
  dbTotalBytes: number;
  dbTotalMb: number;
  dbLimitMb: number;
  months: AuditMonthSummary[];
}

export type UserRole = 'admin' | 'staff';

export interface UserRoleRecord {
  email: string;
  role: UserRole;
  displayName?: string;
  updatedAt?: string;
}

export interface PendingPoDraftLine {
  itemType: 'fabric' | 'trim';
  refId: string;
  quantity: number;
  unitPrice: number;
}

export interface PendingPoDraft {
  supplierId?: string;
  supplierName?: string;
  notes?: string;
  sourceLabel?: string;
  lines: PendingPoDraftLine[];
}

export interface SalesExchangeReturnPayload {
  saleId: string;
  returnVariantId: string;
  returnQty: number;
  replacementVariantId?: string | null;
  replacementQty?: number;
  priceDiff?: number;
  notes?: string;
}

export type ReconciliationType = 'cash' | 'stock';
export type StockReconciliationScope = 'all' | 'fabric' | 'trim' | 'finished_good';
export type StockReconciliationItemType = 'fabric' | 'trim' | 'finished_good';

export interface CashChannelCount {
  id: string;
  label: string;
  amount: number;
}

export interface StockReconciliationLine {
  itemType: StockReconciliationItemType;
  itemId: string;
  itemName: string;
  unitLabel: string;
  systemQty: number;
  actualQty: number;
  qtyDelta: number;
  unitCost: number;
  valueDelta: number;
  note?: string;
}

export interface ReconciliationSession {
  id: string;
  reconciliationNumber: string;
  recType: ReconciliationType;
  stockScope?: StockReconciliationScope | string | null;
  reconciledAt: string;
  systemValue: number;
  actualValue: number;
  varianceValue: number;
  itemsCounted: number;
  itemsAdjusted: number;
  adjustmentPosted: boolean;
  actorEmail?: string;
  actorName?: string;
  notes?: string;
  details: CashChannelCount[] | StockReconciliationLine[];
  source?: 'cloud' | 'local';
}

export interface CashReconciliationPayload {
  reconciliationNumber: string;
  systemCash: number;
  actualCash: number;
  channels: CashChannelCount[];
  postAdjustment: boolean;
  affectPnl: boolean;
  paymentMethod?: string;
  notes?: string;
}

export interface StockReconciliationPayload {
  reconciliationNumber: string;
  stockScope: StockReconciliationScope;
  postAdjustments: boolean;
  notes?: string;
  lines: {
    itemType: StockReconciliationItemType;
    itemId: string;
    itemName: string;
    unitLabel: string;
    systemQty: number;
    actualQty: number;
    unitCost: number;
    note?: string;
  }[];
}

