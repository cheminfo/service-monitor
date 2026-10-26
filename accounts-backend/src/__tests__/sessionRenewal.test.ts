import { afterEach, expect, onTestFinished, test, vi } from 'vitest';

import { COOKIE, PASSWORD, cookiesOf, sessionOf, testApp } from './testApp.ts';

/** 2026-10-02T12:00:00Z. */
const SIGNED_IN_AT = Date.UTC(2026, 9, 2, 12);
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Ask where the browser stands, `days` after it signed in.
 * @param days - How long after the sign-in.
 * @returns The answer.
 */
async function sessionAfter(days: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SIGNED_IN_AT);
  const site = await testApp();
  onTestFinished(() => site.app.close());
  const cookie = await sessionOf(site.app, 'admin', PASSWORD);
  vi.setSystemTime(SIGNED_IN_AT + days * DAY);
  return site.app.inject({
    url: '/v1/account/session',
    cookies: { [COOKIE]: cookie },
  });
}

test('a session signed in today is answered as it is, with no new cookie', async () => {
  const response = await sessionAfter(0.5);

  expect(response.json()).toStrictEqual({
    signedIn: true,
    username: 'admin',
    role: 'admin',
  });
  expect(response.cookies).toStrictEqual([]);
});

test('a session more than a day old comes back with a cookie valid 400 days from now', async () => {
  const response = await sessionAfter(2);
  const expiresAt = (SIGNED_IN_AT + 2 * DAY) / 1000 + 34_560_000;

  expect(response.json()).toStrictEqual({
    signedIn: true,
    username: 'admin',
    role: 'admin',
  });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(cookiesOf(response)).toStrictEqual([
    {
      name: COOKIE,
      value: expect.stringMatching(new RegExp(String.raw`^1\.${expiresAt}\.`)),
      maxAge: 34_560_000,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
});

test('a session 399 days old is still renewed; one 401 days old has ended', async () => {
  const renewed = await sessionAfter(399);
  const ended = await sessionAfter(401);

  expect(renewed.cookies).toHaveLength(1);
  expect(ended.json()).toStrictEqual({
    signedIn: false,
    username: null,
    role: null,
  });
  expect(ended.cookies).toStrictEqual([]);
});
