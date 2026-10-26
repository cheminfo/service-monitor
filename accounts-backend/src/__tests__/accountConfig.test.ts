import Fastify from 'fastify';
import { expect, onTestFinished, test } from 'vitest';

import { readAccountConfig } from '../accountConfig.ts';
import { createServiceAccounts } from '../serviceAccounts.ts';
import { AccountStore } from '../store/AccountStore.ts';

import { COOKIE, PURPOSE } from './testApp.ts';

/**
 * The warnings a server logs once the accounts' routes are registered twice.
 * @param cookieSecret - the key sessions are signed with, if any
 * @returns their messages
 */
async function warningsOf(cookieSecret?: string): Promise<unknown[]> {
  const store = await AccountStore.open(':memory:');
  const lines: string[] = [];
  const accounts = await createServiceAccounts({
    store,
    cookieName: COOKIE,
    purpose: PURPOSE,
    cookieSecret,
    production: false,
  });
  const app = Fastify({
    logger: {
      level: 'warn',
      stream: {
        write(line: string) {
          lines.push(line);
        },
      },
    },
  });
  await app.register(accounts.routes, { prefix: '/v1/account' });
  await app.register(accounts.routes, { prefix: '/v1/admin' });
  await app.ready();
  onTestFinished(() => app.close());
  return lines.map((line) => (JSON.parse(line) as { msg: unknown }).msg);
}

test('the settings come from the environment, blank meaning unset', () => {
  expect(
    readAccountConfig({
      COOKIE_SECRET: ' a secret ',
      ADMIN_TOKEN: ' ',
      ADMIN_SIGN_IN_LIMIT: '5',
      NODE_ENV: 'production',
    }),
  ).toStrictEqual({
    cookieSecret: 'a secret',
    adminToken: undefined,
    signInLimit: 5,
    production: true,
  });
  expect(readAccountConfig({})).toStrictEqual({
    cookieSecret: undefined,
    adminToken: undefined,
    signInLimit: 10,
    production: false,
  });
  expect(readAccountConfig({ ADMIN_SIGN_IN_LIMIT: '  ' }).signInLimit).toBe(10);
  expect(() => readAccountConfig({ ADMIN_SIGN_IN_LIMIT: 'ten' })).toThrow(
    'ADMIN_SIGN_IN_LIMIT is "ten": set it to a whole number of at least 1, or leave it unset for 10.',
  );
  expect(() => readAccountConfig({ ADMIN_SIGN_IN_LIMIT: '0' })).toThrow(
    'ADMIN_SIGN_IN_LIMIT is "0": set it to a whole number of at least 1, or leave it unset for 10.',
  );
  expect(() => readAccountConfig({ ADMIN_SIGN_IN_LIMIT: '2.5' })).toThrow(
    'ADMIN_SIGN_IN_LIMIT is "2.5": set it to a whole number of at least 1, or leave it unset for 10.',
  );
});

test('in production the accounts refuse to start without COOKIE_SECRET, saying how to set it', async () => {
  const store = await AccountStore.open(':memory:');

  await expect(
    createServiceAccounts({
      store,
      cookieName: COOKIE,
      purpose: PURPOSE,
      cookieSecret: '  ',
      production: true,
    }),
  ).rejects.toThrow(
    'COOKIE_SECRET is unset, and in production every restart would then sign everybody out. Set it in .env to the output of `openssl rand -hex 32`, then restart.',
  );
  await expect(
    createServiceAccounts({
      store,
      cookieName: COOKIE,
      purpose: PURPOSE,
      cookieSecret: 'set',
      production: true,
    }),
  ).resolves.toMatchObject({
    securitySchemes: { accountSession: { in: 'cookie', name: COOKIE } },
  });
});

test('outside production, without COOKIE_SECRET, a random key signs the sessions and the log says so once', async () => {
  await expect(warningsOf()).resolves.toStrictEqual([
    'COOKIE_SECRET is unset: a random key signs the sessions, so a restart signs everybody out',
  ]);
  await expect(warningsOf('a secret')).resolves.toStrictEqual([]);
});
