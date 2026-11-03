import type { AccountRole } from '../rules.ts';

import type { AccountDirectory } from './AccountDirectory.ts';
import type { AccountRow } from './accountRows.ts';

/**
 * Says a problem unless what was checked holds.
 * @param holds - whether it holds
 * @param problem - what is wrong otherwise
 */
export type Report = (holds: boolean, problem: string) => void;

/**
 * Says how a row a directory answered differs from the one expected, field by
 * field. Fields of the host's beyond those are not read.
 * @param report - where to say it
 * @param label - what answered it: `byId`, say
 * @param actual - the row answered
 * @param expected - the row expected
 */
export function reportRow(
  report: Report,
  label: string,
  actual: AccountRow | undefined,
  expected: AccountRow,
): void {
  if (actual === undefined) {
    report(false, `${label} found no ${expected.username}`);
    return;
  }
  for (const field of FIELDS) {
    report(
      Object.is(actual[field], expected[field]),
      `${label} answered ${field} ${JSON.stringify(actual[field])}, expected ${JSON.stringify(expected[field])}`,
    );
  }
}

/** The fields of a row the package reads. */
const FIELDS = [
  'id',
  'username',
  'passwordHash',
  'role',
  'envManaged',
  'createdAt',
  'passwordChangedAt',
  'lastSignInAt',
] as const;

/**
 * Add an account, created at 1000 with the hash `hash-<username>`.
 * @param directory - the directory
 * @param username - its username
 * @param role - its role
 * @returns its id
 */
export function add(
  directory: AccountDirectory,
  username: string,
  role: AccountRole = 'read',
): number {
  return directory.insert({
    username,
    passwordHash: `hash-${username}`,
    role,
    createdAt: 1000,
  });
}

/**
 * The row `add` writes.
 * @param id - its id
 * @param username - its username
 * @param role - its role
 * @returns the row
 */
export function row(
  id: number,
  username: string,
  role: AccountRole,
): AccountRow {
  return {
    id,
    username,
    passwordHash: `hash-${username}`,
    role,
    envManaged: false,
    createdAt: 1000,
    passwordChangedAt: 1000,
    lastSignInAt: null,
  };
}

/**
 * The role of an account.
 * @param directory - the directory
 * @param id - its id
 * @returns it, or undefined when there is no such account
 */
export function roleOf(directory: AccountDirectory, id: number) {
  return directory.byId(id)?.role;
}
