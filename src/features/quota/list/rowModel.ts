/**
 * List-view row model: one credential's quota flattened into what a list row
 * shows — a plan subtitle, one column per quota window, and the manual-reset
 * allowance. React-free so bun:test can cover it directly.
 *
 * Antigravity and xAI have no column model (`buildQuotaColumns` → null): their
 * grouped buckets and billing rows don't reduce to percent windows without
 * dropping data, so the row renders their provider Body instead.
 */

import type { TFunction } from 'i18next';
import type { AnthropicResetGrantStatus } from '@/services/api/claudeResetGrants';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
} from '@/types';
import { formatDateTimeValue } from '@/utils/format';
import {
  PREMIUM_CODEX_PLAN_TYPES,
  normalizePlanType,
  parseIsoToMs,
  resolveResetMs,
} from '@/utils/quota';
import type { QuotaProviderType } from '../providers/types';

/** Text the renderer either translates (`key`) or shows verbatim (`text`). */
export type QuotaListText =
  { key: string; params?: Record<string, string | number> } | { text: string };

export const resolveListText = (t: TFunction, text: QuotaListText): string =>
  'key' in text ? t(text.key, text.params ?? {}) : text.text;

/**
 * scheduled — a reset instant or label is known;
 * none — no reset known and nothing used, so no window is counting down;
 * unknown — capacity is used but the provider gave no reset time.
 */
export type QuotaResetState = 'scheduled' | 'none' | 'unknown';

export interface QuotaListColumn {
  id: string;
  label: QuotaListText;
  /** Remaining capacity, 0–100; null when the provider reported no figure. */
  remaining: number | null;
  /** Absolute label baked at fetch time; wins over `resetAtMs` for display. */
  resetLabel: QuotaListText | null;
  resetAtMs: number | null;
  resetState: QuotaResetState;
}

export interface QuotaListPlan {
  label: QuotaListText | null;
  renewal: {
    kind: 'renews' | 'ends';
    atMs: number | null;
    /** Fallback display when the payload's date could not be parsed. */
    label: string | null;
  } | null;
}

export interface QuotaListResets {
  available: number | null;
  /** The allowance that expires first, numbered as on the card (1-based). */
  next: { index: number; atMs: number } | null;
  error: QuotaListText | null;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const remainingFromUsed = (used: number | null | undefined): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - clampPercent(used)) : null;

const bakedLabel = (value: string | null | undefined): QuotaListText | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed && trimmed !== '-' ? { text: trimmed } : null;
};

const finiteMs = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function resolveResetState(
  remaining: number | null,
  resetLabel: QuotaListText | null,
  resetAtMs: number | null
): QuotaResetState {
  if (resetAtMs !== null || resetLabel !== null) return 'scheduled';
  return remaining === 100 ? 'none' : 'unknown';
}

function column(
  id: string,
  label: QuotaListText,
  remaining: number | null,
  resetLabel: QuotaListText | null,
  resetAtMs: number | null
): QuotaListColumn {
  return {
    id,
    label,
    remaining,
    resetLabel,
    resetAtMs,
    resetState: resolveResetState(remaining, resetLabel, resetAtMs),
  };
}

const windowLabel = (
  labelKey: string | undefined,
  label: string,
  params?: Record<string, string | number>
): QuotaListText => (labelKey ? { key: labelKey, params } : { text: label });

/**
 * KimiQuotaBody's remaining percent, left unrounded: rounding happens at
 * display, and 1 of 1000 used must not read as an untouched window.
 */
const kimiRemaining = (used: number, limit: number): number | null => {
  if (limit > 0) return clampPercent(((limit - used) / limit) * 100);
  return used > 0 ? 0 : null;
};

/** One column per quota window, or null when the provider has no column model. */
export function buildQuotaColumns(
  type: QuotaProviderType,
  quota: unknown
): QuotaListColumn[] | null {
  switch (type) {
    case 'claude':
      return ((quota as ClaudeQuotaState).windows ?? []).map((window) =>
        column(
          window.id,
          windowLabel(window.labelKey, window.label),
          remainingFromUsed(window.usedPercent),
          bakedLabel(window.resetLabel),
          finiteMs(window.resetAtMs)
        )
      );
    case 'codex':
      return ((quota as CodexQuotaState).windows ?? []).map((window) =>
        column(
          window.id,
          windowLabel(window.labelKey, window.label, window.labelParams),
          remainingFromUsed(window.usedPercent),
          bakedLabel(window.resetLabel),
          finiteMs(window.resetAtMs)
        )
      );
    case 'devin':
      return ((quota as DevinQuotaState).windows ?? []).map((window) =>
        column(
          window.id,
          { key: `devin_quota.${window.id}` },
          window.remainingPercent === null ? null : clampPercent(window.remainingPercent),
          null,
          finiteMs(window.resetAtMs)
        )
      );
    case 'meta':
      return ((quota as MetaQuotaState).data?.windows ?? []).map((window) =>
        column(
          window.id,
          window.id === 'window' && window.durationMinutes
            ? { key: 'meta_quota.window_duration', params: { minutes: window.durationMinutes } }
            : { key: `meta_quota.${window.id}` },
          remainingFromUsed(window.usedPercent),
          null,
          window.resetAt === undefined ? null : finiteMs(window.resetAt * 1000)
        )
      );
    case 'kimi':
      return ((quota as KimiQuotaState).rows ?? []).map((row) => {
        const resetAtMs = finiteMs(row.resetAtMs);
        return column(
          row.id,
          row.labelKey ? { key: row.labelKey, params: row.labelParams } : { text: row.label ?? '' },
          kimiRemaining(row.used, row.limit),
          resetAtMs === null && row.resetHint
            ? { key: 'kimi_quota.reset_hint', params: { hint: row.resetHint } }
            : null,
          resetAtMs
        );
      });
    default:
      return null;
  }
}

/** Codex plan label — mirrors CodexQuotaBody's getPlanLabel. */
export function codexPlanLabel(planType: string | null | undefined): QuotaListText | null {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') {
    return { key: 'codex_quota.plan_business_premium' };
  }
  if (normalized === 'pro') return { key: 'codex_quota.plan_pro' };
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return { key: 'codex_quota.plan_prolite' };
  if (normalized === 'plus') return { key: 'codex_quota.plan_plus' };
  if (normalized === 'team') return { key: 'codex_quota.plan_team' };
  if (normalized === 'free') return { key: 'codex_quota.plan_free' };
  return { text: planType || normalized };
}

function resolvePlan(type: QuotaProviderType, quota: unknown): QuotaListPlan | null {
  switch (type) {
    case 'claude': {
      const planType = (quota as ClaudeQuotaState).planType;
      return { label: planType ? { key: `claude_quota.${planType}` } : null, renewal: null };
    }
    case 'codex': {
      const codex = quota as CodexQuotaState;
      const activeUntil = codex.subscriptionActiveUntil ?? null;
      const atMs = activeUntil === null ? null : resolveResetMs([activeUntil]);
      const fallback =
        activeUntil === null || atMs !== null ? null : formatDateTimeValue(activeUntil);
      return {
        label: codexPlanLabel(codex.planType),
        renewal:
          atMs !== null || fallback ? { kind: 'renews', atMs, label: fallback || null } : null,
      };
    }
    case 'devin': {
      const devin = quota as DevinQuotaState;
      const endMs = finiteMs(devin.planEndMs);
      return {
        label: devin.plan ? { text: devin.plan } : null,
        renewal: endMs === null ? null : { kind: 'ends', atMs: endMs, label: null },
      };
    }
    case 'meta': {
      const planName = (quota as MetaQuotaState).data?.planName;
      return { label: planName ? { text: planName } : null, renewal: null };
    }
    default:
      return null;
  }
}

/** Plan and renewal shown under the credential name; null when there's nothing to say. */
export function buildPlanSubtitle(type: QuotaProviderType, quota: unknown): QuotaListPlan | null {
  const plan = resolvePlan(type, quota);
  return plan && (plan.label || plan.renewal) ? plan : null;
}

/** Earliest-expiring allowance, keeping the card's 1-based numbering. */
function earliest<T>(
  items: readonly T[],
  expiresAt: (item: T) => number | null
): QuotaListResets['next'] {
  let next: QuotaListResets['next'] = null;
  for (const [index, item] of items.entries()) {
    const atMs = expiresAt(item);
    if (atMs !== null && (next === null || atMs < next.atMs)) next = { index: index + 1, atMs };
  }
  return next;
}

export function buildCodexResets(quota: CodexQuotaState): QuotaListResets | null {
  const available = quota.rateLimitResetCreditsAvailableCount ?? null;
  const credits = quota.rateLimitResetCredits ?? [];
  const message = quota.rateLimitResetCreditsError ?? '';
  if (available === null && credits.length === 0 && !message) return null;
  return {
    available,
    next: earliest(credits, (credit) => parseIsoToMs(credit.expiresAt)),
    error: message ? { key: 'codex_quota.reset_credits_expiry_failed', params: { message } } : null,
  };
}

/**
 * Claude banked reset grants, as read by useClaudeResetGrants. `message` is the
 * hook's own status (`read_error` / `unknown` / `expired`), shown in the column
 * because an ambiguous claim must stay visible next to the allowance.
 */
export function buildClaudeResets(
  status: AnthropicResetGrantStatus | null,
  message: string
): QuotaListResets | null {
  if (!status && !message) return null;
  const grants = status?.grants ?? [];
  return {
    available: status ? grants.reduce((sum, grant) => sum + grant.resetsLeft, 0) : null,
    next: earliest(grants, (grant) =>
      grant.resetsLeft > 0 && grant.endsAt ? parseIsoToMs(grant.endsAt) : null
    ),
    error: message ? { key: `claude_reset.${message}` } : null,
  };
}
