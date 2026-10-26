import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { AccountRole } from '../rules.ts';

import type {
  AccountInsert,
  AccountRow,
  EnvAdminWrite,
  StoredAccountRow,
} from './accountRows.ts';
import { prepareAccountStatements } from './accountStatements.ts';
import { migrate } from './migrate.ts';

export type {
  AccountInsert,
  AccountRow,
  EnvAdminWrite,
} from './accountRows.ts';

/**
 * The accounts of a service, in one SQLite file every process may open. The
 * table carries a migration record of its own, so the file may also hold the
 * host's tables, migrated by the host.
 *
 * It holds a handful of rows, so counting them is cheap.
 */
export class AccountStore {
  /**
   * Open the store, creating its directory and its table or bringing it up to
   * date.
   * @param path - the file, `accountStorePath(DATA_DIR)`, or `:memory:` for
   * tests
   * @returns the store
   */
  static async open(path: string): Promise<AccountStore> {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    try {
      if (path !== ':memory:') applyPragmas(database);
      await migrate(database);
    } catch (error: unknown) {
      database.close();
      throw error;
    }
    return new AccountStore(database);
  }

  readonly #db: DatabaseSync;
  readonly #statements: ReturnType<typeof prepareAccountStatements>;

  private constructor(database: DatabaseSync) {
    this.#db = database;
    this.#statements = prepareAccountStatements(database);
  }

  /**
   * An account by its id.
   * @param id - the row id
   * @returns it, or undefined
   */
  byId(id: number): AccountRow | undefined {
    return plain(this.#statements.byId.get(id));
  }

  /**
   * An account by its username, whatever the case it is typed in.
   * @param username - the username
   * @returns it, or undefined
   */
  byUsername(username: string): AccountRow | undefined {
    return plain(this.#statements.byUsername.get(username));
  }

  /**
   * Every account.
   * @returns them, by username
   */
  all(): AccountRow[] {
    const rows = this.#statements.all.all();
    const accounts = new Array<AccountRow>(rows.length);
    for (let index = 0; index < rows.length; index++) {
      accounts[index] = plain(rows[index]) as AccountRow;
    }
    return accounts;
  }

  /**
   * How many accounts there are.
   * @returns the count
   */
  count(): number {
    return this.#statements.count.get()?.count ?? 0;
  }

  /**
   * Add an account.
   * @param account - what it is stored with
   * @returns its row id
   */
  insert(account: AccountInsert): number {
    const row = this.#statements.insert.get(
      account.username,
      account.passwordHash,
      account.createdAt,
      account.role,
    );
    if (row === undefined) throw new Error('the account was not stored');
    return row.id;
  }

  /**
   * Replace the password hash of an account the `.env` does not define.
   * @param id - the row id
   * @param passwordHash - the new hash
   * @param changedAt - when, in unix seconds
   * @returns whether it was replaced
   */
  setPassword(id: number, passwordHash: string, changedAt: number): boolean {
    const result = this.#statements.setPassword.run(
      passwordHash,
      changedAt,
      id,
    );
    return Number(result.changes) > 0;
  }

  /**
   * Give an account the `.env` does not define a new role, unless that
   * demotes the last administrator.
   * @param id - the row id
   * @param role - its new role
   * @returns whether it was given
   */
  setRole(id: number, role: AccountRole): boolean {
    return Number(this.#statements.setRole.run(role, id).changes) > 0;
  }

  /**
   * Record a sign-in.
   * @param id - the row id
   * @param at - when, in unix seconds
   */
  touchSignIn(id: number, at: number): void {
    this.#statements.touchSignIn.run(at, id);
  }

  /**
   * Remove an account the `.env` does not define, unless it is the last
   * administrator.
   * @param id - the row id
   * @returns whether it was removed
   */
  removeUnlessLastAdmin(id: number): boolean {
    return Number(this.#statements.removeUnlessLastAdmin.run(id).changes) > 0;
  }

  /**
   * Make one account the administrator the `.env` defines, in one
   * transaction: created when missing, given the `admin` role and the hash,
   * and the only account marked so.
   * @param admin - its username and the hash to keep
   * @returns its row id
   */
  writeEnvAdmin(admin: EnvAdminWrite): number {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.#statements.upsertEnvAdmin.get(
        admin.username,
        admin.passwordHash,
        admin.at,
      );
      if (row === undefined) {
        throw new Error('the administrator was not stored');
      }
      this.#statements.forgetEnvAdminsBut.run(row.id);
      this.#db.exec('COMMIT');
      return row.id;
    } catch (error: unknown) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Mark no account as defined by the `.env`, once it defines none.
   * @returns how many were marked
   */
  forgetEnvAdmins(): number {
    return Number(this.#statements.forgetEnvAdminsBut.run(0).changes);
  }

  /** Close the file. */
  close(): void {
    this.#db.close();
  }
}

/**
 * The pragmas of an on-disk store. Sign-ins are rare, so the write-ahead log
 * is there for the readers of every process, not for speed.
 * @param database - the connection
 */
function applyPragmas(database: DatabaseSync): void {
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
}

/**
 * A row as a plain object: `node:sqlite` hands back null-prototype rows kept
 * in dictionary mode, slow to read and refused by `toStrictEqual`.
 * @param row - the row, if any
 * @returns a copy, or undefined
 */
function plain(row: StoredAccountRow | undefined): AccountRow | undefined {
  if (row === undefined) return undefined;
  return { ...row, envManaged: row.envManaged === 1 };
}
