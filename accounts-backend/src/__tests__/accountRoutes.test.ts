import { afterAll, beforeEach, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import {
  ADA_PASSWORD,
  ADMIN_TOKEN,
  PASSWORD,
  asAccount,
  sessionOf,
  testApp,
} from './testApp.ts';

let site: TestApp;
const opened: TestApp[] = [];

// A site of its own per test: each changes the accounts.
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

test('the accounts are listed by username, with their role, never their password hash', async () => {
  const session = await sessionOf(site.app, 'admin', PASSWORD);

  const response = await asAccount(
    site.app,
    session,
    'GET',
    '/v1/account/users',
  );

  const { users } = response.json<{ users: Array<Record<string, unknown>> }>();

  expect(users.map((user) => Object.keys(user))).toStrictEqual([
    [
      'id',
      'username',
      'role',
      'envManaged',
      'createdAt',
      'passwordChangedAt',
      'lastSignInAt',
    ],
    [
      'id',
      'username',
      'role',
      'envManaged',
      'createdAt',
      'passwordChangedAt',
      'lastSignInAt',
    ],
    [
      'id',
      'username',
      'role',
      'envManaged',
      'createdAt',
      'passwordChangedAt',
      'lastSignInAt',
    ],
  ]);
  expect(
    users.map((user) => [user.id, user.username, user.role, user.envManaged]),
  ).toStrictEqual([
    [2, 'ada', 'write', false],
    [1, 'admin', 'admin', false],
    [3, 'bob', 'read', false],
  ]);
  expect(users[1]?.lastSignInAt).toStrictEqual(expect.any(Number));
  expect(users[0]?.lastSignInAt).toBeNull();
});

test('an account is added once, in lower case, with the role asked or read, and signs in at once', async () => {
  const session = await sessionOf(site.app, 'admin', PASSWORD);

  const added = await asAccount(
    site.app,
    session,
    'POST',
    '/v1/account/users',
    {
      username: 'Carl',
      password: 'his password',
    },
  );
  const writer = await asAccount(
    site.app,
    session,
    'POST',
    '/v1/account/users',
    {
      username: 'dora',
      password: 'her password',
      role: 'write',
    },
  );
  const again = await asAccount(
    site.app,
    session,
    'POST',
    '/v1/account/users',
    {
      username: 'carl',
      password: 'another',
    },
  );
  const invalid = await asAccount(
    site.app,
    session,
    'POST',
    '/v1/account/users',
    {
      username: 'eve',
      password: 'hers',
      role: 'owner',
    },
  );

  expect(added.statusCode).toBe(200);
  expect([added.json().username, added.json().role]).toStrictEqual([
    'carl',
    'read',
  ]);
  expect(writer.json().role).toBe('write');
  expect(again.json()).toStrictEqual({
    statusCode: 400,
    error: 'Bad Request',
    message: 'That username is taken.',
    code: 'usernameTaken',
  });
  expect(invalid.statusCode).toBe(400);
  await expect(sessionOf(site.app, 'carl', 'his password')).resolves.toMatch(
    /^4\./,
  );
});

test("setting another account's password signs it out everywhere", async () => {
  const admin = await sessionOf(site.app, 'admin', PASSWORD);
  const ada = await sessionOf(site.app, 'ada', ADA_PASSWORD);

  const own = await asAccount(site.app, admin, 'PATCH', '/v1/account/users/1', {
    password: 'new',
  });
  const set = await asAccount(site.app, admin, 'PATCH', '/v1/account/users/2', {
    password: 'a new one',
  });
  const missing = await asAccount(
    site.app,
    admin,
    'PATCH',
    '/v1/account/users/9',
    { password: 'a new one' },
  );
  const adaAfter = await asAccount(site.app, ada, 'GET', '/v1/data/status');

  expect([own.statusCode, own.json().code]).toStrictEqual([
    400,
    'useChangePassword',
  ]);
  expect(own.json().message).toBe(
    'Change your own password with POST /password, which asks for the current one.',
  );
  expect(set.statusCode).toBe(200);
  expect([missing.statusCode, missing.json().code]).toStrictEqual([
    404,
    'noSuchAccount',
  ]);
  expect([adaAfter.statusCode, adaAfter.json().code]).toStrictEqual([
    401,
    'sessionEnded',
  ]);
  await expect(sessionOf(site.app, 'ada', 'a new one')).resolves.toMatch(
    /^2\./,
  );
});

test('an account is removed, but neither your own nor the last administrator', async () => {
  const admin = await sessionOf(site.app, 'admin', PASSWORD);
  const token = { authorization: `Bearer ${ADMIN_TOKEN}` };

  const own = await asAccount(site.app, admin, 'DELETE', '/v1/account/users/1');
  const ada = await asAccount(site.app, admin, 'DELETE', '/v1/account/users/2');
  const last = await site.app.inject({
    method: 'DELETE',
    url: '/v1/account/users/1',
    headers: token,
  });
  const bob = await site.app.inject({
    method: 'DELETE',
    url: '/v1/account/users/3',
    headers: token,
  });

  expect(own.json()).toStrictEqual({
    statusCode: 400,
    error: 'Bad Request',
    message: 'You cannot remove the account you are using.',
    code: 'removeYourself',
  });
  expect(ada.json().username).toBe('ada');
  expect(last.json()).toStrictEqual({
    statusCode: 400,
    error: 'Bad Request',
    message: 'The last administrator can be neither removed nor demoted.',
    code: 'lastAdmin',
  });
  expect(bob.json().username).toBe('bob');
  expect(site.store.all().map((account) => account.username)).toStrictEqual([
    'admin',
  ]);
});
