import { expect, test } from 'vitest';

import {
  AccountError,
  checkSignIn,
  createAccount,
  ensureFirstAccount,
  removeAccount,
  setAccountPassword,
  usernameProblem,
} from '../accounts.ts';
import { verifyPassword } from '../password.ts';
import { AccountStore } from '../store/AccountStore.ts';

/** 2026-10-02T12:00:00Z, in unix seconds. */
const NOW = Date.UTC(2026, 9, 2, 12) / 1000;

test('the first account is created once, and never over another', async () => {
  const db = await AccountStore.open(':memory:');

  const first = await ensureFirstAccount(
    db,
    { username: ' Admin ', password: 'lpc' },
    NOW,
  );
  const second = await ensureFirstAccount(
    db,
    { username: 'other', password: 'something' },
    NOW + 60,
  );

  expect(first).toStrictEqual({
    id: 1,
    username: 'admin',
    passwordHash: expect.stringMatching(/^pbkdf2\$sha512\$210000\$/),
    createdAt: NOW,
    passwordChangedAt: NOW,
    lastSignInAt: null,
  });
  await expect(verifyPassword('lpc', first?.passwordHash ?? '')).resolves.toBe(
    true,
  );
  expect(second).toBeNull();
  expect(db.all().map((account) => account.username)).toStrictEqual(['admin']);
});

test('a username is three to thirty plain characters, in any case', async () => {
  const db = await AccountStore.open(':memory:');

  expect(usernameProblem('lpc')).toBeNull();
  expect(usernameProblem('luc.patiny-2_x')).toBeNull();
  expect(usernameProblem('lp')).toBe('a username has 3 to 30 characters');
  expect(usernameProblem('l'.repeat(31))).toBe(
    'a username has 3 to 30 characters',
  );
  expect(usernameProblem('luc patiny')).toBe(
    'a username holds letters, digits, dots, dashes and underscores, and starts with a letter or a digit',
  );
  expect(usernameProblem('.luc')).not.toBeNull();
  expect(usernameProblem('luc@epfl.ch')).not.toBeNull();

  await createAccount(db, { username: 'Luc', password: 'one' }, NOW);

  await expect(
    createAccount(db, { username: 'LUC', password: 'two' }, NOW),
  ).rejects.toThrow(new AccountError('there is already an account named luc'));
  await expect(
    createAccount(db, { username: 'ada', password: '' }, NOW),
  ).rejects.toThrow(new AccountError('a password cannot be empty'));
  await expect(
    ensureFirstAccount(db, { username: 'x', password: 'lpc' }, NOW),
  ).resolves.toBeNull();
});

test('only the right pair signs in, whatever the case of the username', async () => {
  const db = await AccountStore.open(':memory:');
  const luc = await createAccount(
    db,
    { username: 'luc', password: 'a password' },
    NOW,
  );

  const signedIn = await checkSignIn(db, ' LUC ', 'a password', NOW + 10);
  const wrongPassword = await checkSignIn(db, 'luc', 'a Password', NOW + 20);
  const nobody = await checkSignIn(db, 'ada', 'a password', NOW + 30);

  expect(signedIn).toStrictEqual({ ...luc, lastSignInAt: NOW + 10 });
  expect(wrongPassword).toBeNull();
  expect(nobody).toBeNull();
  expect(db.byId(luc.id)?.lastSignInAt).toBe(NOW + 10);
});

test('a new password replaces the old one', async () => {
  const db = await AccountStore.open(':memory:');
  const luc = await createAccount(
    db,
    { username: 'luc', password: 'old' },
    NOW,
  );

  const changed = await setAccountPassword(db, luc.id, 'new', NOW + 60);
  const missing = await setAccountPassword(db, 99, 'new', NOW + 60);

  expect(changed?.passwordChangedAt).toBe(NOW + 60);
  expect(changed?.passwordHash).not.toBe(luc.passwordHash);
  expect(missing).toBeUndefined();
  await expect(checkSignIn(db, 'luc', 'old', NOW + 61)).resolves.toBeNull();

  const signedIn = await checkSignIn(db, 'luc', 'new', NOW + 62);

  expect(signedIn?.id).toBe(luc.id);
  await expect(setAccountPassword(db, luc.id, '', NOW)).rejects.toThrow(
    new AccountError('a password cannot be empty'),
  );
});

test('an account is removed, but never the last one', async () => {
  const db = await AccountStore.open(':memory:');
  const luc = await createAccount(db, { username: 'luc', password: 'a' }, NOW);
  const ada = await createAccount(db, { username: 'ada', password: 'b' }, NOW);

  expect(removeAccount(db, ada.id)).toBe('removed');
  expect(removeAccount(db, ada.id)).toBe('missing');
  expect(removeAccount(db, luc.id)).toBe('last');
  expect(db.all().map((account) => account.username)).toStrictEqual(['luc']);
});
