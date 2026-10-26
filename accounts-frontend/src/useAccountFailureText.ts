import type { ChromeKey, MessageValues } from 'react-cheminfo/core';
import { useChromeT } from 'react-cheminfo/ui';

import type { AccountFailure } from './accountFailure.ts';
import { asSentence } from './accountsClient.ts';
import type { AccountRefusal } from './rules.ts';
import {
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
} from './rules.ts';

/**
 * What a failure of the accounts' routes reads, in the language of the page:
 * the chrome's sentence for its code, the chrome's own words for a server
 * that cannot be reached, else the server's message.
 * @returns the formatter
 */
export function useAccountFailureText(): (failure: AccountFailure) => string {
  const t = useChromeT();
  return (failure) => {
    if (failure.code !== undefined) {
      return t(refusalKey(failure.code), refusalValues(failure.code));
    }
    if (failure.status === 0) return t('account.unreachable');
    return asSentence(failure.message);
  };
}

/**
 * The chrome key a refusal is written with: one for every code, which the
 * compiler checks against react-cheminfo's catalog.
 * @param code - the refusal
 * @returns `account.refusal.<code>`
 */
export function refusalKey(code: AccountRefusal): ChromeKey {
  return `account.refusal.${code}`;
}

/**
 * What the placeholders of a refusal's sentence stand for: the limits a
 * username and a password keep, the same here as on the server.
 * @param code - the refusal
 * @returns the values its sentence is filled with
 */
export function refusalValues(code: AccountRefusal): MessageValues {
  if (code === 'usernameLength') {
    return { min: MIN_USERNAME_LENGTH, max: MAX_USERNAME_LENGTH };
  }
  if (code === 'passwordTooLong') return { max: MAX_PASSWORD_LENGTH };
  return {};
}
