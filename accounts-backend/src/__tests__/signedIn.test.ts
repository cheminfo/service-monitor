import { afterAll, beforeAll, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import { ADMIN_TOKEN, COOKIE, HOST, PASSWORD, testApp } from './testApp.ts';

let site: TestApp;
let session: string;

beforeAll(async () => {
  site = await testApp();
  const login = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/login',
    payload: { username: 'admin', password: PASSWORD },
  });
  session = login.cookies[0]?.value ?? '';
});

afterAll(async () => {
  await site.app.close();
});

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

test('an open route is answered to everybody, and knows who is signed in', async () => {
  await expect(askedBy({})).resolves.toStrictEqual({ by: 'nobody' });
  await expect(askedBy({ cookie: session })).resolves.toStrictEqual({
    by: 'admin',
  });
  await expect(askedBy({ token: ADMIN_TOKEN })).resolves.toStrictEqual({
    by: 'token',
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
    askedBy({ method: 'POST', cookie: session, origin: `https://${HOST}` }),
  ).resolves.toStrictEqual({ by: 'admin' });
  await expect(
    askedBy({
      method: 'POST',
      cookie: session,
      origin: 'https://elsewhere.example',
    }),
  ).resolves.toStrictEqual({ by: 'nobody' });
});
