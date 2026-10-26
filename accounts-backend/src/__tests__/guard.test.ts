import type { FastifySchema } from 'fastify';
import { fastify } from 'fastify';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createServiceAccounts } from '../serviceAccounts.ts';

import type { TestApp } from './testApp.ts';
import {
  ADMIN_TOKEN,
  COOKIE,
  HOST,
  PASSWORD,
  PURPOSE,
  sessionOf,
  testApp,
} from './testApp.ts';

let site: TestApp;
let session: string;

beforeAll(async () => {
  site = await testApp();
  session = await sessionOf(site.app, 'admin', PASSWORD);
});

afterAll(async () => {
  await site.app.close();
});

test('a protected route without credentials says how to get in', async () => {
  const response = await site.app.inject({ url: '/v1/data/status' });

  expect(response.statusCode).toBe(401);
  expect(response.headers['www-authenticate']).toBe('Bearer');
  expect(response.json()).toStrictEqual({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'This is for the accounts of this site: sign in.',
    code: 'signInRequired',
  });
});

test('the operator token and a session both open it, and the route knows which', async () => {
  const token = await site.app.inject({
    url: '/v1/data/status',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  const signedIn = await site.app.inject({
    url: '/v1/data/status',
    cookies: { [COOKIE]: session },
  });

  expect(token.json()).toStrictEqual({ by: 'token' });
  expect(signedIn.json()).toStrictEqual({ by: 'admin' });
});

test('a wrong token, or a session that ended, is refused with the reason', async () => {
  const wrong = await site.app.inject({
    url: '/v1/data/status',
    headers: { authorization: 'Bearer not-the-token' },
  });
  const ended = await site.app.inject({
    url: '/v1/data/status',
    cookies: {
      [COOKIE]: `${session.slice(0, -1)}${session.endsWith('0') ? '1' : '0'}`,
    },
  });

  expect([wrong.statusCode, wrong.json().message]).toStrictEqual([
    401,
    'That is not the ADMIN_TOKEN of this server.',
  ]);
  expect([ended.statusCode, ended.json().message]).toStrictEqual([
    401,
    'The session has ended: sign in again.',
  ]);
});

test("a session changes things from this site's pages only; the token from anywhere", async () => {
  const elsewhere = await site.app.inject({
    method: 'POST',
    url: '/v1/data/refresh',
    headers: { host: HOST, origin: 'https://elsewhere.example' },
    cookies: { [COOKIE]: session },
  });
  const here = await site.app.inject({
    method: 'POST',
    url: '/v1/data/refresh',
    headers: { host: HOST, origin: `https://${HOST}` },
    cookies: { [COOKIE]: session },
  });
  const script = await site.app.inject({
    method: 'POST',
    url: '/v1/data/refresh',
    headers: {
      host: HOST,
      origin: 'https://elsewhere.example',
      authorization: `Bearer ${ADMIN_TOKEN}`,
    },
  });

  expect(elsewhere.statusCode).toBe(403);
  expect(elsewhere.json()).toStrictEqual({
    statusCode: 403,
    error: 'Forbidden',
    message: "Changes are made from this site's own pages.",
    code: 'changeElsewhere',
  });
  expect(here.json()).toStrictEqual({ refreshed: true });
  expect(script.json()).toStrictEqual({ refreshed: true });
});

test('without an operator token, a bearer token is told to sign in instead', async () => {
  const accounts = await createServiceAccounts({
    store: site.store,
    cookieName: COOKIE,
    purpose: PURPOSE,
    adminToken: '  ',
    production: false,
  });
  const app = fastify();
  await app.register(async (scope) => {
    accounts.protect(scope);
    scope.get('/status', () => ({ ok: true }));
  });
  try {
    const response = await app.inject({
      url: '/status',
      headers: { authorization: 'Bearer anything' },
    });

    expect([response.statusCode, response.json().code]).toStrictEqual([
      401,
      'noAdminToken',
    ]);
    expect(response.json().message).toBe(
      'No ADMIN_TOKEN is set on this server: sign in instead.',
    );
  } finally {
    await app.close();
  }
});

test('a protected route names both credentials, and its 401 and 403, in the OpenAPI document', async () => {
  const accounts = await createServiceAccounts({
    store: site.store,
    cookieName: COOKIE,
    purpose: PURPOSE,
    production: false,
  });
  const schemas: unknown[] = [];
  const app = fastify();
  await app.register(async (scope) => {
    accounts.protect(scope);
    // After the guard's own hook, so it reads the schema the guard wrote.
    scope.addHook('onRoute', (route) => {
      schemas.push({ method: route.method, ...route.schema });
    });
    // `summary` is typed by @fastify/swagger, which a host registers.
    const schema = { summary: 'The status' } as FastifySchema;
    scope.get('/status', { schema }, () => ({}));
  });
  await app.ready();
  await app.close();

  // Fastify marks a schema it compiled with a symbol of its own: read the
  // fields the OpenAPI document reads.
  const documented = schemas.map((schema) => {
    const { method, summary, security, response } = schema as {
      method: string;
      summary: string;
      security: unknown;
      response: Record<string, { properties: object }>;
    };
    return {
      method,
      summary,
      security,
      refusals: Object.keys(response),
      fields: Object.keys(response[401]?.properties ?? {}),
    };
  });

  // GET, and the HEAD route Fastify adds beside it.
  expect(documented).toStrictEqual(
    ['GET', 'HEAD'].map((method) => ({
      method,
      summary: 'The status',
      security: [{ accountSession: [] }, { operatorToken: [] }],
      refusals: ['401', '403'],
      fields: ['statusCode', 'error', 'message', 'code'],
    })),
  );
  expect(accounts.securitySchemes).toStrictEqual({
    accountSession: {
      type: 'apiKey',
      in: 'cookie',
      name: COOKIE,
      description:
        "The session signing in opens. A change it asks for is taken from this site's own pages only.",
    },
    operatorToken: {
      type: 'http',
      scheme: 'bearer',
      description:
        "The operator's ADMIN_TOKEN, for scripts: it acts as an administrator.",
    },
  });
});
