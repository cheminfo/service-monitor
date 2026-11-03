import { expect, onTestFinished, test } from 'vitest';

import { verifyPassword } from '../password.ts';
import type { ServiceAccountsOptions } from '../serviceAccountsTypes.ts';

import { COOKIE, outcomes, testApp } from './testApp.ts';

/** 2026-10-02T12:00:00Z, in unix seconds. */
const NOW = Date.UTC(2026, 9, 2, 12) / 1000;

/** Carol's password, and the hash the host kept of it before the package. */
const CAROL_PASSWORD = 'her old password';
const LEGACY_HASH = `legacy:${CAROL_PASSWORD}`;

/**
 * The test site, with carol (write, id 4) kept under a hash of the host's
 * former format, `legacy:<password>`.
 * @param accounts - Options of `createServiceAccounts` to change.
 * @returns The site, and the hashes the legacy check was asked about.
 */
async function legacySite(accounts: Partial<ServiceAccountsOptions> = {}) {
  const site = await testApp({ accounts });
  onTestFinished(() => site.app.close());
  site.store.insert({
    username: 'carol',
    passwordHash: LEGACY_HASH,
    role: 'write',
    createdAt: NOW,
  });
  return site;
}

/**
 * Check a password against a hash of the former format, keeping what it was
 * asked.
 * @returns The check, and the hashes it was asked about.
 */
function legacyCheck() {
  const asked: string[] = [];
  return {
    asked,
    verifyLegacyHash: (password: string, hash: string) => {
      asked.push(hash);
      return hash === `legacy:${password}`;
    },
  };
}

test('a legacy hash signs in once, and is replaced by the package hash', async () => {
  const { asked, verifyLegacyHash } = legacyCheck();
  const { app, store } = await legacySite({ verifyLegacyHash });
  const signIn = (password: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/account/login',
      payload: { username: 'carol', password },
    });

  const wrong = await signIn('not hers');

  expect(store.byId(4)?.passwordHash).toBe(LEGACY_HASH);

  const first = await signIn(CAROL_PASSWORD);
  const stored = store.byId(4);
  const session = await app.inject({
    url: '/v1/account/session',
    cookies: { [COOKIE]: first.cookies[0]?.value ?? '' },
  });
  const second = await signIn(CAROL_PASSWORD);

  expect(outcomes([wrong, first, second])).toStrictEqual([
    [401, 'wrongCredentials'],
    [200, undefined],
    [200, undefined],
  ]);
  expect(stored?.passwordHash).toMatch(/^pbkdf2\$sha512\$210000\$/);
  await expect(
    verifyPassword(CAROL_PASSWORD, stored?.passwordHash ?? ''),
  ).resolves.toBe(true);
  // The password itself did not change.
  expect(stored?.passwordChangedAt).toBe(NOW);
  expect(session.json()).toStrictEqual({
    signedIn: true,
    username: 'carol',
    role: 'write',
  });
  expect(asked).toStrictEqual([LEGACY_HASH, LEGACY_HASH]);
});

test('without verifyLegacyHash, a legacy hash never signs in', async () => {
  const { app, store } = await legacySite();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/account/login',
    payload: { username: 'carol', password: CAROL_PASSWORD },
  });

  expect(outcomes([response])).toStrictEqual([[401, 'wrongCredentials']]);
  expect(store.byId(4)?.passwordHash).toBe(LEGACY_HASH);
});

test('the current password of POST /password is checked against a legacy hash', async () => {
  const { asked, verifyLegacyHash } = legacyCheck();
  const site = await legacySite({
    verifyLegacyHash,
    // carol has not signed in since, so her hash is still the old one.
    verifyToken: (token) =>
      token === 'carol-api-token' ? site.store.byId(4) : undefined,
  });
  const change = (currentPassword: string) =>
    site.app.inject({
      method: 'POST',
      url: '/v1/account/password',
      headers: { authorization: 'Bearer carol-api-token' },
      payload: { currentPassword, newPassword: 'her new password' },
    });

  const wrong = await change('not hers');
  const changed = await change(CAROL_PASSWORD);

  expect(outcomes([wrong, changed])).toStrictEqual([
    [400, 'wrongCurrentPassword'],
    [200, undefined],
  ]);
  await expect(
    verifyPassword('her new password', site.store.byId(4)?.passwordHash ?? ''),
  ).resolves.toBe(true);
  expect(asked).toStrictEqual([LEGACY_HASH, LEGACY_HASH]);
});
