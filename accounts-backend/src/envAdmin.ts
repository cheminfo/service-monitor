import process from 'node:process';

import type { FastifyBaseLogger } from 'fastify';

import { hashPassword, verifyPassword } from './password.ts';
import {
  REFUSAL_MESSAGES,
  passwordProblem,
  toUsername,
  usernameProblem,
} from './rules.ts';
import { nowSeconds, toAccount } from './signIn.ts';
import type { AccountStore } from './store/AccountStore.ts';
import type { Account } from './types.ts';

/** The administrator's username when `ADMIN_USERNAME` is unset. */
export const DEFAULT_ADMIN_USERNAME = 'admin';

/** Where the administrator the `.env` defines is read from. */
export interface EnvAdminEnvironment {
  /**
   * The administrator's username.
   * @default 'admin'
   */
  ADMIN_USERNAME?: string;
  /**
   * The administrator's password. Unset or empty, the `.env` defines no
   * account: no password is ever chosen for the operator.
   * @default undefined
   */
  ADMIN_PASSWORD?: string;
}

/** What the start of the server did to the administrator the `.env` defines. */
export interface EnvAdminOutcome {
  /**
   * `unset` without `ADMIN_PASSWORD`; else whether the account was created,
   * brought back in line with the `.env`, or already was.
   */
  status: 'unset' | 'created' | 'updated' | 'unchanged';
  /** What was brought back in line: its password, its role, its mark. */
  changed: Array<'password' | 'role' | 'envManaged'>;
  /** The administrator, or null when the `.env` defines none. */
  account: Account | null;
}

/**
 * Make the administrator the `.env` defines exist, as it says, at every start.
 *
 * With `ADMIN_PASSWORD` set, the account `ADMIN_USERNAME` exists, has the role
 * `admin` and signs in with that password, and is the one account marked as
 * defined by the `.env`: the routes then refuse to remove it, demote it or
 * change its password. The password is hashed again only when it no longer
 * verifies, so the sessions it opened survive a restart. Without it, no
 * account is marked, and one line of the log says so.
 * @param store - the accounts
 * @param log - where to say what was done
 * @param env - the environment to read
 * @returns what was done
 * @throws {Error} When `ADMIN_USERNAME` or `ADMIN_PASSWORD` cannot be used,
 * naming them.
 */
export async function syncEnvAdmin(
  store: AccountStore,
  log: FastifyBaseLogger,
  env: EnvAdminEnvironment = process.env,
): Promise<EnvAdminOutcome> {
  const password = env.ADMIN_PASSWORD ?? '';
  if (password === '') {
    store.forgetEnvAdmins();
    if (store.count() === 0) {
      log.warn(
        'no account can sign in: set ADMIN_PASSWORD in .env and restart to create the administrator',
      );
    } else {
      log.info('ADMIN_PASSWORD is unset: the .env defines no administrator');
    }
    return { status: 'unset', changed: [], account: null };
  }

  const username = toUsername(
    env.ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME,
  );
  const problem = usernameProblem(username) ?? passwordProblem(password);
  if (problem !== null) {
    throw new Error(
      `ADMIN_USERNAME or ADMIN_PASSWORD: ${REFUSAL_MESSAGES[problem]}`,
    );
  }

  const existing = store.byUsername(username);
  const keepsHash =
    existing !== undefined &&
    (await verifyPassword(password, existing.passwordHash));
  const id = store.writeEnvAdmin({
    username,
    passwordHash: keepsHash
      ? existing.passwordHash
      : await hashPassword(password),
    at: nowSeconds(),
  });
  const account = store.byId(id);
  if (account === undefined) {
    throw new Error(`the administrator ${username} was removed meanwhile`);
  }

  const changed: EnvAdminOutcome['changed'] = [];
  if (existing !== undefined) {
    if (!keepsHash) changed.push('password');
    if (existing.role !== 'admin') changed.push('role');
    if (!existing.envManaged) changed.push('envManaged');
  }
  const status =
    existing === undefined
      ? 'created'
      : changed.length > 0
        ? 'updated'
        : 'unchanged';
  log.info(
    { username, status, changed },
    status === 'unchanged'
      ? 'the administrator the .env defines is as it says'
      : `${status} the administrator the .env defines`,
  );
  return { status, changed, account: toAccount(account) };
}
