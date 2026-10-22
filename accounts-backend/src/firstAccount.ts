import type { FastifyBaseLogger } from 'fastify';

import { AccountError, ensureFirstAccount, toAccount } from './accounts.ts';
import type { AccountStore } from './store/AccountStore.ts';
import type { Account } from './types.ts';

/** The username of the first account when ADMIN_USERNAME is unset. */
export const DEFAULT_USERNAME = 'admin';

/** Where the first account's username and password come from. */
export interface FirstAccountEnvironment {
  /**
   * The first account's username.
   * @default 'admin'
   */
  ADMIN_USERNAME?: string;
  /**
   * The first account's password. Unset, no account is created, in
   * development as in production: no password is ever chosen for the operator.
   * @default undefined
   */
  ADMIN_PASSWORD?: string;
}

/**
 * Create the first account when the store has none, from ADMIN_USERNAME and
 * ADMIN_PASSWORD. Without a password no account is created: the site serves
 * on, and signing in works once it is set and the server restarted. Once an
 * account exists the two are never read again: accounts and passwords are then
 * managed on the Accounts page.
 * @param store - the accounts
 * @param log - where to say what was done
 * @param env - the environment to read
 * @returns the account created, or null when there already was one or no
 * password was set
 * @throws {Error} When ADMIN_USERNAME or ADMIN_PASSWORD cannot be used.
 */
export async function firstAccount(
  store: AccountStore,
  log: FastifyBaseLogger,
  env: FirstAccountEnvironment = process.env,
): Promise<Account | null> {
  if (store.count() > 0) return null;
  const username = env.ADMIN_USERNAME?.trim() || DEFAULT_USERNAME;
  const password = env.ADMIN_PASSWORD ?? '';
  if (password === '') {
    log.warn(
      { username },
      'no account can sign in: set ADMIN_PASSWORD and restart to create the first one',
    );
    return null;
  }
  let created;
  try {
    created = await ensureFirstAccount(store, { username, password });
  } catch (error: unknown) {
    if (!(error instanceof AccountError)) throw error;
    throw new Error(`ADMIN_USERNAME or ADMIN_PASSWORD: ${error.message}`, {
      cause: error,
    });
  }
  if (created === null) return null;
  log.info({ username: created.username }, 'created the first account');
  return toAccount(created);
}
