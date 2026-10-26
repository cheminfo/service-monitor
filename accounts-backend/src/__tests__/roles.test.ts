import { afterAll, beforeEach, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import {
  ADA_PASSWORD,
  ADMIN_TOKEN,
  BOB_PASSWORD,
  PASSWORD,
  asAccount,
  outcomes,
  sessionOf,
  testApp,
} from './testApp.ts';

let site: TestApp;
const opened: TestApp[] = [];

beforeEach(async () => {
  site = await testApp();
  opened.push(site);
});

afterAll(async () => {
  for (const each of opened) {
    // eslint-disable-next-line no-await-in-loop -- one site closed after the other
    await each.app.close();
  }
});

test('nobody signed in gets 401; an account below the role gets 403', async () => {
  const bob = await sessionOf(site.app, 'bob', BOB_PASSWORD);
  const ada = await sessionOf(site.app, 'ada', ADA_PASSWORD);
  const admin = await sessionOf(site.app, 'admin', PASSWORD);

  const nobody = await site.app.inject({ url: '/v1/admin/system' });
  const readRead = await asAccount(site.app, bob, 'GET', '/v1/data/status');
  const readWrite = await asAccount(site.app, bob, 'POST', '/v1/data/samples');
  const writeWrite = await asAccount(site.app, ada, 'POST', '/v1/data/samples');
  const writeAdmin = await asAccount(
    site.app,
    ada,
    'DELETE',
    '/v1/data/samples',
  );
  const writeScope = await asAccount(site.app, ada, 'GET', '/v1/admin/system');
  const adminScope = await asAccount(
    site.app,
    admin,
    'GET',
    '/v1/admin/system',
  );
  const adminRoute = await asAccount(
    site.app,
    admin,
    'DELETE',
    '/v1/data/samples',
  );

  expect(
    outcomes([
      nobody,
      readRead,
      readWrite,
      writeWrite,
      writeAdmin,
      writeScope,
      adminScope,
      adminRoute,
    ]),
  ).toStrictEqual([
    [401, 'signInRequired'],
    [200, undefined],
    [403, 'roleTooLow'],
    [200, undefined],
    [403, 'roleTooLow'],
    [403, 'roleTooLow'],
    [200, undefined],
    [200, undefined],
  ]);
  expect(readWrite.json()).toStrictEqual({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Your account cannot do this: ask an administrator.',
    code: 'roleTooLow',
  });
  expect(nobody.headers['www-authenticate']).toBe('Bearer');
  expect(readWrite.headers['www-authenticate']).toBeUndefined();
});

test('the ADMIN_TOKEN acts as an administrator', async () => {
  const token = { authorization: `Bearer ${ADMIN_TOKEN}` };

  const responses = await Promise.all([
    site.app.inject({ url: '/v1/admin/system', headers: token }),
    site.app.inject({
      method: 'DELETE',
      url: '/v1/data/samples',
      headers: token,
    }),
    site.app.inject({ url: '/v1/account/users', headers: token }),
  ]);

  expect(outcomes(responses)).toStrictEqual([
    [200, undefined],
    [200, undefined],
    [200, undefined],
  ]);
});

test('only an administrator lists, adds, changes and removes accounts', async () => {
  const ada = await sessionOf(site.app, 'ada', ADA_PASSWORD);

  const responses = [
    await asAccount(site.app, ada, 'GET', '/v1/account/users'),
    await asAccount(site.app, ada, 'POST', '/v1/account/users', {
      username: 'carl',
      password: 'his password',
    }),
    await asAccount(site.app, ada, 'PATCH', '/v1/account/users/3', {
      role: 'admin',
    }),
    await asAccount(site.app, ada, 'DELETE', '/v1/account/users/3'),
  ];

  expect(outcomes(responses)).toStrictEqual([
    [403, 'roleTooLow'],
    [403, 'roleTooLow'],
    [403, 'roleTooLow'],
    [403, 'roleTooLow'],
  ]);
  expect(site.store.all().map((account) => account.role)).toStrictEqual([
    'write',
    'admin',
    'read',
  ]);
});

test('every account changes its own password, whatever its role', async () => {
  const bob = await sessionOf(site.app, 'bob', BOB_PASSWORD);

  const changed = await asAccount(
    site.app,
    bob,
    'POST',
    '/v1/account/password',
    {
      currentPassword: BOB_PASSWORD,
      newPassword: 'a better one',
    },
  );

  expect(changed.json()).toStrictEqual({
    signedIn: true,
    username: 'bob',
    role: 'read',
  });
  await expect(sessionOf(site.app, 'bob', 'a better one')).resolves.toMatch(
    /^3\./,
  );
});

test('a new role applies at the next request of a session already open', async () => {
  const admin = await sessionOf(site.app, 'admin', PASSWORD);
  const bob = await sessionOf(site.app, 'bob', BOB_PASSWORD);

  const before = await asAccount(site.app, bob, 'POST', '/v1/data/samples');
  const promoted = await asAccount(
    site.app,
    admin,
    'PATCH',
    '/v1/account/users/3',
    {
      role: 'write',
    },
  );
  const after = await asAccount(site.app, bob, 'POST', '/v1/data/samples');
  const session = await asAccount(site.app, bob, 'GET', '/v1/account/session');

  expect(before.statusCode).toBe(403);
  expect([promoted.json().username, promoted.json().role]).toStrictEqual([
    'bob',
    'write',
  ]);
  expect(after.json()).toStrictEqual({ written: true });
  expect(session.json().role).toBe('write');
});

test('the last administrator is neither demoted nor removed; another one may be', async () => {
  const admin = await sessionOf(site.app, 'admin', PASSWORD);
  const token = { authorization: `Bearer ${ADMIN_TOKEN}` };

  const demoteLast = await site.app.inject({
    method: 'PATCH',
    url: '/v1/account/users/1',
    headers: token,
    payload: { role: 'write' },
  });
  const promoteAda = await asAccount(
    site.app,
    admin,
    'PATCH',
    '/v1/account/users/2',
    {
      role: 'admin',
    },
  );
  const demoteNow = await site.app.inject({
    method: 'PATCH',
    url: '/v1/account/users/1',
    headers: token,
    payload: { role: 'read' },
  });
  const removeAda = await site.app.inject({
    method: 'DELETE',
    url: '/v1/account/users/2',
    headers: token,
  });

  expect(
    outcomes([demoteLast, promoteAda, demoteNow, removeAda]),
  ).toStrictEqual([
    [400, 'lastAdmin'],
    [200, undefined],
    [200, undefined],
    [400, 'lastAdmin'],
  ]);
  expect(
    site.store.all().map((account) => [account.username, account.role]),
  ).toStrictEqual([
    ['ada', 'admin'],
    ['admin', 'read'],
    ['bob', 'read'],
  ]);
});
