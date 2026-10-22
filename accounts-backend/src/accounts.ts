import { hashPassword, verifyPassword } from './password.ts';
import type { AccountRow, AccountStore } from './store/AccountStore.ts';
import type { Account } from './types.ts';

/** The shortest username. */
export const MIN_USERNAME_LENGTH = 3;

/** The longest username, so it stays readable in the list of accounts. */
export const MAX_USERNAME_LENGTH = 30;

/** The longest password: PBKDF2 hashes anything, but nobody types more. */
export const MAX_PASSWORD_LENGTH = 200;

/** Letters, digits, dots, dashes and underscores, starting with no symbol. */
const USERNAME_PATTERN = /^[\da-z][\d._a-z-]*$/;

/** A change to the accounts that cannot be made, with the reason. */
export class AccountError extends Error {}

/** What an account is made of. */
export interface NewAccount {
  /** What it signs in with; stored in lower case. */
  username: string;
  /** Its password, in clear: only its hash is kept. */
  password: string;
}

/** A hash no password matches, so a sign-in as nobody costs a real check. */
let decoyHash: Promise<string> | undefined;

/**
 * A username as it is stored: trimmed and in lower case, so `Luc` and `luc`
 * are one account.
 * @param value - what was typed
 * @returns the username
 */
export function toUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Why a username cannot be used.
 * @param username - the username, as {@link toUsername} writes it
 * @returns the reason, or null when it can be
 */
export function usernameProblem(username: string): string | null {
  if (
    username.length < MIN_USERNAME_LENGTH ||
    username.length > MAX_USERNAME_LENGTH
  ) {
    return `a username has ${MIN_USERNAME_LENGTH} to ${MAX_USERNAME_LENGTH} characters`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'a username holds letters, digits, dots, dashes and underscores, and starts with a letter or a digit';
  }
  return null;
}

/**
 * Why a password cannot be used.
 * @param password - the password, in clear
 * @returns the reason, or null when it can be
 */
export function passwordProblem(password: string): string | null {
  if (password === '') return 'a password cannot be empty';
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `a password has at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

/**
 * Add an account.
 * @param store - the accounts
 * @param account - its username and password
 * @param now - when, in unix seconds
 * @returns the stored account
 * @throws {AccountError} When the username cannot be used or is taken, or the
 * password is empty or too long.
 */
export async function createAccount(
  store: AccountStore,
  account: NewAccount,
  now: number = nowSeconds(),
): Promise<AccountRow> {
  const username = toUsername(account.username);
  const problem =
    usernameProblem(username) ?? passwordProblem(account.password);
  if (problem !== null) throw new AccountError(problem);
  if (store.byUsername(username) !== undefined) {
    throw new AccountError(`there is already an account named ${username}`);
  }
  const id = store.insert({
    username,
    passwordHash: await hashPassword(account.password),
    createdAt: now,
  });
  return required(store, id);
}

/**
 * Create the first account, when the store has none.
 * @param store - the accounts
 * @param account - its username and password
 * @param now - when, in unix seconds
 * @returns the account created, or null when there already was one
 * @throws {AccountError} When the username cannot be used, or the password is
 * empty or too long.
 */
export async function ensureFirstAccount(
  store: AccountStore,
  account: NewAccount,
  now: number = nowSeconds(),
): Promise<AccountRow | null> {
  if (store.count() > 0) return null;
  const username = toUsername(account.username);
  const problem =
    usernameProblem(username) ?? passwordProblem(account.password);
  if (problem !== null) throw new AccountError(problem);
  const id = store.insertFirst({
    username,
    passwordHash: await hashPassword(account.password),
    createdAt: now,
  });
  return id === undefined ? null : required(store, id);
}

/**
 * Give an account a new password. Its sessions end, because each is signed
 * over the hash this replaces.
 * @param store - the accounts
 * @param id - the account's row id
 * @param password - the new password, in clear
 * @param now - when, in unix seconds
 * @returns the account, or undefined when there is no such account
 * @throws {AccountError} When the password is empty or too long.
 */
export async function setAccountPassword(
  store: AccountStore,
  id: number,
  password: string,
  now: number = nowSeconds(),
): Promise<AccountRow | undefined> {
  const problem = passwordProblem(password);
  if (problem !== null) throw new AccountError(problem);
  if (store.byId(id) === undefined) return undefined;
  store.setPassword(id, await hashPassword(password), now);
  return required(store, id);
}

/**
 * Remove an account, never the last one: somebody must still be able to sign
 * in.
 * @param store - the accounts
 * @param id - the account's row id
 * @returns what was done
 */
export function removeAccount(
  store: AccountStore,
  id: number,
): 'removed' | 'last' | 'missing' {
  if (store.byId(id) === undefined) return 'missing';
  return store.removeUnlessLast(id) ? 'removed' : 'last';
}

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
    decoyHash ??= hashPassword(crypto.randomUUID());
    await verifyPassword(password, await decoyHash);
    return null;
  }
  if (!(await verifyPassword(password, account.passwordHash))) return null;
  store.touchSignIn(account.id, now);
  return { ...account, lastSignInAt: now };
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

/**
 * An account that was just written.
 * @param store - the accounts
 * @param id - its row id
 * @returns it
 * @throws {Error} When it is not there, which only a concurrent removal does.
 */
function required(store: AccountStore, id: number): AccountRow {
  const row = store.byId(id);
  if (row === undefined) throw new Error(`account ${id} was removed meanwhile`);
  return row;
}
