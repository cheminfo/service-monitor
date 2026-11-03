import type { AccountRole } from '../rules.ts';

import type {
  AccountInsert,
  AccountRow,
  EnvAdminWrite,
} from './accountRows.ts';

/**
 * Where the accounts are kept: `AccountStore` (`accounts.sqlite`), or a table
 * the host already has, its people with their own ids, password hashes and
 * roles. `createServiceAccounts` takes either.
 *
 * Every method is synchronous. The family's hosts keep their tables in
 * `node:sqlite`, whose calls are, and a check the package makes before a
 * write then runs in the same turn of the event loop as the write: no other
 * request of the process comes between the two.
 *
 * What an implementation keeps, which `accountDirectoryProblems` checks:
 * - **Usernames are unique and in lower case.** The package hands every
 * username over as `toUsername` writes it; `insert` throws on one that is
 * taken, as a `UNIQUE` column does.
 * - **The last administrator is never demoted nor removed.** `setRole` and
 * `removeUnlessLastAdmin` refuse, answering false, when no other account
 * would be left an administrator, in one statement where they can: the
 * package checks first, which holds within one process, and only the
 * statement holds between two processes sharing the file.
 * - **The account the `.env` defines is changed by the `.env` alone.**
 * `setPassword`, `setRole` and `removeUnlessLastAdmin` refuse it.
 * - **A role is one of `read`, `write` and `admin`.** A host with roles of its
 * own maps them in the rows it answers and back in the ones it writes; a row
 * with any other role is let through nowhere.
 */
export interface AccountDirectory {
  /**
   * An account by its id.
   * @param id - the account's id, as the sessions name it; never 0
   * @returns it, or undefined
   */
  byId: (id: number) => AccountRow | undefined;
  /**
   * An account by its username.
   * @param username - the username, trimmed and in lower case
   * @returns it, or undefined
   */
  byUsername: (username: string) => AccountRow | undefined;
  /**
   * Every account.
   * @returns them, by username
   */
  all: () => AccountRow[];
  /**
   * How many accounts there are.
   * @returns the count
   */
  count: () => number;
  /**
   * Add an account, not marked as defined by the `.env`, its password changed
   * when it is created and never signed in.
   * @param account - what it is stored with
   * @returns its id, a positive integer
   * @throws {Error} When the username is taken.
   */
  insert: (account: AccountInsert) => number;
  /**
   * Replace the password hash of an account the `.env` does not define.
   * @param id - the account's id
   * @param passwordHash - the new hash
   * @param changedAt - when the password changed, in unix seconds
   * @returns whether it was replaced: false for no such account, or one the
   * `.env` defines
   */
  setPassword: (id: number, passwordHash: string, changedAt: number) => boolean;
  /**
   * Give an account the `.env` does not define a new role, unless that
   * demotes the last administrator.
   * @param id - the account's id
   * @param role - its new role
   * @returns whether it was given
   */
  setRole: (id: number, role: AccountRole) => boolean;
  /**
   * Record a sign-in.
   * @param id - the account's id
   * @param at - when, in unix seconds
   */
  touchSignIn: (id: number, at: number) => void;
  /**
   * Remove an account the `.env` does not define, unless it is the last
   * administrator.
   * @param id - the account's id
   * @returns whether it was removed
   */
  removeUnlessLastAdmin: (id: number) => boolean;
  /**
   * Make one account the administrator the `.env` defines, in one
   * transaction: created when its username is missing, given the role
   * `admin` and the hash, marked, and every other account unmarked. Its
   * password's date moves only when the hash does.
   * @param admin - its username and the hash to keep
   * @returns its id
   */
  writeEnvAdmin: (admin: EnvAdminWrite) => number;
  /**
   * Mark no account as defined by the `.env`, once it defines none.
   * @returns how many were marked
   */
  forgetEnvAdmins: () => number;
}

/** The accounts, or what opens them: a function is called at every request. */
export type AccountDirectorySource =
  | AccountDirectory
  | Promise<AccountDirectory>
  | (() => AccountDirectory | Promise<AccountDirectory>);
