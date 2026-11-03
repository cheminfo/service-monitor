import type { VerifyLegacyHash } from './password.ts';
import { hashPassword, isPackageHash, verifyPassword } from './password.ts';
import { toUsername } from './rules.ts';
import type { AccountDirectory } from './store/AccountDirectory.ts';
import type { AccountRow } from './store/accountRows.ts';
import type { Account } from './types.ts';

/** A hash no password matches, so a sign-in as nobody costs a real check. */
let decoyHash: Promise<string> | undefined;

/**
 * The account a username and a password sign in to.
 *
 * A username nobody has costs a password check all the same, so the time an
 * answer takes does not say which usernames exist. A hash the host kept
 * before, in a format of its own, is checked by `verifyLegacyHash`, and once
 * it matches it is replaced by the package's: it is asked once per account.
 * @param directory - the accounts, where the sign-in is recorded
 * @param username - the username, as typed
 * @param password - the password, as typed
 * @param now - when, in unix seconds
 * @param verifyLegacyHash - checks a hash of the host's own format; without
 * it, such a hash never matches
 * @returns the account, or null when the pair is not one
 */
export async function checkSignIn(
  directory: AccountDirectory,
  username: string,
  password: string,
  now: number = nowSeconds(),
  verifyLegacyHash?: VerifyLegacyHash,
): Promise<AccountRow | null> {
  const account = directory.byUsername(toUsername(username));
  if (account === undefined) {
    await checkAgainstNobody(password);
    return null;
  }
  const { id, passwordHash, passwordChangedAt } = account;
  if (!(await passwordMatches(password, passwordHash, verifyLegacyHash))) {
    return null;
  }
  let signedIn = account;
  if (!isPackageHash(passwordHash)) {
    const upgraded = await hashPassword(password);
    // Unless the password changed while it was hashed. The password itself
    // is the same, so its date stays.
    if (
      directory.byId(id)?.passwordHash === passwordHash &&
      directory.setPassword(id, upgraded, passwordChangedAt)
    ) {
      signedIn = { ...account, passwordHash: upgraded };
    }
  }
  directory.touchSignIn(id, now);
  return { ...signedIn, lastSignInAt: now };
}

/**
 * Whether a password is the one a stored hash was made from: the package's
 * own hash, or one of the host's former format checked by `verifyLegacyHash`.
 * A hash of another format with nothing to check it costs a password check
 * all the same.
 * @param password - the password, as typed
 * @param hash - the stored hash
 * @param verifyLegacyHash - checks a hash of the host's own format, if any
 * @returns true when they match
 */
export async function passwordMatches(
  password: string,
  hash: string,
  verifyLegacyHash: VerifyLegacyHash | undefined,
): Promise<boolean> {
  if (isPackageHash(hash)) return verifyPassword(password, hash);
  if (verifyLegacyHash === undefined) {
    await checkAgainstNobody(password);
    return false;
  }
  return verifyLegacyHash(password, hash);
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
