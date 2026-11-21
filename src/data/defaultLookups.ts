import type { LookupGroupKey, LookupItem } from '../types/erp';

export const LOOKUP_GROUPS: {
  key: LookupGroupKey;
  title: string;
  description: string;
  placeholder: string;
}[] = [
  {
    key: 'model_categories',
    title: 'فئات الموديلات',
    description: 'تظهر في بطاقة الموديل (BOM) والتقارير',
    placeholder: 'مثال: عباية / فستان / كارديجان / كيمونو',
  },
  {
    key: 'trim_categories',
    title: 'تصنيفات الكلف والإكسسوارات',
    description: 'تظهر عند إضافة كلفة أو إكسسوار جديد',
    placeholder: 'مثال: تيكت / سحابات / أزرار / تغليف',
  },
  {
    key: 'platforms',
    title: 'منصات وقنوات البيع',
    description: 'تظهر في الطلبات وقاعدة بيانات العملاء',
    placeholder: 'مثال: واتساب / انستجرام / المتجر / تيك توك',
  },
  {
    key: 'governorates',
    title: 'المحافظات والمدن',
    description: 'تظهر في بيانات العملاء وعناوين الشحن',
    placeholder: 'مثال: العريش / القاهرة / السويس / الإسكندرية',
  },
  {
    key: 'expense_categories',
    title: 'فئات المصروفات',
    description: 'تظهر في سجل المصروفات وتقرير الأرباح والخسائر',
    placeholder: 'مثال: ثابت / متغير / تسويق / خامات',
  },
  {
    key: 'payment_methods',
    title: 'طرق الدفع والتحصيل',
    description: 'تظهر في المصروفات وتحصيل دفعات العملاء',
    placeholder: 'مثال: كاش / تحويل / إنستاباي / فودافون كاش',
  },
  {
    key: 'sizes',
    title: 'المقاسات القياسية',
    description: 'تظهر عند إضافة أصناف المنتج التام (Variants)',
    placeholder: 'مثال: Free Size / S / M / L / XL',
  },
  {
    key: 'colors',
    title: 'الألوان القياسية',
    description: 'تظهر عند إضافة أصناف المنتج التام (Variants)',
    placeholder: 'مثال: أسود فحمي / بيج رملي / زيتوني',
  },
];

const RAW_DEFAULTS: Record<LookupGroupKey, string[]> = {
  model_categories: [
    'عباية',
    'فستان',
    'كارديجان',
    'كيمونو',
    'تونك',
    'بلوزة',
    'طقم',
    'بنطال واسع',
    'جيبة',
    'بيزك',
  ],
  trim_categories: [
    'تيكت وهوية البراند',
    'التغليف والهوية',
    'سحابات',
    'أزرار',
    'خيوط',
    'إكسسوارات',
  ],
  platforms: ['واتساب', 'انستجرام', 'المتجر', 'مباشر'],
  governorates: [
    'العريش',
    'القاهرة',
    'الجيزة',
    'الإسكندرية',
    'السويس',
    'بورسعيد',
    'الإمارات',
  ],
  expense_categories: ['ثابت', 'متغير', 'تسويق', 'خامات'],
  payment_methods: ['كاش', 'تحويل', 'إنستاباي', 'فودافون كاش'],
  sizes: ['Free Size', 'S', 'M', 'L', 'XL', 'XXL'],
  colors: ['أسود فحمي', 'بيج رملي', 'أبيض', 'كحلي', 'زيتوني', 'نبيتي', 'موف'],
};

export const DEFAULT_LOOKUPS: LookupItem[] = (
  Object.entries(RAW_DEFAULTS) as [LookupGroupKey, string[]][]
).flatMap(([groupKey, labels], gIdx) =>
  labels.map((label, idx) => ({
    id: `70000000-0000-4000-a000-${String(gIdx + 1).padStart(4, '0')}${String(
      idx + 1
    ).padStart(8, '0')}`,
    groupKey,
    label,
    sortOrder: idx + 1,
  }))
);

export function getLookupLabels(
  lookups: LookupItem[],
  groupKey: LookupGroupKey
): string[] {
  const found = lookups
    .filter((l) => l.groupKey === groupKey)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => l.label);
  return found.length > 0 ? found : RAW_DEFAULTS[groupKey];
}
