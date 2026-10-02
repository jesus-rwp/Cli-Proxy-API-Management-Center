/**
 * Quota list row and summary models.
 *
 * The list renders whatever these return, so the cases that matter are the
 * ones the cards express differently: remaining vs used percent per provider,
 * the "no reset pending" vs "unknown" split, and which allowance counts as next.
 */

import { describe, expect, test } from 'bun:test';
import type {
  AnthropicResetGrant,
  AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import {
  buildClaudeResets,
  buildCodexResets,
  buildPlanSubtitle,
  buildQuotaColumns,
  codexPlanLabel,
} from '@/features/quota/list/rowModel';
import { groupByProvider } from '@/features/quota/list/grouping';
import { buildProviderSummaries } from '@/features/quota/list/summaryModel';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
} from '@/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const now = Date.UTC(2026, 9, 2, 12, 0, 0);

const claudeQuota = (
  windows: Partial<ClaudeQuotaState['windows'][number]>[],
  planType: string | null = 'plan_max'
): ClaudeQuotaState => ({
  status: 'success',
  planType,
  windows: windows.map((window, index) => ({
    id: `w${index}`,
    label: `Window ${index}`,
    usedPercent: 0,
    resetLabel: '-',
    resetAtMs: null,
    ...window,
  })),
});

describe('buildQuotaColumns', () => {
  test('Claude windows become remaining-percent columns with a reset state', () => {
    const columns = buildQuotaColumns(
      'claude',
      claudeQuota([
        { id: 'five-hour', labelKey: 'claude_quota.five_hour', usedPercent: 0 },
        { id: 'seven-day', labelKey: 'claude_quota.seven_day', usedPercent: 67 },
        {
          id: 'seven-day-fable',
          labelKey: 'claude_quota.seven_day_fable',
          usedPercent: 42,
          resetAtMs: now + DAY_MS,
        },
        { id: 'seven-day-opus', usedPercent: 120, resetLabel: '10/03 03:00' },
      ])
    );
    expect(columns).toEqual([
      {
        id: 'five-hour',
        label: { key: 'claude_quota.five_hour', params: undefined },
        remaining: 100,
        resetLabel: null,
        resetAtMs: null,
        resetState: 'none',
      },
      {
        id: 'seven-day',
        label: { key: 'claude_quota.seven_day', params: undefined },
        remaining: 33,
        resetLabel: null,
        resetAtMs: null,
        resetState: 'unknown',
      },
      {
        id: 'seven-day-fable',
        label: { key: 'claude_quota.seven_day_fable', params: undefined },
        remaining: 58,
        resetLabel: null,
        resetAtMs: now + DAY_MS,
        resetState: 'scheduled',
      },
      {
        id: 'seven-day-opus',
        label: { text: 'Window 3' },
        remaining: 0,
        resetLabel: { text: '10/03 03:00' },
        resetAtMs: null,
        resetState: 'scheduled',
      },
    ]);
  });

  test('an unknown percent is never "no reset pending"', () => {
    const [column] = buildQuotaColumns('claude', claudeQuota([{ usedPercent: null }])) ?? [];
    expect(column.remaining).toBeNull();
    expect(column.resetState).toBe('unknown');
  });

  test('Codex keeps label params', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      windows: [
        {
          id: 'gpt-weekly-0',
          label: 'GPT weekly',
          labelKey: 'codex_quota.additional_secondary_window',
          labelParams: { name: 'GPT' },
          usedPercent: 83,
          resetLabel: '09/14 18:42',
          resetAtMs: now + 2 * DAY_MS,
        },
      ],
    };
    const [column] = buildQuotaColumns('codex', quota) ?? [];
    expect(column.label).toEqual({
      key: 'codex_quota.additional_secondary_window',
      params: { name: 'GPT' },
    });
    expect(column.remaining).toBe(17);
    expect(column.resetState).toBe('scheduled');
  });

  test('Kimi derives remaining from counts and falls back to the reset hint', () => {
    const quota: KimiQuotaState = {
      status: 'success',
      rows: [
        { id: 'limit-1', labelKey: 'kimi_quota.weekly', used: 25, limit: 100, resetHint: '3h' },
        { id: 'limit-2', label: 'Burst', used: 3, limit: 0, resetAtMs: now + HOUR_MS },
      ],
    };
    const columns = buildQuotaColumns('kimi', quota) ?? [];
    expect(columns[0].remaining).toBe(75);
    expect(columns[0].resetLabel).toEqual({ key: 'kimi_quota.reset_hint', params: { hint: '3h' } });
    expect(columns[1].remaining).toBe(0);
    expect(columns[1].resetLabel).toBeNull();
    expect(columns[1].resetAtMs).toBe(now + HOUR_MS);
  });

  test('Kimi: a sliver of usage is not "no reset pending"', () => {
    const [row] =
      buildQuotaColumns('kimi', {
        status: 'success',
        rows: [{ id: 'limit-1', label: 'Weekly', used: 1, limit: 1000 }],
      } satisfies KimiQuotaState) ?? [];
    expect(row.remaining).toBeCloseTo(99.9);
    expect(row.resetState).toBe('unknown');
  });

  test('Devin is already remaining; Meta resets are Unix seconds', () => {
    const devin: DevinQuotaState = {
      status: 'success',
      windows: [{ id: 'weekly', remainingPercent: 40, resetAtMs: null, periodHours: 168 }],
      observedAtMs: now,
      plan: 'Teams',
      planStartMs: null,
      planEndMs: now + 10 * DAY_MS,
    };
    expect(buildQuotaColumns('devin', devin)?.[0]).toMatchObject({
      label: { key: 'devin_quota.weekly' },
      remaining: 40,
      resetState: 'unknown',
    });

    const meta: MetaQuotaState = {
      status: 'success',
      data: {
        windows: [
          { id: 'window', usedPercent: 10, resetAt: 1_800_000_000, durationMinutes: 300 },
          { id: 'weekly', usedPercent: null },
        ],
      },
    };
    const [window, weekly] = buildQuotaColumns('meta', meta) ?? [];
    expect(window.label).toEqual({ key: 'meta_quota.window_duration', params: { minutes: 300 } });
    expect(window.resetAtMs).toBe(1_800_000_000_000);
    expect(window.remaining).toBe(90);
    expect(weekly.label).toEqual({ key: 'meta_quota.weekly' });
  });

  test('Antigravity and xAI have no column model', () => {
    expect(buildQuotaColumns('antigravity', { status: 'success', groups: [] })).toBeNull();
    expect(buildQuotaColumns('xai', { status: 'success', billing: null })).toBeNull();
  });
});

describe('plan subtitle', () => {
  test.each([
    ['pro', { key: 'codex_quota.plan_pro' }],
    ['  PROLITE ', { key: 'codex_quota.plan_prolite' }],
    ['self_serve_business_prolite', { key: 'codex_quota.plan_business_premium' }],
    ['plus', { key: 'codex_quota.plan_plus' }],
    ['enterprise', { text: 'enterprise' }],
    [null, null],
  ])('Codex plan %p', (planType, expected) => {
    expect(codexPlanLabel(planType)).toEqual(expected);
  });

  test('Codex renewal comes from subscriptionActiveUntil', () => {
    const activeUntil = new Date(now + 21 * DAY_MS).toISOString();
    expect(
      buildPlanSubtitle('codex', {
        status: 'success',
        windows: [],
        planType: 'pro',
        subscriptionActiveUntil: activeUntil,
      } satisfies CodexQuotaState)
    ).toEqual({
      label: { key: 'codex_quota.plan_pro' },
      renewal: { kind: 'renews', atMs: now + 21 * DAY_MS, label: null },
    });
  });

  test('Claude shows its plan; nothing to say is null', () => {
    expect(buildPlanSubtitle('claude', claudeQuota([]))).toEqual({
      label: { key: 'claude_quota.plan_max' },
      renewal: null,
    });
    expect(buildPlanSubtitle('claude', claudeQuota([], null))).toBeNull();
    expect(buildPlanSubtitle('kimi', { status: 'success', rows: [] })).toBeNull();
  });
});

const grant = (overrides: Partial<AnthropicResetGrant>): AnthropicResetGrant => ({
  id: 'g',
  label: 'Grant',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: null,
  endsAt: null,
  clears: ['five_hour'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...overrides,
});

const grantStatus = (grants: AnthropicResetGrant[]): AnthropicResetGrantStatus => ({
  eligible: true,
  ineligibleReason: null,
  atLimit: false,
  grants,
  nextGrantId: grants[0]?.id ?? null,
  weeklyResetsAt: null,
  cooldownUntil: null,
});

describe('manual resets', () => {
  test('Codex picks the earliest-expiring credit and keeps its card number', () => {
    const resets = buildCodexResets({
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: 2,
      rateLimitResetCredits: [
        {
          id: 'a',
          status: 'available',
          grantedAt: '',
          expiresAt: new Date(now + 22 * DAY_MS).toISOString(),
        },
        {
          id: 'b',
          status: 'available',
          grantedAt: '',
          expiresAt: new Date(now + 8 * DAY_MS).toISOString(),
        },
      ],
    });
    expect(resets).toEqual({
      available: 2,
      next: { index: 2, atMs: now + 8 * DAY_MS },
      error: null,
    });
  });

  test('Codex without any reset data has no column; a read error still shows', () => {
    expect(buildCodexResets({ status: 'success', windows: [] })).toBeNull();
    expect(
      buildCodexResets({ status: 'success', windows: [], rateLimitResetCreditsError: 'boom' })
    ).toEqual({
      available: null,
      next: null,
      error: { key: 'codex_quota.reset_credits_expiry_failed', params: { message: 'boom' } },
    });
  });

  test('Claude sums grants and skips spent ones for the next expiry', () => {
    const resets = buildClaudeResets(
      grantStatus([
        grant({ id: 'spent', resetsLeft: 0, endsAt: new Date(now + DAY_MS).toISOString() }),
        grant({ id: 'later', resetsLeft: 2, endsAt: new Date(now + 9 * DAY_MS).toISOString() }),
        grant({ id: 'open', resetsLeft: 1, endsAt: null }),
      ]),
      ''
    );
    expect(resets).toEqual({
      available: 3,
      next: { index: 2, atMs: now + 9 * DAY_MS },
      error: null,
    });
  });

  test('Claude: nothing read yet means no column; an ambiguous claim stays visible', () => {
    expect(buildClaudeResets(null, '')).toBeNull();
    expect(buildClaudeResets(null, 'unknown')).toEqual({
      available: null,
      next: null,
      error: { key: 'claude_reset.unknown' },
    });
    expect(buildClaudeResets(grantStatus([]), '')?.available).toBe(0);
  });
});

describe('buildProviderSummaries', () => {
  const entry = (name: string, type: QuotaFileEntry['type']): QuotaFileEntry => ({
    file: { name },
    type,
  });

  test('sums the general weekly window across credentials, not a model-scoped one', () => {
    const entries = [
      entry('a.json', 'claude'),
      entry('b.json', 'claude'),
      entry('c.json', 'claude'),
    ];
    const quotas: Record<string, QuotaCardState> = {
      'a.json': claudeQuota([
        { id: 'seven-day-fable', labelKey: 'claude_quota.seven_day_fable', usedPercent: 0 },
        {
          id: 'seven-day',
          labelKey: 'claude_quota.seven_day',
          usedPercent: 67,
          resetAtMs: now + 13 * HOUR_MS,
        },
      ]),
      'b.json': claudeQuota([
        {
          id: 'seven-day',
          labelKey: 'claude_quota.seven_day',
          usedPercent: 0,
          resetAtMs: now + 3 * DAY_MS,
        },
      ]),
    };
    const [summary] = buildProviderSummaries(entries, (e) => quotas[e.file.name], now);
    expect(summary).toEqual({
      type: 'claude',
      total: 3,
      loaded: 2,
      headline: { key: 'claude_quota.seven_day', params: undefined },
      remainingSum: 133,
      capacity: 300,
      segments: [33, 100, null],
      nextResetAtMs: now + 13 * HOUR_MS,
      resetState: 'scheduled',
    });
  });

  test('falls back to the first reported window and orders providers by tab order', () => {
    const entries = [entry('k.json', 'kimi'), entry('c.json', 'claude')];
    const quotas: Record<string, QuotaCardState> = {
      'k.json': {
        status: 'success',
        rows: [{ id: 'limit-1', label: 'Weekly', used: 0, limit: 10 }],
      } as KimiQuotaState,
      'c.json': { status: 'error', error: 'nope' } as QuotaCardState,
    };
    const summaries = buildProviderSummaries(entries, (e) => quotas[e.file.name], now);
    expect(summaries.map((s) => s.type)).toEqual(['claude', 'kimi']);
    expect(summaries[0]).toMatchObject({
      loaded: 0,
      headline: null,
      remainingSum: null,
      resetState: 'unknown',
    });
    expect(summaries[1]).toMatchObject({
      headline: { text: 'Weekly' },
      remainingSum: 100,
      resetState: 'none',
    });
  });

  test('providers without columns still report their next recovery', () => {
    const quota = {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 40,
        productUsage: [],
        monthlyLimitCents: null,
        usedCents: null,
        includedUsedCents: null,
        onDemandCapCents: null,
        onDemandUsedCents: null,
        onDemandUsedPercent: null,
        usedPercent: null,
        resetAtMs: now + 2 * DAY_MS,
      },
    } as QuotaCardState;
    const [summary] = buildProviderSummaries([entry('x.json', 'xai')], () => quota, now);
    expect(summary).toMatchObject({
      headline: null,
      remainingSum: null,
      nextResetAtMs: now + 2 * DAY_MS,
      resetState: 'scheduled',
    });
  });
});

describe('groupByProvider', () => {
  test('groups follow their first row and rows keep the sorted order', () => {
    const sorted: QuotaFileEntry[] = [
      { file: { name: 'codex-b.json' }, type: 'codex' },
      { file: { name: 'claude-a.json' }, type: 'claude' },
      { file: { name: 'codex-a.json' }, type: 'codex' },
      { file: { name: 'claude-b.json' }, type: 'claude' },
    ];
    const groups = groupByProvider(sorted);
    expect([...groups.keys()]).toEqual(['codex', 'claude']);
    expect(groups.get('codex')?.map((e) => e.file.name)).toEqual(['codex-b.json', 'codex-a.json']);
    expect(groups.get('claude')?.map((e) => e.file.name)).toEqual([
      'claude-a.json',
      'claude-b.json',
    ]);
  });
});
