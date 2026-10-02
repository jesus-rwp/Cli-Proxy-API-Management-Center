/**
 * Presentational halves of a list row: the plan subtitle and the window
 * columns. Both take their classes as props so bun:test can render them.
 *
 * Reset lines read countdown first (`in 1 day · 09/13, 13:00`): in a row of
 * columns the scan is "which one comes back first", not the calendar date.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, formatRelativeInstant } from '@/utils/quota';
import { QuotaMeter } from '../components/QuotaMeter';
import type { QuotaClassMap } from '../types';
import type { QuotaListClassMap } from './classes';
import { isPassiveQuotaStale } from './passiveQuota';
import {
  resolveListText,
  type QuotaListColumn,
  type QuotaListPlan,
  type QuotaListResets,
  type QuotaResetState,
} from './rowModel';

const percentLabel = (remaining: number | null) =>
  remaining === null ? '--' : `${Math.round(remaining)}%`;

/** `in 1 day · 09/13, 13:00`, or a plain note when no reset is known. */
export function QuotaResetLine({
  absolute,
  atMs,
  state,
  lead,
  classes,
}: {
  absolute: string | null;
  atMs: number | null;
  state: QuotaResetState;
  /** Prefix such as `Reset 1`. */
  lead?: ReactNode;
  classes: QuotaListClassMap;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const display = buildResetDisplay(absolute, atMs, now, i18n.resolvedLanguage);

  return (
    // The narrow column ellipsizes the date; the title keeps it readable.
    <div
      className={classes.resetLine}
      title={display ? [display.relative, display.absolute].filter(Boolean).join(' · ') : undefined}
    >
      {lead && <span>{lead}</span>}
      {display ? (
        <>
          {display.relative && <span className={classes.resetLead}>{display.relative}</span>}
          <span className={classes.resetMuted}>{display.absolute}</span>
        </>
      ) : (
        <span className={classes.resetMuted}>
          {t(state === 'none' ? 'quota_list.reset_none' : 'quota_list.reset_unknown')}
        </span>
      )}
    </div>
  );
}

export function QuotaListSubtitle({
  plan,
  classes,
}: {
  plan: QuotaListPlan;
  classes: QuotaListClassMap;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const renewal = plan.renewal;
  const display = renewal
    ? buildResetDisplay(renewal.label, renewal.atMs, now, i18n.resolvedLanguage)
    : null;
  const parts = [
    plan.label ? resolveListText(t, plan.label) : null,
    renewal && display ? t(`quota_list.${renewal.kind}`, { date: display.absolute }) : null,
    display?.relative ?? null,
  ];

  return (
    <div className={classes.subtitle} title={parts.filter(Boolean).join(' · ')}>
      {parts[0] && <span className={classes.plan}>{parts[0]}</span>}
      {parts[1] && <span>{parts[1]}</span>}
      {parts[1] && parts[2] && <span>{parts[2]}</span>}
    </div>
  );
}

/** Where the row's figures came from when they were not fetched: proxy traffic, and how long ago. */
export function QuotaPassiveNote({
  observedAtMs,
  classes,
}: {
  observedAtMs: number;
  classes: QuotaListClassMap;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const stale = isPassiveQuotaStale(observedAtMs, now);
  const age = formatRelativeInstant(observedAtMs, now, i18n.resolvedLanguage);
  return (
    <div
      className={stale ? `${classes.passiveNote} ${classes.passiveNoteStale}` : classes.passiveNote}
      title={t('quota_list.passive_hint')}
    >
      {t(stale ? 'quota_list.passive_stale' : 'quota_list.passive_note', { age })}
    </div>
  );
}

export interface QuotaListColumnsProps {
  columns: QuotaListColumn[];
  resets: QuotaListResets | null;
  classes: QuotaListClassMap;
  meterClasses: QuotaClassMap;
}

export function QuotaListColumns({
  columns,
  resets,
  classes,
  meterClasses,
}: QuotaListColumnsProps) {
  const { t } = useTranslation();

  if (columns.length === 0 && !resets) {
    return <div className={classes.message}>{t('quota_list.no_windows')}</div>;
  }

  return (
    <div className={classes.columns}>
      {columns.map((column, index) => {
        const label = resolveListText(t, column.label);
        return (
          <div key={column.id} className={classes.column}>
            <div className={classes.columnHead}>
              <span className={classes.columnLabel} title={label}>
                {label}
              </span>
              <span className={classes.columnPercent}>{percentLabel(column.remaining)}</span>
            </div>
            <div
              role={column.remaining === null ? undefined : 'meter'}
              aria-label={column.remaining === null ? undefined : label}
              aria-valuemin={column.remaining === null ? undefined : 0}
              aria-valuemax={column.remaining === null ? undefined : 100}
              aria-valuenow={column.remaining === null ? undefined : Math.round(column.remaining)}
            >
              <QuotaMeter percent={column.remaining} classes={meterClasses} index={index} />
            </div>
            <QuotaResetLine
              absolute={column.resetLabel ? resolveListText(t, column.resetLabel) : null}
              atMs={column.resetAtMs}
              state={column.resetState}
              classes={classes}
            />
          </div>
        );
      })}
      {resets && (
        <div className={`${classes.column} ${classes.columnResets}`}>
          <div className={classes.columnHead}>
            <span className={classes.columnLabel}>{t('quota_list.manual_resets')}</span>
          </div>
          <div className={classes.resetsValue}>
            <span className={classes.resetsCount}>{resets.available ?? '--'}</span>
            <span>{t('quota_list.resets_available')}</span>
          </div>
          {resets.error ? (
            <div className={classes.columnError} role="status">
              {resolveListText(t, resets.error)}
            </div>
          ) : (
            resets.next && (
              <QuotaResetLine
                absolute={null}
                atMs={resets.next.atMs}
                state="scheduled"
                lead={t('codex_quota.reset_credit_number', { index: resets.next.index })}
                classes={classes}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
