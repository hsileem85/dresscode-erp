import * as XLSX from 'xlsx';
import type {
  ERPState,
  Fabric,
  OutsourcedOperation,
  ProductModel,
  TrimAccessory,
  TrimPurchaseUnit,
} from '../types/erp';
import {
  calculateModelCost,
  FABRIC_UNIT_LABELS,
  getLaborStepUnitCost,
  getOverheadPerPiece,
  getTotalMonthlyOverhead,
  getTrimUnitCost,
  OVERHEAD_CATEGORY_LABELS,
  PURCHASE_UNIT_LABELS,
} from './calculations';

export type ImportTargetType = 'fabrics' | 'trims' | 'operations' | 'models';

export interface ParsedWorkbook {
  fileName: string;
  sheetNames: string[];
  sheets: Record<
    string,
    {
      headers: string[];
      rows: Record<string, unknown>[];
    }
  >;
}

export interface TargetFieldDef {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

export const TARGET_FIELDS: Record<ImportTargetType, TargetFieldDef[]> = {
  fabrics: [
    {
      key: 'name',
      label: 'اسم القماش',
      required: true,
      aliases: ['اسم القماش', 'القماش', 'الخامة', 'الاسم', 'fabric', 'name', 'material'],
    },
    {
      key: 'supplier',
      label: 'المورد',
      aliases: ['المورد', 'الشركة', 'supplier', 'vendor'],
    },
    {
      key: 'unit',
      label: 'الوحدة (متر / كيلو)',
      aliases: ['الوحدة', 'وحدة', 'unit'],
    },
    {
      key: 'pricePerUnit',
      label: 'السعر للوحدة',
      required: true,
      aliases: ['السعر', 'سعر المتر', 'سعر الكيلو', 'سعر الوحدة', 'price', 'cost', 'rate'],
    },
    {
      key: 'widthCm',
      label: 'العرض (سم)',
      aliases: ['العرض', 'عرض القماش', 'width'],
    },
    {
      key: 'defaultWastePct',
      label: 'نسبة الهالك %',
      aliases: ['الهالك', 'نسبة الهالك', 'هالك', 'waste'],
    },
    {
      key: 'notes',
      label: 'ملاحظات',
      aliases: ['ملاحظات', 'notes', 'description'],
    },
  ],
  trims: [
    {
      key: 'name',
      label: 'اسم الكلفة / الإكسسوار',
      required: true,
      aliases: ['اسم الكلفة', 'الكلفة', 'الإكسسوار', 'الاسم', 'trim', 'accessory', 'name', 'item'],
    },
    {
      key: 'category',
      label: 'التصنيف',
      aliases: ['التصنيف', 'النوع', 'الفئة', 'category', 'type'],
    },
    {
      key: 'supplier',
      label: 'المورد',
      aliases: ['المورد', 'supplier', 'vendor'],
    },
    {
      key: 'purchaseUnit',
      label: 'وحدة الشراء',
      aliases: ['وحدة الشراء', 'الوحدة', 'unit', 'pack unit'],
    },
    {
      key: 'packPrice',
      label: 'سعر العبوة / الدستة',
      required: true,
      aliases: ['سعر العبوة', 'السعر', 'سعر الدستة', 'pack price', 'price', 'cost'],
    },
    {
      key: 'unitsPerPack',
      label: 'عدد الوحدات بالعبوة',
      aliases: ['عدد الوحدات', 'الكمية بالعبوة', 'العدد', 'units', 'qty per pack', 'count'],
    },
    {
      key: 'unitLabel',
      label: 'مسمى القطعة',
      aliases: ['مسمى القطعة', 'وحدة الاستهلاك', 'unit label'],
    },
  ],
  operations: [
    {
      key: 'name',
      label: 'المرحلة / العملية',
      required: true,
      aliases: ['المرحلة', 'العملية', 'التشغيل', 'الاسم', 'operation', 'step', 'name'],
    },
    {
      key: 'workshopName',
      label: 'اسم الورشة / المصنع',
      aliases: ['الورشة', 'المصنع', 'العامل', 'workshop', 'vendor', 'factory'],
    },
    {
      key: 'billingType',
      label: 'نظام المحاسبة (قطعة / باتش)',
      aliases: ['نظام المحاسبة', 'النوع', 'billing', 'type'],
    },
    {
      key: 'cost',
      label: 'التكلفة',
      required: true,
      aliases: ['التكلفة', 'السعر', 'الأجر', 'cost', 'price', 'rate'],
    },
    {
      key: 'batchSize',
      label: 'حجم الباتش (عدد القطع)',
      aliases: ['حجم الباتش', 'العدد', 'الكمية', 'batch', 'qty'],
    },
  ],
  models: [
    {
      key: 'name',
      label: 'اسم الموديل',
      required: true,
      aliases: ['اسم الموديل', 'الموديل', 'المنتج', 'الاسم', 'model', 'product', 'name'],
    },
    {
      key: 'sku',
      label: 'كود الموديل (SKU)',
      aliases: ['الكود', 'كود الموديل', 'sku', 'code'],
    },
    {
      key: 'category',
      label: 'الفئة',
      aliases: ['الفئة', 'التصنيف', 'category', 'type'],
    },
    {
      key: 'season',
      label: 'الموسم',
      aliases: ['الموسم', 'season'],
    },
    {
      key: 'targetMarginPct',
      label: 'هامش الربح المستهدف %',
      aliases: ['هامش الربح', 'الربح', 'النسبة', 'margin', 'markup'],
    },
    {
      key: 'directLaborCost',
      label: 'تكلفة التشغيل (اختياري)',
      aliases: ['تكلفة التشغيل', 'التشغيل', 'العمالة', 'labor', 'sewing'],
    },
    {
      key: 'notes',
      label: 'ملاحظات',
      aliases: ['ملاحظات', 'notes'],
    },
  ],
};

export async function parseExcelFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheets: ParsedWorkbook['sheets'] = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '',
    });
    const headerSet = new Set<string>();
    jsonRows.forEach((row) => {
      Object.keys(row).forEach((k) => headerSet.add(k));
    });
    sheets[sheetName] = {
      headers: Array.from(headerSet),
      rows: jsonRows,
    };
  }

  return {
    fileName: file.name,
    sheetNames: workbook.SheetNames,
    sheets,
  };
}

export function autoMapColumns(
  headers: string[],
  targetType: ImportTargetType
): Record<string, string> {
  const fields = TARGET_FIELDS[targetType];
  const mapping: Record<string, string> = {};

  for (const field of fields) {
    const match = headers.find((header) => {
      const normalized = header.trim().toLowerCase();
      return field.aliases.some(
        (alias) =>
          normalized === alias.toLowerCase() ||
          normalized.includes(alias.toLowerCase())
      );
    });
    if (match) {
      mapping[field.key] = match;
    }
  }
  return mapping;
}

function parseNum(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  const cleaned = String(val ?? '')
    .replace(/[^\d.-]/g, '')
    .trim();
  const num = Number(cleaned);
  return isNaN(num) ? fallback : num;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function mapRowsToFabrics(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>
): Fabric[] {
  return rows
    .map((row): Fabric | null => {
      const name = String(row[mapping.name] ?? '').trim();
      if (!name) return null;
      const rawUnit = String(row[mapping.unit] ?? '').toLowerCase();
      const unit: Fabric['unit'] =
        rawUnit.includes('كيلو') || rawUnit.includes('kg') ? 'kg' : 'meter';
      return {
        id: makeId(),
        name,
        supplier: String(row[mapping.supplier] ?? 'مورد عام').trim() || 'مورد عام',
        unit,
        pricePerUnit: parseNum(row[mapping.pricePerUnit], 0),
        widthCm: parseNum(row[mapping.widthCm], 150),
        defaultWastePct: parseNum(row[mapping.defaultWastePct], 6),
        stockQty: 0,
        reorderLevel: 20,
        notes: String(row[mapping.notes] ?? '').trim(),
      };
    })
    .filter((item): item is Fabric => item !== null);
}

export function mapRowsToTrims(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>
): TrimAccessory[] {
  return rows
    .map((row): TrimAccessory | null => {
      const name = String(row[mapping.name] ?? '').trim();
      if (!name) return null;
      const rawUnit = String(row[mapping.purchaseUnit] ?? '').toLowerCase();
      let purchaseUnit: TrimPurchaseUnit = 'pack';
      if (rawUnit.includes('دست') || rawUnit.includes('dozen')) purchaseUnit = 'dozen';
      else if (rawUnit.includes('لف') || rawUnit.includes('رول') || rawUnit.includes('roll'))
        purchaseUnit = 'roll';
      else if (rawUnit.includes('بكر') || rawUnit.includes('cone')) purchaseUnit = 'cone';
      else if (rawUnit.includes('علب') || rawUnit.includes('box')) purchaseUnit = 'box';
      else if (rawUnit.includes('قطع') || rawUnit.includes('piece')) purchaseUnit = 'piece';
      else if (
        rawUnit.includes('وزن') ||
        rawUnit.includes('كيلو') ||
        rawUnit.includes('كجم') ||
        rawUnit.includes('جرام') ||
        rawUnit.includes('weight') ||
        rawUnit.includes('kg')
      )
        purchaseUnit = 'weight';

      const defaultUnits = purchaseUnit === 'dozen' ? 12 : purchaseUnit === 'weight' ? 1000 : 1;
      const unitsPerPack = Math.max(1, parseNum(row[mapping.unitsPerPack], defaultUnits));

      return {
        id: makeId(),
        name,
        category: String(row[mapping.category] ?? 'إكسسوارات').trim() || 'إكسسوارات',
        supplier: String(row[mapping.supplier] ?? 'مورد عام').trim() || 'مورد عام',
        purchaseUnit,
        packPrice: parseNum(row[mapping.packPrice], 0),
        unitsPerPack,
        unitLabel: String(row[mapping.unitLabel] ?? 'قطعة').trim() || 'قطعة',
        stockQty: 0,
        reorderLevel: 50,
      };
    })
    .filter((item): item is TrimAccessory => item !== null);
}

export function mapRowsToOperations(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>
): OutsourcedOperation[] {
  return rows
    .map((row): OutsourcedOperation | null => {
      const name = String(row[mapping.name] ?? '').trim();
      if (!name) return null;
      const rawBilling = String(row[mapping.billingType] ?? '').toLowerCase();
      const billingType =
        rawBilling.includes('باتش') || rawBilling.includes('batch')
          ? 'per_batch'
          : 'per_piece';
      return {
        id: makeId(),
        name,
        workshopName:
          String(row[mapping.workshopName] ?? 'ورشة خارجية').trim() || 'ورشة خارجية',
        billingType,
        cost: parseNum(row[mapping.cost], 0),
        batchSize: Math.max(1, parseNum(row[mapping.batchSize], 1)),
      };
    })
    .filter((item): item is OutsourcedOperation => item !== null);
}

export function mapRowsToModels(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>
): ProductModel[] {
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .map((row, idx): ProductModel | null => {
      const name = String(row[mapping.name] ?? '').trim();
      if (!name) return null;
      const laborCost = parseNum(row[mapping.directLaborCost], 0);
      return {
        id: makeId(),
        name,
        sku:
          String(row[mapping.sku] ?? '').trim() ||
          `DC-IMP-${String(idx + 1).padStart(3, '0')}`,
        category: String(row[mapping.category] ?? 'عباية').trim() || 'عباية',
        season: String(row[mapping.season] ?? '2026').trim() || '2026',
        status: 'active',
        targetMarginPct: parseNum(row[mapping.targetMarginPct], 65),
        fabrics: [],
        trims: [],
        variants: [],
        laborSteps:
          laborCost > 0
            ? [
                {
                  id: makeId(),
                  name: 'إجمالي التشغيل الخارجي (مستورد)',
                  workshopName: 'ورشة التشغيل',
                  billingType: 'per_piece',
                  cost: laborCost,
                  batchSize: 1,
                },
              ]
            : [],
        notes: String(row[mapping.notes] ?? '').trim(),
        updatedAt: today,
      };
    })
    .filter((item): item is ProductModel => item !== null);
}

export function exportFullERPToExcel(state: ERPState): void {
  const wb = XLSX.utils.book_new();

  // 1. Models & Costing Summary Sheet
  const modelsData = state.models.map((m) => {
    const c = calculateModelCost(m, state.fabrics, state.trims, state.overhead);
    return {
      'كود الموديل (SKU)': m.sku,
      'اسم الموديل': m.name,
      'الفئة': m.category,
      'الموسم': m.season,
      'تكلفة الأقمشة (بالهالك)': Number(c.fabricCost.toFixed(2)),
      'تكلفة الكلف والإكسسوارات': Number(c.trimCost.toFixed(2)),
      'إجمالي الخامات المباشرة': Number(c.directMaterialCost.toFixed(2)),
      'تكلفة التشغيل الخارجي': Number(c.directLaborCost.toFixed(2)),
      'نصيب المصاريف غير المباشرة': Number(c.indirectOverheadCost.toFixed(2)),
      'التكلفة الإجمالية للقطعة': Number(c.totalUnitCost.toFixed(2)),
      'نسبة الربح المستهدفة %': m.targetMarginPct,
      'سعر البيع المقترح': Number(c.suggestedRetailPrice.toFixed(2)),
      'صافي الربح للقطعة': Number(c.profitPerPiece.toFixed(2)),
    };
  });
  const wsModels = XLSX.utils.json_to_sheet(modelsData);
  XLSX.utils.book_append_sheet(wb, wsModels, 'تكاليف الموديلات');

  // 2. Fabrics Sheet
  const fabricsData = state.fabrics.map((f) => ({
    'اسم القماش': f.name,
    'المورد': f.supplier,
    'الوحدة': FABRIC_UNIT_LABELS[f.unit],
    'سعر الوحدة': f.pricePerUnit,
    'العرض (سم)': f.widthCm,
    'نسبة الهالك %': f.defaultWastePct,
    'ملاحظات': f.notes || '',
  }));
  const wsFabrics = XLSX.utils.json_to_sheet(fabricsData);
  XLSX.utils.book_append_sheet(wb, wsFabrics, 'الأقمشة');

  // 3. Trims Sheet
  const trimsData = state.trims.map((t) => ({
    'اسم الكلفة': t.name,
    'التصنيف': t.category,
    'المورد': t.supplier,
    'وحدة الشراء': PURCHASE_UNIT_LABELS[t.purchaseUnit],
    'سعر العبوة': t.packPrice,
    'عدد الوحدات بالعبوة': t.unitsPerPack,
    'تكلفة القطعة الواحدة': Number(getTrimUnitCost(t).toFixed(2)),
    'مسمى القطعة': t.unitLabel,
    'تلقائي في التكلفة': t.autoIncludeInBom ? 'نعم' : 'لا',
    'الكمية التلقائية للقطعة': t.autoIncludeInBom ? t.defaultQtyPerPiece ?? 1 : 0,
  }));
  const wsTrims = XLSX.utils.json_to_sheet(trimsData);
  XLSX.utils.book_append_sheet(wb, wsTrims, 'الكلف والإكسسوارات');

  // 4. Outsourced Labor Sheet
  const laborData = state.operations.map((o) => ({
    'المرحلة': o.name,
    'اسم الورشة': o.workshopName,
    'الخدمات المشمولة': (o.services || []).map((s) => s.name).join(' + '),
    'خامات مشتراة من الورشة': (o.suppliedMaterials || [])
      .map((m) => `${m.name} (${m.quantity} ${m.unit} × ${m.unitPrice})`)
      .join('، '),
    'نظام المحاسبة': o.billingType === 'per_batch' ? 'بالباتش' : 'بالقطعة',
    'التكلفة المسجلة': o.cost,
    'حجم الباتش': o.batchSize,
    'تكلفة القطعة الواحدة': Number(getLaborStepUnitCost(o).toFixed(2)),
  }));
  const wsLabor = XLSX.utils.json_to_sheet(laborData);
  XLSX.utils.book_append_sheet(wb, wsLabor, 'التشغيل الخارجي');

  // 5. Overhead Sheet
  const overheadData = [
    ...state.overhead.items.map((item) => ({
      'البند': item.name,
      'التصنيف': OVERHEAD_CATEGORY_LABELS[item.category],
      'المبلغ الشهري': item.monthlyAmount,
      'ملاحظات': item.notes || '',
    })),
    {
      'البند': 'إجمالي المصاريف الشهرية',
      'التصنيف': '',
      'المبلغ الشهري': getTotalMonthlyOverhead(state.overhead),
      'ملاحظات': `حجم الإنتاج المتوقع: ${state.overhead.estimatedMonthlyVolume} قطعة | نصيب القطعة: ${getOverheadPerPiece(state.overhead).toFixed(2)}`,
    },
  ];
  const wsOverhead = XLSX.utils.json_to_sheet(overheadData);
  XLSX.utils.book_append_sheet(wb, wsOverhead, 'المصاريف غير المباشرة');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `DressCode_ERP_Costing_${dateStamp}.xlsx`);
}

export function downloadExcelTemplate(): void {
  const wb = XLSX.utils.book_new();

  const sampleFabrics = [
    {
      'اسم القماش': 'كريب ياباني فاخر',
      'المورد': 'شركة النور للأقمشة',
      'الوحدة': 'متر',
      'السعر': 160,
      'العرض': 150,
      'نسبة الهالك': 6,
      'ملاحظات': 'عبايات صيفية',
    },
    {
      'اسم القماش': 'كتان طبيعي مبطن',
      'المورد': 'مؤسسة الشرق',
      'الوحدة': 'متر',
      'السعر': 195,
      'العرض': 145,
      'نسبة الهالك': 8,
      'ملاحظات': 'فساتين وكارديجان',
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleFabrics), 'الأقمشة');

  const sampleTrims = [
    {
      'اسم الكلفة': 'أزرار خشبية طبيعية',
      'التصنيف': 'أزرار',
      'المورد': 'المتحدة لمستلزمات الخياطة',
      'وحدة الشراء': 'دستة',
      'سعر العبوة': 84,
      'عدد الوحدات': 12,
      'مسمى القطعة': 'زر',
    },
    {
      'اسم الكلفة': 'تيكت عناية وغسيل DressCode',
      'التصنيف': 'تيكت وهوية البراند',
      'المورد': 'مطبعة إيليت',
      'وحدة الشراء': 'عبوة',
      'سعر العبوة': 600,
      'عدد الوحدات': 500,
      'مسمى القطعة': 'تيكت',
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleTrims), 'الكلف');

  const sampleLabor = [
    {
      'المرحلة': 'تطريز ياقة يدوي',
      'الورشة': 'أتيليه فنون التطريز',
      'نظام المحاسبة': 'بالقطعة',
      'التكلفة': 45,
      'حجم الباتش': 1,
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleLabor), 'التشغيل');

  XLSX.writeFile(wb, 'DressCode_Import_Template.xlsx');
}
