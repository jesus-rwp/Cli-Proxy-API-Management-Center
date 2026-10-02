/**
 * Provider summary strip above the quota list: one cell per provider with the
 * headline window's remaining capacity summed across credentials, a segment
 * per credential, the next reset, and how many credentials have reported.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { getTypeLabel } from '@/features/authFiles/constants';
import { QuotaMeter } from '../components/QuotaMeter';
import bodyStyles from '../components/QuotaBody.module.scss';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { bindQuotaClasses } from '../types';
import { bindQuotaListClasses } from './classes';
import { ProviderLogo } from './ProviderLogo';
import { QuotaResetLine } from './QuotaListColumns';
import { resolveListText } from './rowModel';
import { buildProviderSummaries } from './summaryModel';
import listStyles from './QuotaList.module.scss';
import styles from './QuotaSummary.module.scss';

const meterClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');
const listClasses = bindQuotaListClasses(listStyles, 'QuotaList.module.scss');

export type QuotaSummaryProps = {
  entries: QuotaFileEntry[];
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
};

export function QuotaSummary({ entries, getQuota, resolvedTheme }: QuotaSummaryProps) {
  const { t } = useTranslation();
  const now = useNow();
  const summaries = useMemo(
    () => buildProviderSummaries(entries, getQuota, now),
    [entries, getQuota, now]
  );

  if (summaries.length === 0) return null;

  return (
    <section className={styles.strip} aria-label={t('quota_list.summary_aria')}>
      {summaries.map((summary) => {
        const typeLabel = getTypeLabel(t, summary.type);
        return (
          <article key={summary.type} className={styles.cell}>
            <header className={styles.head}>
              <ProviderLogo type={summary.type} resolvedTheme={resolvedTheme} />
              <span className={styles.provider}>{typeLabel}</span>
              <span className={styles.accounts}>
                {t('quota_list.summary_accounts', { count: summary.total })}
              </span>
            </header>

            <div className={styles.metricLabel}>
              {summary.headline
                ? resolveListText(t, summary.headline)
                : t('quota_list.summary_no_window')}
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>
                {summary.remainingSum === null ? '—' : `${Math.round(summary.remainingSum)}%`}
              </span>
              <span className={styles.metricOf}>
                {t('quota_list.summary_of', { total: summary.capacity })}
              </span>
            </div>

            <div className={styles.segments} aria-hidden="true">
              {summary.segments.map((remaining, index) =>
                remaining === null ? (
                  <span key={index} className={styles.segmentEmpty} />
                ) : (
                  <div key={index} className={styles.segment}>
                    <QuotaMeter percent={remaining} classes={meterClasses} index={index} />
                  </div>
                )
              )}
            </div>

            <QuotaResetLine
              absolute={null}
              atMs={summary.nextResetAtMs}
              state={summary.resetState}
              classes={listClasses}
            />
            {summary.loaded < summary.total && (
              <div className={styles.loaded}>
                {t('quota_list.summary_loaded', { loaded: summary.loaded, total: summary.total })}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
