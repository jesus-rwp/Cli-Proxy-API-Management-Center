/** Quota page view controls: list/cards switch and the email visibility toggle. */

import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { QUOTA_VIEW_MODES, type QuotaViewMode } from './viewState';
import styles from './QuotaViewControls.module.scss';

export function QuotaViewToggle({
  value,
  onChange,
}: {
  value: QuotaViewMode;
  onChange: (next: QuotaViewMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.segmented} role="group" aria-label={t('quota_list.view_label')}>
      {QUOTA_VIEW_MODES.map((mode) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            className={`${styles.segment} ${active ? styles.segmentActive : ''}`}
            aria-pressed={active}
            onClick={() => onChange(mode)}
          >
            {t(`quota_list.view_${mode}`)}
          </button>
        );
      })}
    </div>
  );
}

export function QuotaEmailToggle({
  showEmail,
  onChange,
}: {
  showEmail: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const Icon = showEmail ? IconEyeOff : IconEye;
  return (
    <button
      type="button"
      className={styles.emailToggle}
      aria-pressed={showEmail}
      onClick={() => onChange(!showEmail)}
    >
      <Icon size={14} aria-hidden="true" />
      {t(showEmail ? 'quota_list.hide_email' : 'quota_list.show_email')}
    </button>
  );
}
