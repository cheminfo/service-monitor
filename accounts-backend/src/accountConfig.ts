import process from 'node:process';

import { DEFAULT_SIGN_IN_LIMIT } from './serviceAccountsTypes.ts';

/** What `createServiceAccounts` reads from the environment. */
export interface AccountConfig {
  /** `COOKIE_SECRET`, trimmed; undefined when unset or blank. */
  cookieSecret: string | undefined;
  /** `ADMIN_TOKEN`, trimmed; undefined when unset or blank. */
  adminToken: string | undefined;
  /** `ADMIN_SIGN_IN_LIMIT`, or 10 when unset or blank. */
  signInLimit: number;
  /** Whether `NODE_ENV` is `production`. */
  production: boolean;
}

/**
 * Read the accounts' settings from the environment, once, as the server
 * starts, to spread into `createServiceAccounts`. `ADMIN_USERNAME` and
 * `ADMIN_PASSWORD` are read by `syncEnvAdmin` instead.
 *
 * ```ts
 * const accounts = await createServiceAccounts({ store, cookieName, purpose, ...readAccountConfig() });
 * ```
 * @param env - the environment
 * @returns the settings
 * @throws {Error} When `ADMIN_SIGN_IN_LIMIT` is not a whole number of at
 * least 1.
 */
export function readAccountConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccountConfig {
  return {
    cookieSecret: env.COOKIE_SECRET?.trim() || undefined,
    adminToken: env.ADMIN_TOKEN?.trim() || undefined,
    signInLimit: signInLimitOf(env.ADMIN_SIGN_IN_LIMIT),
    production: env.NODE_ENV === 'production',
  };
}

/**
 * The sign-ins one client may try per fifteen minutes, as `.env` writes it.
 * @param value - `ADMIN_SIGN_IN_LIMIT`, if set
 * @returns the limit
 * @throws {Error} When it is not a whole number of at least 1.
 */
function signInLimitOf(value: string | undefined): number {
  const text = value?.trim() ?? '';
  if (text === '') return DEFAULT_SIGN_IN_LIMIT;
  const limit = Number(text);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `ADMIN_SIGN_IN_LIMIT is "${text}": set it to a whole number of at least 1, or leave it unset for ${DEFAULT_SIGN_IN_LIMIT}.`,
    );
  }
  return limit;
}
