import { afterAll, beforeAll, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import {
  ADMIN_TOKEN,
  BOB_PASSWORD,
  COOKIE,
  HOST,
  PASSWORD,
  sessionOf,
  testApp,
} from './testApp.ts';

let site: TestApp;
let admin: string;
let bob: string;

beforeAll(async () => {
  site = await testApp();
  admin = await sessionOf(site.app, 'admin', PASSWORD);
  bob = await sessionOf(site.app, 'bob', BOB_PASSWORD);
});

afterAll(async () => {
  await site.app.close();
});

/**
 * Ask the open route who it was asked by.
 * @param options - How to ask.
 * @param options.method - The method.
 * @param options.cookie - The session's cookie, if any.
 * @param options.token - The bearer token, if any.
 * @param options.origin - The page the request comes from, if any.
 * @returns What the route answered.
 */
async function askedBy(options: {
  method?: 'GET' | 'POST';
  cookie?: string;
  token?: string;
  origin?: string;
}): Promise<unknown> {
  const response = await site.app.inject({
    method: options.method ?? 'GET',
    url: '/v1/open',
    headers: {
      host: HOST,
      ...(options.token === undefined
        ? {}
        : { authorization: `Bearer ${options.token}` }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    cookies: options.cookie === undefined ? {} : { [COOKIE]: options.cookie },
  });

  expect(response.statusCode).toBe(200);

  return response.json();
}

test('an open route is answered to everybody, and knows who is signed in with which role', async () => {
  await expect(askedBy({})).resolves.toStrictEqual({ by: 'nobody' });
  await expect(askedBy({ cookie: admin })).resolves.toStrictEqual({
    by: 'admin',
    role: 'admin',
  });
  await expect(askedBy({ cookie: bob })).resolves.toStrictEqual({
    by: 'bob',
    role: 'read',
  });
  await expect(askedBy({ token: ADMIN_TOKEN })).resolves.toStrictEqual({
    by: 'token',
    role: 'admin',
  });
});

test('a wrong token or a session that ended counts as nobody, and is never refused', async () => {
  await expect(askedBy({ token: 'not-the-token' })).resolves.toStrictEqual({
    by: 'nobody',
  });
  await expect(askedBy({ cookie: 'forged.session' })).resolves.toStrictEqual({
    by: 'nobody',
  });
});

test('a session asking for a change from another site counts as nobody', async () => {
  await expect(
    askedBy({ method: 'POST', cookie: admin, origin: `https://${HOST}` }),
  ).resolves.toStrictEqual({ by: 'admin', role: 'admin' });
  await expect(
    askedBy({
      method: 'POST',
      cookie: admin,
      origin: 'https://elsewhere.example',
    }),
  ).resolves.toStrictEqual({ by: 'nobody' });
});
