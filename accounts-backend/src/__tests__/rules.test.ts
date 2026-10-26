import { expect, test } from 'vitest';

import { strongerRole } from '../guard.ts';
import {
  ACCOUNT_REFUSALS,
  ACCOUNT_ROLES,
  DEFAULT_ACCOUNT_ROLE,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  REFUSAL_MESSAGES,
  isAccountRefusal,
  isAccountRole,
  passwordProblem,
  roleAllows,
  toUsername,
  usernameProblem,
} from '../rules.ts';

test('three roles, each doing what the one below does, and read when none is named', () => {
  expect(ACCOUNT_ROLES).toStrictEqual(['read', 'write', 'admin']);
  expect(DEFAULT_ACCOUNT_ROLE).toBe('read');
  expect(
    ACCOUNT_ROLES.map((role) =>
      ACCOUNT_ROLES.map((needed) => roleAllows(role, needed)),
    ),
  ).toStrictEqual([
    [true, false, false],
    [true, true, false],
    [true, true, true],
  ]);
  expect([
    roleAllows(null, 'read'),
    roleAllows(undefined, 'read'),
  ]).toStrictEqual([false, false]);
});

test('a role is one of the three, and a route asking for more than its scope gets it', () => {
  expect(
    ['read', 'write', 'admin', 'Admin', 'owner', '', null, 3].map((value) =>
      isAccountRole(value),
    ),
  ).toStrictEqual([true, true, true, false, false, false, false, false]);
  expect([
    strongerRole('read', undefined),
    strongerRole('read', 'write'),
    strongerRole('admin', 'read'),
    strongerRole('write', 'admin'),
  ]).toStrictEqual(['read', 'write', 'admin', 'admin']);
});

test('a username is three to thirty plain characters, stored in lower case', () => {
  expect([
    MIN_USERNAME_LENGTH,
    MAX_USERNAME_LENGTH,
    MAX_PASSWORD_LENGTH,
  ]).toStrictEqual([3, 30, 200]);
  expect(toUsername('  Luc.Patiny ')).toBe('luc.patiny');
  expect(
    [
      'lpc',
      'luc.patiny-2_x',
      'lp',
      'l'.repeat(31),
      'luc patiny',
      '.luc',
      'luc@epfl.ch',
    ].map((username) => usernameProblem(username)),
  ).toStrictEqual([
    null,
    null,
    'usernameLength',
    'usernameLength',
    'usernameCharacters',
    'usernameCharacters',
    'usernameCharacters',
  ]);
});

test('a password is anything from one to two hundred characters', () => {
  expect(
    ['', 'x', 'x'.repeat(200), 'x'.repeat(201)].map((password) =>
      passwordProblem(password),
    ),
  ).toStrictEqual(['passwordEmpty', null, null, 'passwordTooLong']);
});

test('every refusal has an English sentence, filled with the limits it names', () => {
  expect(ACCOUNT_REFUSALS).toHaveLength(25);
  expect(Object.keys(REFUSAL_MESSAGES)).toStrictEqual([...ACCOUNT_REFUSALS]);
  expect(REFUSAL_MESSAGES.usernameLength).toBe(
    'A username has 3 to 30 characters.',
  );
  expect(REFUSAL_MESSAGES.passwordTooLong).toBe(
    'A password has at most 200 characters.',
  );

  for (const code of ACCOUNT_REFUSALS) {
    expect(REFUSAL_MESSAGES[code]).toMatch(/^[A-Z][^{}]*\.$/);
  }
});

test('a refusal code is one of the list, never one of Fastify’s', () => {
  expect(
    ['lastAdmin', 'FST_ERR_VALIDATION', '', undefined, 3].map((value) =>
      isAccountRefusal(value),
    ),
  ).toStrictEqual([true, false, false, false, false]);
});
