/**
 * Typed class contract for the list's presentational pieces, so they take their
 * stylesheet as a prop (like the provider Bodies) and render under bun:test.
 */

export const QUOTA_LIST_CLASS_KEYS = [
  'columns',
  'column',
  'columnResets',
  'columnHead',
  'columnLabel',
  'columnPercent',
  'resetLine',
  'resetLead',
  'resetMuted',
  'resetsValue',
  'resetsCount',
  'columnError',
  'message',
  'subtitle',
  'plan',
  'passiveNote',
  'passiveNoteStale',
] as const;

export type QuotaListClassMap = Record<(typeof QUOTA_LIST_CLASS_KEYS)[number], string>;

/** Host CSS module → typed contract. Missing keys throw at module init. */
export function bindQuotaListClasses(
  module: Record<string, string>,
  source: string
): QuotaListClassMap {
  const missing = QUOTA_LIST_CLASS_KEYS.filter((key) => !module[key]);
  if (missing.length > 0) {
    throw new Error(`[quota-list] ${source} is missing classes: ${missing.join(', ')}`);
  }
  return Object.fromEntries(
    QUOTA_LIST_CLASS_KEYS.map((key) => [key, module[key]])
  ) as QuotaListClassMap;
}
