/**
 * Email masking for credential names on the quota page.
 *
 * Auth files are named after the account (`claude-tom@acme.dev.json`,
 * `codex-ae5d455f-tom@acme.dev-pro.json`), so the filename leaks the address on
 * a shared screen. Masking keeps one leading character of the local part and of
 * the first domain label: `claude-t•••@a•••.dev.json`.
 */

import type { AuthFileItem } from '@/types';
import { getQuotaDisplayName } from '@/utils/quota/identity';

const MASK = '•••';

/** Local part without `-`, so a `provider-` filename prefix is not swallowed. */
const EMAIL_IN_TEXT = /([A-Za-z0-9._%+]+)@([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)*)/g;

const firstChar = (value: string) => Array.from(value)[0] ?? '';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const maskParts = (local: string, domainHead: string, domainTail: string) =>
  `${firstChar(local)}${MASK}@${firstChar(domainHead)}${MASK}${domainTail}`;

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return email;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  return maskParts(
    email.slice(0, at),
    dot === -1 ? domain : domain.slice(0, dot),
    dot === -1 ? '' : domain.slice(dot)
  );
}

/**
 * Mask every email inside a display name. The credential's own `email` is
 * replaced exactly first — it may contain `-`, which the generic pattern
 * deliberately leaves out of the local part.
 */
export function maskIdentity(text: string, email?: string | null): string {
  let masked = text;
  const known = email?.trim();
  if (known && known.includes('@')) {
    masked = masked.replace(new RegExp(escapeRegExp(known), 'gi'), (match) => maskEmail(match));
  }
  return masked.replace(EMAIL_IN_TEXT, (_match, local: string, head: string, tail: string) =>
    maskParts(local, head, tail)
  );
}

/** The credential's display name as the page shows it: masked unless emails are shown. */
export function credentialDisplayName(file: AuthFileItem, showEmail: boolean): string {
  const name = getQuotaDisplayName(file);
  return showEmail ? name : maskIdentity(name, file.email);
}

/** Timeline lane names follow the same toggle, keeping the exact-email replacement. */
export function laneNameFormatter(showEmail: boolean) {
  return (name: string, file: AuthFileItem): string =>
    showEmail ? name : maskIdentity(name, file.email);
}
