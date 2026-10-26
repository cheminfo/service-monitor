import { expect, onTestFinished, test } from 'vitest';

import { createAccount } from '../accounts.ts';
import { verifyPassword } from '../password.ts';
import { AccountStore } from '../store/AccountStore.ts';

import { signedInAs, start, storePath } from './envAdminFixture.ts';

test('the .env administrator is created on a store that has none, marked as the .env’s', async () => {
  const store = await AccountStore.open(':memory:');
  const { lines, outcome } = await start(store, {
    ADMIN_USERNAME: ' Luc ',
    ADMIN_PASSWORD: 'the first password',
  });

  expect(outcome).toStrictEqual({
    status: 'created',
    changed: [],
    account: {
      id: 1,
      username: 'luc',
      role: 'admin',
      envManaged: true,
      createdAt: expect.any(Number),
      passwordChangedAt: outcome.account?.createdAt,
      lastSignInAt: null,
    },
  });
  await expect(
    verifyPassword('the first password', store.byId(1)?.passwordHash ?? ''),
  ).resolves.toBe(true);
  expect(lines).toStrictEqual([
    [
      'info',
      'created the administrator the .env defines',
      { username: 'luc', status: 'created', changed: [] },
    ],
  ]);
});

test('a restart with the same password keeps the hash, so its sessions survive', async () => {
  const path = storePath();
  const env = { ADMIN_PASSWORD: 'the password' };
  const first = await AccountStore.open(path);
  const before = await start(first, env);
  const login = await before.app.inject({
    method: 'POST',
    url: '/v1/account/login',
    payload: { username: 'admin', password: 'the password' },
  });
  const cookie = login.cookies[0]?.value ?? '';
  const hash = first.byId(1)?.passwordHash;
  first.close();

  const second = await AccountStore.open(path);
  onTestFinished(() => second.close());
  const after = await start(second, env);

  expect(after.outcome.status).toBe('unchanged');
  expect(second.byId(1)?.passwordHash).toBe(hash);
  await expect(signedInAs(after.app, cookie)).resolves.toBe('admin');
  expect(after.lines).toStrictEqual([
    [
      'info',
      'the administrator the .env defines is as it says',
      { username: 'admin', status: 'unchanged', changed: [] },
    ],
  ]);
});

test('a new ADMIN_PASSWORD replaces the old one at the next start, and ends its sessions', async () => {
  const store = await AccountStore.open(':memory:');
  const before = await start(store, { ADMIN_PASSWORD: 'the old password' });
  const login = await before.app.inject({
    method: 'POST',
    url: '/v1/account/login',
    payload: { username: 'admin', password: 'the old password' },
  });
  const cookie = login.cookies[0]?.value ?? '';

  const after = await start(store, { ADMIN_PASSWORD: 'the new password' });
  const withNew = await after.app.inject({
    method: 'POST',
    url: '/v1/account/login',
    payload: { username: 'admin', password: 'the new password' },
  });

  expect([after.outcome.status, after.outcome.changed]).toStrictEqual([
    'updated',
    ['password'],
  ]);
  await expect(signedInAs(after.app, cookie)).resolves.toBeNull();
  expect(withNew.statusCode).toBe(200);
});

test('an account of that name is taken over: made administrator, with the .env’s password', async () => {
  const store = await AccountStore.open(':memory:');
  await createAccount(store, {
    username: 'luc',
    password: 'chosen on the page',
    role: 'read',
  });

  const { outcome } = await start(store, {
    ADMIN_USERNAME: 'luc',
    ADMIN_PASSWORD: 'from the env',
  });

  expect([outcome.status, outcome.changed]).toStrictEqual([
    'updated',
    ['password', 'role', 'envManaged'],
  ]);
  expect([store.byId(1)?.role, store.byId(1)?.envManaged]).toStrictEqual([
    'admin',
    true,
  ]);
  await expect(
    verifyPassword('from the env', store.byId(1)?.passwordHash ?? ''),
  ).resolves.toBe(true);
});
