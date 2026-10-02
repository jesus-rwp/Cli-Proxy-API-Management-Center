/** Session-scoped quota view preferences: list/cards and email visibility. */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readQuotaViewState, writeQuotaViewState } from '@/features/quota/list/viewState';

const KEY = 'quotaPage.viewState';

/** Test files share one process — leaving a fake `window` behind would leak. */
const originalWindow = (globalThis as { window?: unknown }).window;

function installSessionStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  (globalThis as unknown as { window: unknown }).window = { sessionStorage: storage };
  return storage;
}

let storage: ReturnType<typeof installSessionStorage>;

beforeEach(() => {
  storage = installSessionStorage();
});

afterAll(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe('quota view state', () => {
  test('is empty until something is written', () => {
    expect(readQuotaViewState()).toBeNull();
  });

  test('each control writes its own field without dropping the other', () => {
    writeQuotaViewState({ viewMode: 'cards' });
    writeQuotaViewState({ showEmail: true });
    expect(readQuotaViewState()).toEqual({ viewMode: 'cards', showEmail: true });
  });

  test('invalid stored values are ignored', () => {
    storage.setItem(KEY, JSON.stringify({ viewMode: 'table', showEmail: 'yes' }));
    expect(readQuotaViewState()).toEqual({ viewMode: undefined, showEmail: undefined });
    storage.setItem(KEY, '{not json');
    expect(readQuotaViewState()).toBeNull();
  });
});
