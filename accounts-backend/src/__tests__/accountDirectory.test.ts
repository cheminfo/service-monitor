import { expect, test } from 'vitest';

import {
  AccountError,
  createAccount,
  removeAccount,
  setAccountRole,
} from '../accounts.ts';
import type { AccountDirectory } from '../store/AccountDirectory.ts';
import { AccountStore } from '../store/AccountStore.ts';
import { accountDirectoryProblems } from '../store/accountDirectoryProblems.ts';

import { contactDirectory } from './contactDirectory.ts';

/**
 * A store behind a plain object, so a test can replace any of its methods.
 * @param store - The store.
 * @returns Its methods.
 */
function directoryOf(store: AccountStore): AccountDirectory {
  return {
    byId: (id) => store.byId(id),
    byUsername: (username) => store.byUsername(username),
    all: () => store.all(),
    count: () => store.count(),
    insert: (account) => store.insert(account),
    setPassword: (id, hash, at) => store.setPassword(id, hash, at),
    setRole: (id, role) => store.setRole(id, role),
    touchSignIn: (id, at) => store.touchSignIn(id, at),
    removeUnlessLastAdmin: (id) => store.removeUnlessLastAdmin(id),
    writeEnvAdmin: (admin) => store.writeEnvAdmin(admin),
    forgetEnvAdmins: () => store.forgetEnvAdmins(),
  };
}

test('the store of the package and a host table of its own keep every guarantee', async () => {
  await expect(
    accountDirectoryProblems(() => AccountStore.open(':memory:')),
  ).resolves.toStrictEqual([]);
  await expect(
    accountDirectoryProblems(contactDirectory),
  ).resolves.toStrictEqual([]);
});

test('a directory that breaks a guarantee is told which, and how', async () => {
  const problems = await accountDirectoryProblems(async () => {
    const store = await AccountStore.open(':memory:');
    return {
      ...directoryOf(store),
      // No unique username, listed backwards, and nobody ever removed.
      insert: (account) =>
        store.byUsername(account.username)?.id ?? store.insert(account),
      all: () => store.all().toReversed(),
      removeUnlessLastAdmin: () => false,
    };
  });

  expect(problems).toStrictEqual([
    'uniqueUsernames: insert took a username already taken',
    'allByUsername: all answered mia, luc, ada, expected ada, luc, mia',
    'lastAdmin: removeUnlessLastAdmin refused a reader',
    'lastAdmin: a removed account is found',
    'lastAdmin: setRole answered true for a missing id',
  ]);
});

test('a directory that throws is told where', async () => {
  const problems = await accountDirectoryProblems(
    () => ({}) as AccountDirectory,
  );

  expect(problems).toStrictEqual(
    [
      'rows',
      'uniqueUsernames',
      'allByUsername',
      'passwordAndSignIn',
      'lastAdmin',
      'envAdmin',
      'envAdminRefused',
    ].map(
      (check) =>
        `${check}: threw TypeError: directory.insert is not a function`,
    ),
  );
});

test('the package refuses the last administrator before it asks the directory', async () => {
  const store = await AccountStore.open(':memory:');
  const luc = await createAccount(store, {
    username: 'luc',
    password: 'a',
    role: 'admin',
  });
  const asked: string[] = [];
  // A directory that forgot the rule, and does whatever it is asked.
  const careless: AccountDirectory = {
    ...directoryOf(store),
    setRole: (id, role) => {
      asked.push(`setRole ${id} ${role}`);
      return true;
    },
    removeUnlessLastAdmin: (id) => {
      asked.push(`remove ${id}`);
      return true;
    },
  };

  expect(() => setAccountRole(careless, luc.id, 'write')).toThrow(
    new AccountError('lastAdmin'),
  );
  expect(removeAccount(careless, luc.id)).toBe('lastAdmin');
  expect(asked).toStrictEqual([]);

  const ada = await createAccount(store, {
    username: 'ada',
    password: 'b',
    role: 'admin',
  });

  expect(setAccountRole(careless, luc.id, 'write')?.id).toBe(luc.id);
  expect(removeAccount(careless, ada.id)).toBe('removed');
  expect(asked).toStrictEqual([`setRole ${luc.id} write`, `remove ${ada.id}`]);
});

test('a username taken while the password was hashed is refused, not stored twice', async () => {
  const store = await AccountStore.open(':memory:');
  let inserted = 0;
  const racing: AccountDirectory = {
    ...directoryOf(store),
    insert: (account) => {
      inserted++;
      return store.insert(account);
    },
  };

  const settled = await Promise.allSettled([
    createAccount(racing, { username: 'luc', password: 'a' }),
    createAccount(racing, { username: 'LUC', password: 'b' }),
  ]);
  // Either hash may finish first under load: whichever does wins.
  const refused = settled.filter(({ status }) => status === 'rejected');

  expect(settled.map(({ status }) => status).toSorted()).toStrictEqual([
    'fulfilled',
    'rejected',
  ]);
  expect(refused).toStrictEqual([
    { status: 'rejected', reason: new AccountError('usernameTaken') },
  ]);
  expect(inserted).toBe(1);
  expect(store.count()).toBe(1);
});
