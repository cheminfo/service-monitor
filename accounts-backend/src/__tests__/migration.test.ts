import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import Postgrator from 'postgrator';
import { expect, onTestFinished, test } from 'vitest';

import { createAccount } from '../accounts.ts';
import { hashPassword } from '../password.ts';
import { checkSignIn } from '../signIn.ts';
import { AccountStore } from '../store/AccountStore.ts';
import { SCHEMA_TABLE } from '../store/migrate.ts';

/** The migrations the store runs, read from `src` by the compiled store too. */
const MIGRATIONS = join(import.meta.dirname, '../store/migrations');

/**
 * A store as service-accounts-backend 0.1.0 leaves it, written statement by
 * statement as that version and its Postgrator wrote chembio's: the 001 table,
 * the version table with migration 1 and the checksum 0.1.0 recorded for it,
 * and two accounts.
 * @returns The file's path.
 */
async function serviceAccountsFile(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'service-accounts-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'accounts.sqlite');
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE service_accounts_version (version INTEGER PRIMARY KEY);
    INSERT INTO service_accounts_version (version) VALUES (0);
    ALTER TABLE service_accounts_version ADD COLUMN name TEXT;
    ALTER TABLE service_accounts_version ADD COLUMN md5 TEXT;
    ALTER TABLE service_accounts_version ADD COLUMN run_at TIMESTAMP WITH TIME ZONE;
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      passwordChangedAt INTEGER NOT NULL,
      lastSignInAt INTEGER
    ) STRICT;
    INSERT INTO service_accounts_version (version, name, md5, run_at)
    VALUES (1, '', '794e3fc95772083447a4d5571c84beed', '2026-10-22 10:15:25.758');
  `);
  const insert = database.prepare(
    `INSERT INTO accounts (username, passwordHash, createdAt, passwordChangedAt)
     VALUES (?1, ?2, ?3, ?3)`,
  );
  insert.run('luc', await hashPassword('his password'), 1_790_000_000);
  insert.run('ada', await hashPassword('her password'), 1_790_000_100);
  database.close();
  return path;
}

/**
 * A Postgrator on a connection, as the store runs it.
 * @param database - The connection.
 * @returns It.
 */
function postgratorOn(database: DatabaseSync) {
  return new Postgrator({
    migrationPattern: join(MIGRATIONS, '*'),
    driver: 'sqlite3',
    schemaTable: SCHEMA_TABLE,
    execQuery: (query: string) =>
      Promise.resolve({ rows: database.prepare(query).all() }),
    execSqlScript: (script: string) => {
      database.exec(script);
      return Promise.resolve();
    },
  });
}

/**
 * The columns of the accounts table, in order.
 * @param database - The connection.
 * @returns Their names.
 */
function columnsOf(database: DatabaseSync): unknown[] {
  return database
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('accounts')
    .map((row) => row.name);
}

test('a service-accounts 0.1.0 store migrates in place: every account an administrator, none the .env’s', async () => {
  const path = await serviceAccountsFile();

  const store = await AccountStore.open(path);
  onTestFinished(() => store.close());

  expect(
    store
      .all()
      .map((account) => [account.username, account.role, account.envManaged]),
  ).toStrictEqual([
    ['ada', 'admin', false],
    ['luc', 'admin', false],
  ]);
  await expect(
    checkSignIn(store, 'luc', 'his password', 1_790_000_500),
  ).resolves.toMatchObject({
    id: 1,
    role: 'admin',
    lastSignInAt: 1_790_000_500,
  });
  await expect(
    createAccount(store, { username: 'bob', password: 'his own' }),
  ).resolves.toMatchObject({ id: 3, role: 'read', envManaged: false });

  const database = new DatabaseSync(path);
  onTestFinished(() => database.close());

  expect(
    database
      .prepare(
        `SELECT version, name, md5 FROM ${SCHEMA_TABLE} ORDER BY version`,
      )
      .all()
      .map((row) => ({ ...row })),
  ).toStrictEqual([
    { version: 0, name: null, md5: null },
    { version: 1, name: '', md5: '794e3fc95772083447a4d5571c84beed' },
    { version: 2, name: '', md5: expect.stringMatching(/^[\da-f]{32}$/) },
  ]);
  expect(columnsOf(database)).toStrictEqual([
    'id',
    'username',
    'passwordHash',
    'createdAt',
    'passwordChangedAt',
    'lastSignInAt',
    'role',
    'env_managed',
  ]);
});

test('a store opened again once migrated takes no new migration', async () => {
  const path = await serviceAccountsFile();
  const migrated = await AccountStore.open(path);
  migrated.close();

  const reopened = await AccountStore.open(path);
  onTestFinished(() => reopened.close());

  expect(reopened.count()).toBe(2);
});

test('a role the CHECK does not know is refused by the table itself', async () => {
  const path = await serviceAccountsFile();
  const migrated = await AccountStore.open(path);
  migrated.close();
  const database = new DatabaseSync(path);
  onTestFinished(() => database.close());

  expect(() =>
    database.exec("UPDATE accounts SET role = 'owner' WHERE id = 1"),
  ).toThrow('CHECK constraint failed');
});

test('migration 002 is undone back to the 0.1.0 table, the accounts kept', async () => {
  const path = await serviceAccountsFile();
  const migrated = await AccountStore.open(path);
  migrated.close();
  const database = new DatabaseSync(path);
  onTestFinished(() => database.close());

  await postgratorOn(database).migrate('001');

  expect(columnsOf(database)).toStrictEqual([
    'id',
    'username',
    'passwordHash',
    'createdAt',
    'passwordChangedAt',
    'lastSignInAt',
  ]);
  expect(
    database
      .prepare('SELECT username FROM accounts ORDER BY id')
      .all()
      .map((row) => row.username),
  ).toStrictEqual(['luc', 'ada']);
});

test('the checksum 0.1.0 recorded is checked, so the 001 files must stay as it wrote them', async () => {
  const path = await serviceAccountsFile();
  const database = new DatabaseSync(path);
  database.exec(
    `UPDATE ${SCHEMA_TABLE} SET md5 = '00000000000000000000000000000000' WHERE version = 1`,
  );
  database.close();

  await expect(AccountStore.open(path)).rejects.toThrow(
    'MD5 checksum failed for migration [1]',
  );
});
