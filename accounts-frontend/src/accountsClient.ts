import type { AccountRefusal, AccountRole } from './rules.ts';
import { DEFAULT_ACCOUNT_ROLE, isAccountRefusal } from './rules.ts';
import type { Account, AccountSession, AccountsResponse } from './types.ts';

/** A request the server refused, with the status it refused it with. */
export class AccountsRequestError extends Error {
  /** The HTTP status: 401 once the session has ended, 0 for no answer. */
  readonly status: number;
  /** Why, when the server named one of the refusals; else undefined. */
  readonly code: AccountRefusal | undefined;

  /**
   * A refusal.
   * @param message - what the server said
   * @param status - the HTTP status it answered with, 0 when none
   * @param code - why, when the server named a refusal
   */
  constructor(message: string, status: number, code?: AccountRefusal) {
    super(message);
    this.name = 'AccountsRequestError';
    this.status = status;
    this.code = code;
  }
}

/** The methods a request may use. */
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * A client for the routes of `service-accounts-backend`. The session is a
 * cookie no script can read, so nothing is kept here: the browser sends it.
 * @param apiBasePath - where the routes are mounted, e.g. `/v1/account` or
 *   `/v1/admin`; no trailing slash
 * @param fetcher - the fetch to call
 * @returns a method per route
 */
export function createAccountsClient(
  apiBasePath: string,
  fetcher: typeof fetch = fetch.bind(globalThis),
) {
  /**
   * One request, never answered from a cache.
   * @param path - the route
   * @param method - the method
   * @param body - what to send as JSON
   * @returns what the server answered
   * @throws {AccountsRequestError} When it answers with an error status, or
   * cannot be reached (status 0).
   */
  async function send<T>(
    path: string,
    method: Method = 'GET',
    body?: object,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${apiBasePath}${path}`, {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
    } catch {
      throw new AccountsRequestError('the server could not be reached', 0);
    }
    if (!response.ok) {
      const { message, code } = await refusalOf(response);
      throw new AccountsRequestError(message, response.status, code);
    }
    return (await response.json()) as T;
  }

  return {
    /**
     * Where this browser stands; a session older than a day comes back
     * renewed.
     * @returns the session
     */
    session: () => send<AccountSession>('/session'),
    /**
     * Sign in; the server answers with the cookie.
     * @param username - as typed
     * @param password - as typed
     * @returns the session
     */
    signIn: (username: string, password: string) =>
      send<AccountSession>('/login', 'POST', { username, password }),
    /**
     * Sign this browser out.
     * @returns the session, signed out
     */
    signOut: () => send<AccountSession>('/logout', 'POST'),
    /**
     * Every account; an administrator's only.
     * @returns them, by username
     */
    accounts: async () => {
      const { users } = await send<AccountsResponse>('/users');
      return users;
    },
    /**
     * Add an account; an administrator's only.
     * @param username - what it signs in with
     * @param password - its password
     * @param role - what it may do
     * @returns the account, as stored
     */
    addAccount: (
      username: string,
      password: string,
      role: AccountRole = DEFAULT_ACCOUNT_ROLE,
    ) => send<Account>('/users', 'POST', { username, password, role }),
    /**
     * Set another account's password, which signs it out everywhere; an
     * administrator's only.
     * @param id - the account's id
     * @param password - the new password
     * @returns the account
     */
    setPassword: (id: number, password: string) =>
      send<Account>(`/users/${id}`, 'PATCH', { password }),
    /**
     * Give another account a new role, which applies at its next request; an
     * administrator's only.
     * @param id - the account's id
     * @param role - its new role
     * @returns the account
     */
    setRole: (id: number, role: AccountRole) =>
      send<Account>(`/users/${id}`, 'PATCH', { role }),
    /**
     * Remove an account: neither the one signed in, the last administrator
     * nor the one the `.env` defines; an administrator's only.
     * @param id - the account's id
     * @returns the account removed
     */
    removeAccount: (id: number) => send<Account>(`/users/${id}`, 'DELETE'),
    /**
     * Change the password of the account signed in. The answer carries a new
     * session, since the old one ends with the old password.
     * @param currentPassword - the password in use
     * @param newPassword - the one replacing it
     * @returns the session, still signed in
     */
    changeOwnPassword: (currentPassword: string, newPassword: string) =>
      send<AccountSession>('/password', 'POST', {
        currentPassword,
        newPassword,
      }),
  };
}

/** What {@link createAccountsClient} returns. */
export type AccountsClient = ReturnType<typeof createAccountsClient>;

/**
 * What went wrong with a request, as the server put it.
 * @param response - the answer that was not a success
 * @returns the server's message, or the status when it gave none
 */
export async function messageOf(response: Response): Promise<string> {
  const { message } = await refusalOf(response);
  return message;
}

/**
 * What a refusal says, and why when it names one of the refusals.
 * @param response - the answer that was not a success
 * @returns its message, or the status when it gave none, and its code
 */
async function refusalOf(
  response: Response,
): Promise<{ message: string; code: AccountRefusal | undefined }> {
  let message = `the server answered ${response.status}`;
  let code: AccountRefusal | undefined;
  try {
    const body = (await response.json()) as {
      message?: unknown;
      code?: unknown;
    };
    if (typeof body.message === 'string' && body.message !== '') {
      message = body.message;
    }
    if (isAccountRefusal(body.code)) code = body.code;
  } catch {
    // A body that is not JSON says nothing useful; the status does.
  }
  return { message, code };
}

/**
 * What went wrong, written as a sentence: the server writes some of its
 * messages in lower case, to be quoted.
 * @param error - what a request threw
 * @returns the line to show
 */
export function sentenceOf(error: unknown): string {
  return asSentence(
    error instanceof Error ? error.message : 'the request failed',
  );
}

/**
 * A message written as a sentence: its first letter in capitals, and a full
 * stop unless it ends with one of its own.
 * @param message - the message
 * @returns the sentence, empty for a blank message
 */
export function asSentence(message: string): string {
  const trimmed = message.trim();
  if (trimmed === '') return '';
  const ending = /[!.?]$/.test(trimmed) ? '' : '.';
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${ending}`;
}
