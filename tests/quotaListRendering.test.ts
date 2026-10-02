/**
 * Quota list columns and subtitle rendered end-to-end.
 *
 * Like the provider Bodies they take their classes as props, so they render
 * here without a stylesheet; the stateful row and page shell are covered by
 * the model tests and browser checks.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QUOTA_LIST_CLASS_KEYS, bindQuotaListClasses } from '@/features/quota/list/classes';
import { QuotaListColumns, QuotaListSubtitle } from '@/features/quota/list/QuotaListColumns';
import { buildPlanSubtitle, buildQuotaColumns } from '@/features/quota/list/rowModel';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const identity = (keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, key]));
const classes = bindQuotaListClasses(identity(QUOTA_LIST_CLASS_KEYS), 'test-host');
const meterClasses = bindQuotaClasses(identity(QUOTA_CLASS_KEYS), 'test-host');

/** useNow() freezes to module-load time under renderToStaticMarkup. */
const now = Date.now();

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const claude: ClaudeQuotaState = {
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '5-hour limit',
      labelKey: 'claude_quota.five_hour',
      usedPercent: 0,
      resetLabel: '-',
      resetAtMs: null,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      labelKey: 'claude_quota.seven_day',
      usedPercent: 21,
      resetLabel: '-',
      resetAtMs: now + 3 * HOUR_MS + 5 * 60_000,
    },
    {
      id: 'seven-day-opus',
      label: '7-day Opus',
      labelKey: 'claude_quota.seven_day_opus',
      usedPercent: 40,
      resetLabel: '-',
      resetAtMs: null,
    },
  ],
};

describe('QuotaListColumns', () => {
  test('renders one column per window with countdown-first reset lines', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaListColumns, {
        columns: buildQuotaColumns('claude', claude) ?? [],
        resets: null,
        classes,
        meterClasses,
      })
    );
    expect(markup.match(/class="column"/g)).toHaveLength(3);
    expect(markup).not.toContain('columnResets');
    expect(markup).toContain('<span class="columnLabel" title="5-hour limit">5-hour limit</span>');
    expect(markup).toContain('<span class="columnPercent">100%</span>');
    expect(markup).toContain('<span class="resetMuted">No reset pending</span>');
    expect(markup).toContain('<span class="columnPercent">79%</span>');
    expect(markup).toMatch(/<span class="resetLead">in 3 hours<\/span><span class="resetMuted">/);
    expect(markup).toContain('<span class="resetMuted">Reset time unknown</span>');
    expect(markup).toContain('role="meter" aria-label="7-day limit"');
  });

  test('renders the manual resets column with the next expiry', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaListColumns, {
        columns: [],
        resets: { available: 2, next: { index: 1, atMs: now + 22 * DAY_MS }, error: null },
        classes,
        meterClasses,
      })
    );
    expect(markup).toContain('<div class="column columnResets">');
    expect(markup).toContain('Manual resets');
    expect(markup).toContain('<span class="resetsCount">2</span><span>available</span>');
    expect(markup).toMatch(/<span>Reset 1<\/span><span class="resetLead">in 22 days<\/span>/);
  });

  test('a reset read error replaces the expiry line', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaListColumns, {
        columns: [],
        resets: { available: null, next: null, error: { key: 'claude_reset.read_error' } },
        classes,
        meterClasses,
      })
    );
    expect(markup).toContain('<span class="resetsCount">--</span>');
    expect(markup).toContain(
      '<div class="columnError" role="status">Reset grants could not be read.'
    );
  });

  test('no windows and no resets says so', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaListColumns, { columns: [], resets: null, classes, meterClasses })
    );
    expect(markup).toBe('<div class="message">No quota windows reported</div>');
  });
});

describe('QuotaListSubtitle', () => {
  test('Codex reads plan · renews date · countdown', () => {
    const codex: CodexQuotaState = {
      status: 'success',
      windows: [],
      planType: 'pro',
      subscriptionActiveUntil: new Date(now + 21 * DAY_MS + HOUR_MS).toISOString(),
    };
    const plan = buildPlanSubtitle('codex', codex);
    if (!plan) throw new Error('expected a plan subtitle');
    const markup = renderToStaticMarkup(createElement(QuotaListSubtitle, { plan, classes }));
    expect(markup).toMatch(
      /^<div class="subtitle" title="Pro 20x · renews [^"]+ · in 21 days"><span class="plan">Pro 20x<\/span><span>renews [^<]+<\/span><span>in 21 days<\/span><\/div>$/
    );
  });

  test('Claude shows only the plan', () => {
    const plan = buildPlanSubtitle('claude', claude);
    if (!plan) throw new Error('expected a plan subtitle');
    expect(renderToStaticMarkup(createElement(QuotaListSubtitle, { plan, classes }))).toBe(
      '<div class="subtitle" title="Max"><span class="plan">Max</span></div>'
    );
  });
});

describe('quota_list locale keys', () => {
  const read = (locale: string) =>
    (
      JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ) as { quota_list: Record<string, string> }
    ).quota_list;
  const base = (key: string) => key.replace(/_(one|few|many|other)$/, '');
  const english = new Set(Object.keys(read('en')).map(base));

  test.each(['zh-CN', 'zh-TW', 'ru'])('%s covers every English key', (locale) => {
    expect(new Set(Object.keys(read(locale)).map(base))).toEqual(english);
  });
});
