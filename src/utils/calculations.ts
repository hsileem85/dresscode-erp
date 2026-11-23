import { CURRENCIES } from '../types/erp';
import type {
  CurrencyCode,
  Fabric,
  ModelCostBreakdown,
  ModelFabricItem,
  ModelLaborItem,
  ModelTrimItem,
  OverheadConfig,
  ProductModel,
  TrimAccessory,
  TrimPurchaseUnit,
} from '../types/erp';

export function getTrimUnitCost(trim: TrimAccessory): number {
  const divisor = trim.unitsPerPack > 0 ? trim.unitsPerPack : 1;
  return trim.packPrice / divisor;
}

export function getLaborStepUnitCost(step: {
  billingType: 'per_piece' | 'per_batch';
  cost: number;
  batchSize: number;
}): number {
  if (step.billingType === 'per_batch') {
    const batch = step.batchSize > 0 ? step.batchSize : 1;
    return step.cost / batch;
  }
  return step.cost;
}

export function getFabricLineCost(
  item: ModelFabricItem,
  fabrics: Fabric[]
): number {
  const fabric = fabrics.find((f) => f.id === item.fabricId);
  if (!fabric) return 0;
  const effectiveQty = item.consumption * (1 + (item.wastePct || 0) / 100);
  return effectiveQty * fabric.pricePerUnit;
}

export function getTrimLineCost(
  item: ModelTrimItem,
  trims: TrimAccessory[]
): number {
  const trim = trims.find((t) => t.id === item.trimId);
  if (!trim) return 0;
  return item.quantity * getTrimUnitCost(trim);
}

export function getTotalMonthlyOverhead(overhead: OverheadConfig): number {
  return overhead.items.reduce((sum, item) => sum + (Number(item.monthlyAmount) || 0), 0);
}

export function getOverheadPerPiece(overhead: OverheadConfig): number {
  const total = getTotalMonthlyOverhead(overhead);
  const volume = overhead.estimatedMonthlyVolume > 0 ? overhead.estimatedMonthlyVolume : 1;
  return total / volume;
}

/**
 * Calculates full cost breakdown for a ProductModel.
 * targetMarginPct is applied as Profit Margin on Retail Price when pricingMode === 'margin',
 * or Markup on Cost when pricingMode === 'markup'. Default is markup-on-cost for apparel ERP clarity,
 * with effective margin on retail price also returned.
 */
export function getQuickDirectMaterialCost(model: ProductModel): number {
  return (
    (Number(model.quickFabricCost) || 0) +
    (Number(model.quickShippingCost) || 0) +
    (Number(model.quickPackagingCost) || 0) +
    (Number(model.quickAccessoriesCost) || 0)
  );
}

export function getQuickDirectLaborCost(model: ProductModel): number {
  return (
    (Number(model.quickOverlockCost) || 0) +
    (Number(model.quickSewingCost) || 0)
  );
}

export function calculateModelCost(
  model: ProductModel,
  fabrics: Fabric[],
  trims: TrimAccessory[],
  overhead: OverheadConfig,
  overrideMarginPct?: number,
  pricingMode: 'markup' | 'margin' = 'markup'
): ModelCostBreakdown {
  const hasBomMaterials = model.fabrics.length > 0 || model.trims.length > 0;
  const fabricCost = hasBomMaterials
    ? model.fabrics.reduce((sum, item) => sum + getFabricLineCost(item, fabrics), 0)
    : (Number(model.quickFabricCost) || 0) + (Number(model.quickShippingCost) || 0);

  const trimCost = hasBomMaterials
    ? model.trims.reduce((sum, item) => sum + getTrimLineCost(item, trims), 0)
    : (Number(model.quickPackagingCost) || 0) + (Number(model.quickAccessoriesCost) || 0);

  const directMaterialCost = fabricCost + trimCost;

  const hasBomLabor = model.laborSteps.length > 0;
  const directLaborCost = hasBomLabor
    ? model.laborSteps.reduce(
        (sum, step: ModelLaborItem) => sum + getLaborStepUnitCost(step),
        0
      )
    : getQuickDirectLaborCost(model);

  const indirectOverheadCost = getOverheadPerPiece(overhead);
  const totalUnitCost = directMaterialCost + directLaborCost + indirectOverheadCost;

  const marginPct =
    overrideMarginPct !== undefined ? overrideMarginPct : model.targetMarginPct;

  let suggestedRetailPrice = totalUnitCost;
  if (pricingMode === 'margin') {
    const safePct = Math.min(Math.max(marginPct, 0), 95);
    suggestedRetailPrice = totalUnitCost / (1 - safePct / 100);
  } else {
    suggestedRetailPrice = totalUnitCost * (1 + Math.max(marginPct, 0) / 100);
  }

  const profitPerPiece = suggestedRetailPrice - totalUnitCost;
  const effectiveMarginOnPricePct =
    suggestedRetailPrice > 0 ? (profitPerPiece / suggestedRetailPrice) * 100 : 0;

  return {
    fabricCost,
    trimCost,
    directMaterialCost,
    directLaborCost,
    indirectOverheadCost,
    totalUnitCost,
    suggestedRetailPrice,
    profitPerPiece,
    effectiveMarginOnPricePct,
  };
}

export function formatMoney(amount: number, currency: CurrencyCode): string {
  const cfg = CURRENCIES[currency] || CURRENCIES.EGP;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isNaN(amount) ? 0 : amount);
  return `${formatted} ${cfg.symbol}`;
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(isNaN(value) ? 0 : value);
}

export const PURCHASE_UNIT_LABELS: Record<TrimPurchaseUnit, string> = {
  piece: 'قطعة',
  dozen: 'دستة (12)',
  roll: 'لفة / رول',
  pack: 'عبوة / باكت',
  box: 'علبة / كرتونة',
  cone: 'بكرة / كون',
  weight: 'بالوزن',
};

export const FABRIC_UNIT_LABELS = {
  meter: 'متر',
  kg: 'كيلو',
} as const;

export const OVERHEAD_CATEGORY_LABELS = {
  rent: 'إيجار ومقر',
  utilities: 'كهرباء ومرافق',
  maintenance: 'صيانة ماكينات',
  marketing: 'تسويق وإعلانات',
  shipping: 'خامات شحن وتغليف',
  other: 'مصاريف إدارية أخرى',
} as const;
