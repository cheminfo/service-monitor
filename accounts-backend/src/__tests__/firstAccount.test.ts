import type { FastifyBaseLogger } from 'fastify';
import { expect, test } from 'vitest';

import { firstAccount } from '../firstAccount.ts';
import { verifyPassword } from '../password.ts';
import { AccountStore } from '../store/AccountStore.ts';

/**
 * A logger that keeps what it was told.
 * @returns the logger, and the lines as `[level, message, context]`
 */
function recorder() {
  const lines: Array<[string, string, unknown]> = [];
  const keep = (level: string) => (context: unknown, message: string) => {
    lines.push([level, message, context]);
  };
  const log = {
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  } as unknown as FastifyBaseLogger;
  return { log, lines };
}

test('the first account takes ADMIN_USERNAME and ADMIN_PASSWORD, once', async () => {
  const store = await AccountStore.open(':memory:');
  const { log, lines } = recorder();

  const created = await firstAccount(store, log, {
    ADMIN_USERNAME: ' Luc ',
    ADMIN_PASSWORD: 'the first password',
  });
  const again = await firstAccount(store, log, {
    ADMIN_USERNAME: 'other',
    ADMIN_PASSWORD: 'another password',
  });

  expect(created).toStrictEqual({
    id: 1,
    username: 'luc',
    createdAt: expect.any(Number),
    passwordChangedAt: created?.createdAt,
    lastSignInAt: null,
  });
  expect(again).toBeNull();
  await expect(
    verifyPassword('the first password', store.byId(1)?.passwordHash ?? ''),
  ).resolves.toBe(true);
  expect(lines).toStrictEqual([
    ['info', 'created the first account', { username: 'luc' }],
  ]);
});

test('without ADMIN_PASSWORD no account is made, and the log says what to do', async () => {
  const store = await AccountStore.open(':memory:');
  const { log, lines } = recorder();

  const created = await firstAccount(store, log, { ADMIN_PASSWORD: '' });

  expect(created).toBeNull();
  expect(store.count()).toBe(0);
  expect(lines).toStrictEqual([
    [
      'warn',
      'no account can sign in: set ADMIN_PASSWORD and restart to create the first one',
      { username: 'admin' },
    ],
  ]);
});

test('an unusable ADMIN_USERNAME stops the start, naming the variable', async () => {
  const store = await AccountStore.open(':memory:');
  const { log } = recorder();

  await expect(
    firstAccount(store, log, {
      ADMIN_USERNAME: 'luc patiny',
      ADMIN_PASSWORD: 'a password',
    }),
  ).rejects.toThrow(
    'ADMIN_USERNAME or ADMIN_PASSWORD: a username holds letters, digits, dots, dashes and underscores, and starts with a letter or a digit',
  );
});
