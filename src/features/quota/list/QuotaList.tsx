/**
 * Quota list view: one row per credential — identity and plan on the left,
 * one column per quota window in the middle, actions on the right.
 *
 * Rows keep QuotaCard's behaviour contract: click-to-load idle state, the
 * Claude reset-grant hook per credential, and the same disabled rules for
 * refresh/reset. Rows are always grouped under provider headings; the sort
 * orders rows within a group, and groups follow their first row, so under
 * "soonest" the group holding the next recovery comes first.
 */

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { IconRefreshCw } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import type { ResolvedTheme } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import bodyStyles from '../components/QuotaBody.module.scss';
import { bindQuotaListClasses } from './classes';
import { groupByProvider } from './grouping';
import { ProviderLogo } from './ProviderLogo';
import { QuotaListColumns, QuotaListSubtitle, QuotaPassiveNote } from './QuotaListColumns';
import { isPassiveQuotaStale, passiveObservedAt } from './passiveQuota';
import { credentialDisplayName } from './privacy';
import {
  buildClaudeResets,
  buildCodexResets,
  buildPlanSubtitle,
  buildQuotaColumns,
} from './rowModel';
import type { CodexQuotaState } from '@/types';
import styles from './QuotaList.module.scss';

const meterClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');
const listClasses = bindQuotaListClasses(styles, 'QuotaList.module.scss');

const SKELETON_ROW_COUNT = 5;

type QuotaListRowProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  showEmail: boolean;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
};

function QuotaListRow(props: QuotaListRowProps) {
  const { entry, quota, showEmail, canRefresh, resetting, onRefresh, onReset } = props;
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const loaded = status === 'success' && quota !== undefined;
  const now = useNow();
  // Figures from proxy traffic: no provider call is made for them, not even
  // the reset-grant read, until the user refreshes the row.
  const passiveAt = passiveObservedAt(quota);
  const stale = passiveAt !== null && isPassiveQuotaStale(passiveAt, now);
  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle' && passiveAt === null,
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );

  const displayName = credentialDisplayName(file, showEmail);
  const plan = loaded ? buildPlanSubtitle(entry.type, quota) : null;
  const columns = loaded ? buildQuotaColumns(entry.type, quota) : null;
  const resets = !loaded
    ? null
    : entry.type === 'codex'
      ? buildCodexResets(quota as unknown as CodexQuotaState)
      : entry.type === 'claude'
        ? buildClaudeResets(claudeReset.status, claudeReset.message)
        : null;
  const showReset =
    loaded && Boolean(adapter.resetQuota) && Boolean(adapter.canResetQuota?.(quota));
  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  let body;
  if (status === 'idle') {
    body = (
      <button
        type="button"
        className={styles.idleButton}
        onClick={onRefresh}
        disabled={!canRefresh}
      >
        <IconRefreshCw size={14} aria-hidden="true" />
        <span>{t(`${adapter.i18nPrefix}.idle`)}</span>
      </button>
    );
  } else if (loading) {
    body = (
      <div className={styles.skeleton} aria-busy="true">
        <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
        {[0, 1, 2].map((cell) => (
          <span key={cell} className={styles.skeletonCell} aria-hidden="true" />
        ))}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className={styles.error} role="alert">
        {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
      </div>
    );
  } else if (quota && columns === null) {
    // No column model (Antigravity, xAI): the provider Body keeps every figure.
    body = (
      <div className={styles.bodyFallback}>
        <adapter.Body quota={quota} classes={meterClasses} />
      </div>
    );
  } else {
    body = (
      <QuotaListColumns
        columns={columns ?? []}
        resets={resets}
        classes={listClasses}
        meterClasses={meterClasses}
      />
    );
  }

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.name} title={displayName}>
          {displayName}
        </span>
        {plan && <QuotaListSubtitle plan={plan} classes={listClasses} />}
        {passiveAt !== null && <QuotaPassiveNote observedAtMs={passiveAt} classes={listClasses} />}
      </div>

      <div className={stale ? `${styles.body} ${styles.bodyStale}` : styles.body}>{body}</div>

      {status !== 'idle' && (
        <div className={styles.actions}>
          {entry.type === 'claude' && passiveAt === null && (
            <button
              type="button"
              className={styles.action}
              disabled={claudeReset.blocked}
              onClick={claudeReset.confirm}
              title={t(`claude_reset.${claudeReset.buttonLabel}`)}
            >
              <IconRefreshCw size={13} className={claudeReset.busy ? styles.spinning : undefined} />
              {t(`claude_reset.${claudeReset.buttonLabel}`)}
            </button>
          )}
          {showReset && (
            <button
              type="button"
              className={styles.action}
              onClick={onReset}
              disabled={!canRefresh || loading || resetting}
              title={t('codex_quota.reset_button')}
            >
              <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
              {t('codex_quota.reset_button')}
            </button>
          )}
          <button
            type="button"
            className={styles.action}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </div>
      )}
    </div>
  );
}

export type QuotaListProps = {
  entries: QuotaFileEntry[];
  /** Credentials per provider across all pages, for the group headings. */
  counts: Record<string, number>;
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  showEmail: boolean;
  canUseActions: boolean;
  resettingQuotaName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
};

export function QuotaList(props: QuotaListProps) {
  const { entries, counts, getQuota, resolvedTheme, showEmail, canUseActions } = props;
  const { resettingQuotaName, onRefresh, onReset } = props;
  const { t } = useTranslation();

  const renderRows = (rows: QuotaFileEntry[]) => (
    <ul className={styles.rows}>
      {rows.map((entry) => {
        const key = getQuotaCacheKey(entry.file);
        return (
          <li key={`${entry.type}:${key}`}>
            <QuotaListRow
              entry={entry}
              quota={getQuota(entry)}
              showEmail={showEmail}
              canRefresh={canUseActions && !entry.file.disabled}
              resetting={resettingQuotaName === key}
              onRefresh={() => onRefresh(entry)}
              onReset={() => onReset(entry)}
            />
          </li>
        );
      })}
    </ul>
  );

  const groups = groupByProvider(entries);

  return (
    <div className={styles.list}>
      {[...groups].map(([type, rows]) => (
        <section key={type} className={styles.group}>
          <h2 className={styles.groupTitle}>
            <ProviderLogo type={type} resolvedTheme={resolvedTheme} />
            {getTypeLabel(t, type)}
            <span className={styles.groupCount}>{counts[type] ?? rows.length}</span>
          </h2>
          {renderRows(rows)}
        </section>
      ))}
    </div>
  );
}

export function QuotaListSkeleton() {
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <Skeleton key={index} height={72} rounded={12} />
      ))}
    </div>
  );
}
