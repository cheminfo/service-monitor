import { afterAll, beforeAll, expect, test } from 'vitest';

import { createSharedPassword } from '../createSharedPassword.ts';
import { verifyPassword } from '../password.ts';

import type { SharedPasswordApp } from './sharedPasswordApp.ts';
import {
  SHARED,
  sharedPasswordApp,
  sharedSessionOf,
  signInShared,
  withSession,
} from './sharedPasswordApp.ts';
import {
  ADMIN_TOKEN,
  COOKIE,
  HOST,
  PURPOSE,
  cookiesOf,
  outcomes,
} from './testApp.ts';

let site: SharedPasswordApp;

beforeAll(async () => {
  // Every test signs in again: the limit has a test of its own.
  site = await sharedPasswordApp({ access: { signInLimit: 100 } });
});

afterAll(async () => {
  await site.app.close();
});

test('the shared password signs in, with no username, to a 400-day cookie', async () => {
  const response = await signInShared(site.app, SHARED);

  expect(response.statusCode).toBe(200);
  expect(response.json()).toStrictEqual({
    signedIn: true,
    username: null,
    role: 'admin',
  });
  expect(cookiesOf(response)).toStrictEqual([
    {
      name: COOKIE,
      value: expect.stringMatching(/^0\.\d{10}\.[\da-f]{64}$/),
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
      maxAge: 400 * 24 * 60 * 60,
    },
  ]);

  const session = await site.app.inject({
    method: 'GET',
    url: '/v1/auth/session',
    cookies: { [COOKIE]: response.cookies[0]?.value ?? '' },
  });

  expect(session.json()).toStrictEqual({
    signedIn: true,
    username: null,
    role: 'admin',
  });
});

test('a wrong password, or a page of another site, is refused; a username is ignored', async () => {
  const wrong = await signInShared(site.app, 'not it');
  const elsewhere = await signInShared(site.app, SHARED, {
    origin: 'https://evil.example.org',
  });
  const withUsername = await site.app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { username: 'admin', password: SHARED },
  });

  expect(outcomes([wrong, elsewhere])).toStrictEqual([
    [401, 'wrongCredentials'],
    [403, 'signInElsewhere'],
  ]);
  expect(withUsername.statusCode).toBe(200);
  expect([wrong.cookies, elsewhere.cookies]).toStrictEqual([[], []]);
});

test('the eleventh sign-in of a client within 15 minutes is refused', async () => {
  const { app } = await sharedPasswordApp();
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 11; attempt++) {
    // eslint-disable-next-line no-await-in-loop -- the limit counts them in order
    const response = await signInShared(app, 'not it', {}, '10.0.0.7');
    statuses.push(response.statusCode);
  }
  const other = await signInShared(app, SHARED, {}, '10.0.0.8');

  expect(statuses).toStrictEqual([
    ...Array.from({ length: 10 }, () => 401),
    429,
  ]);
  expect(other.statusCode).toBe(200);

  await app.close();
});

test('reads stay open, a change needs the password, the token or the site itself', async () => {
  const session = await sharedSessionOf(site.app);
  const read = await site.app.inject({ method: 'GET', url: '/v1/printers' });
  const anonymous = await site.app.inject({
    method: 'POST',
    url: '/v1/printers',
  });
  const signedIn = await withSession(site.app, session, 'POST', '/v1/printers');
  const token = await site.app.inject({
    method: 'POST',
    url: '/v1/printers',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  const wrongToken = await site.app.inject({
    method: 'POST',
    url: '/v1/printers',
    headers: { authorization: 'Bearer not-the-token' },
  });
  const elsewhere = await site.app.inject({
    method: 'POST',
    url: '/v1/printers',
    headers: { host: HOST, origin: 'https://evil.example.org' },
    cookies: { [COOKIE]: session },
  });

  expect(
    outcomes([read, anonymous, signedIn, token, wrongToken, elsewhere]),
  ).toStrictEqual([
    [200, undefined],
    [401, 'signInRequired'],
    [200, undefined],
    [200, undefined],
    [401, 'wrongToken'],
    [403, 'changeElsewhere'],
  ]);
});

test('a scope protected without openReads guards its reads too', async () => {
  const session = await sharedSessionOf(site.app);
  const anonymous = await site.app.inject({
    method: 'GET',
    url: '/v1/admin/system',
  });
  const signedIn = await withSession(
    site.app,
    session,
    'GET',
    '/v1/admin/system',
  );

  expect(outcomes([anonymous, signedIn])).toStrictEqual([
    [401, 'signInRequired'],
    [200, undefined],
  ]);
});

test('signedIn tells a session and the token from anybody, refusing nobody', async () => {
  const session = await sharedSessionOf(site.app);
  const asked = await Promise.all([
    site.app.inject({ method: 'GET', url: '/v1/open' }),
    withSession(site.app, session, 'GET', '/v1/open'),
    site.app.inject({
      method: 'GET',
      url: '/v1/open',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    }),
  ]);

  expect(asked.map((response) => response.json())).toStrictEqual([
    { signedIn: false },
    { signedIn: true },
    { signedIn: true },
  ]);
});

test('a forged, tampered or extended cookie is nobody', async () => {
  const session = await sharedSessionOf(site.app);
  const [id, expiresAt, signature] = session.split('.');
  const forged = [
    'not-a-session',
    `${id}.${expiresAt}.${signature?.slice(0, -1)}${signature?.endsWith('0') ? '1' : '0'}`,
    `${id}.${Number(expiresAt) + 3600}.${signature}`,
    `1.${expiresAt}.${signature}`,
  ];
  const answers = await Promise.all(
    forged.map((value) =>
      site.app.inject({
        method: 'GET',
        url: '/v1/auth/session',
        cookies: { [COOKIE]: value },
      }),
    ),
  );

  expect(answers.map((response) => response.json().signedIn)).toStrictEqual([
    false,
    false,
    false,
    false,
  ]);
});

test('signing out clears the cookie, signed in or not, from the site only', async () => {
  const session = await sharedSessionOf(site.app);
  const signOut = await withSession(
    site.app,
    session,
    'POST',
    '/v1/auth/logout',
  );
  const nobody = await site.app.inject({
    method: 'POST',
    url: '/v1/auth/logout',
  });
  const elsewhere = await site.app.inject({
    method: 'POST',
    url: '/v1/auth/logout',
    headers: { host: HOST, origin: 'https://evil.example.org' },
  });

  expect(signOut.json()).toStrictEqual({
    signedIn: false,
    username: null,
    role: null,
  });
  expect(signOut.cookies[0]).toMatchObject({ name: COOKIE, value: '' });
  expect(outcomes([nobody, elsewhere])).toStrictEqual([
    [200, undefined],
    [403, 'signOutElsewhere'],
  ]);
});

test('a new password ends every other session and signs this one in again', async () => {
  const { app, holder } = await sharedPasswordApp();
  const current = await sharedSessionOf(app);
  const other = await sharedSessionOf(app);
  const wrongCurrent = await withSession(
    app,
    current,
    'POST',
    '/v1/auth/password',
    {
      currentPassword: 'not it',
      newPassword: 'a new one',
    },
  );
  const changed = await withSession(app, current, 'POST', '/v1/auth/password', {
    currentPassword: SHARED,
    newPassword: 'a new one',
  });
  const renewed = changed.cookies[0]?.value ?? '';

  expect(outcomes([wrongCurrent, changed])).toStrictEqual([
    [400, 'wrongCurrentPassword'],
    [200, undefined],
  ]);
  await expect(verifyPassword('a new one', holder.hash ?? '')).resolves.toBe(
    true,
  );

  const after = await Promise.all(
    [current, other, renewed].map((session) =>
      withSession(app, session, 'POST', '/v1/printers'),
    ),
  );

  expect(after.map((response) => response.statusCode)).toStrictEqual([
    401, 401, 200,
  ]);

  const oldPassword = await signInShared(app, SHARED);
  const newPassword = await signInShared(app, 'a new one');

  expect([oldPassword.statusCode, newPassword.statusCode]).toStrictEqual([
    401, 200,
  ]);

  await app.close();
});

test('the token does not change the password, and nobody without a session', async () => {
  const token = await site.app.inject({
    method: 'POST',
    url: '/v1/auth/password',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { currentPassword: SHARED, newPassword: 'a new one' },
  });
  const nobody = await site.app.inject({
    method: 'POST',
    url: '/v1/auth/password',
    payload: { currentPassword: SHARED, newPassword: 'a new one' },
  });

  expect(outcomes([token, nobody])).toStrictEqual([
    [400, 'tokenCannotChangePassword'],
    [401, 'signInRequired'],
  ]);
});

test('with no password kept, nobody signs in', async () => {
  const { app } = await sharedPasswordApp({ hash: null });
  const response = await signInShared(app, SHARED);

  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('wrongCredentials');

  await app.close();
});

test('a hash of an older format verifies once, and is kept in the package format', async () => {
  const legacy = await sharedPasswordApp({
    hash: 'legacy:the shared password',
    access: {
      verifyLegacyHash: async (password, hash) => hash === `legacy:${password}`,
    },
  });
  const ignored = await sharedPasswordApp({
    hash: 'legacy:the shared password',
  });

  const wrong = await signInShared(legacy.app, 'not it');

  expect(legacy.holder.hash).toBe('legacy:the shared password');

  const upgraded = await signInShared(legacy.app, SHARED);

  expect([wrong.statusCode, upgraded.statusCode]).toStrictEqual([401, 200]);
  expect(legacy.holder.hash).toMatch(/^pbkdf2\$sha512\$210000\$/);
  await expect(verifyPassword(SHARED, legacy.holder.hash ?? '')).resolves.toBe(
    true,
  );

  const unknownFormat = await signInShared(ignored.app, SHARED);

  expect(unknownFormat.statusCode).toBe(401);

  await legacy.app.close();
  await ignored.app.close();
});

test('production refuses to start without COOKIE_SECRET', async () => {
  await expect(
    createSharedPassword({
      cookieName: COOKIE,
      purpose: PURPOSE,
      production: true,
      readPasswordHash: () => undefined,
      writePasswordHash: () => undefined,
    }),
  ).rejects.toThrow(/COOKIE_SECRET is unset/);
});
