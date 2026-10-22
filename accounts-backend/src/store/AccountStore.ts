import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { TypedStatement } from './TypedStatement.ts';
import { migrate } from './migrate.ts';

/** An account as the store holds it, password hash included. */
export interface AccountRow {
  id: number;
  /** What it signs in with, in lower case. */
  username: string;
  /** `pbkdf2$sha512$<iterations>$<salt>$<hash>`, never sent to a client. */
  passwordHash: string;
  /** When it was added, in unix seconds. */
  createdAt: number;
  /** When its password last changed, in unix seconds. */
  passwordChangedAt: number;
  /** When it last signed in, in unix seconds, or null when never. */
  lastSignInAt: number | null;
}

/** What a new account is stored with. */
export interface AccountInsert {
  username: string;
  passwordHash: string;
  /** In unix seconds; the password is changed at the same instant. */
  createdAt: number;
}

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
  readonly #statements: ReturnType<typeof prepareStatements>;

  private constructor(database: DatabaseSync) {
    this.#db = database;
    this.#statements = prepareStatements(database);
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
      accounts[index] = { ...(rows[index] as AccountRow) };
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
    );
    if (row === undefined) throw new Error('the account was not stored');
    return row.id;
  }

  /**
   * Add the first account, and nothing once there is one, so two processes
   * starting at once cannot both create it.
   * @param account - what it is stored with
   * @returns its row id, or undefined when there already was an account
   */
  insertFirst(account: AccountInsert): number | undefined {
    return this.#statements.insertFirst.get(
      account.username,
      account.passwordHash,
      account.createdAt,
    )?.id;
  }

  /**
   * Replace an account's password hash.
   * @param id - the row id
   * @param passwordHash - the new hash
   * @param changedAt - when, in unix seconds
   */
  setPassword(id: number, passwordHash: string, changedAt: number): void {
    this.#statements.setPassword.run(passwordHash, changedAt, id);
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
   * Remove an account, unless it is the last one.
   * @param id - the row id
   * @returns whether it was removed
   */
  removeUnlessLast(id: number): boolean {
    return Number(this.#statements.removeUnlessLast.run(id).changes) > 0;
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
 * The statements of the store.
 * @param database - the connection
 * @returns them, by what they do
 */
function prepareStatements(database: DatabaseSync) {
  const prepare = <T extends object>(sql: string) =>
    new TypedStatement<T>(database.prepare(sql));
  return {
    byId: prepare<AccountRow>('SELECT * FROM accounts WHERE id = ?'),
    byUsername: prepare<AccountRow>(
      'SELECT * FROM accounts WHERE username = ?',
    ),
    all: prepare<AccountRow>('SELECT * FROM accounts ORDER BY username'),
    count: prepare<{ count: number }>('SELECT COUNT(*) AS count FROM accounts'),
    insert: prepare<{ id: number }>(
      `INSERT INTO accounts (username, passwordHash, createdAt, passwordChangedAt)
       VALUES (?1, ?2, ?3, ?3)
       RETURNING id`,
    ),
    insertFirst: prepare<{ id: number }>(
      `INSERT INTO accounts (username, passwordHash, createdAt, passwordChangedAt)
       SELECT ?1, ?2, ?3, ?3
       WHERE NOT EXISTS (SELECT 1 FROM accounts)
       RETURNING id`,
    ),
    setPassword: prepare(
      'UPDATE accounts SET passwordHash = ?, passwordChangedAt = ? WHERE id = ?',
    ),
    touchSignIn: prepare('UPDATE accounts SET lastSignInAt = ? WHERE id = ?'),
    removeUnlessLast: prepare(
      `DELETE FROM accounts
       WHERE id = ? AND (SELECT COUNT(*) FROM accounts) > 1`,
    ),
  };
}

/**
 * A row as a plain object: `node:sqlite` hands back null-prototype rows kept
 * in dictionary mode, slow to read and refused by `toStrictEqual`.
 * @param row - the row, if any
 * @returns a copy, or undefined
 */
function plain(row: AccountRow | undefined): AccountRow | undefined {
  return row === undefined ? undefined : { ...row };
}
