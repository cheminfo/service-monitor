import type { Account, AccountSession, AccountsResponse } from './types.ts';

/** A request the server refused, with the status it refused it with. */
export class AccountsRequestError extends Error {
  /** The HTTP status: 401 once the session has ended. */
  readonly status: number;

  /**
   * A refusal.
   * @param message - what the server said
   * @param status - the HTTP status it answered with
   */
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AccountsRequestError';
    this.status = status;
  }
}

/** The methods a request may use. */
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * A client for the routes of `service-accounts-backend`. The session is a
 * cookie no script can read, so nothing is kept here: the browser sends it.
 * @param apiBasePath - where the routes are mounted, e.g. `/v1/admin`; no
 *   trailing slash
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
   * @throws {AccountsRequestError} When it answers with an error status.
   */
  async function send<T>(
    path: string,
    method: Method = 'GET',
    body?: object,
  ): Promise<T> {
    const response = await fetcher(`${apiBasePath}${path}`, {
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
    if (!response.ok) {
      throw new AccountsRequestError(
        await messageOf(response),
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  return {
    /**
     * Where this browser stands.
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
     * Every account.
     * @returns them, by username
     */
    accounts: async () => {
      const { users } = await send<AccountsResponse>('/users');
      return users;
    },
    /**
     * Add an account.
     * @param username - what it signs in with
     * @param password - its password
     * @returns the account, as stored
     */
    addAccount: (username: string, password: string) =>
      send<Account>('/users', 'POST', { username, password }),
    /**
     * Set another account's password, which signs it out everywhere.
     * @param id - the account's id
     * @param password - the new password
     * @returns the account
     */
    setPassword: (id: number, password: string) =>
      send<Account>(`/users/${id}`, 'PATCH', { password }),
    /**
     * Remove an account: neither the one signed in nor the last one.
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
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message !== '') {
      return body.message;
    }
  } catch {
    // A body that is not JSON says nothing useful; the status does.
  }
  return `the server answered ${response.status}`;
}

/**
 * What went wrong, written as a sentence: the server writes its messages in
 * lower case, to be quoted.
 * @param error - what a request threw
 * @returns the line to show
 */
export function sentenceOf(error: unknown): string {
  const message = (
    error instanceof Error ? error.message : 'the request failed'
  ).trim();
  const ending = /[!.?]$/.test(message) ? '' : '.';
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}${ending}`;
}
