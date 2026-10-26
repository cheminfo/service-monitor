import { DatabaseSync } from 'node:sqlite';

import { expect, onTestFinished, test } from 'vitest';

import { syncEnvAdmin } from '../envAdmin.ts';
import { AccountStore } from '../store/AccountStore.ts';

import { recorder, start, storePath } from './envAdminFixture.ts';

test('a role changed behind the server is set back to admin, the password untouched', async () => {
  const path = storePath();
  const store = await AccountStore.open(path);
  onTestFinished(() => store.close());
  const env = { ADMIN_PASSWORD: 'the password' };
  await start(store, env);
  const hash = store.byId(1)?.passwordHash;
  const direct = new DatabaseSync(path);
  direct.exec("UPDATE accounts SET role = 'read', env_managed = 0");
  direct.close();

  const { outcome } = await start(store, env);

  expect([outcome.status, outcome.changed]).toStrictEqual([
    'updated',
    ['role', 'envManaged'],
  ]);
  expect([
    store.byId(1)?.role,
    store.byId(1)?.envManaged,
    store.byId(1)?.passwordHash,
  ]).toStrictEqual(['admin', true, hash]);
});

test('only the account the .env names now is marked as the .env’s', async () => {
  const store = await AccountStore.open(':memory:');
  await start(store, { ADMIN_PASSWORD: 'the password' });

  await start(store, { ADMIN_USERNAME: 'luc', ADMIN_PASSWORD: 'his password' });

  expect(
    store
      .all()
      .map((account) => [account.username, account.role, account.envManaged]),
  ).toStrictEqual([
    ['admin', 'admin', false],
    ['luc', 'admin', true],
  ]);
});

test('without ADMIN_PASSWORD no account is the .env’s, and one line says so', async () => {
  const empty = await AccountStore.open(':memory:');
  const nobody = recorder();
  const unset = await syncEnvAdmin(empty, nobody.log, { ADMIN_PASSWORD: '' });

  const store = await AccountStore.open(':memory:');
  await start(store, { ADMIN_PASSWORD: 'the password' });
  const somebody = recorder();
  await syncEnvAdmin(store, somebody.log, {});

  expect(unset).toStrictEqual({ status: 'unset', changed: [], account: null });
  expect(empty.count()).toBe(0);
  expect(nobody.lines).toStrictEqual([
    [
      'warn',
      'no account can sign in: set ADMIN_PASSWORD in .env and restart to create the administrator',
      undefined,
    ],
  ]);
  expect(somebody.lines).toStrictEqual([
    [
      'info',
      'ADMIN_PASSWORD is unset: the .env defines no administrator',
      undefined,
    ],
  ]);
  expect(store.byId(1)?.envManaged).toBe(false);
});

test('an unusable ADMIN_USERNAME stops the start, naming the variables', async () => {
  const store = await AccountStore.open(':memory:');
  const { log } = recorder();

  await expect(
    syncEnvAdmin(store, log, {
      ADMIN_USERNAME: 'luc patiny',
      ADMIN_PASSWORD: 'a password',
    }),
  ).rejects.toThrow(
    'ADMIN_USERNAME or ADMIN_PASSWORD: A username holds letters, digits, dots, dashes and underscores, and starts with a letter or a digit.',
  );
  await expect(
    syncEnvAdmin(store, log, {
      ADMIN_USERNAME: ' '.repeat(3),
      ADMIN_PASSWORD: 'a password',
    }),
  ).resolves.toMatchObject({ account: { username: 'admin' } });
});
