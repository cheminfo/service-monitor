import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, onTestFinished, test } from 'vitest';

import { accountStoreOpener } from '../store/accountStoreOpener.ts';

/**
 * A directory removed when the calling test finishes.
 * @returns its path
 */
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'service-accounts-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('every caller shares one opening, in a directory created for it', async () => {
  const open = accountStoreOpener(
    join(temporaryDirectory(), 'data', 'sqlite', 'accounts.sqlite'),
  );

  const [first, second] = await Promise.all([open(), open()]);
  onTestFinished(() => first.close());

  expect(second).toBe(first);
  await expect(open()).resolves.toBe(first);
});

test('an opening that failed is tried again at the next call', async () => {
  const directory = temporaryDirectory();
  // A file where the directory should be: no store can be made under it.
  writeFileSync(join(directory, 'data'), '');
  const open = accountStoreOpener(join(directory, 'data', 'accounts.sqlite'));

  await expect(open()).rejects.toThrow(/ENOTDIR|EEXIST/);

  rmSync(join(directory, 'data'));
  const store = await open();
  onTestFinished(() => store.close());

  expect(store.count()).toBe(0);
});

test('a file shared with the host keeps the accounts under a version table of their own', async () => {
  const path = join(temporaryDirectory(), 'sqlite', 'db.sqlite');
  const store = await accountStoreOpener(path)();
  store.insert({
    username: 'luc',
    passwordHash: 'x',
    role: 'read',
    createdAt: 1,
  });
  store.close();

  const database = new DatabaseSync(path);
  onTestFinished(() => database.close());
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  const reopened = await accountStoreOpener(path)();
  onTestFinished(() => reopened.close());

  expect(tables).toStrictEqual(['accounts', 'service_accounts_version']);
  expect(reopened.all().map((account) => account.username)).toStrictEqual([
    'luc',
  ]);
});
