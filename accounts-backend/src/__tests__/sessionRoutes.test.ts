import { afterAll, beforeAll, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import {
  ADA_PASSWORD,
  COOKIE,
  HOST,
  PASSWORD,
  cookiesOf,
  testApp,
} from './testApp.ts';

let site: TestApp;

beforeAll(async () => {
  site = await testApp();
});

afterAll(async () => {
  await site.app.close();
});

/**
 * Sign in the way the sign-in form does.
 * @param password - The password typed.
 * @param headers - Extra request headers.
 * @param remoteAddress - The client the request comes from.
 * @param username - The username typed.
 * @returns The response.
 */
function signIn(
  password: string,
  headers: Record<string, string> = {},
  remoteAddress = '127.0.0.1',
  username = 'admin',
) {
  return site.app.inject({
    method: 'POST',
    url: '/v1/account/login',
    remoteAddress,
    payload: { username, password },
    headers: { host: HOST, ...headers },
  });
}

test('each account signs in with its own password, to its own session', async () => {
  const ada = await signIn(ADA_PASSWORD, {}, '127.0.0.1', 'Ada');
  const crossed = await signIn(PASSWORD, {}, '127.0.0.1', 'ada');
  const nobody = await signIn(PASSWORD, {}, '127.0.0.1', 'nobody');

  expect(ada.statusCode).toBe(200);
  expect(ada.json()).toStrictEqual({
    signedIn: true,
    username: 'ada',
    role: 'write',
  });
  expect(ada.cookies[0]?.value).toMatch(/^2\.\d{10}\.[\da-f]{64}$/);
  expect([crossed.statusCode, nobody.statusCode]).toStrictEqual([401, 401]);
  expect(nobody.json()).toStrictEqual({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Wrong username or password.',
    code: 'wrongCredentials',
  });

  const session = await site.app.inject({
    method: 'GET',
    url: '/v1/account/session',
    cookies: { [COOKIE]: ada.cookies[0]?.value ?? '' },
  });
  const anonymous = await site.app.inject({
    method: 'GET',
    url: '/v1/account/session',
  });

  expect(session.json()).toStrictEqual({
    signedIn: true,
    username: 'ada',
    role: 'write',
  });
  expect(session.headers['cache-control']).toBe('no-store');
  expect(session.cookies).toStrictEqual([]);
  expect(anonymous.json()).toStrictEqual({
    signedIn: false,
    username: null,
    role: null,
  });
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
      url: '/v1/account/login',
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

test('the right password opens a 400-day session no script can read', async () => {
  const response = await signIn(PASSWORD);

  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toStrictEqual({
    signedIn: true,
    username: 'admin',
    role: 'admin',
  });
  expect(cookiesOf(response)).toStrictEqual([
    {
      name: COOKIE,
      value: expect.stringMatching(/^1\.\d{10}\.[\da-f]{64}$/),
      maxAge: 34_560_000,
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
  const untrusted = await signIn(
    PASSWORD,
    { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.21' },
    '203.0.113.99',
  );

  expect(response.statusCode).toBe(200);
  expect(response.cookies[0]?.secure).toBe(true);
  expect(untrusted.cookies[0]?.secure).toBeUndefined();
});

test("signing in and out is taken from this site's own pages only", async () => {
  const login = await signIn(PASSWORD, { origin: 'https://elsewhere.example' });
  const logout = await site.app.inject({
    method: 'POST',
    url: '/v1/account/logout',
    headers: { host: HOST, origin: 'https://elsewhere.example' },
  });

  expect(login.statusCode).toBe(403);
  expect(login.json()).toStrictEqual({
    statusCode: 403,
    error: 'Forbidden',
    message: "Signing in happens on this site's own pages.",
    code: 'signInElsewhere',
  });
  expect(login.cookies).toStrictEqual([]);
  expect([logout.statusCode, logout.json().code]).toStrictEqual([
    403,
    'signOutElsewhere',
  ]);
});

test('signing out clears the cookie', async () => {
  const login = await signIn(PASSWORD);

  const response = await site.app.inject({
    method: 'POST',
    url: '/v1/account/logout',
    headers: { host: HOST, origin: `https://${HOST}` },
    cookies: { [COOKIE]: login.cookies[0]?.value ?? '' },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toStrictEqual({
    signedIn: false,
    username: null,
    role: null,
  });
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
  let last;
  for (let attempt = 1; attempt <= 11; attempt++) {
    // eslint-disable-next-line no-await-in-loop -- the limit counts the attempts in order
    last = await signIn(`guess ${attempt}`, {}, '203.0.113.77');
    statuses.push(last.statusCode);
  }

  expect(statuses).toStrictEqual([
    401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429,
  ]);
  expect(last?.json()).toStrictEqual({
    statusCode: 429,
    code: 'tooManyAttempts',
    error: 'Too Many Requests',
    message: 'Too many sign-ins from here. Try again in 15 minutes.',
  });

  // Another client is not held back by that one.
  const other = await signIn(PASSWORD, {}, '203.0.113.78');

  expect(other.statusCode).toBe(200);
});
