/**
 * Arabic-aware smart search utilities:
 * - Normalizes Alef variants (أ إ آ ٱ -> ا), Teh Marbuta (ة -> ه), Alef Maksura (ى -> ي),
 *   diacritics (تشكيل), tatweel (ـ), and Arabic-Indic digits (٠-٩ -> 0-9).
 * - Supports multi-token AND matching in any word order.
 */

const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u0640]/g;
const ARABIC_DIGITS_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export function normalizeSmartText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .toLowerCase()
    .replace(ARABIC_DIACRITICS_RE, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => ARABIC_DIGITS_MAP[d] ?? d)
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSmartQuery(query: string): string[] {
  const norm = normalizeSmartText(query);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/**
 * Returns true if ALL tokens in `query` appear anywhere in the combined normalized `haystacks`.
 */
export function matchesSmartQuery(
  query: string,
  haystacks: Array<string | number | null | undefined>
): boolean {
  const tokens = tokenizeSmartQuery(query);
  if (tokens.length === 0) return true;
  const combined = normalizeSmartText(haystacks.filter((h) => h !== null && h !== undefined).join(' '));
  return tokens.every((tok) => combined.includes(tok));
}
