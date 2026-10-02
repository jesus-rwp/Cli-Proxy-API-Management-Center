import type { QuotaFileEntry } from '../logic';
import type { QuotaProviderType } from '../providers/types';

/**
 * Provider groups in order of their first row, rows keeping the sorted order.
 * Under "soonest" sort the group holding the next recovery therefore leads;
 * under the default sort this is the provider tab order.
 */
export function groupByProvider(
  entries: readonly QuotaFileEntry[]
): Map<QuotaProviderType, QuotaFileEntry[]> {
  const groups = new Map<QuotaProviderType, QuotaFileEntry[]>();
  for (const entry of entries) {
    const rows = groups.get(entry.type);
    if (rows) rows.push(entry);
    else groups.set(entry.type, [entry]);
  }
  return groups;
}
