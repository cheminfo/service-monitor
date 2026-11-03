import { expect, onTestFinished, test } from 'vitest';

import { contactDirectory } from './contactDirectory.ts';
import { start } from './envAdminFixture.ts';
import type { TestApp } from './testApp.ts';
import {
  ADA_PASSWORD,
  ADMIN_TOKEN,
  COOKIE,
  PASSWORD,
  asAccount,
  cookiesOf,
  outcomes,
  sessionOf,
  testApp,
} from './testApp.ts';

/**
 * The test site, its accounts kept in a host's own `contacts` table.
 * @returns The site.
 */
async function hostSite(): Promise<TestApp> {
  const site = await testApp({ directory: contactDirectory() });
  onTestFinished(() => site.app.close());
  return site;
}

test("a host's own table signs in and out, its roles read as the accounts'", async () => {
  const { app, store } = await hostSite();
  const before = Math.floor(Date.now() / 1000);

  const login = await app.inject({
    method: 'POST',
    url: '/v1/account/login',
    payload: { username: 'Ada', password: ADA_PASSWORD },
  });
  const session = login.cookies[0]?.value ?? '';
  const responses = [
    await asAccount(app, session, 'GET', '/v1/data/status'),
    await asAccount(app, session, 'POST', '/v1/data/samples'),
    await asAccount(app, session, 'DELETE', '/v1/data/samples'),
  ];
  const logout = await asAccount(app, session, 'POST', '/v1/account/logout');

  expect(login.json()).toStrictEqual({
    signedIn: true,
    username: 'ada',
    role: 'write',
  });
  expect(outcomes(responses)).toStrictEqual([
    [200, undefined],
    [200, undefined],
    [403, 'roleTooLow'],
  ]);
  expect(responses[0]?.json()).toStrictEqual({ by: 'ada' });
  expect(logout.json()).toStrictEqual({
    signedIn: false,
    username: null,
    role: null,
  });
  expect(cookiesOf(logout)).toStrictEqual([
    expect.objectContaining({ name: COOKIE, value: '' }),
  ]);
  expect(store.byUsername('ada')?.lastSignInAt).toBeGreaterThanOrEqual(before);
  expect(store.byUsername('ada')?.lastSignInAt).toBeLessThanOrEqual(
    Math.floor(Date.now() / 1000),
  );
});

test("a password changed in the host's table ends the sessions it had", async () => {
  const { app } = await hostSite();
  const session = await sessionOf(app, 'ada', ADA_PASSWORD);
  const other = await sessionOf(app, 'ada', ADA_PASSWORD);

  const changed = await asAccount(
    app,
    session,
    'POST',
    '/v1/account/password',
    {
      currentPassword: ADA_PASSWORD,
      newPassword: 'her new password',
    },
  );
  const renewed = changed.cookies[0]?.value ?? '';
  const responses = [
    await asAccount(app, renewed, 'GET', '/v1/data/status'),
    await asAccount(app, other, 'GET', '/v1/data/status'),
    await app.inject({
      method: 'POST',
      url: '/v1/account/login',
      payload: { username: 'ada', password: ADA_PASSWORD },
    }),
    await app.inject({
      method: 'POST',
      url: '/v1/account/login',
      payload: { username: 'ada', password: 'her new password' },
    }),
  ];

  expect(changed.json()).toStrictEqual({
    signedIn: true,
    username: 'ada',
    role: 'write',
  });
  expect(outcomes(responses)).toStrictEqual([
    [200, undefined],
    [401, 'sessionEnded'],
    [401, 'wrongCredentials'],
    [200, undefined],
  ]);
});

test("an administrator manages the host's people through the routes", async () => {
  const { app, store } = await hostSite();
  const session = await sessionOf(app, 'admin', PASSWORD);

  const added = await asAccount(app, session, 'POST', '/v1/account/users', {
    username: 'Cleo',
    password: 'her password',
    role: 'write',
  });
  const promoted = await asAccount(
    app,
    session,
    'PATCH',
    '/v1/account/users/4',
    {
      role: 'admin',
    },
  );
  const removed = await asAccount(
    app,
    session,
    'DELETE',
    '/v1/account/users/3',
  );
  const listed = await asAccount(app, session, 'GET', '/v1/account/users');

  expect(outcomes([added, promoted, removed, listed])).toStrictEqual([
    [200, undefined],
    [200, undefined],
    [200, undefined],
    [200, undefined],
  ]);
  expect(promoted.json()).toMatchObject({
    id: 4,
    username: 'cleo',
    role: 'admin',
  });
  expect(
    listed
      .json<{ users: Array<{ id: number; username: string; role: string }> }>()
      .users.map((user) => [user.id, user.username, user.role]),
  ).toStrictEqual([
    [2, 'ada', 'write'],
    [1, 'admin', 'admin'],
    [4, 'cleo', 'admin'],
  ]);
  expect(store.byId(3)).toBeUndefined();
});

test("the last administrator of a host's table is neither demoted nor removed", async () => {
  const { app, store } = await hostSite();
  const token = { authorization: `Bearer ${ADMIN_TOKEN}` };

  const responses = [
    await app.inject({
      method: 'PATCH',
      url: '/v1/account/users/1',
      headers: token,
      payload: { role: 'read' },
    }),
    await app.inject({
      method: 'DELETE',
      url: '/v1/account/users/1',
      headers: token,
    }),
    await app.inject({
      method: 'PATCH',
      url: '/v1/account/users/2',
      headers: token,
      payload: { role: 'admin' },
    }),
    await app.inject({
      method: 'DELETE',
      url: '/v1/account/users/1',
      headers: token,
    }),
    await app.inject({
      method: 'PATCH',
      url: '/v1/account/users/2',
      headers: token,
      payload: { role: 'read' },
    }),
  ];

  expect(outcomes(responses)).toStrictEqual([
    [400, 'lastAdmin'],
    [400, 'lastAdmin'],
    [200, undefined],
    [200, undefined],
    [400, 'lastAdmin'],
  ]);
  expect(
    store.all().map((account) => [account.username, account.role]),
  ).toStrictEqual([
    ['ada', 'admin'],
    ['bob', 'read'],
  ]);
});

test("the administrator of the .env is made in the host's table, and signs in", async () => {
  const directory = contactDirectory();
  const { app, outcome } = await start(directory, {
    ADMIN_USERNAME: 'Root',
    ADMIN_PASSWORD: 'the password of the .env',
  });

  const login = await app.inject({
    method: 'POST',
    url: '/v1/account/login',
    payload: { username: 'root', password: 'the password of the .env' },
  });

  expect([
    outcome.status,
    outcome.account?.role,
    outcome.account?.envManaged,
  ]).toStrictEqual(['created', 'admin', true]);
  expect(login.json()).toStrictEqual({
    signedIn: true,
    username: 'root',
    role: 'admin',
  });
  expect(directory.count()).toBe(1);
});
