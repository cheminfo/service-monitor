import { afterAll, beforeEach, expect, test } from 'vitest';

import type { TestApp } from './testApp.ts';
import {
  ADMIN_TOKEN,
  PASSWORD,
  asAccount,
  sessionOf,
  testApp,
} from './testApp.ts';

let site: TestApp;
const opened: TestApp[] = [];

// A site of its own per test: each changes the accounts.
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

test('your own password changes with the current one, and this browser stays in', async () => {
  const before = await sessionOf(site.app, 'admin', PASSWORD);
  const other = await sessionOf(site.app, 'admin', PASSWORD);

  const wrong = await asAccount(
    site.app,
    before,
    'POST',
    '/v1/account/password',
    {
      currentPassword: 'not it',
      newPassword: 'the new password',
    },
  );
  const changed = await asAccount(
    site.app,
    before,
    'POST',
    '/v1/account/password',
    { currentPassword: PASSWORD, newPassword: 'the new password' },
  );
  const renewed = changed.cookies[0]?.value ?? '';
  const withToken = await site.app.inject({
    method: 'POST',
    url: '/v1/account/password',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { currentPassword: 'x', newPassword: 'y' },
  });

  expect([wrong.statusCode, wrong.json().message]).toStrictEqual([
    400,
    'The current password is not that one.',
  ]);
  expect(changed.json()).toStrictEqual({
    signedIn: true,
    username: 'admin',
    role: 'admin',
  });

  const withRenewed = await asAccount(
    site.app,
    renewed,
    'GET',
    '/v1/data/status',
  );
  const withOther = await asAccount(site.app, other, 'GET', '/v1/data/status');

  expect([withRenewed.statusCode, withOther.statusCode]).toStrictEqual([
    200, 401,
  ]);
  expect([withToken.statusCode, withToken.json().code]).toStrictEqual([
    400,
    'tokenCannotChangePassword',
  ]);
});
