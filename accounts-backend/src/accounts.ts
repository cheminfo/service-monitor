import { hashPassword } from './password.ts';
import type { AccountRefusal, AccountRole } from './rules.ts';
import {
  DEFAULT_ACCOUNT_ROLE,
  REFUSAL_MESSAGES,
  passwordProblem,
  toUsername,
  usernameProblem,
} from './rules.ts';
import { nowSeconds } from './signIn.ts';
import type { AccountDirectory } from './store/AccountDirectory.ts';
import type { AccountRow } from './store/accountRows.ts';
import type { AccountPatchBody } from './types.ts';

/** A change to the accounts that cannot be made, with the reason. */
export class AccountError extends Error {
  override name = 'AccountError';
  /** Why, as the code a page writes in its own language. */
  readonly code: AccountRefusal;

  /**
   * A refusal, its message in English.
   * @param code - why
   */
  constructor(code: AccountRefusal) {
    super(REFUSAL_MESSAGES[code]);
    this.code = code;
  }
}

/** What an account is made of. */
export interface NewAccount {
  /** What it signs in with; stored in lower case. */
  username: string;
  /** Its password, in clear: only its hash is kept. */
  password: string;
  /**
   * What it may do.
   * @default 'read'
   */
  role?: AccountRole;
}

/**
 * Add an account. The username is looked up again once the password is
 * hashed, in the same turn as the write, so two requests adding it at once
 * cannot both succeed.
 * @param store - the accounts
 * @param account - its username, its password and its role
 * @param now - when, in unix seconds
 * @returns the stored account
 * @throws {AccountError} When the username cannot be used or is taken, or the
 * password is empty or too long.
 */
export async function createAccount(
  store: AccountDirectory,
  account: NewAccount,
  now: number = nowSeconds(),
): Promise<AccountRow> {
  const username = toUsername(account.username);
  const problem =
    usernameProblem(username) ?? passwordProblem(account.password);
  if (problem !== null) throw new AccountError(problem);
  if (store.byUsername(username) !== undefined) {
    throw new AccountError('usernameTaken');
  }
  const passwordHash = await hashPassword(account.password);
  if (store.byUsername(username) !== undefined) {
    throw new AccountError('usernameTaken');
  }
  const id = store.insert({
    username,
    passwordHash,
    role: account.role ?? DEFAULT_ACCOUNT_ROLE,
    createdAt: now,
  });
  return required(store, id);
}

/**
 * Give an account a new password. Its sessions end, because each is signed
 * over the hash this replaces.
 * @param store - the accounts
 * @param id - the account's row id
 * @param password - the new password, in clear
 * @param now - when, in unix seconds
 * @returns the account, or undefined when there is no such account
 * @throws {AccountError} When the password is empty or too long, or the
 * `.env` defines the account.
 */
export async function setAccountPassword(
  store: AccountDirectory,
  id: number,
  password: string,
  now: number = nowSeconds(),
): Promise<AccountRow | undefined> {
  const problem = passwordProblem(password);
  if (problem !== null) throw new AccountError(problem);
  const account = store.byId(id);
  if (account === undefined) return undefined;
  if (account.envManaged) throw new AccountError('envManaged');
  if (!store.setPassword(id, await hashPassword(password), now)) {
    // Refused by the statement itself: the account went, or the `.env` took
    // it over meanwhile.
    if (store.byId(id) === undefined) return undefined;
    throw new AccountError('envManaged');
  }
  return required(store, id);
}

/**
 * Give an account a new role, which applies at its next request: a session
 * reads its account again every time. The last administrator is refused here
 * before the directory is asked, in the same turn as the write, and again by
 * the directory itself.
 * @param store - the accounts
 * @param id - the account's row id
 * @param role - its new role
 * @returns the account, or undefined when there is no such account
 * @throws {AccountError} When the `.env` defines the account, or it is the
 * last administrator and the role is not `admin`.
 */
export function setAccountRole(
  store: AccountDirectory,
  id: number,
  role: AccountRole,
): AccountRow | undefined {
  const account = store.byId(id);
  if (account === undefined) return undefined;
  if (account.envManaged) throw new AccountError('envManaged');
  if (role !== 'admin' && isLastAdmin(store, account)) {
    throw new AccountError('lastAdmin');
  }
  if (!store.setRole(id, role)) {
    // Refused by the statement itself: the last administrator, unless the
    // account went meanwhile.
    if (store.byId(id) === undefined) return undefined;
    throw new AccountError('lastAdmin');
  }
  return required(store, id);
}

/**
 * Change another account's password, its role, or both, as `PATCH /users/:id`
 * asks. The password is checked before anything is written, so a refused one
 * leaves the role as it was.
 * @param store - the accounts
 * @param id - the account's row id
 * @param patch - its new password, its new role, or both
 * @param now - when, in unix seconds
 * @returns the account, or undefined when there is no such account
 * @throws {AccountError} When the password cannot be used, the `.env` defines
 * the account, or it is the last administrator and the role is not `admin`.
 */
export async function updateAccount(
  store: AccountDirectory,
  id: number,
  patch: AccountPatchBody,
  now: number = nowSeconds(),
): Promise<AccountRow | undefined> {
  const { password, role } = patch;
  const problem = password === undefined ? null : passwordProblem(password);
  if (problem !== null) throw new AccountError(problem);
  let account =
    role === undefined ? store.byId(id) : setAccountRole(store, id, role);
  if (account !== undefined && password !== undefined) {
    account = await setAccountPassword(store, id, password, now);
  }
  return account;
}

/**
 * Remove an account: never the last administrator, so somebody can still
 * manage the accounts, and never the one the `.env` defines.
 * @param store - the accounts
 * @param id - the account's row id
 * @returns what was done
 */
export function removeAccount(
  store: AccountDirectory,
  id: number,
): 'removed' | 'missing' | 'lastAdmin' | 'envManaged' {
  const account = store.byId(id);
  if (account === undefined) return 'missing';
  if (account.envManaged) return 'envManaged';
  if (isLastAdmin(store, account)) return 'lastAdmin';
  if (store.removeUnlessLastAdmin(id)) return 'removed';
  return store.byId(id) === undefined ? 'missing' : 'lastAdmin';
}

/**
 * Whether an account is the only administrator left.
 * @param store - the accounts
 * @param account - the account
 * @returns true when it is an administrator and no other account is
 */
function isLastAdmin(store: AccountDirectory, account: AccountRow): boolean {
  if (account.role !== 'admin') return false;
  const accounts = store.all();
  for (const other of accounts) {
    if (other.role === 'admin' && other.id !== account.id) return false;
  }
  return true;
}

/**
 * An account that was just written.
 * @param store - the accounts
 * @param id - its row id
 * @returns it
 * @throws {Error} When it is not there, which only a concurrent removal does.
 */
function required(store: AccountDirectory, id: number): AccountRow {
  const row = store.byId(id);
  if (row === undefined) throw new Error(`account ${id} was removed meanwhile`);
  return row;
}
