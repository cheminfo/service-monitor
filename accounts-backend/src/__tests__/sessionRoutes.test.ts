import { afterAll, beforeAll, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import { COOKIE, HOST, PASSWORD, cookiesOf, testApp } from './testApp.ts';

let site: TestApp;

beforeAll(async () => {
  site = await testApp();
});

afterAll(async () => {
  await site.app.close();
});

/**
 * Sign in the way the sign-in form does.
 * @param password - the password typed
 * @param headers - extra request headers
 * @param remoteAddress - the client the request comes from
 * @param username - the username typed
 * @returns the response
 */
function signIn(
  password: string,
  headers: Record<string, string> = {},
  remoteAddress = '127.0.0.1',
  username = 'admin',
) {
  return site.app.inject({
    method: 'POST',
    url: '/v1/admin/login',
    remoteAddress,
    payload: { username, password },
    headers: { host: HOST, ...headers },
  });
}

test('each account signs in with its own password, to its own session', async () => {
  const ada = await signIn('her own password', {}, '127.0.0.1', 'Ada');
  const crossed = await signIn(PASSWORD, {}, '127.0.0.1', 'ada');
  const nobody = await signIn(PASSWORD, {}, '127.0.0.1', 'nobody');

  expect(ada.statusCode).toBe(200);
  expect(ada.json()).toStrictEqual({ signedIn: true, username: 'ada' });
  expect(ada.cookies[0]?.value).toMatch(/^2\.\d{10}\.[\da-f]{64}$/);
  expect([crossed.statusCode, nobody.statusCode]).toStrictEqual([401, 401]);
  expect(nobody.json()).toStrictEqual({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'wrong username or password',
  });

  const session = await site.app.inject({
    method: 'GET',
    url: '/v1/admin/session',
    cookies: { [COOKIE]: ada.cookies[0]?.value ?? '' },
  });
  const anonymous = await site.app.inject({
    method: 'GET',
    url: '/v1/admin/session',
  });

  expect(session.json()).toStrictEqual({ signedIn: true, username: 'ada' });
  expect(anonymous.json()).toStrictEqual({ signedIn: false, username: null });
});

test('a wrong password is refused, and logged without the password', async () => {
  const lines: string[] = [];
  const logged = await testApp({
    logger: {
      level: 'info',
      stream: {
        write(line: string) {
          lines.push(line);
        },
      },
    },
  });
  try {
    const response = await logged.app.inject({
      method: 'POST',
      url: '/v1/admin/login',
      payload: { username: 'admin', password: 'a guess at the password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.cookies).toStrictEqual([]);

    const refusal = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.msg === 'refused a sign-in');

    expect([
      refusal?.level,
      refusal?.clientIp,
      refusal?.username,
    ]).toStrictEqual([40, '127.0.0.1', 'admin']);
    expect(lines.join('\n')).not.toContain('a guess at the password');
  } finally {
    await logged.app.close();
  }
});

test('the right password opens an eight-hour session no script can read', async () => {
  const response = await signIn(PASSWORD);

  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toStrictEqual({ signedIn: true, username: 'admin' });
  expect(cookiesOf(response)).toStrictEqual([
    {
      name: COOKIE,
      value: expect.stringMatching(/^1\.\d{10}\.[\da-f]{64}$/),
      maxAge: 28_800,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
});

test('a page served over HTTPS gets a cookie sent over HTTPS only', async () => {
  const response = await signIn(
    PASSWORD,
    { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.20' },
    '192.168.1.5',
  );

  expect(response.statusCode).toBe(200);
  expect(response.cookies[0]?.secure).toBe(true);
});

test('signing in and out is taken from this site’s own pages only', async () => {
  const login = await signIn(PASSWORD, { origin: 'https://elsewhere.example' });
  const logout = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/logout',
    headers: { host: HOST, origin: 'https://elsewhere.example' },
  });

  expect(login.statusCode).toBe(403);
  expect(login.json().message).toBe(
    'signing in happens on this site’s own pages',
  );
  expect(login.cookies).toStrictEqual([]);
  expect(logout.statusCode).toBe(403);
});

test('signing out clears the cookie', async () => {
  const login = await signIn(PASSWORD);

  const response = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/logout',
    headers: { host: HOST, origin: `https://${HOST}` },
    cookies: { [COOKIE]: login.cookies[0]?.value ?? '' },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toStrictEqual({ signedIn: false, username: null });
  expect(cookiesOf(response)).toStrictEqual([
    {
      name: COOKIE,
      value: '',
      maxAge: 0,
      path: '/',
      expires: new Date(0),
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
});

test('a client guessing the password is stopped after ten attempts', async () => {
  const statuses: number[] = [];
  for (let attempt = 1; attempt <= 11; attempt++) {
    // eslint-disable-next-line no-await-in-loop -- the limit counts the attempts in order
    const response = await signIn(`guess ${attempt}`, {}, '203.0.113.77');
    statuses.push(response.statusCode);
  }

  expect(statuses).toStrictEqual([
    401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429,
  ]);

  // Another client is not held back by that one.
  const other = await signIn(PASSWORD, {}, '203.0.113.78');

  expect(other.statusCode).toBe(200);
});
