import { describe, expect, test } from 'bun:test';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';

type LocaleTree = { [key: string]: string | LocaleTree };

const flatten = (tree: LocaleTree, prefix = ''): Map<string, string> => {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.set(path, value);
    } else {
      for (const [nested, text] of flatten(value, path)) entries.set(nested, text);
    }
  }
  return entries;
};

const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();

// A key missing from ru.json falls back to zh-CN, so Russian users see Chinese.
describe('ru locale', () => {
  const enEntries = flatten(en as LocaleTree);
  const ruEntries = flatten(ru as LocaleTree);

  test('translates every key of the English locale', () => {
    const missing = [...enEntries.keys()].filter((key) => !ruEntries.has(key));
    expect(missing).toEqual([]);
  });

  test('keeps the interpolation placeholders of the English text', () => {
    const mismatched = [...enEntries]
      .filter(([key]) => ruEntries.has(key))
      .filter(([key, text]) => {
        const translated = ruEntries.get(key) ?? '';
        return placeholders(translated).join() !== placeholders(text).join();
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });
});
