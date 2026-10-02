/** Quota list/cards view and email visibility: session-scoped, like the page's uiState. */
export const QUOTA_VIEW_MODES = ['list', 'cards'] as const;

export type QuotaViewMode = (typeof QUOTA_VIEW_MODES)[number];

export type QuotaViewState = {
  viewMode?: QuotaViewMode;
  showEmail?: boolean;
};

const QUOTA_VIEW_STATE_KEY = 'quotaPage.viewState';

const QUOTA_VIEW_MODE_SET = new Set<string>(QUOTA_VIEW_MODES);

export const isQuotaViewMode = (value: unknown): value is QuotaViewMode =>
  typeof value === 'string' && QUOTA_VIEW_MODE_SET.has(value);

export const readQuotaViewState = (): QuotaViewState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(QUOTA_VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuotaViewState;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      viewMode: isQuotaViewMode(parsed.viewMode) ? parsed.viewMode : undefined,
      showEmail: typeof parsed.showEmail === 'boolean' ? parsed.showEmail : undefined,
    };
  } catch {
    return null;
  }
};

/** Merge into what is stored: the two controls write one field each. */
export const writeQuotaViewState = (state: QuotaViewState) => {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readQuotaViewState(), ...state };
    window.sessionStorage.setItem(QUOTA_VIEW_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
};
