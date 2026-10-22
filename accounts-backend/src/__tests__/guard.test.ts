import Fastify from 'fastify';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createServiceAccounts } from '../serviceAccounts.ts';

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

test('a protected route without credentials says how to get in', async () => {
  const response = await site.app.inject({ url: '/v1/admin/status' });

  expect(response.statusCode).toBe(401);
  expect(response.headers['www-authenticate']).toBe('Bearer');
  expect(response.json()).toStrictEqual({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'this page is for the operator: sign in',
  });
});

test('the operator token and a session both open it, and the route knows which', async () => {
  const token = await site.app.inject({
    url: '/v1/admin/status',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  const signedIn = await site.app.inject({
    url: '/v1/admin/status',
    cookies: { [COOKIE]: session },
  });

  expect(token.json()).toStrictEqual({ by: 'token' });
  expect(signedIn.json()).toStrictEqual({ by: 'admin' });
});

test('a wrong token, or a session that ended, is refused with the reason', async () => {
  const wrong = await site.app.inject({
    url: '/v1/admin/status',
    headers: { authorization: 'Bearer not-the-token' },
  });
  const ended = await site.app.inject({
    url: '/v1/admin/status',
    cookies: {
      [COOKIE]: `${session.slice(0, -1)}${session.endsWith('0') ? '1' : '0'}`,
    },
  });

  expect([wrong.statusCode, wrong.json().message]).toStrictEqual([
    401,
    'that is not the operator token',
  ]);
  expect([ended.statusCode, ended.json().message]).toStrictEqual([
    401,
    'the session has ended: sign in again',
  ]);
});

test('a session changes things from this site’s pages only; the token from anywhere', async () => {
  const elsewhere = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/refresh',
    headers: { host: HOST, origin: 'https://elsewhere.example' },
    cookies: { [COOKIE]: session },
  });
  const here = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/refresh',
    headers: { host: HOST, origin: `https://${HOST}` },
    cookies: { [COOKIE]: session },
  });
  const script = await site.app.inject({
    method: 'POST',
    url: '/v1/admin/refresh',
    headers: {
      host: HOST,
      origin: 'https://elsewhere.example',
      authorization: `Bearer ${ADMIN_TOKEN}`,
    },
  });

  expect(elsewhere.statusCode).toBe(403);
  expect(elsewhere.json().message).toBe(
    'the operator changes things from this site’s own pages',
  );
  expect(here.json()).toStrictEqual({ refreshed: true });
  expect(script.json()).toStrictEqual({ refreshed: true });
});

test('without an operator token, a bearer token is told to sign in instead', async () => {
  const accounts = await createServiceAccounts({
    store: site.store,
    cookieName: COOKIE,
    purpose: 'test.cheminfo.org operator session',
    adminToken: '  ',
  });
  const app = Fastify();
  await app.register(async (scope) => {
    accounts.protect(scope);
    scope.get('/status', () => ({ ok: true }));
  });
  try {
    const response = await app.inject({
      url: '/status',
      headers: { authorization: 'Bearer anything' },
    });

    expect([response.statusCode, response.json().message]).toStrictEqual([
      401,
      'no operator token is set on this server: sign in instead',
    ]);
  } finally {
    await app.close();
  }
});
