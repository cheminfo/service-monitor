import { fastify } from 'fastify';
import { afterAll, beforeEach, expect, test } from 'vitest';

import { createServiceAccounts } from '../serviceAccounts.ts';

import type { TestApp } from './testApp.ts';
import {
  ADA_PASSWORD,
  PASSWORD,
  asAccount,
  outcomes,
  sessionOf,
  testApp,
} from './testApp.ts';

let site: TestApp;
const opened: TestApp[] = [];

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

test('your own role is not yours to change, and an empty change is refused', async () => {
  const admin = await sessionOf(site.app, 'admin', PASSWORD);

  const own = await asAccount(site.app, admin, 'PATCH', '/v1/account/users/1', {
    role: 'read',
  });
  const nothing = await asAccount(
    site.app,
    admin,
    'PATCH',
    '/v1/account/users/3',
    {},
  );
  const badPassword = await asAccount(
    site.app,
    admin,
    'PATCH',
    '/v1/account/users/3',
    { role: 'admin', password: '' },
  );

  expect(outcomes([own, nothing])).toStrictEqual([
    [400, 'ownRole'],
    [400, 'nothingToChange'],
  ]);
  // Refused by the schema before anything is written: the role is unchanged.
  expect(badPassword.statusCode).toBe(400);
  expect(site.store.byId(3)?.role).toBe('read');
});

test('the account the .env defines is never removed, demoted or given a password here', async () => {
  site.store.writeEnvAdmin({
    username: 'admin',
    passwordHash: site.store.byId(1)?.passwordHash ?? '',
    at: 1_790_000_000,
  });
  await asAccount(
    site.app,
    await sessionOf(site.app, 'admin', PASSWORD),
    'PATCH',
    '/v1/account/users/2',
    { role: 'admin' },
  );
  const ada = await sessionOf(site.app, 'ada', ADA_PASSWORD);
  const admin = await sessionOf(site.app, 'admin', PASSWORD);

  const responses = [
    await asAccount(site.app, ada, 'DELETE', '/v1/account/users/1'),
    await asAccount(site.app, ada, 'PATCH', '/v1/account/users/1', {
      role: 'read',
    }),
    await asAccount(site.app, ada, 'PATCH', '/v1/account/users/1', {
      password: 'taken over',
    }),
    await asAccount(site.app, admin, 'POST', '/v1/account/password', {
      currentPassword: PASSWORD,
      newPassword: 'changed here',
    }),
  ];

  expect(outcomes(responses)).toStrictEqual([
    [400, 'envManaged'],
    [400, 'envManaged'],
    [400, 'envManaged'],
    [400, 'envManaged'],
  ]);
  expect(responses[0]?.json().message).toBe(
    "The server's .env defines this account, so it is changed there.",
  );
  expect([
    site.store.byId(1)?.role,
    site.store.byId(1)?.envManaged,
  ]).toStrictEqual(['admin', true]);
  await expect(sessionOf(site.app, 'admin', PASSWORD)).resolves.toMatch(/^1\./);
});

test('a protected scope refuses a role that is none', async () => {
  const accounts = await createServiceAccounts({
    store: site.store,
    cookieName: 'x',
    purpose: 'x',
    production: false,
  });

  expect(() => {
    accounts.protect(fastify(), { role: 'owner' as 'admin' });
  }).toThrow('protect: "owner" is no role: read, write or admin');
});
