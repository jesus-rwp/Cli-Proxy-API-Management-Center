/**
 * Quota read from the proxy's own traffic.
 *
 * Every Claude/Codex response the proxy relays carries rate-limit headers, and
 * the backend keeps the latest set per credential (`quota` and `model_quotas`
 * on /credentials, memory-only). Seeding rows from them shows the 5-hour and
 * weekly windows without calling the provider. A manual refresh still fetches
 * the full picture: model-scoped windows, plan, renewal, manual resets.
 *
 * React-free so bun:test can cover it directly.
 */

import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState, CodexQuotaWindow } from '@/types';
import { parseIsoToMs } from '@/utils/quota';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';

/** Older observations are shown dimmed as stale. */
export const PASSIVE_QUOTA_STALE_MS = 60 * 60 * 1000;

const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

export interface PassiveQuotaMarker {
  /** When the backend recorded the headers this state was built from. */
  passiveObservedAtMs: number;
}

interface QuotaObservation {
  observedAtMs: number;
  signals: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readObservation(value: unknown): QuotaObservation | null {
  if (!isRecord(value) || !isRecord(value.signals)) return null;
  // Go marshals RFC 3339 with nanoseconds, which some engines reject.
  const observedAtMs = parseIsoToMs(value.observed_at);
  if (observedAtMs === null) return null;
  const signals: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value.signals)) {
    if (typeof raw === 'string') signals[key] = raw;
  }
  return Object.keys(signals).length > 0 ? { observedAtMs, signals } : null;
}

/**
 * The newest snapshot among the credential-level one and the per-model ones.
 * Claude and Codex limits apply to the whole credential, so any model's
 * snapshot describes them all.
 */
export function readQuotaObservation(file: AuthFileItem): QuotaObservation | null {
  let latest = readObservation(file.quota);
  const perModel = file.model_quotas;
  if (isRecord(perModel)) {
    for (const value of Object.values(perModel)) {
      const observation = readObservation(value);
      if (observation && (!latest || observation.observedAtMs > latest.observedAtMs)) {
        latest = observation;
      }
    }
  }
  return latest;
}

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Unix seconds (or milliseconds, when too large to be seconds) to epoch ms. */
const toUnixMs = (value: string | undefined): number | null => {
  const parsed = toNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return parsed > 1e12 ? parsed : parsed * 1000;
};

/**
 * A window whose reset has passed has rolled over since the snapshot: it is
 * fresh, not still spent.
 */
const rolledOver = (resetAtMs: number | null, nowMs: number) =>
  resetAtMs !== null && resetAtMs <= nowMs;

function buildClaude(observation: QuotaObservation, nowMs: number): ClaudeQuotaState | null {
  const windows: ClaudeQuotaState['windows'] = [];
  for (const spec of [
    { name: '5h', id: 'five-hour', labelKey: 'claude_quota.five_hour', periodHours: 5 },
    { name: '7d', id: 'seven-day', labelKey: 'claude_quota.seven_day', periodHours: 168 },
  ]) {
    const prefix = `Anthropic-Ratelimit-Unified-${spec.name}-`;
    const utilization = toNumber(observation.signals[`${prefix}Utilization`]);
    const resetAtMs = toUnixMs(observation.signals[`${prefix}Reset`]);
    if (utilization === null && resetAtMs === null) continue;
    const fresh = rolledOver(resetAtMs, nowMs);
    windows.push({
      id: spec.id,
      label: spec.labelKey,
      labelKey: spec.labelKey,
      usedPercent: fresh ? 0 : utilization === null ? null : utilization * 100,
      resetLabel: '-',
      resetAtMs: fresh ? null : resetAtMs,
      periodHours: spec.periodHours,
    });
  }
  return windows.length > 0 ? { status: 'success', windows, planType: null } : null;
}

/** Same ids and labels as a full Codex fetch, classified by window length. */
function codexWindowMeta(minutes: number) {
  if (minutes < DAY_MINUTES) return { id: 'five-hour', labelKey: 'codex_quota.primary_window' };
  if (minutes >= 28 * DAY_MINUTES) {
    return { id: 'monthly', labelKey: 'codex_quota.team_secondary_window' };
  }
  return { id: 'weekly', labelKey: 'codex_quota.secondary_window' };
}

function buildCodex(observation: QuotaObservation, nowMs: number): CodexQuotaState | null {
  const windows: CodexQuotaWindow[] = [];
  for (const name of ['Primary', 'Secondary']) {
    const prefix = `X-Codex-${name}-`;
    const minutes = toNumber(observation.signals[`${prefix}Window-Minutes`]);
    if (minutes === null || minutes <= 0) continue;
    const after = toNumber(observation.signals[`${prefix}Reset-After-Seconds`]);
    const resetAtMs =
      toUnixMs(observation.signals[`${prefix}Reset-At`]) ??
      (after !== null && after >= 0 ? observation.observedAtMs + after * 1000 : null);
    const used = toNumber(observation.signals[`${prefix}Used-Percent`]);
    const fresh = rolledOver(resetAtMs, nowMs);
    const meta = codexWindowMeta(minutes);
    windows.push({
      ...meta,
      label: meta.labelKey,
      usedPercent: fresh ? 0 : used,
      resetLabel: '-',
      resetAtMs: fresh ? null : resetAtMs,
      periodHours: minutes / HOUR_MINUTES,
    });
  }
  if (windows.length === 0) return null;
  const planType = observation.signals['X-Codex-Plan-Type']?.trim() || null;
  return { status: 'success', windows, planType };
}

/** A success-shaped quota state built from the proxy's own traffic, or null. */
export function buildPassiveQuota(
  type: QuotaProviderType,
  file: AuthFileItem,
  nowMs: number
): (QuotaCardState & PassiveQuotaMarker) | null {
  if (type !== 'claude' && type !== 'codex') return null;
  const observation = readQuotaObservation(file);
  if (!observation) return null;
  const state =
    type === 'claude' ? buildClaude(observation, nowMs) : buildCodex(observation, nowMs);
  return state ? { ...state, passiveObservedAtMs: observation.observedAtMs } : null;
}

/** When the state came from proxy traffic, the observation instant; otherwise null. */
export function passiveObservedAt(quota: QuotaCardState | undefined): number | null {
  const value = (quota as Partial<PassiveQuotaMarker> | undefined)?.passiveObservedAtMs;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export const isPassiveQuotaStale = (observedAtMs: number, nowMs: number) =>
  nowMs - observedAtMs > PASSIVE_QUOTA_STALE_MS;

type PassiveEntry = { file: AuthFileItem; type: QuotaProviderType };

/**
 * Every window reset instant in the entries' proxy-traffic snapshots, ascending.
 * The passive states only change when one of these passes.
 */
export function passiveResetInstants(entries: readonly PassiveEntry[]): number[] {
  const instants: number[] = [];
  for (const entry of entries) {
    // At time 0 nothing has rolled over, so every window keeps its reset.
    const state = buildPassiveQuota(entry.type, entry.file, 0) as
      (QuotaCardState & { windows?: { resetAtMs?: number | null }[] }) | null;
    for (const window of state?.windows ?? []) {
      if (typeof window.resetAtMs === 'number') instants.push(window.resetAtMs);
    }
  }
  return instants.sort((a, b) => a - b);
}

/**
 * The latest instant that has passed, or 0. Deciding roll-over against it is
 * exact for these instants, and it changes only when one of them passes, so a
 * resolver keyed on it is rebuilt then and not on every clock tick.
 */
export function latestPassedInstant(instants: readonly number[], nowMs: number): number {
  let latest = 0;
  for (const instant of instants) {
    if (instant > nowMs) break;
    latest = instant;
  }
  return latest;
}

/**
 * The quota a list row shows: whatever was fetched, else the proxy-traffic
 * snapshot as of nowMs. Cached per file object, which is replaced on every
 * list reload; build a new resolver when nowMs moves past a reset.
 */
export function createPassiveQuotaResolver(
  getQuota: (entry: PassiveEntry) => QuotaCardState | undefined,
  nowMs: number
) {
  const cache = new WeakMap<AuthFileItem, QuotaCardState | null>();
  return (entry: PassiveEntry) => {
    const fetched = getQuota(entry);
    if (fetched && fetched.status !== 'idle') return fetched;
    let passive = cache.get(entry.file);
    if (passive === undefined) {
      passive = buildPassiveQuota(entry.type, entry.file, nowMs);
      cache.set(entry.file, passive);
    }
    return passive ?? fetched;
  };
}
