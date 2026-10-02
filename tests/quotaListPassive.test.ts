/**
 * Quota rows seeded from the proxy's own traffic: the backend keeps the last
 * rate-limit headers per credential, so the page can show limits without a
 * provider call. The cases that matter are reading the newest snapshot,
 * treating windows whose reset passed as rolled over, and staleness.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QUOTA_LIST_CLASS_KEYS, bindQuotaListClasses } from '@/features/quota/list/classes';
import { QuotaPassiveNote } from '@/features/quota/list/QuotaListColumns';
import {
  PASSIVE_QUOTA_STALE_MS,
  buildPassiveQuota,
  createPassiveQuotaResolver,
  isPassiveQuotaStale,
  latestPassedInstant,
  passiveObservedAt,
  passiveResetInstants,
  readQuotaObservation,
} from '@/features/quota/list/passiveQuota';
import type { QuotaCardState } from '@/features/quota/providers';
import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState } from '@/types';

const now = Date.UTC(2026, 9, 2, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const unix = (ms: number) => String(Math.floor(ms / 1000));
const HOUR = 3600_000;

const claudeFile = (observedAtMs: number, signals: Record<string, string>): AuthFileItem => ({
  name: 'claude-a.json',
  type: 'claude',
  quota: { observed_at: iso(observedAtMs), signals },
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('readQuotaObservation', () => {
  test('takes the newest of the credential-level and per-model snapshots', () => {
    const file: AuthFileItem = {
      name: 'a.json',
      quota: { observed_at: iso(now - 2 * HOUR), signals: { A: 'old' } },
      model_quotas: {
        'claude-opus': { observed_at: iso(now - HOUR), signals: { A: 'new' } },
        'claude-haiku': { observed_at: 'not a date', signals: { A: 'broken' } },
      },
    };
    expect(readQuotaObservation(file)).toEqual({ observedAtMs: now - HOUR, signals: { A: 'new' } });
    expect(readQuotaObservation({ name: 'b.json', quota: { signals: {} } })).toBeNull();
  });

  test('accepts Go nanosecond timestamps', () => {
    const observation = readQuotaObservation({
      name: 'go.json',
      quota: { observed_at: '2026-10-02T12:21:46.123456789+03:00', signals: { A: 'b' } },
    });
    expect(observation?.observedAtMs).toBe(Date.UTC(2026, 9, 2, 9, 21, 46, 123));
  });
});

describe('buildPassiveQuota', () => {
  test('Claude: utilization becomes used percent; a window past its reset has rolled over', () => {
    const quota = buildPassiveQuota(
      'claude',
      claudeFile(now - 10 * 60_000, {
        'Anthropic-Ratelimit-Unified-5h-Utilization': '0.9',
        'Anthropic-Ratelimit-Unified-5h-Reset': unix(now - 60_000),
        'Anthropic-Ratelimit-Unified-7d-Utilization': '0.53',
        'Anthropic-Ratelimit-Unified-7d-Reset': unix(now + 30 * HOUR),
      }),
      now
    ) as ClaudeQuotaState;
    expect(quota.status).toBe('success');
    expect(quota.windows.map((w) => [w.id, w.labelKey, w.usedPercent, w.resetAtMs])).toEqual([
      ['five-hour', 'claude_quota.five_hour', 0, null],
      ['seven-day', 'claude_quota.seven_day', 53, now + 30 * HOUR],
    ]);
    expect(passiveObservedAt(quota)).toBe(now - 10 * 60_000);
  });

  test('Codex: windows are classified by length and plan type is kept', () => {
    const observedAtMs = now - 5 * 60_000;
    const quota = buildPassiveQuota(
      'codex',
      {
        name: 'codex-a.json',
        quota: {
          observed_at: iso(observedAtMs),
          signals: {
            'X-Codex-Plan-Type': 'pro',
            'X-Codex-Primary-Window-Minutes': '10080',
            'X-Codex-Primary-Used-Percent': '29',
            'X-Codex-Primary-Reset-After-Seconds': '86400',
          },
        },
      },
      now
    ) as CodexQuotaState;
    expect(quota.planType).toBe('pro');
    expect(quota.windows).toHaveLength(1);
    expect(quota.windows[0]).toMatchObject({
      id: 'weekly',
      labelKey: 'codex_quota.secondary_window',
      usedPercent: 29,
      resetAtMs: observedAtMs + 86_400_000,
    });
  });

  test('nothing to build from', () => {
    expect(buildPassiveQuota('claude', { name: 'x.json' }, now)).toBeNull();
    expect(
      buildPassiveQuota(
        'claude',
        claudeFile(now, { 'Anthropic-Ratelimit-Unified-Status': 'allowed' }),
        now
      )
    ).toBeNull();
    expect(buildPassiveQuota('antigravity', claudeFile(now, { A: 'b' }), now)).toBeNull();
  });
});

describe('createPassiveQuotaResolver', () => {
  const file = claudeFile(now, {
    'Anthropic-Ratelimit-Unified-7d-Utilization': '0.1',
    'Anthropic-Ratelimit-Unified-7d-Reset': unix(Date.now() + 30 * HOUR),
  });
  const entry = { file, type: 'claude' as const };

  test('a fetched state wins; idle or missing falls back to proxy traffic', () => {
    const fetched = { status: 'loading' } as QuotaCardState;
    expect(createPassiveQuotaResolver(() => fetched, now)(entry)).toBe(fetched);
    const fromIdle = createPassiveQuotaResolver(() => ({ status: 'idle' }), now)(entry);
    expect(passiveObservedAt(fromIdle)).toBe(now);
    expect(passiveObservedAt(createPassiveQuotaResolver(() => undefined, now)(entry))).toBe(now);
  });

  test('builds once per file object', () => {
    const resolve = createPassiveQuotaResolver(() => undefined, now);
    expect(resolve(entry)).toBe(resolve(entry));
  });
});

describe('roll-over while the page stays open', () => {
  // 5h window spent at 12:00 and resetting at 12:01; weekly window later.
  const fiveHourReset = now + 60_000;
  const weekReset = now + 30 * HOUR;
  const entry = {
    type: 'claude' as const,
    file: claudeFile(now - 60_000, {
      'Anthropic-Ratelimit-Unified-5h-Utilization': '1',
      'Anthropic-Ratelimit-Unified-5h-Reset': unix(fiveHourReset),
      'Anthropic-Ratelimit-Unified-7d-Utilization': '0.4',
      'Anthropic-Ratelimit-Unified-7d-Reset': unix(weekReset),
    }),
  };
  const fiveHour = (nowMs: number) =>
    (createPassiveQuotaResolver(() => undefined, nowMs)(entry) as ClaudeQuotaState).windows[0];

  test('the resolver key moves only when a snapshot reset passes', () => {
    const instants = passiveResetInstants([entry]);
    expect(instants).toEqual([fiveHourReset, weekReset]);
    expect(latestPassedInstant(instants, now)).toBe(0);
    expect(latestPassedInstant(instants, now + 30_000)).toBe(0);
    expect(latestPassedInstant(instants, now + 2 * 60_000)).toBe(fiveHourReset);
  });

  test('a resolver keyed after the reset shows the window rolled over, no provider call', () => {
    expect(fiveHour(latestPassedInstant(passiveResetInstants([entry]), now))).toMatchObject({
      usedPercent: 100,
      resetAtMs: fiveHourReset,
    });
    expect(
      fiveHour(latestPassedInstant(passiveResetInstants([entry]), now + 2 * 60_000))
    ).toMatchObject({ usedPercent: 0, resetAtMs: null });
  });
});

describe('staleness', () => {
  test('older than an hour is stale', () => {
    expect(isPassiveQuotaStale(now - PASSIVE_QUOTA_STALE_MS, now)).toBe(false);
    expect(isPassiveQuotaStale(now - PASSIVE_QUOTA_STALE_MS - 1, now)).toBe(true);
  });

  const classes = bindQuotaListClasses(
    Object.fromEntries(QUOTA_LIST_CLASS_KEYS.map((key) => [key, key])),
    'test-host'
  );

  // useNow() freezes at module load under SSR; the 30s margin keeps the
  // truncated relative age stable.
  test('the note says where the figures came from and dims when stale', () => {
    const fresh = renderToStaticMarkup(
      createElement(QuotaPassiveNote, { observedAtMs: Date.now() - 7 * 60_000 - 30_000, classes })
    );
    expect(fresh).toContain('class="passiveNote"');
    expect(fresh).toContain('from proxy traffic · 7 minutes ago');
    const stale = renderToStaticMarkup(
      createElement(QuotaPassiveNote, { observedAtMs: Date.now() - 3 * HOUR - 30_000, classes })
    );
    expect(stale).toContain('class="passiveNote passiveNoteStale"');
    expect(stale).toContain('stale · from proxy traffic 3 hours ago');
  });
});
