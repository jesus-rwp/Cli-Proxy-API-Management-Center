/**
 * Email masking for quota credential names: the filename carries the account
 * address, so every shape the backend produces must come out masked.
 */

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n';
import { QuotaTimeline } from '@/features/quota/components/QuotaTimeline';
import {
  credentialDisplayName,
  laneNameFormatter,
  maskEmail,
  maskIdentity,
} from '@/features/quota/list/privacy';
import type { QuotaFileEntry } from '@/features/quota/logic';

describe('maskEmail', () => {
  test.each([
    ['tom@acme.dev', 't•••@a•••.dev'],
    ['john.doe@gmail.com', 'j•••@g•••.com'],
    ['user@mail.example.co.uk', 'u•••@m•••.example.co.uk'],
    ['root@localhost', 'r•••@l•••'],
    ['not-an-email', 'not-an-email'],
    ['@acme.dev', '@acme.dev'],
  ])('%s → %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});

describe('maskIdentity', () => {
  test.each([
    ['claude-tom@1acme.dev.json', 'claude-t•••@1•••.dev.json'],
    ['codex-ae5d455f-tom@1acme.dev-pro.json', 'codex-ae5d455f-t•••@1•••.dev-pro.json'],
    ['codex-tom@gmail.com-pro.json', 'codex-t•••@g•••.com-pro.json'],
    ['shared.json · demo@example.test', 'shared.json · d•••@e•••.test'],
    ['antigravity-plain.json', 'antigravity-plain.json'],
  ])('%s → %s', (name, masked) => {
    expect(maskIdentity(name)).toBe(masked);
  });

  test('the credential email wins, so a hyphenated local part is masked whole', () => {
    expect(maskIdentity('claude-john-doe@acme.dev.json', 'john-doe@acme.dev')).toBe(
      'claude-j•••@a•••.dev.json'
    );
    expect(maskIdentity('claude-John-Doe@Acme.dev.json', 'john-doe@acme.dev')).toBe(
      'claude-J•••@A•••.dev.json'
    );
  });

  test('is idempotent', () => {
    const once = maskIdentity('claude-tom@acme.dev.json', 'tom@acme.dev');
    expect(maskIdentity(once, 'tom@acme.dev')).toBe(once);
  });
});

const hyphenated = { name: 'claude-john-doe@example.test.json', email: 'john-doe@example.test' };

describe('page-level display names', () => {
  test('cards and rows share one name, masked unless emails are shown', () => {
    expect(credentialDisplayName(hyphenated, false)).toBe('claude-j•••@e•••.test.json');
    expect(credentialDisplayName(hyphenated, true)).toBe(hyphenated.name);
    expect(
      credentialDisplayName(
        { name: 'shared.json', type: 'devin', email: 'demo@example.test', authIndex: '1' },
        false
      )
    ).toBe('shared.json · d•••@e•••.test');
  });

  test('the card grid receives the masked name instead of deriving its own', () => {
    const page = readFileSync(
      new URL('../src/features/quota/QuotaPage.tsx', import.meta.url),
      'utf8'
    );
    const card = readFileSync(
      new URL('../src/features/quota/components/QuotaCard.tsx', import.meta.url),
      'utf8'
    );
    expect(page).toContain('displayName={credentialDisplayName(entry.file, showEmail)}');
    expect(card).toContain('const displayName = props.displayName ?? getQuotaDisplayName(file);');
  });

  test('timeline lanes mask the full email, hyphens included', () => {
    const entries: QuotaFileEntry[] = [{ file: hyphenated, type: 'claude' }];
    const now = new Date(2026, 6, 29, 12).getTime();
    const render = (showEmail: boolean) =>
      renderToStaticMarkup(
        createElement(QuotaTimeline, {
          entries,
          displayNameFor: laneNameFormatter(showEmail),
          resolvedTheme: 'light',
          now,
          quotaFor: () => ({
            status: 'success',
            windows: [
              {
                id: 'seven-day',
                label: '7-day',
                usedPercent: 25,
                resetLabel: '-',
                resetAtMs: now + 2 * 24 * 3600 * 1000,
                periodHours: 168,
              },
            ],
          }),
        })
      );
    const masked = render(false);
    expect(masked).toContain('claude-j•••@e•••.test.json');
    expect(masked).not.toContain('john-doe');
    expect(render(true)).toContain('claude-john-doe@example.test.json');
  });
});
