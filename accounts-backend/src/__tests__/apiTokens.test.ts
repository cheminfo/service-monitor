import { fastify } from 'fastify';
import { expect, onTestFinished, test } from 'vitest';

import { createServiceAccounts } from '../serviceAccounts.ts';
import type { ServiceAccountsOptions } from '../serviceAccountsTypes.ts';
import type { AccountRow } from '../store/accountRows.ts';

import { contactDirectory } from './contactDirectory.ts';
import { sharedPasswordApp } from './sharedPasswordApp.ts';
import type { TestApp } from './testApp.ts';
import {
  ADMIN_TOKEN,
  COOKIE,
  HOST,
  PURPOSE,
  outcomes,
  testApp,
} from './testApp.ts';

/** The API tokens of the test site's host, by the username each stands for. */
const TOKENS = new Map([
  ['ada-api-token', 'ada'],
  ['bob-api-token', 'bob'],
  // A host whose table also happens to hold the operator's token.
  [ADMIN_TOKEN, 'bob'],
]);

/**
 * The test site, its accounts' API tokens looked up in {@link TOKENS}.
 * @param accounts - Options of `createServiceAccounts` to change.
 * @returns The site, and the tokens the lookup was asked about.
 */
async function tokenSite(accounts: Partial<ServiceAccountsOptions> = {}) {
  const asked: string[] = [];
  const holder: { site?: TestApp } = {};
  const site = await testApp({
    accounts: {
      verifyToken: (token): AccountRow | undefined => {
        asked.push(token);
        const username = TOKENS.get(token);
        return username === undefined
          ? undefined
          : holder.site?.store.byUsername(username);
      },
      ...accounts,
    },
  });
  holder.site = site;
  onTestFinished(() => site.app.close());
  return { app: site.app, asked };
}

test('a bearer token is its account, at its role, from anywhere', async () => {
  const { app } = await tokenSite();
  const as = (token: string, method: 'GET' | 'POST' | 'DELETE', url: string) =>
    app.inject({
      method,
      url,
      headers: {
        host: HOST,
        origin: 'https://elsewhere.example',
        authorization: `Bearer ${token}`,
      },
    });

  const responses = [
    await as('ada-api-token', 'GET', '/v1/data/status'),
    await as('ada-api-token', 'POST', '/v1/data/samples'),
    await as('ada-api-token', 'DELETE', '/v1/data/samples'),
    await as('bob-api-token', 'GET', '/v1/admin/system'),
    await as('ada-api-token', 'GET', '/v1/open'),
  ];

  expect(outcomes(responses)).toStrictEqual([
    [200, undefined],
    [200, undefined],
    [403, 'roleTooLow'],
    [403, 'roleTooLow'],
    [200, undefined],
  ]);
  expect(responses[0]?.json()).toStrictEqual({ by: 'ada' });
  expect(responses[1]?.json()).toStrictEqual({ written: true });
  expect(responses[4]?.json()).toStrictEqual({ by: 'ada', role: 'write' });
});

test('?token= is a token when the host takes it, and is ignored when not', async () => {
  const taken = await tokenSite({ tokenQueryParameter: true });
  const ignored = await tokenSite();

  const responses = [
    await taken.app.inject({ url: '/v1/data/status?token=bob-api-token' }),
    await taken.app.inject({ url: '/v1/open?token=ada-api-token' }),
    await taken.app.inject({
      url: '/v1/data/status?token=bob-api-token',
      headers: { authorization: 'Bearer ada-api-token' },
    }),
    await ignored.app.inject({ url: '/v1/data/status?token=bob-api-token' }),
    await ignored.app.inject({ url: '/v1/open?token=ada-api-token' }),
  ];

  expect(responses.map((response) => response.json())).toStrictEqual([
    { by: 'bob' },
    { by: 'ada', role: 'write' },
    { by: 'ada' },
    {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'This is for the accounts of this site: sign in.',
      code: 'signInRequired',
    },
    { by: 'nobody' },
  ]);
  expect(ignored.asked).toStrictEqual([]);
});

test('a token nobody has is refused, with or without an ADMIN_TOKEN set', async () => {
  const withAdminToken = await tokenSite({ tokenQueryParameter: true });
  const withoutAdminToken = await tokenSite({ adminToken: undefined });

  const responses = [
    await withAdminToken.app.inject({
      url: '/v1/data/status',
      headers: { authorization: 'Bearer not-a-token' },
    }),
    await withAdminToken.app.inject({ url: '/v1/data/status?token=nope' }),
    await withoutAdminToken.app.inject({
      url: '/v1/data/status',
      headers: { authorization: 'Bearer not-a-token' },
    }),
  ];

  expect(outcomes(responses)).toStrictEqual([
    [401, 'wrongToken'],
    [401, 'wrongToken'],
    [401, 'wrongToken'],
  ]);
  expect(
    responses.map((response) => response.headers['www-authenticate']),
  ).toStrictEqual(['Bearer', 'Bearer', 'Bearer']);
  expect(withAdminToken.asked).toStrictEqual(['not-a-token', 'nope']);
});

test('the ADMIN_TOKEN comes first, and keeps its meaning', async () => {
  const { app, asked } = await tokenSite({ tokenQueryParameter: true });

  const responses = [
    await app.inject({
      url: '/v1/data/status',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    }),
    await app.inject({ url: `/v1/data/status?token=${ADMIN_TOKEN}` }),
    await app.inject({
      url: '/v1/open',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    }),
  ];

  expect(responses.map((response) => response.json())).toStrictEqual([
    { by: 'token' },
    { by: 'token' },
    { by: 'token', role: 'admin' },
  ]);
  expect(asked).toStrictEqual([]);
});

test('the shared password takes the ADMIN_TOKEN from ?token= too', async () => {
  const { app } = await sharedPasswordApp({
    access: { tokenQueryParameter: true },
  });
  onTestFinished(() => app.close());

  const response = await app.inject({
    url: `/v1/admin/system?token=${ADMIN_TOKEN}`,
  });

  expect(response.json()).toStrictEqual({ system: 'ok' });
});

test('the OpenAPI document names the tokens a site takes', async () => {
  const accounts = await createServiceAccounts({
    store: contactDirectory(),
    cookieName: COOKIE,
    purpose: PURPOSE,
    production: false,
    verifyToken: () => undefined,
    tokenQueryParameter: true,
  });
  const security: unknown[] = [];
  const app = fastify();
  await app.register(async (scope) => {
    accounts.protect(scope);
    scope.addHook('onRoute', (route) => {
      security.push((route.schema as { security?: unknown }).security);
    });
    scope.post('/samples', () => ({}));
  });
  await app.ready();
  await app.close();

  expect(security).toStrictEqual([
    [
      { accountSession: [] },
      { operatorToken: [] },
      { accountToken: [] },
      { queryToken: [] },
    ],
  ]);
  expect(Object.keys(accounts.securitySchemes)).toStrictEqual([
    'accountSession',
    'operatorToken',
    'accountToken',
    'queryToken',
  ]);
  expect(accounts.securitySchemes.accountToken).toStrictEqual({
    type: 'http',
    scheme: 'bearer',
    description:
      "An account's API token, for its scripts: it acts as that account, with its role.",
  });
  expect(accounts.securitySchemes.queryToken).toStrictEqual({
    type: 'apiKey',
    in: 'query',
    name: 'token',
    description:
      'Any token above, as `?token=`, for a client that cannot send a header. It is written in the access logs.',
  });
});
