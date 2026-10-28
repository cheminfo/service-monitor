import { hashPassword, verifyPassword } from './password.ts';
import { toUsername } from './rules.ts';
import type { AccountRow, AccountStore } from './store/AccountStore.ts';
import type { Account } from './types.ts';

/** A hash no password matches, so a sign-in as nobody costs a real check. */
let decoyHash: Promise<string> | undefined;

/**
 * The account a username and a password sign in to.
 *
 * A username nobody has costs a password check all the same, so the time an
 * answer takes does not say which usernames exist.
 * @param store - the accounts, where the sign-in is recorded
 * @param username - the username, as typed
 * @param password - the password, as typed
 * @param now - when, in unix seconds
 * @returns the account, or null when the pair is not one
 */
export async function checkSignIn(
  store: AccountStore,
  username: string,
  password: string,
  now: number = nowSeconds(),
): Promise<AccountRow | null> {
  const account = store.byUsername(toUsername(username));
  if (account === undefined) {
    await checkAgainstNobody(password);
    return null;
  }
  if (!(await verifyPassword(password, account.passwordHash))) return null;
  store.touchSignIn(account.id, now);
  return { ...account, lastSignInAt: now };
}

/**
 * Check a password against a hash no password matches, so that refusing a
 * sign-in nobody can pass takes as long as refusing a wrong password.
 * @param password - the password, as typed
 */
export async function checkAgainstNobody(password: string): Promise<void> {
  decoyHash ??= hashPassword(crypto.randomUUID());
  await verifyPassword(password, await decoyHash);
}

/**
 * An account, as the routes list it.
 * @param row - the stored row
 * @returns the account, without its password hash
 */
export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    envManaged: row.envManaged,
    createdAt: row.createdAt,
    passwordChangedAt: row.passwordChangedAt,
    lastSignInAt: row.lastSignInAt,
  };
}

/**
 * The current time, as the store keeps it.
 * @returns unix seconds
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
