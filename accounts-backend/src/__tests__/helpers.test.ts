import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { expect, onTestFinished, test } from 'vitest';

import { firstAccount } from '../firstAccount.ts';
import { fromHex, toHex } from '../hex.ts';
import { isSameOrigin } from '../isSameOrigin.ts';
import { sameSecret } from '../sameSecret.ts';
import { AccountStore } from '../store/AccountStore.ts';

/**
 * A request as the origin check reads it.
 * @param host - the host it was sent to
 * @param origin - the page it says it comes from, if any
 * @returns the request
 */
function requestOf(host: string, origin?: string): FastifyRequest {
  return { host, headers: { origin } } as unknown as FastifyRequest;
}

test('bytes go to hexadecimal and back, and anything else is refused', () => {
  const bytes = new Uint8Array([0, 15, 16, 255]);

  expect(toHex(bytes)).toBe('000f10ff');
  expect(fromHex('000F10ff')).toStrictEqual(bytes);
  expect(fromHex('')).toStrictEqual(new Uint8Array(0));
  expect(() => fromHex('abc')).toThrow('that is not hexadecimal');
  expect(() => fromHex('zz')).toThrow('that is not hexadecimal');
});

test('a request from no page, or from this site, is its own; any other is not', () => {
  expect([
    isSameOrigin(requestOf('chembio.cheminfo.org')),
    isSameOrigin(
      requestOf('chembio.cheminfo.org', 'https://chembio.cheminfo.org'),
    ),
    isSameOrigin(requestOf('chembio.cheminfo.org', 'https://elsewhere.org')),
    isSameOrigin(requestOf('chembio.cheminfo.org', 'not an address')),
  ]).toStrictEqual([true, true, false, false]);
});

test('two secrets are the same only when every character is', async () => {
  expect([
    await sameSecret('a token', 'a token'),
    await sameSecret('a token', 'a tokeN'),
    await sameSecret('a token', 'a token and more'),
    await sameSecret('a token', ''),
  ]).toStrictEqual([true, false, false, false]);
});

test('a store file that cannot be migrated is closed again and the error thrown', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'service-accounts-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'accounts.sqlite');
  // A table of the store's name, but of another shape: its migration fails.
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE accounts (other TEXT)');
  database.close();

  await expect(AccountStore.open(path)).rejects.toThrow(
    'table accounts already exists',
  );

  const reopened = new DatabaseSync(path);
  onTestFinished(() => reopened.close());

  expect(
    reopened
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  ).toStrictEqual(['accounts']);
});

test('a blank ADMIN_USERNAME is the default one', async () => {
  const store = await AccountStore.open(':memory:');
  onTestFinished(() => store.close());
  const log = { info: () => undefined } as unknown as FastifyBaseLogger;

  const created = await firstAccount(store, log, {
    ADMIN_USERNAME: ' '.repeat(3),
    ADMIN_PASSWORD: 'a password',
  });

  expect(created?.username).toBe('admin');
});
