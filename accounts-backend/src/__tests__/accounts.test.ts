import { expect, test } from 'vitest';

import {
  AccountError,
  createAccount,
  removeAccount,
  setAccountPassword,
  setAccountRole,
  updateAccount,
} from '../accounts.ts';
import { verifyPassword } from '../password.ts';
import { checkSignIn, toAccount } from '../signIn.ts';
import { AccountStore } from '../store/AccountStore.ts';

/** 2026-10-02T12:00:00Z, in unix seconds. */
const NOW = Date.UTC(2026, 9, 2, 12) / 1000;

test('an account is stored in lower case, with its role, read when none is named', async () => {
  const store = await AccountStore.open(':memory:');

  const luc = await createAccount(
    store,
    { username: ' Luc ', password: 'lpc', role: 'admin' },
    NOW,
  );
  const ada = await createAccount(
    store,
    { username: 'ada', password: 'hers' },
    NOW,
  );

  expect(luc).toStrictEqual({
    id: 1,
    username: 'luc',
    passwordHash: expect.stringMatching(/^pbkdf2\$sha512\$210000\$/),
    role: 'admin',
    envManaged: false,
    createdAt: NOW,
    passwordChangedAt: NOW,
    lastSignInAt: null,
  });
  expect(ada.role).toBe('read');
  await expect(verifyPassword('lpc', luc.passwordHash)).resolves.toBe(true);
  expect(toAccount(luc)).toStrictEqual({
    id: 1,
    username: 'luc',
    role: 'admin',
    envManaged: false,
    createdAt: NOW,
    passwordChangedAt: NOW,
    lastSignInAt: null,
  });
});

test('a username is taken once, whatever its case, and a password cannot be empty', async () => {
  const store = await AccountStore.open(':memory:');
  await createAccount(store, { username: 'Luc', password: 'one' }, NOW);

  await expect(
    createAccount(store, { username: 'LUC', password: 'two' }, NOW),
  ).rejects.toThrow(new AccountError('usernameTaken'));
  await expect(
    createAccount(store, { username: 'ada', password: '' }, NOW),
  ).rejects.toThrow('A password cannot be empty.');
  await expect(
    createAccount(store, { username: 'lp', password: 'x' }, NOW),
  ).rejects.toMatchObject({
    code: 'usernameLength',
    message: 'A username has 3 to 30 characters.',
  });
});

test('only the right pair signs in, whatever the case of the username', async () => {
  const store = await AccountStore.open(':memory:');
  const luc = await createAccount(
    store,
    { username: 'luc', password: 'a password' },
    NOW,
  );

  const signedIn = await checkSignIn(store, ' LUC ', 'a password', NOW + 10);
  const wrongPassword = await checkSignIn(store, 'luc', 'a Password', NOW + 20);
  const nobody = await checkSignIn(store, 'ada', 'a password', NOW + 30);

  expect(signedIn).toStrictEqual({ ...luc, lastSignInAt: NOW + 10 });
  expect(wrongPassword).toBeNull();
  expect(nobody).toBeNull();
  expect(store.byId(luc.id)?.lastSignInAt).toBe(NOW + 10);
});

test('a new password replaces the old one', async () => {
  const store = await AccountStore.open(':memory:');
  const luc = await createAccount(
    store,
    { username: 'luc', password: 'old' },
    NOW,
  );

  const changed = await setAccountPassword(store, luc.id, 'new', NOW + 60);
  const missing = await setAccountPassword(store, 99, 'new', NOW + 60);

  expect(changed?.passwordChangedAt).toBe(NOW + 60);
  expect(changed?.passwordHash).not.toBe(luc.passwordHash);
  expect(missing).toBeUndefined();
  await expect(checkSignIn(store, 'luc', 'old', NOW + 61)).resolves.toBeNull();

  const signedIn = await checkSignIn(store, 'luc', 'new', NOW + 62);

  expect(signedIn?.id).toBe(luc.id);
  await expect(setAccountPassword(store, luc.id, '', NOW)).rejects.toThrow(
    new AccountError('passwordEmpty'),
  );
});

test('the last administrator is never demoted nor removed; anybody else is', async () => {
  const store = await AccountStore.open(':memory:');
  const luc = await createAccount(
    store,
    { username: 'luc', password: 'a', role: 'admin' },
    NOW,
  );
  const ada = await createAccount(
    store,
    { username: 'ada', password: 'b', role: 'write' },
    NOW,
  );

  expect(() => setAccountRole(store, luc.id, 'read')).toThrow(
    new AccountError('lastAdmin'),
  );
  expect(setAccountRole(store, luc.id, 'admin')?.role).toBe('admin');
  expect(setAccountRole(store, 99, 'read')).toBeUndefined();
  expect(removeAccount(store, luc.id)).toBe('lastAdmin');
  expect(removeAccount(store, ada.id)).toBe('removed');
  expect(removeAccount(store, ada.id)).toBe('missing');
  expect(store.all().map((account) => account.username)).toStrictEqual(['luc']);
});

test('a change checks the password before it writes the role', async () => {
  const store = await AccountStore.open(':memory:');
  await createAccount(store, { username: 'luc', password: 'a', role: 'admin' });
  const ada = await createAccount(store, { username: 'ada', password: 'b' });

  await expect(
    updateAccount(store, ada.id, { role: 'write', password: 'x'.repeat(201) }),
  ).rejects.toThrow('A password has at most 200 characters.');
  expect(store.byId(ada.id)?.role).toBe('read');

  const both = await updateAccount(store, ada.id, {
    role: 'write',
    password: 'new',
  });

  expect(both?.role).toBe('write');
  await expect(verifyPassword('new', both?.passwordHash ?? '')).resolves.toBe(
    true,
  );
  await expect(
    updateAccount(store, 99, { role: 'read' }),
  ).resolves.toBeUndefined();
  await expect(
    updateAccount(store, 99, { password: 'x' }),
  ).resolves.toBeUndefined();
});

test('the account the .env defines is changed by the .env alone', async () => {
  const store = await AccountStore.open(':memory:');
  const luc = await createAccount(store, { username: 'luc', password: 'a' });
  store.writeEnvAdmin({
    username: 'luc',
    passwordHash: luc.passwordHash,
    at: NOW,
  });

  await expect(setAccountPassword(store, luc.id, 'b')).rejects.toThrow(
    new AccountError('envManaged'),
  );
  expect(() => setAccountRole(store, luc.id, 'read')).toThrow(
    new AccountError('envManaged'),
  );
  expect(removeAccount(store, luc.id)).toBe('envManaged');
  expect(store.setPassword(luc.id, 'x', NOW)).toBe(false);
  expect(store.byId(luc.id)?.passwordHash).toBe(luc.passwordHash);
});
