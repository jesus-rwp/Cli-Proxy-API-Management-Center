/** Provider brand mark shared by the summary strip and the list's group headings. */

import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import styles from './ProviderLogo.module.scss';

export function ProviderLogo({
  type,
  resolvedTheme,
}: {
  type: QuotaProviderType;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(type, resolvedTheme);
  // Decorative: the provider name is always rendered next to it.
  return (
    <span
      className={styles.wrap}
      aria-hidden="true"
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.icon} />
      ) : (
        <span className={styles.fallback}>{getTypeLabel(t, type).slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}
