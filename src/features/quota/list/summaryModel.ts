/**
 * Per-provider summary above the quota list: how much of one headline window
 * is left across every credential of that provider, and when it next resets.
 * React-free so bun:test can cover it directly.
 */

import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { nextRecoveryMs } from '../resetSchedule';
import { buildQuotaColumns, type QuotaListText, type QuotaResetState } from './rowModel';

/**
 * The window a provider's capacity is actually gated by. Model-scoped windows
 * (Claude's Fable or Opus 7-day) often sit at 100% while the general weekly
 * limit runs out, so they make a misleading headline.
 */
const HEADLINE_WINDOW_IDS: Partial<Record<QuotaProviderType, string>> = {
  claude: 'seven-day',
  codex: 'weekly',
  devin: 'weekly',
  meta: 'weekly',
};

export interface QuotaProviderSummary {
  type: QuotaProviderType;
  /** Credentials of this provider in the current tab and search. */
  total: number;
  /** Credentials whose quota has loaded successfully. */
  loaded: number;
  /** Label of the aggregated window; null when no loaded credential reports one. */
  headline: QuotaListText | null;
  /** Sum of remaining percent over credentials that report the window. */
  remainingSum: number | null;
  /** 100 per credential, loaded or not. */
  capacity: number;
  /** Remaining percent per credential, in list order; null = no figure. */
  segments: (number | null)[];
  nextResetAtMs: number | null;
  resetState: QuotaResetState;
}

export function buildProviderSummaries(
  entries: readonly QuotaFileEntry[],
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  nowMs: number
): QuotaProviderSummary[] {
  const byType = new Map<QuotaProviderType, QuotaFileEntry[]>();
  entries.forEach((entry) => {
    const list = byType.get(entry.type);
    if (list) list.push(entry);
    else byType.set(entry.type, [entry]);
  });

  return QUOTA_TAB_ORDER.flatMap((type) => {
    const group = byType.get(type);
    return group ? [summarize(type, group, getQuota, nowMs)] : [];
  });
}

function summarize(
  type: QuotaProviderType,
  group: readonly QuotaFileEntry[],
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  nowMs: number
): QuotaProviderSummary {
  const loadedQuotas = group.map((entry) => {
    const quota = getQuota(entry);
    return quota?.status === 'success' ? quota : null;
  });
  const columnsPerEntry = loadedQuotas.map((quota) =>
    quota ? buildQuotaColumns(type, quota) : null
  );
  const allColumns = columnsPerEntry.flatMap((columns) => columns ?? []);
  const preferred = HEADLINE_WINDOW_IDS[type];
  const headlineId =
    (preferred && allColumns.some((column) => column.id === preferred) ? preferred : null) ??
    allColumns[0]?.id ??
    null;
  const headlineColumns = columnsPerEntry.map(
    (columns) => columns?.find((column) => column.id === headlineId) ?? null
  );

  const segments = headlineColumns.map((column) => column?.remaining ?? null);
  const reported = segments.filter((value): value is number => value !== null);

  // Providers without a column model (Antigravity, xAI) still know when they recover.
  const resetCandidates =
    headlineId === null
      ? loadedQuotas.map((quota) => (quota ? nextRecoveryMs(type, quota, nowMs) : null))
      : headlineColumns.map((column) => column?.resetAtMs ?? null);
  const nextResetAtMs = resetCandidates.reduce<number | null>(
    (best, atMs) => (atMs !== null && atMs > nowMs && (best === null || atMs < best) ? atMs : best),
    null
  );

  return {
    type,
    total: group.length,
    loaded: loadedQuotas.filter(Boolean).length,
    headline: headlineColumns.find(Boolean)?.label ?? null,
    remainingSum: reported.length > 0 ? reported.reduce((sum, value) => sum + value, 0) : null,
    capacity: group.length * 100,
    segments,
    nextResetAtMs,
    resetState:
      nextResetAtMs !== null
        ? 'scheduled'
        : reported.length > 0 &&
            reported.length === group.length &&
            reported.every((v) => v === 100)
          ? 'none'
          : 'unknown',
  };
}
