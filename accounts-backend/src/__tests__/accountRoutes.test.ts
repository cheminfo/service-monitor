import { afterAll, beforeEach, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import { ADMIN_TOKEN, COOKIE, HOST, PASSWORD, testApp } from './testApp.ts';

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

/** Headers a page of the site sends with a change. */
const SAME_SITE = { host: HOST, origin: `https://${HOST}` };

/**
 * Sign in, and keep the session's cookie.
 * @param username - who
 * @param password - their password
 * @returns the cookie's value
 */
async function sessionOf(username: string, password: string) {
  const login = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/login',
    payload: { username, password },
  });
  return login.cookies[0]?.value ?? '';
}

/**
 * A request of an account signed in, from the site's own page.
 * @param session - the session's cookie
 * @param method - the method
 * @param url - the route
 * @param payload - what to send
 * @returns the response
 */
function asAccount(
  session: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  return site.app.inject({
    method,
    url,
    payload,
    headers: SAME_SITE,
    cookies: { [COOKIE]: session },
  });
}

test('the accounts are listed by username, never with their password hash', async () => {
  const session = await sessionOf('admin', PASSWORD);

  const response = await asAccount(session, 'GET', '/v1/admin/users');

  const { users } = response.json<{ users: Array<Record<string, unknown>> }>();

  expect(users.map((user) => Object.keys(user))).toStrictEqual([
    ['id', 'username', 'createdAt', 'passwordChangedAt', 'lastSignInAt'],
    ['id', 'username', 'createdAt', 'passwordChangedAt', 'lastSignInAt'],
  ]);
  expect(users.map((user) => [user.id, user.username])).toStrictEqual([
    [2, 'ada'],
    [1, 'admin'],
  ]);
  expect(users[1]?.lastSignInAt).toStrictEqual(expect.any(Number));
  expect(users[0]?.lastSignInAt).toBeNull();
});

test('an account is added once, in lower case, and signs in at once', async () => {
  const session = await sessionOf('admin', PASSWORD);

  const added = await asAccount(session, 'POST', '/v1/admin/users', {
    username: 'Bob',
    password: 'his password',
  });
  const again = await asAccount(session, 'POST', '/v1/admin/users', {
    username: 'bob',
    password: 'another',
  });

  expect(added.statusCode).toBe(200);
  expect(added.json().username).toBe('bob');
  expect([again.statusCode, again.json().message]).toStrictEqual([
    400,
    'there is already an account named bob',
  ]);
  await expect(sessionOf('bob', 'his password')).resolves.toMatch(/^3\./);
});

test("setting another account's password signs it out everywhere", async () => {
  const admin = await sessionOf('admin', PASSWORD);
  const ada = await sessionOf('ada', 'her own password');

  const own = await asAccount(admin, 'PATCH', '/v1/admin/users/1', {
    password: 'new',
  });
  const set = await asAccount(admin, 'PATCH', '/v1/admin/users/2', {
    password: 'a new one',
  });
  const missing = await asAccount(admin, 'PATCH', '/v1/admin/users/9', {
    password: 'a new one',
  });
  const adaAfter = await asAccount(ada, 'GET', '/v1/admin/users');

  expect([own.statusCode, own.json().message]).toStrictEqual([
    400,
    'change your own password with POST /password, which asks for the current one',
  ]);
  expect(set.statusCode).toBe(200);
  expect(missing.statusCode).toBe(404);
  expect(adaAfter.statusCode).toBe(401);
  await expect(sessionOf('ada', 'a new one')).resolves.toMatch(/^2\./);
});

test('an account is removed, but neither your own nor the last one', async () => {
  const admin = await sessionOf('admin', PASSWORD);
  const token = { authorization: `Bearer ${ADMIN_TOKEN}` };

  const own = await asAccount(admin, 'DELETE', '/v1/admin/users/1');
  const ada = await asAccount(admin, 'DELETE', '/v1/admin/users/2');
  const last = await site.app.inject({
    method: 'DELETE',
    url: '/v1/admin/users/1',
    headers: token,
  });

  expect([own.statusCode, own.json().message]).toStrictEqual([
    400,
    'you cannot remove the account you are using',
  ]);
  expect(ada.json().username).toBe('ada');
  expect([last.statusCode, last.json().message]).toStrictEqual([
    400,
    'the last account cannot be removed',
  ]);
  expect(site.store.all().map((account) => account.username)).toStrictEqual([
    'admin',
  ]);
});

test('your own password changes with the current one, and this browser stays in', async () => {
  const before = await sessionOf('admin', PASSWORD);
  const other = await sessionOf('admin', PASSWORD);

  const wrong = await asAccount(before, 'POST', '/v1/admin/password', {
    currentPassword: 'not it',
    newPassword: 'the new password',
  });
  const changed = await asAccount(before, 'POST', '/v1/admin/password', {
    currentPassword: PASSWORD,
    newPassword: 'the new password',
  });
  const renewed = changed.cookies[0]?.value ?? '';
  const withToken = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/password',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { currentPassword: 'x', newPassword: 'y' },
  });

  expect([wrong.statusCode, wrong.json().message]).toStrictEqual([
    400,
    'the current password is not that one',
  ]);
  expect(changed.json()).toStrictEqual({ signedIn: true, username: 'admin' });

  const withRenewed = await asAccount(renewed, 'GET', '/v1/admin/users');
  const withOther = await asAccount(other, 'GET', '/v1/admin/users');

  expect([withRenewed.statusCode, withOther.statusCode]).toStrictEqual([
    200, 401,
  ]);
  expect(withToken.json().message).toBe(
    'a password is changed by the account signed in, not with the ADMIN_TOKEN',
  );
});
